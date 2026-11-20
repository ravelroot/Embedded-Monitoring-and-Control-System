import type { FrameLog, LinkStats } from '../../shared/model';
import { type DecodeError, encodeFrame, type Frame, FrameDecoder, MSG_NAMES, MsgType, STATUS_MESSAGES, toHex } from './codec';
import type { Transport } from './transport';

export class DeviceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceError';
  }
}

interface Pending {
  type: number;
  expected: number;
  resolve: (frame: Frame) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  sentAt: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
}

export interface LinkListener {
  unsolicited(frame: Frame): void;
  closed(reason: string): void;
  log(entry: FrameLog): void;
}

const RESPONSE_TYPES: Record<number, number> = {
  [MsgType.Hello]: MsgType.Info,
  [MsgType.Ping]: MsgType.Pong,
  [MsgType.GetConfig]: MsgType.Config,
  [MsgType.GetRules]: MsgType.Rules,
};

export class DeviceLink {
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, Pending>();
  private readonly latencies: number[] = [];
  private seq = Math.floor(Math.random() * 0xffff);
  private open = false;
  readonly stats: LinkStats = {
    txFrames: 0,
    rxFrames: 0,
    crcErrors: 0,
    decodeErrors: 0,
    timeouts: 0,
    retries: 0,
    latencyAvgMs: 0,
    latencyP95Ms: 0,
    bytesIn: 0,
    bytesOut: 0,
  };

  constructor(
    private readonly transport: Transport,
    private readonly listener: LinkListener,
  ) {}

  get label(): string {
    return this.transport.label;
  }

  async start(): Promise<void> {
    await this.transport.open({
      data: (chunk) => this.receive(chunk),
      close: (reason) => this.handleClose(reason),
    });
    this.open = true;
  }

  async stop(): Promise<void> {
    this.open = false;
    this.failAll(new DeviceError('Conexão encerrada.'));
    await this.transport.close();
  }

  async request(type: number, body: Uint8Array = new Uint8Array(0), options: RequestOptions = {}): Promise<Frame> {
    const retries = options.retries ?? 2;
    let lastError: Error = new DeviceError('Sem resposta do dispositivo.');
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        this.stats.retries++;
      }
      try {
        return await this.send(type, body, options.timeoutMs ?? 800);
      } catch (error) {
        lastError = error as Error;
        if (!(error instanceof DeviceError) || !/Sem resposta/.test(error.message)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async command(type: number, body: Uint8Array = new Uint8Array(0), options: RequestOptions = {}): Promise<void> {
    const frame = await this.request(type, body, options);
    const status = frame.body[1] ?? 255;
    if (status !== 0) {
      throw new DeviceError(STATUS_MESSAGES[status] ?? `Erro ${status} do dispositivo.`);
    }
  }

  private send(type: number, body: Uint8Array, timeoutMs: number): Promise<Frame> {
    if (!this.open) {
      return Promise.reject(new DeviceError('Dispositivo desconectado.'));
    }
    this.seq = (this.seq + 1) & 0xffff;
    const seq = this.seq;
    const wire = encodeFrame(type, seq, body);
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        this.stats.timeouts++;
        reject(new DeviceError(`Sem resposta do dispositivo para ${MSG_NAMES[type] ?? type}.`));
      }, timeoutMs);
      this.pending.set(seq, { type, expected: RESPONSE_TYPES[type] ?? MsgType.Ack, resolve, reject, timer, sentAt: performance.now() });
      this.stats.txFrames++;
      this.stats.bytesOut += wire.length;
      this.listener.log({ at: Date.now(), direction: 'tx', type, name: MSG_NAMES[type] ?? '?', seq, length: body.length, hex: toHex(wire) });
      this.transport.write(wire).catch((error: Error) => {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(new DeviceError(error.message));
      });
    });
  }

  private receive(chunk: Uint8Array): void {
    this.stats.bytesIn += chunk.length;
    this.decoder.push(
      chunk,
      (frame, raw) => this.dispatch(frame, raw),
      (error) => this.decodeError(error),
    );
  }

  private dispatch(frame: Frame, raw: Uint8Array): void {
    this.stats.rxFrames++;
    this.listener.log({
      at: Date.now(),
      direction: 'rx',
      type: frame.type,
      name: MSG_NAMES[frame.type] ?? '?',
      seq: frame.seq,
      length: frame.body.length,
      hex: toHex(raw),
    });
    const pending = this.pending.get(frame.seq);
    const matchesAck = frame.type === MsgType.Ack && frame.body[0] === pending?.type;
    if (pending && (frame.type === pending.expected && (frame.type !== MsgType.Ack || matchesAck))) {
      clearTimeout(pending.timer);
      this.pending.delete(frame.seq);
      this.recordLatency(performance.now() - pending.sentAt);
      pending.resolve(frame);
      return;
    }
    if (frame.type === MsgType.Telemetry || frame.type === MsgType.Event) {
      this.listener.unsolicited(frame);
    }
  }

  private decodeError(error: DecodeError): void {
    if (error === 'crc') {
      this.stats.crcErrors++;
    } else {
      this.stats.decodeErrors++;
    }
    this.listener.log({ at: Date.now(), direction: 'err', type: 0, name: `erro: ${error}`, seq: 0, length: 0, hex: '' });
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 200) {
      this.latencies.shift();
    }
    const sorted = [...this.latencies].sort((a, b) => a - b);
    this.stats.latencyAvgMs = Math.round((sorted.reduce((sum, value) => sum + value, 0) / sorted.length) * 10) / 10;
    this.stats.latencyP95Ms = Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 10) / 10;
  }

  private handleClose(reason: string): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.failAll(new DeviceError(reason));
    this.listener.closed(reason);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
