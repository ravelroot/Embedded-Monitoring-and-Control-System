export const RULE_SLOTS = 8;
export const PWM_MAX = 1000;
export const NO_OUTPUT = 0xff;

export interface ChannelSpec {
  id: number;
  key: string;
  name: string;
  unit: string;
  digits: number;
  min: number;
  max: number;
}

export interface OutputSpec {
  id: number;
  key: string;
  name: string;
  kind: 'relay' | 'pwm';
}

export const CHANNELS: readonly ChannelSpec[] = [
  { id: 0, key: 'temperature', name: 'Temperatura', unit: '°C', digits: 1, min: -10, max: 60 },
  { id: 1, key: 'light', name: 'Luminosidade', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 2, key: 'level', name: 'Nível', unit: '%', digits: 0, min: 0, max: 100 },
  { id: 3, key: 'supply', name: 'Alimentação', unit: 'V', digits: 2, min: 0, max: 6 },
  { id: 4, key: 'presence', name: 'Presença', unit: '', digits: 0, min: 0, max: 1 },
];

export const OUTPUTS: readonly OutputSpec[] = [
  { id: 0, key: 'relay1', name: 'Relé 1 · bomba', kind: 'relay' },
  { id: 1, key: 'relay2', name: 'Relé 2 · sirene', kind: 'relay' },
  { id: 2, key: 'fan', name: 'Ventilador', kind: 'pwm' },
];

export type Severity = 0 | 1 | 2 | 3;

export const SEVERITY_NAMES: Record<Severity, string> = {
  0: 'Informação',
  1: 'Baixa',
  2: 'Alta',
  3: 'Crítica',
};

export const EVENT_NAMES: Record<number, string> = {
  1: 'Dispositivo iniciado',
  2: 'Regra ativada',
  3: 'Regra desativada',
  4: 'Comunicação perdida',
  5: 'Comunicação restabelecida',
  6: 'Configuração gravada',
  7: 'Restaurado de fábrica',
  8: 'Falha de sensor',
  9: 'Sensor recuperado',
  100: 'Conectado',
  101: 'Desconectado',
};

export interface Calibration {
  gain: number;
  offset: number;
}

export interface DeviceConfig {
  sampleIntervalMs: number;
  linkTimeoutS: number;
  safeOnLinkLoss: boolean;
  filterPercent: number;
  calibration: Calibration[];
}

export interface Rule {
  enabled: boolean;
  channel: number;
  comparison: 'above' | 'below';
  threshold: number;
  hysteresis: number;
  delayS: number;
  output: number | null;
  onValue: number;
  offValue: number;
  severity: Severity;
}

export interface RuleSlot {
  slot: number;
  active: boolean;
  rule: Rule;
}

export interface Telemetry {
  at: number;
  uptimeMs: number;
  linkUp: boolean;
  sensorFault: boolean;
  dirty: boolean;
  values: (number | null)[];
  outputs: number[];
  activeRules: number;
}

export interface DeviceInfo {
  protocol: number;
  firmware: string;
  deviceId: string;
  channels: number;
  outputs: number;
  ruleSlots: number;
  uptimeMs: number;
  bootReason: number;
  hardware: string;
}

export interface DeviceEvent {
  id: number;
  at: number;
  code: number;
  severity: Severity;
  index: number;
  value: number | null;
  uptimeMs: number;
  acknowledged: boolean;
  message: string;
}

export type ConnectionTarget =
  | { kind: 'serial'; path: string }
  | { kind: 'tcp'; host: string; port: number; telnet: boolean }
  | { kind: 'simulator' };

export type LinkState = 'disconnected' | 'connecting' | 'online' | 'reconnecting' | 'error';

export interface LinkStatus {
  state: LinkState;
  target: ConnectionTarget | null;
  info: DeviceInfo | null;
  message: string;
  since: number;
}

export interface LinkStats {
  txFrames: number;
  rxFrames: number;
  crcErrors: number;
  decodeErrors: number;
  timeouts: number;
  retries: number;
  latencyAvgMs: number;
  latencyP95Ms: number;
  bytesIn: number;
  bytesOut: number;
}

export interface FrameLog {
  at: number;
  direction: 'tx' | 'rx' | 'err';
  type: number;
  name: string;
  seq: number;
  length: number;
  hex: string;
}

export interface SerialPortInfo {
  path: string;
  manufacturer: string;
  description: string;
  likelyEsp32: boolean;
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  retentionDays: number;
  notifications: boolean;
  autoConnect: boolean;
  lastTarget: ConnectionTarget | null;
  chartWindowMinutes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  retentionDays: 30,
  notifications: true,
  autoConnect: true,
  lastTarget: null,
  chartWindowMinutes: 5,
};

export const DEFAULT_CONFIG: DeviceConfig = {
  sampleIntervalMs: 1000,
  linkTimeoutS: 10,
  safeOnLinkLoss: true,
  filterPercent: 30,
  calibration: CHANNELS.map(() => ({ gain: 1, offset: 0 })),
};

export function emptyRule(): Rule {
  return {
    enabled: false,
    channel: 0,
    comparison: 'above',
    threshold: 0,
    hysteresis: 0,
    delayS: 0,
    output: null,
    onValue: 0,
    offValue: 0,
    severity: 0,
  };
}

export interface HistoryPoint {
  t: number;
  avg: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
}

export interface HistoryQuery {
  from: number;
  to: number;
  buckets: number;
}

export interface HistoryResult {
  from: number;
  to: number;
  bucketMs: number;
  points: HistoryPoint[];
  samples: number;
}

export interface EventQuery {
  limit: number;
  minSeverity: Severity;
  onlyOpen: boolean;
}

export interface StorageSummary {
  path: string;
  sizeBytes: number;
  telemetryRows: number;
  eventRows: number;
  oldest: number | null;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  node: string;
  dataPath: string;
}
