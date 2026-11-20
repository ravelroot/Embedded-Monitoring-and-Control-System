import { SerialPort } from 'serialport';

import type { SerialPortInfo } from '../../shared/model';
import type { Transport, TransportHandlers } from './transport';

const BAUD_RATE = 115200;
const ESP32_BRIDGES = ['10c4', '1a86', '0403', '303a'];

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list().catch((error: Error) => {
    throw new Error(`Não foi possível listar as portas seriais: ${error.message}`);
  });
  return ports
    .map((port) => {
      const vendor = (port.vendorId ?? '').toLowerCase();
      return {
        path: port.path,
        manufacturer: port.manufacturer ?? '',
        description: port.friendlyName ?? port.pnpId ?? '',
        likelyEsp32: ESP32_BRIDGES.includes(vendor),
      };
    })
    .sort((a, b) => Number(b.likelyEsp32) - Number(a.likelyEsp32) || a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));
}

export class SerialTransport implements Transport {
  private port: SerialPort | null = null;
  private closing = false;

  constructor(private readonly path: string) {}

  get label(): string {
    return this.path;
  }

  async open(handlers: TransportHandlers): Promise<void> {
    const port = new SerialPort({ path: this.path, baudRate: BAUD_RATE, autoOpen: false, hupcl: false });
    await new Promise<void>((resolve, reject) => port.open((error) => (error ? reject(new Error(describe(error, this.path))) : resolve())));
    await new Promise<void>((resolve) => port.set({ dtr: false, rts: false }, () => resolve()));
    port.on('data', (chunk: Buffer) => handlers.data(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
    port.on('close', () => handlers.close(this.closing ? 'Desconectado pelo usuário.' : 'A porta serial foi fechada (cabo removido?).'));
    port.on('error', (error) => handlers.close(describe(error, this.path)));
    this.port = port;
  }

  async write(data: Uint8Array): Promise<void> {
    const port = this.port;
    if (!port?.isOpen) {
      throw new Error('Porta serial fechada.');
    }
    await new Promise<void>((resolve, reject) => port.write(Buffer.from(data), (error) => (error ? reject(error) : resolve())));
  }

  async close(): Promise<void> {
    const port = this.port;
    this.port = null;
    if (!port?.isOpen) {
      return;
    }
    this.closing = true;
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

function describe(error: Error, path: string): string {
  const message = error.message ?? String(error);
  if (/access denied|EBUSY|resource busy/i.test(message)) {
    return `A porta ${path} está em uso por outro programa (feche o monitor serial da IDE).`;
  }
  if (/file not found|ENOENT|cannot open/i.test(message)) {
    return `A porta ${path} não existe mais. Reconecte o cabo USB.`;
  }
  return `Erro na porta ${path}: ${message}`;
}
