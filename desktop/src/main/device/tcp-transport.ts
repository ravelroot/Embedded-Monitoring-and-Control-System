import { Socket } from 'node:net';

import type { Transport, TransportHandlers } from './transport';

const IAC = 0xff;
const DONT = 0xfe;
const DO = 0xfd;
const WONT = 0xfc;
const WILL = 0xfb;
const SB = 0xfa;
const SE = 0xf0;

export class TelnetFilter {
  private state: 'data' | 'iac' | 'option' | 'sub' | 'subIac' = 'data';
  private command = 0;

  constructor(private readonly reply: (bytes: Uint8Array) => void) {}

  feed(chunk: Uint8Array): Uint8Array {
    const output: number[] = [];
    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) {
            this.state = 'iac';
          } else {
            output.push(byte);
          }
          break;
        case 'iac':
          if (byte === IAC) {
            output.push(IAC);
            this.state = 'data';
          } else if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
            this.command = byte;
            this.state = 'option';
          } else if (byte === SB) {
            this.state = 'sub';
          } else {
            this.state = 'data';
          }
          break;
        case 'option':
          if (this.command === DO) {
            this.reply(Uint8Array.of(IAC, WONT, byte));
          } else if (this.command === WILL) {
            this.reply(Uint8Array.of(IAC, DONT, byte));
          }
          this.state = 'data';
          break;
        case 'sub':
          if (byte === IAC) {
            this.state = 'subIac';
          }
          break;
        case 'subIac':
          this.state = byte === SE ? 'data' : 'sub';
          break;
      }
    }
    return Uint8Array.from(output);
  }

  static escape(data: Uint8Array): Uint8Array {
    const output: number[] = [];
    for (const byte of data) {
      output.push(byte);
      if (byte === IAC) {
        output.push(IAC);
      }
    }
    return Uint8Array.from(output);
  }
}

export class TcpTransport implements Transport {
  private socket: Socket | null = null;
  private closing = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly telnet: boolean,
  ) {}

  get label(): string {
    return `${this.host}:${this.port}`;
  }

  async open(handlers: TransportHandlers): Promise<void> {
    const socket = new Socket();
    socket.setNoDelay(true);
    const filter = new TelnetFilter((bytes) => socket.write(bytes));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Sem resposta de ${this.label} em 5 s.`));
      }, 5000);
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Não foi possível conectar em ${this.label}: ${error.message}`));
      });
      socket.connect(this.port, this.host, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    socket.on('data', (chunk: Buffer) => {
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      handlers.data(this.telnet ? filter.feed(bytes) : bytes);
    });
    socket.on('close', () => handlers.close(this.closing ? 'Desconectado pelo usuário.' : `A conexão com ${this.label} foi encerrada.`));
    socket.on('error', (error) => handlers.close(`Erro de rede: ${error.message}`));
    this.socket = socket;
  }

  async write(data: Uint8Array): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error('Conexão TCP fechada.');
    }
    const payload = this.telnet ? TelnetFilter.escape(data) : data;
    await new Promise<void>((resolve, reject) => socket.write(payload, (error) => (error ? reject(error) : resolve())));
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
    this.closing = true;
    socket.destroy();
  }
}
