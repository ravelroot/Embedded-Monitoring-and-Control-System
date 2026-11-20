import {
  type AppSettings,
  type Calibration,
  CHANNELS,
  type ConnectionTarget,
  type DeviceConfig,
  OUTPUTS,
  PWM_MAX,
  RULE_SLOTS,
  type Rule,
  type Severity,
} from './model';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function fail(message: string): never {
  throw new ValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function finite(value: unknown, name: string, limit = 1e6): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    fail(`${name} deve ser um número válido.`);
  }
  return value;
}

function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    fail(`${name} deve ser verdadeiro ou falso.`);
  }
  return value;
}

export function validOutputValue(output: number, value: number): boolean {
  const spec = OUTPUTS[output];
  if (!spec || !Number.isInteger(value) || value < 0) {
    return false;
  }
  return spec.kind === 'relay' ? value <= 1 : value <= PWM_MAX;
}

export function parseOutputCommand(output: unknown, value: unknown): { output: number; value: number } {
  const index = integer(output, 'Saída', 0, OUTPUTS.length - 1);
  const parsed = integer(value, 'Valor', 0, PWM_MAX);
  if (!validOutputValue(index, parsed)) {
    fail('Valor fora do intervalo da saída.');
  }
  return { output: index, value: parsed };
}

export function parseSlot(value: unknown): number {
  return integer(value, 'Posição da regra', 0, RULE_SLOTS - 1);
}

export function parseChannel(value: unknown): number {
  return integer(value, 'Canal', 0, CHANNELS.length - 1);
}

export function parseCalibration(value: unknown): Calibration {
  if (!isRecord(value)) {
    fail('Calibração inválida.');
  }
  const gain = finite(value.gain, 'Ganho', 1000);
  const offset = finite(value.offset, 'Deslocamento', 10000);
  if (Math.abs(gain) < 0.001) {
    fail('O ganho não pode ser zero.');
  }
  return { gain, offset };
}

export function parseRule(value: unknown): Rule {
  if (!isRecord(value)) {
    fail('Regra inválida.');
  }
  const enabled = bool(value.enabled, 'Ativa');
  const channel = parseChannel(value.channel);
  if (value.comparison !== 'above' && value.comparison !== 'below') {
    fail('Comparação inválida.');
  }
  const threshold = finite(value.threshold, 'Limite');
  const hysteresis = finite(value.hysteresis, 'Histerese');
  if (hysteresis < 0) {
    fail('A histerese não pode ser negativa.');
  }
  const delayS = integer(value.delayS, 'Atraso', 0, 3600);
  const severity = integer(value.severity, 'Severidade', 0, 3) as Severity;
  const output = value.output === null ? null : integer(value.output, 'Saída', 0, OUTPUTS.length - 1);
  const onValue = integer(value.onValue, 'Valor ao ativar', 0, PWM_MAX);
  const offValue = integer(value.offValue, 'Valor ao desativar', 0, PWM_MAX);
  if (output === null) {
    if (enabled && severity === 0) {
      fail('Uma regra sem saída precisa gerar alarme (severidade maior que informação).');
    }
  } else if (!validOutputValue(output, onValue) || !validOutputValue(output, offValue)) {
    fail('Os valores da regra estão fora do intervalo da saída escolhida.');
  }
  return { enabled, channel, comparison: value.comparison, threshold, hysteresis, delayS, output, onValue, offValue, severity };
}

export function parseConfig(value: unknown): DeviceConfig {
  if (!isRecord(value)) {
    fail('Configuração inválida.');
  }
  const sampleIntervalMs = integer(value.sampleIntervalMs, 'Intervalo de amostragem', 100, 60000);
  const linkTimeoutS = integer(value.linkTimeoutS, 'Tempo limite da comunicação', 0, 3600);
  const safeOnLinkLoss = bool(value.safeOnLinkLoss, 'Estado seguro');
  const filterPercent = integer(value.filterPercent, 'Filtro', 1, 100);
  if (!Array.isArray(value.calibration) || value.calibration.length !== CHANNELS.length) {
    fail('A calibração deve ter um item por canal.');
  }
  const calibration = value.calibration.map(parseCalibration);
  return { sampleIntervalMs, linkTimeoutS, safeOnLinkLoss, filterPercent, calibration };
}

export function parseTarget(value: unknown): ConnectionTarget {
  if (!isRecord(value)) {
    fail('Destino de conexão inválido.');
  }
  if (value.kind === 'simulator') {
    return { kind: 'simulator' };
  }
  if (value.kind === 'serial') {
    if (typeof value.path !== 'string' || !/^(COM\d{1,3}|\/dev\/[A-Za-z0-9._-]{1,64})$/.test(value.path)) {
      fail('Porta serial inválida.');
    }
    return { kind: 'serial', path: value.path };
  }
  if (value.kind === 'tcp') {
    if (typeof value.host !== 'string' || !/^[A-Za-z0-9.-]{1,253}$/.test(value.host)) {
      fail('Endereço TCP inválido.');
    }
    return { kind: 'tcp', host: value.host, port: integer(value.port, 'Porta TCP', 1, 65535), telnet: value.telnet !== false };
  }
  return fail('Tipo de conexão desconhecido.');
}

export function parseSettingsPatch(value: unknown): Partial<AppSettings> {
  if (!isRecord(value)) {
    fail('Preferências inválidas.');
  }
  const patch: Partial<AppSettings> = {};
  if ('theme' in value) {
    if (value.theme !== 'system' && value.theme !== 'light' && value.theme !== 'dark') {
      fail('Tema inválido.');
    }
    patch.theme = value.theme;
  }
  if ('retentionDays' in value) {
    patch.retentionDays = integer(value.retentionDays, 'Retenção', 1, 3650);
  }
  if ('notifications' in value) {
    patch.notifications = bool(value.notifications, 'Notificações');
  }
  if ('autoConnect' in value) {
    patch.autoConnect = bool(value.autoConnect, 'Conexão automática');
  }
  if ('chartWindowMinutes' in value) {
    patch.chartWindowMinutes = integer(value.chartWindowMinutes, 'Janela do gráfico', 1, 60);
  }
  if ('lastTarget' in value) {
    patch.lastTarget = value.lastTarget === null ? null : parseTarget(value.lastTarget);
  }
  return patch;
}
