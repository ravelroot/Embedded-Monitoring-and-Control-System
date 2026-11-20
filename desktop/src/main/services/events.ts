import { CHANNELS, EVENT_NAMES, type RuleSlot, type Severity } from '../../shared/model';
import type { RawEvent } from '../device/codec';

function formatValue(channel: number, value: number | null): string {
  const spec = CHANNELS[channel];
  if (!spec || value === null) {
    return '';
  }
  const text = value.toLocaleString('pt-BR', { maximumFractionDigits: spec.digits, minimumFractionDigits: spec.digits });
  return spec.unit ? `${text} ${spec.unit}` : text;
}

const BOOT_REASONS: Record<number, string> = {
  1: 'energia ligada',
  3: 'reinício por software',
  4: 'falha (panic)',
  5: 'watchdog de interrupção',
  6: 'watchdog de tarefa',
  7: 'watchdog',
  9: 'queda de tensão',
};

export function describeEvent(event: RawEvent, rules: RuleSlot[]): string {
  const base = EVENT_NAMES[event.code] ?? `Evento ${event.code}`;
  switch (event.code) {
    case 1:
      return `${base} (${BOOT_REASONS[event.index] ?? `motivo ${event.index}`})`;
    case 2:
    case 3: {
      const rule = rules.find((slot) => slot.slot === event.index)?.rule;
      if (!rule) {
        return `${base}: regra ${event.index + 1}`;
      }
      const channel = CHANNELS[rule.channel];
      const reading = `${channel?.name ?? 'canal'} em ${formatValue(rule.channel, event.value)}`;
      if (event.code === 3) {
        return `${base}: regra ${event.index + 1}, ${reading}`;
      }
      const relation = rule.comparison === 'above' ? 'acima de' : 'abaixo de';
      return `${base}: regra ${event.index + 1}, ${reading} (limite: ${relation} ${formatValue(rule.channel, rule.threshold)})`;
    }
    case 8:
    case 9:
      return `${base}: ${CHANNELS[event.index]?.name ?? `canal ${event.index}`}`;
    default:
      return base;
  }
}

export function localEvent(code: 100 | 101, severity: Severity, detail: string) {
  return { code, severity, index: 0, value: null, uptimeMs: 0, message: `${EVENT_NAMES[code]}: ${detail}` };
}
