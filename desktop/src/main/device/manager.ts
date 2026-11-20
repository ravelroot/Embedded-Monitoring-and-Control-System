import type {
  Calibration,
  ConnectionTarget,
  DeviceConfig,
  DeviceInfo,
  FrameLog,
  LinkStats,
  LinkStatus,
  Rule,
  RuleSlot,
  Telemetry,
} from '../../shared/model';
import { type Frame, MsgType, type RawEvent, readConfig, readEvent, readInfo, readRules, readTelemetry, writeConfig, writeRule, Writer } from './codec';
import { DeviceError, DeviceLink } from './link';
import { SerialTransport } from './serial-transport';
import { DEFAULT_SIMULATOR_CONTROLS, type SimulatorControls, SimulatorTransport } from './simulator-transport';
import { TcpTransport } from './tcp-transport';
import type { Transport } from './transport';

export interface ManagerTopics {
  status: LinkStatus;
  telemetry: Telemetry;
  event: RawEvent & { at: number };
  rules: RuleSlot[];
  config: DeviceConfig;
  frames: FrameLog[];
}

type Listener<T> = (payload: T) => void;

export interface ManagerOptions {
  wasmPath: string;
  simulatorNvsPath: string;
  heartbeatMs?: number;
  reconnectMs?: number;
  transportFactory?: (target: ConnectionTarget) => Transport;
}

const EMPTY_STATS: LinkStats = {
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

export class DeviceManager {
  private readonly listeners = new Map<keyof ManagerTopics, Set<Listener<never>>>();
  private link: DeviceLink | null = null;
  private target: ConnectionTarget | null = null;
  private generation = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private pendingLogs: FrameLog[] = [];
  private readonly history: FrameLog[] = [];
  private simulatorControls: SimulatorControls = { ...DEFAULT_SIMULATOR_CONTROLS };
  private simulator: SimulatorTransport | null = null;
  private current: { info: DeviceInfo | null; config: DeviceConfig | null; rules: RuleSlot[]; telemetry: Telemetry | null } = {
    info: null,
    config: null,
    rules: [],
    telemetry: null,
  };
  private status: LinkStatus = { state: 'disconnected', target: null, info: null, message: 'Nenhum dispositivo conectado.', since: Date.now() };

  constructor(private readonly options: ManagerOptions) {}

  on<K extends keyof ManagerTopics>(topic: K, listener: Listener<ManagerTopics[K]>): () => void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(topic, set);
    return () => set.delete(listener as Listener<never>);
  }

  private emit<K extends keyof ManagerTopics>(topic: K, payload: ManagerTopics[K]): void {
    for (const listener of this.listeners.get(topic) ?? []) {
      (listener as Listener<ManagerTopics[K]>)(payload);
    }
  }

  snapshot() {
    return { status: this.status, ...this.current, stats: this.stats(), frames: [...this.history] };
  }

  stats(): LinkStats {
    return this.link ? { ...this.link.stats } : { ...EMPTY_STATS };
  }

  async connect(target: ConnectionTarget): Promise<void> {
    await this.disconnect('Trocando de dispositivo.', false);
    this.target = target;
    const generation = ++this.generation;
    await this.establish(generation, false);
  }

  async disconnect(message = 'Desconectado pelo usuário.', announce = true): Promise<void> {
    this.generation++;
    this.target = null;
    this.stopTimers();
    const link = this.link;
    this.link = null;
    this.simulator = null;
    await link?.stop().catch(() => undefined);
    this.current = { info: null, config: null, rules: [], telemetry: null };
    if (announce || this.status.state !== 'disconnected') {
      this.setStatus('disconnected', message, null);
    }
  }

  private createTransport(target: ConnectionTarget): Transport {
    if (this.options.transportFactory) {
      return this.options.transportFactory(target);
    }
    switch (target.kind) {
      case 'serial':
        return new SerialTransport(target.path);
      case 'tcp':
        return new TcpTransport(target.host, target.port, target.telnet);
      case 'simulator': {
        const simulator = new SimulatorTransport(this.options.wasmPath, this.options.simulatorNvsPath, this.simulatorControls);
        this.simulator = simulator;
        return simulator;
      }
    }
  }

  private async establish(generation: number, reconnecting: boolean): Promise<void> {
    const target = this.target;
    if (!target || generation !== this.generation) {
      return;
    }
    this.setStatus(reconnecting ? 'reconnecting' : 'connecting', reconnecting ? 'Tentando reconectar…' : 'Conectando…', null);
    const transport = this.createTransport(target);
    const link = new DeviceLink(transport, {
      unsolicited: (frame) => this.handleFrame(frame),
      closed: (reason) => this.handleClosed(generation, reason),
      log: (entry) => this.pushLog(entry),
    });
    try {
      await link.start();
      if (generation !== this.generation) {
        await link.stop();
        return;
      }
      this.link = link;
      const hello = await link.request(MsgType.Hello, undefined, { timeoutMs: 700, retries: 5 });
      const info = readInfo(hello.body);
      if (info.protocol !== 1) {
        throw new DeviceError(`Versão de protocolo ${info.protocol} não suportada por este aplicativo.`);
      }
      this.current.info = info;
      await this.refreshConfig();
      await this.refreshRules();
      if (generation !== this.generation) {
        return;
      }
      this.failures = 0;
      this.startHeartbeat(generation);
      this.setStatus('online', `Conectado em ${link.label}.`, info);
    } catch (error) {
      await link.stop().catch(() => undefined);
      if (this.link === link) {
        this.link = null;
      }
      if (generation !== this.generation) {
        return;
      }
      this.setStatus(reconnecting ? 'reconnecting' : 'error', (error as Error).message, null);
      this.scheduleReconnect(generation);
    }
  }

  private scheduleReconnect(generation: number): void {
    if (!this.target || generation !== this.generation || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.establish(generation, true);
    }, this.options.reconnectMs ?? 2500);
  }

  private handleClosed(generation: number, reason: string): void {
    if (generation !== this.generation) {
      return;
    }
    this.stopHeartbeat();
    this.link = null;
    this.setStatus('reconnecting', reason, null);
    this.scheduleReconnect(generation);
  }

  private startHeartbeat(generation: number): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const link = this.link;
      if (!link || generation !== this.generation) {
        return;
      }
      link
        .request(MsgType.Ping, new Writer().u32(Date.now() >>> 0).done(), { timeoutMs: 900, retries: 0 })
        .then(() => {
          this.failures = 0;
        })
        .catch(async () => {
          this.failures++;
          if (this.failures >= 3 && this.link === link) {
            this.link = null;
            this.stopHeartbeat();
            await link.stop().catch(() => undefined);
            this.handleClosed(generation, 'O dispositivo parou de responder.');
          }
        });
    }, this.options.heartbeatMs ?? 2000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private stopTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(state: LinkStatus['state'], message: string, info: DeviceInfo | null): void {
    this.status = { state, target: this.target, info, message, since: Date.now() };
    this.emit('status', this.status);
  }

  private handleFrame(frame: Frame): void {
    try {
      if (frame.type === MsgType.Telemetry) {
        const raw = readTelemetry(frame.body);
        const telemetry: Telemetry = {
          at: Date.now(),
          uptimeMs: raw.uptimeMs,
          linkUp: (raw.flags & 0x01) !== 0,
          sensorFault: (raw.flags & 0x02) !== 0,
          dirty: (raw.flags & 0x04) !== 0,
          values: raw.values,
          outputs: raw.outputs,
          activeRules: raw.activeRules,
        };
        this.current.telemetry = telemetry;
        this.emit('telemetry', telemetry);
      } else if (frame.type === MsgType.Event) {
        this.emit('event', { ...readEvent(frame.body), at: Date.now() });
      }
    } catch {
      this.pushLog({ at: Date.now(), direction: 'err', type: frame.type, name: 'conteúdo inválido', seq: frame.seq, length: frame.body.length, hex: '' });
    }
  }

  private pushLog(entry: FrameLog): void {
    this.history.push(entry);
    if (this.history.length > 300) {
      this.history.shift();
    }
    this.pendingLogs.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.pendingLogs;
        this.pendingLogs = [];
        this.emit('frames', batch);
      }, 250);
    }
  }

  private requireLink(): DeviceLink {
    if (!this.link || this.status.state !== 'online') {
      throw new DeviceError('Nenhum dispositivo conectado.');
    }
    return this.link;
  }

  private connectedLink(): DeviceLink {
    if (!this.link) {
      throw new DeviceError('Nenhum dispositivo conectado.');
    }
    return this.link;
  }

  async refreshConfig(): Promise<DeviceConfig> {
    const frame = await this.connectedLink().request(MsgType.GetConfig);
    const config = readConfig(frame.body);
    this.current.config = config;
    this.emit('config', config);
    return config;
  }

  async refreshRules(): Promise<RuleSlot[]> {
    const frame = await this.connectedLink().request(MsgType.GetRules);
    const rules = readRules(frame.body);
    this.current.rules = rules;
    this.emit('rules', rules);
    return rules;
  }

  async setOutput(output: number, value: number): Promise<void> {
    await this.requireLink().command(MsgType.SetOutput, new Writer().u8(output).u16(value).done());
  }

  async setConfig(config: DeviceConfig): Promise<DeviceConfig> {
    await this.requireLink().command(MsgType.SetConfig, writeConfig(config));
    return this.refreshConfig();
  }

  async setCalibration(channel: number, calibration: Calibration): Promise<DeviceConfig> {
    await this.requireLink().command(MsgType.SetCalibration, new Writer().u8(channel).f32(calibration.gain).f32(calibration.offset).done());
    return this.refreshConfig();
  }

  async setRule(slot: number, rule: Rule): Promise<RuleSlot[]> {
    await this.requireLink().command(MsgType.SetRule, writeRule(new Writer().u8(slot), rule).done());
    return this.refreshRules();
  }

  async clearRule(slot: number): Promise<RuleSlot[]> {
    await this.requireLink().command(MsgType.ClearRule, new Writer().u8(slot).done());
    return this.refreshRules();
  }

  async save(): Promise<void> {
    await this.requireLink().command(MsgType.Save, undefined, { timeoutMs: 2000, retries: 1 });
  }

  async reboot(): Promise<void> {
    await this.requireLink().command(MsgType.Reboot, undefined, { retries: 0 });
  }

  async factoryReset(): Promise<void> {
    await this.requireLink().command(MsgType.FactoryReset, undefined, { timeoutMs: 2000, retries: 0 });
    await this.refreshConfig();
    await this.refreshRules();
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.requireLink().request(MsgType.Ping, new Writer().u32(0x4d4c4841).done(), { retries: 0 });
    return Math.round((performance.now() - started) * 10) / 10;
  }

  getSimulatorControls(): SimulatorControls {
    return { ...this.simulatorControls };
  }

  setSimulatorControls(controls: SimulatorControls): SimulatorControls {
    this.simulatorControls = { ...controls };
    this.simulator?.setControls(this.simulatorControls);
    return this.getSimulatorControls();
  }

  isSimulator(): boolean {
    return this.status.target?.kind === 'simulator';
  }
}
