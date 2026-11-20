import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

import { CHANNELS, type DeviceEvent, OUTPUTS, SEVERITY_NAMES } from '../../shared/model';
import type { TelemetryRow } from '../storage/database';

const SEPARATOR = ';';

export function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value).replace('.', ',') : '';
  }
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function localTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function slug(name: string, unit: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const suffix = unit === '°C' ? 'c' : unit === '%' ? 'pct' : unit.toLowerCase();
  return suffix ? `${base}_${suffix}` : base;
}

export function telemetryHeader(): string {
  return ['data_hora', 'timestamp_ms', ...CHANNELS.map((channel) => slug(channel.name, channel.unit)), ...OUTPUTS.map((output) => output.key), 'regras_ativas']
    .map(csvCell)
    .join(SEPARATOR);
}

export function telemetryLine(row: TelemetryRow): string {
  return [localTimestamp(row.ts), row.ts, ...row.values, ...row.outputs, row.activeRules].map(csvCell).join(SEPARATOR);
}

export async function exportTelemetry(path: string, rows: Iterable<TelemetryRow>): Promise<number> {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let count = 0;
  const write = async (line: string) => {
    if (!stream.write(line)) {
      await once(stream, 'drain');
    }
  };
  await write(`﻿${telemetryHeader()}\r\n`);
  for (const row of rows) {
    await write(`${telemetryLine(row)}\r\n`);
    count++;
  }
  stream.end();
  await once(stream, 'finish');
  return count;
}

export async function exportEvents(path: string, events: DeviceEvent[]): Promise<number> {
  const lines = [
    ['data_hora', 'evento', 'severidade', 'indice', 'valor', 'reconhecido'].map(csvCell).join(SEPARATOR),
    ...events.map((event) =>
      [localTimestamp(event.at), event.message, SEVERITY_NAMES[event.severity], event.index, event.value, event.acknowledged ? 'sim' : 'não']
        .map(csvCell)
        .join(SEPARATOR),
    ),
  ];
  const stream = createWriteStream(path, { encoding: 'utf8' });
  stream.end(`﻿${lines.join('\r\n')}\r\n`);
  await once(stream, 'finish');
  return events.length;
}
