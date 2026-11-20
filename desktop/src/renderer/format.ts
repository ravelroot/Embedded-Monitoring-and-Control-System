import { CHANNELS, OUTPUTS, PWM_MAX, type Rule, SEVERITY_NAMES } from '../shared/model';

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatChannel(channel: number, value: number | null | undefined, withUnit = true): string {
  const spec = CHANNELS[channel];
  if (!spec) {
    return '—';
  }
  if (spec.key === 'presence') {
    return value === null || value === undefined ? '—' : value >= 0.5 ? 'Detectada' : 'Ausente';
  }
  const text = formatNumber(value, spec.digits);
  return withUnit && spec.unit && text !== '—' ? `${text} ${spec.unit}` : text;
}

export function formatOutput(output: number, value: number): string {
  const spec = OUTPUTS[output];
  if (!spec) {
    return '—';
  }
  if (spec.kind === 'relay') {
    return value ? 'Ligado' : 'Desligado';
  }
  return `${Math.round((value / PWM_MAX) * 100)}%`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  return days > 0 ? `${days} d ${clock}` : clock;
}

export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? 'dia' : 'dias'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} h`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes} min`);
  }
  if (rest > 0 && days === 0 && hours === 0) {
    parts.push(`${rest} s`);
  }
  return parts.length > 0 ? parts.join(' ') : '0 s';
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${formatNumber(value, value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function severityName(severity: number): string {
  return SEVERITY_NAMES[severity as 0 | 1 | 2 | 3] ?? '—';
}

export function describeCondition(rule: Rule): string {
  const channel = CHANNELS[rule.channel];
  if (!channel) {
    return '—';
  }
  const relation = rule.comparison === 'above' ? 'acima de' : 'abaixo de';
  const release = rule.comparison === 'above' ? rule.threshold - rule.hysteresis : rule.threshold + rule.hysteresis;
  const delay = rule.delayS > 0 ? ` por ${rule.delayS} s` : '';
  return `${channel.name} ${relation} ${formatChannel(rule.channel, rule.threshold)}${delay}; volta ao normal ${rule.comparison === 'above' ? 'abaixo' : 'acima'} de ${formatChannel(rule.channel, release)}`;
}

export function describeAction(rule: Rule): string {
  if (rule.output === null) {
    return 'Somente alarme';
  }
  const output = OUTPUTS[rule.output];
  return `${output?.name ?? 'Saída'}: ${formatOutput(rule.output, rule.onValue)} → ${formatOutput(rule.output, rule.offValue)}`;
}

export function describeRule(rule: Rule): string {
  const channel = CHANNELS[rule.channel];
  const relation = rule.comparison === 'above' ? 'ficar acima de' : 'ficar abaixo de';
  const delay = rule.delayS > 0 ? ` por pelo menos ${rule.delayS} s` : '';
  const release = rule.comparison === 'above' ? rule.threshold - rule.hysteresis : rule.threshold + rule.hysteresis;
  const action =
    rule.output === null
      ? 'gerar um alarme'
      : `colocar ${OUTPUTS[rule.output]?.name ?? 'a saída'} em ${formatOutput(rule.output, rule.onValue).toLowerCase()}`;
  const back =
    rule.output === null ? 'O alarme é encerrado' : `Volta para ${formatOutput(rule.output, rule.offValue).toLowerCase()}`;
  const severity = rule.severity > 0 ? ` Severidade: ${severityName(rule.severity).toLowerCase()}.` : '';
  return `Quando ${channel?.name.toLowerCase() ?? 'o canal'} ${relation} ${formatChannel(rule.channel, rule.threshold)}${delay}, ${action}. ${back} quando ${rule.comparison === 'above' ? 'cair abaixo' : 'subir acima'} de ${formatChannel(rule.channel, release)}.${severity}`;
}
