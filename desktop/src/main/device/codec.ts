import {
  CHANNELS,
  type DeviceConfig,
  type DeviceInfo,
  NO_OUTPUT,
  OUTPUTS,
  type Rule,
  type RuleSlot,
  type Severity,
} from '../../shared/model';

export const PROTOCOL_VERSION = 1;
export const HEADER_SIZE = 6;
export const MAX_BODY = 240;
export const CONFIG_WIRE_SIZE = 6 + CHANNELS.length * 8;
export const RULE_WIRE_SIZE = 19;

export const MsgType = {
  Hello: 0x01,
  Ping: 0x02,
  GetConfig: 0x03,
  GetRules: 0x04,
  SetOutput: 0x10,
  SetConfig: 0x11,
  SetCalibration: 0x12,
  SetRule: 0x13,
  ClearRule: 0x14,
  Save: 0x15,
  Reboot: 0x16,
  FactoryReset: 0x17,
  Ack: 0x80,
  Info: 0x81,
  Pong: 0x82,
  Config: 0x83,
  Rules: 0x84,
  Telemetry: 0x90,
  Event: 0x91,
} as const;

export const MSG_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(MsgType).map(([name, value]) => [value, name]),
);

export const STATUS_MESSAGES: Record<number, string> = {
  0: 'Ok',
  1: 'Comando desconhecido pelo firmware',
  2: 'Valor recusado pelo dispositivo',
  3: 'Tamanho de mensagem inválido',
  4: 'Falha ao gravar na memória do dispositivo',
};

export type DecodeError = 'cobs' | 'short' | 'length' | 'crc' | 'version' | 'overflow';

export interface Frame {
  version: number;
  type: number;
  seq: number;
  body: Uint8Array;
}

export function crc16(data: Uint8Array, seed = 0xffff): number {
  let crc = seed;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function cobsEncode(input: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length + Math.floor(input.length / 254) + 1);
  let codeIndex = 0;
  let writeIndex = 1;
  let code = 1;
  for (const byte of input) {
    if (byte === 0) {
      output[codeIndex] = code;
      codeIndex = writeIndex++;
      code = 1;
      continue;
    }
    output[writeIndex++] = byte;
    code++;
    if (code === 0xff) {
      output[codeIndex] = code;
      codeIndex = writeIndex++;
      code = 1;
    }
  }
  output[codeIndex] = code;
  return output.subarray(0, writeIndex);
}

export function cobsDecode(input: Uint8Array): Uint8Array | null {
  const output = new Uint8Array(input.length);
  let readIndex = 0;
  let writeIndex = 0;
  while (readIndex < input.length) {
    const code = input[readIndex];
    if (code === 0 || readIndex + code > input.length) {
      return null;
    }
    readIndex++;
    for (let i = 1; i < code; i++) {
      output[writeIndex++] = input[readIndex++];
    }
    if (code !== 0xff && readIndex < input.length) {
      output[writeIndex++] = 0;
    }
  }
  return output.subarray(0, writeIndex);
}

export function encodeFrame(type: number, seq: number, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (body.length > MAX_BODY) {
    throw new RangeError('Corpo da mensagem maior que o limite do protocolo.');
  }
  const payload = new Uint8Array(HEADER_SIZE + body.length + 2);
  const view = new DataView(payload.buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setUint8(1, type);
  view.setUint16(2, seq & 0xffff, true);
  view.setUint16(4, body.length, true);
  payload.set(body, HEADER_SIZE);
  view.setUint16(HEADER_SIZE + body.length, crc16(payload.subarray(0, HEADER_SIZE + body.length)), true);
  const encoded = cobsEncode(payload);
  const wire = new Uint8Array(encoded.length + 1);
  wire.set(encoded);
  return wire;
}

export function decodePayload(payload: Uint8Array): Frame | DecodeError {
  if (payload.length < HEADER_SIZE + 2) {
    return 'short';
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const length = view.getUint16(4, true);
  if (length > MAX_BODY || payload.length !== HEADER_SIZE + length + 2) {
    return 'length';
  }
  if (crc16(payload.subarray(0, payload.length - 2)) !== view.getUint16(payload.length - 2, true)) {
    return 'crc';
  }
  const version = view.getUint8(0);
  if (version !== PROTOCOL_VERSION) {
    return 'version';
  }
  return { version, type: view.getUint8(1), seq: view.getUint16(2, true), body: payload.slice(HEADER_SIZE, HEADER_SIZE + length) };
}

const MAX_WIRE = 260;

export class FrameDecoder {
  private buffer = new Uint8Array(MAX_WIRE);
  private size = 0;
  private overflow = false;

  push(chunk: Uint8Array, onFrame: (frame: Frame, raw: Uint8Array) => void, onError: (error: DecodeError) => void): void {
    for (const byte of chunk) {
      if (byte !== 0) {
        if (this.size >= this.buffer.length) {
          this.overflow = true;
        } else {
          this.buffer[this.size++] = byte;
        }
        continue;
      }
      if (this.overflow) {
        this.overflow = false;
        this.size = 0;
        onError('overflow');
        continue;
      }
      if (this.size === 0) {
        continue;
      }
      const raw = this.buffer.slice(0, this.size);
      this.size = 0;
      const payload = cobsDecode(raw);
      if (!payload) {
        onError('cobs');
        continue;
      }
      const result = decodePayload(payload);
      if (typeof result === 'string') {
        onError(result);
      } else {
        onFrame(result, raw);
      }
    }
  }

  reset(): void {
    this.size = 0;
    this.overflow = false;
  }
}

export class Writer {
  private bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }

  u32(value: number): this {
    return this.u16(value & 0xffff).u16(value >>> 16);
  }

  f32(value: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    return this.u32(view.getUint32(0, true));
  }

  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private take(size: number): number {
    if (this.offset + size > this.data.length) {
      throw new RangeError('Mensagem truncada.');
    }
    const start = this.offset;
    this.offset += size;
    return start;
  }

  u8(): number {
    return this.view.getUint8(this.take(1));
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }

  u64hex(): string {
    const low = this.u32();
    const high = this.u32();
    return (BigInt(high) * 0x100000000n + BigInt(low)).toString(16).toUpperCase().padStart(12, '0');
  }

  f32(): number {
    return this.view.getFloat32(this.take(4), true);
  }
}

function rounded(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function writeRule(writer: Writer, rule: Rule): Writer {
  return writer
    .u8(rule.enabled ? 1 : 0)
    .u8(rule.channel)
    .u8(rule.comparison === 'above' ? 0 : 1)
    .f32(rule.threshold)
    .f32(rule.hysteresis)
    .u16(rule.delayS)
    .u8(rule.output ?? NO_OUTPUT)
    .u16(rule.onValue)
    .u16(rule.offValue)
    .u8(rule.severity);
}

export function readRule(reader: Reader): Rule {
  const enabled = reader.u8() === 1;
  const channel = reader.u8();
  const comparison = reader.u8() === 0 ? 'above' : 'below';
  const threshold = rounded(reader.f32());
  const hysteresis = rounded(reader.f32());
  const delayS = reader.u16();
  const output = reader.u8();
  const onValue = reader.u16();
  const offValue = reader.u16();
  const severity = Math.min(reader.u8(), 3) as Severity;
  return {
    enabled,
    channel,
    comparison,
    threshold,
    hysteresis,
    delayS,
    output: output === NO_OUTPUT || output >= OUTPUTS.length ? null : output,
    onValue,
    offValue,
    severity,
  };
}

export function writeConfig(config: DeviceConfig): Uint8Array {
  const writer = new Writer()
    .u16(config.sampleIntervalMs)
    .u16(config.linkTimeoutS)
    .u8(config.safeOnLinkLoss ? 1 : 0)
    .u8(config.filterPercent);
  for (const calibration of config.calibration) {
    writer.f32(calibration.gain).f32(calibration.offset);
  }
  return writer.done();
}

export function readConfig(body: Uint8Array): DeviceConfig {
  const reader = new Reader(body);
  const sampleIntervalMs = reader.u16();
  const linkTimeoutS = reader.u16();
  const safeOnLinkLoss = reader.u8() === 1;
  const filterPercent = reader.u8();
  const calibration = CHANNELS.map(() => ({ gain: rounded(reader.f32()), offset: rounded(reader.f32()) }));
  return { sampleIntervalMs, linkTimeoutS, safeOnLinkLoss, filterPercent, calibration };
}

export function readRules(body: Uint8Array): RuleSlot[] {
  const reader = new Reader(body);
  const count = reader.u8();
  const slots: RuleSlot[] = [];
  for (let i = 0; i < count; i++) {
    const slot = reader.u8();
    const active = reader.u8() === 1;
    slots.push({ slot, active, rule: readRule(reader) });
  }
  return slots;
}

const HARDWARE: Record<number, string> = { 1: 'ESP32 DevKit', 2: 'Simulador (núcleo do firmware em WebAssembly)' };

export function readInfo(body: Uint8Array): DeviceInfo {
  const reader = new Reader(body);
  const protocol = reader.u8();
  const firmware = `${reader.u8()}.${reader.u8()}.${reader.u8()}`;
  const deviceId = reader.u64hex();
  const channels = reader.u8();
  const outputs = reader.u8();
  const ruleSlots = reader.u8();
  const uptimeMs = reader.u32();
  const bootReason = reader.u8();
  const model = reader.u8();
  return { protocol, firmware, deviceId, channels, outputs, ruleSlots, uptimeMs, bootReason, hardware: HARDWARE[model] ?? `Modelo ${model}` };
}

export interface RawTelemetry {
  uptimeMs: number;
  flags: number;
  values: (number | null)[];
  outputs: number[];
  activeRules: number;
}

export function readTelemetry(body: Uint8Array): RawTelemetry {
  const reader = new Reader(body);
  const uptimeMs = reader.u32();
  const flags = reader.u8();
  const channelCount = reader.u8();
  const values: (number | null)[] = [];
  for (let i = 0; i < channelCount; i++) {
    const value = reader.f32();
    values.push(Number.isFinite(value) ? rounded(value) : null);
  }
  const outputCount = reader.u8();
  const outputs: number[] = [];
  for (let i = 0; i < outputCount; i++) {
    outputs.push(reader.u16());
  }
  return { uptimeMs, flags, values, outputs, activeRules: reader.u8() };
}

export interface RawEvent {
  code: number;
  severity: Severity;
  index: number;
  value: number | null;
  uptimeMs: number;
}

export function readEvent(body: Uint8Array): RawEvent {
  const reader = new Reader(body);
  const code = reader.u8();
  const severity = Math.min(reader.u8(), 3) as Severity;
  const index = reader.u8();
  const value = reader.f32();
  return { code, severity, index, value: Number.isFinite(value) ? rounded(value) : null, uptimeMs: reader.u32() };
}

export function toHex(bytes: Uint8Array, limit = 96): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, limit); i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return parts.join(' ') + (bytes.length > limit ? ' …' : '');
}
