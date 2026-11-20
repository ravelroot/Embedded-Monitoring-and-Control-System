import type {
  AppInfo,
  AppSettings,
  Calibration,
  ConnectionTarget,
  DeviceConfig,
  DeviceEvent,
  DeviceInfo,
  EventQuery,
  FrameLog,
  HistoryQuery,
  HistoryResult,
  LinkStats,
  LinkStatus,
  Rule,
  RuleSlot,
  SerialPortInfo,
  StorageSummary,
  Telemetry,
} from './model';

export interface SimulatorControls {
  ambientC: number;
  heatLoadC: number;
  consumptionPerMin: number;
  presence: 'auto' | 'on' | 'off';
  temperatureFault: boolean;
}

export interface Snapshot {
  status: LinkStatus;
  info: DeviceInfo | null;
  config: DeviceConfig | null;
  rules: RuleSlot[];
  telemetry: Telemetry | null;
  stats: LinkStats;
  frames: FrameLog[];
  settings: AppSettings;
  openAlarms: number;
  simulator: SimulatorControls;
  recent: Telemetry[];
}

export interface PushTopics {
  status: LinkStatus;
  telemetry: Telemetry;
  event: DeviceEvent;
  rules: RuleSlot[];
  config: DeviceConfig;
  frames: FrameLog[];
  alarms: number;
  settings: AppSettings;
}

export type ExportKind = 'telemetry' | 'events';

export interface ExportResult {
  saved: boolean;
  path: string;
  rows: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface MalhaApi {
  snapshot(): Promise<Result<Snapshot>>;
  listPorts(): Promise<Result<SerialPortInfo[]>>;
  connect(target: ConnectionTarget): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  setOutput(output: number, value: number): Promise<Result<void>>;
  setConfig(config: DeviceConfig): Promise<Result<DeviceConfig>>;
  setCalibration(channel: number, calibration: Calibration): Promise<Result<DeviceConfig>>;
  setRule(slot: number, rule: Rule): Promise<Result<RuleSlot[]>>;
  clearRule(slot: number): Promise<Result<RuleSlot[]>>;
  loadExampleRules(): Promise<Result<RuleSlot[]>>;
  restoreRuleBackup(): Promise<Result<RuleSlot[]>>;
  save(): Promise<Result<void>>;
  reboot(): Promise<Result<void>>;
  factoryReset(): Promise<Result<void>>;
  ping(): Promise<Result<number>>;
  stats(): Promise<Result<LinkStats>>;
  setSimulator(controls: SimulatorControls): Promise<Result<SimulatorControls>>;
  history(query: HistoryQuery): Promise<Result<HistoryResult>>;
  events(query: EventQuery): Promise<Result<DeviceEvent[]>>;
  acknowledge(id: number | null): Promise<Result<number>>;
  exportCsv(kind: ExportKind, from: number, to: number): Promise<Result<ExportResult>>;
  settings(patch: Partial<AppSettings>): Promise<Result<AppSettings>>;
  storage(): Promise<Result<StorageSummary>>;
  prune(): Promise<Result<{ telemetry: number; events: number }>>;
  appInfo(): Promise<Result<AppInfo>>;
  openDataFolder(): Promise<Result<void>>;
  on<K extends keyof PushTopics>(topic: K, listener: (payload: PushTopics[K]) => void): () => void;
}

export const INVOKE_CHANNELS = [
  'snapshot',
  'listPorts',
  'connect',
  'disconnect',
  'setOutput',
  'setConfig',
  'setCalibration',
  'setRule',
  'clearRule',
  'loadExampleRules',
  'restoreRuleBackup',
  'save',
  'reboot',
  'factoryReset',
  'ping',
  'stats',
  'setSimulator',
  'history',
  'events',
  'acknowledge',
  'exportCsv',
  'settings',
  'storage',
  'prune',
  'appInfo',
  'openDataFolder',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const PUSH_TOPICS: readonly (keyof PushTopics)[] = ['status', 'telemetry', 'event', 'rules', 'config', 'frames', 'alarms', 'settings'];
