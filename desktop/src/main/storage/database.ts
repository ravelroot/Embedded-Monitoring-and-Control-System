import { statSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import {
  type AppSettings,
  CHANNELS,
  DEFAULT_SETTINGS,
  type DeviceEvent,
  type DeviceInfo,
  EVENT_NAMES,
  type EventQuery,
  type HistoryPoint,
  type HistoryQuery,
  type HistoryResult,
  type Rule,
  type Severity,
  type StorageSummary,
  type Telemetry,
} from '../../shared/model';
import { MIGRATIONS } from './migrations';

type Row = Record<string, string | number | bigint | null | Uint8Array>;

export interface NewEvent {
  at: number;
  code: number;
  severity: Severity;
  index: number;
  value: number | null;
  uptimeMs: number;
  message: string;
}

export interface TelemetryRow {
  ts: number;
  values: (number | null)[];
  outputs: number[];
  activeRules: number;
}

function num(value: Row[string]): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

function nullableNum(value: Row[string]): number | null {
  return value === null || value === undefined ? null : num(value);
}

export class Database {
  private readonly db: DatabaseSync;
  private readonly insertTelemetry: StatementSync;
  private readonly insertEvent: StatementSync;
  private buffer: Telemetry[] = [];
  private sessionId: number | null = null;
  private deviceRef: number | null = null;

  constructor(private readonly path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
    const channelColumns = CHANNELS.map((channel) => `c${channel.id}`).join(', ');
    const channelParams = CHANNELS.map(() => '?').join(', ');
    this.insertTelemetry = this.db.prepare(
      `INSERT INTO telemetry (session_id, ts, uptime_ms, flags, ${channelColumns}, o0, o1, o2, active_rules) VALUES (?, ?, ?, ?, ${channelParams}, ?, ?, ?, ?)`,
    );
    this.insertEvent = this.db.prepare(
      'INSERT INTO events (session_id, ts, code, severity, idx, value, uptime_ms, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.db.prepare("UPDATE sessions SET ended_at = started_at, end_reason = 'interrompida' WHERE ended_at IS NULL").run();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as Row | undefined;
    const current = row ? num(row.version) : 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) {
        continue;
      }
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
      });
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as Row;
    return num(row.version);
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  startSession(info: DeviceInfo, target: string, now = Date.now()): number {
    this.endSession('nova sessão', now);
    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO devices (device_id, hardware, firmware, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(device_id) DO UPDATE SET hardware = excluded.hardware, firmware = excluded.firmware, last_seen = excluded.last_seen`,
        )
        .run(info.deviceId, info.hardware, info.firmware, now, now);
      const device = this.db.prepare('SELECT id FROM devices WHERE device_id = ?').get(info.deviceId) as Row;
      this.deviceRef = num(device.id);
      const result = this.db.prepare('INSERT INTO sessions (device_ref, target, started_at) VALUES (?, ?, ?)').run(this.deviceRef, target, now);
      this.sessionId = Number(result.lastInsertRowid);
      return this.sessionId;
    });
  }

  endSession(reason: string, now = Date.now()): void {
    this.flush();
    if (this.sessionId === null) {
      return;
    }
    this.db.prepare('UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL').run(now, reason, this.sessionId);
    this.sessionId = null;
  }

  queueTelemetry(telemetry: Telemetry): void {
    if (this.sessionId === null) {
      return;
    }
    this.buffer.push(telemetry);
    if (this.buffer.length >= 500) {
      this.flush();
    }
  }

  flush(): number {
    if (this.buffer.length === 0 || this.sessionId === null) {
      this.buffer = [];
      return 0;
    }
    const rows = this.buffer;
    this.buffer = [];
    const session = this.sessionId;
    this.transaction(() => {
      for (const row of rows) {
        const flags = (row.linkUp ? 1 : 0) | (row.sensorFault ? 2 : 0) | (row.dirty ? 4 : 0);
        this.insertTelemetry.run(
          session,
          row.at,
          row.uptimeMs,
          flags,
          ...CHANNELS.map((channel) => row.values[channel.id] ?? null),
          row.outputs[0] ?? 0,
          row.outputs[1] ?? 0,
          row.outputs[2] ?? 0,
          row.activeRules,
        );
      }
    });
    return rows.length;
  }

  addEvent(event: NewEvent): DeviceEvent {
    const result = this.insertEvent.run(this.sessionId, event.at, event.code, event.severity, event.index, event.value, event.uptimeMs, event.message);
    return { id: Number(result.lastInsertRowid), acknowledged: false, ...event };
  }

  listEvents(query: EventQuery): DeviceEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, ts, code, severity, idx, value, uptime_ms, message, acknowledged_at FROM events
         WHERE severity >= ? AND (? = 0 OR acknowledged_at IS NULL) ORDER BY ts DESC, id DESC LIMIT ?`,
      )
      .all(query.minSeverity, query.onlyOpen ? 1 : 0, query.limit) as Row[];
    return rows.map((row) => ({
      id: num(row.id),
      at: num(row.ts),
      code: num(row.code),
      severity: num(row.severity) as Severity,
      index: num(row.idx),
      value: nullableNum(row.value),
      uptimeMs: num(row.uptime_ms),
      acknowledged: row.acknowledged_at !== null,
      message: String(row.message ?? EVENT_NAMES[num(row.code)] ?? ''),
    }));
  }

  openAlarmCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM events WHERE severity >= 2 AND acknowledged_at IS NULL').get() as Row;
    return num(row.total);
  }

  acknowledge(id: number | null, now = Date.now()): number {
    const result =
      id === null
        ? this.db.prepare('UPDATE events SET acknowledged_at = ? WHERE acknowledged_at IS NULL').run(now)
        : this.db.prepare('UPDATE events SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL').run(now, id);
    return Number(result.changes);
  }

  history(query: HistoryQuery): HistoryResult {
    this.flush();
    const span = Math.max(1, query.to - query.from);
    const bucketMs = Math.max(1000, Math.ceil(span / Math.max(1, Math.min(query.buckets, 2000))));
    const aggregates = CHANNELS.map((channel) => `AVG(c${channel.id}) AS a${channel.id}, MIN(c${channel.id}) AS n${channel.id}, MAX(c${channel.id}) AS x${channel.id}`).join(', ');
    const rows = this.db
      .prepare(`SELECT CAST(ts / ? AS INTEGER) * ? AS bucket, COUNT(*) AS samples, ${aggregates} FROM telemetry WHERE ts >= ? AND ts < ? GROUP BY bucket ORDER BY bucket`)
      .all(bucketMs, bucketMs, query.from, query.to) as Row[];
    let samples = 0;
    const points: HistoryPoint[] = rows.map((row) => {
      samples += num(row.samples);
      return {
        t: num(row.bucket),
        avg: CHANNELS.map((channel) => nullableNum(row[`a${channel.id}`])),
        min: CHANNELS.map((channel) => nullableNum(row[`n${channel.id}`])),
        max: CHANNELS.map((channel) => nullableNum(row[`x${channel.id}`])),
      };
    });
    return { from: query.from, to: query.to, bucketMs, points, samples };
  }

  *telemetryRows(from: number, to: number): Generator<TelemetryRow> {
    this.flush();
    const statement = this.db.prepare(
      `SELECT ts, ${CHANNELS.map((channel) => `c${channel.id}`).join(', ')}, o0, o1, o2, active_rules FROM telemetry WHERE ts >= ? AND ts < ? ORDER BY ts`,
    );
    for (const row of statement.iterate(from, to) as Iterable<Row>) {
      yield {
        ts: num(row.ts),
        values: CHANNELS.map((channel) => nullableNum(row[`c${channel.id}`])),
        outputs: [num(row.o0), num(row.o1), num(row.o2)],
        activeRules: num(row.active_rules),
      };
    }
  }

  saveRuleBackup(deviceId: string, slot: number, rule: Rule, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO rule_backups (device_ref, slot, rule_json, updated_at) SELECT id, ?, ?, ? FROM devices WHERE device_id = ?
         ON CONFLICT(device_ref, slot) DO UPDATE SET rule_json = excluded.rule_json, updated_at = excluded.updated_at`,
      )
      .run(slot, JSON.stringify(rule), now, deviceId);
  }

  deleteRuleBackup(deviceId: string, slot: number): void {
    this.db.prepare('DELETE FROM rule_backups WHERE slot = ? AND device_ref = (SELECT id FROM devices WHERE device_id = ?)').run(slot, deviceId);
  }

  ruleBackups(deviceId: string): { slot: number; rule: Rule; updatedAt: number }[] {
    const rows = this.db
      .prepare('SELECT slot, rule_json, updated_at FROM rule_backups WHERE device_ref = (SELECT id FROM devices WHERE device_id = ?) ORDER BY slot')
      .all(deviceId) as Row[];
    return rows.map((row) => ({ slot: num(row.slot), rule: JSON.parse(String(row.rule_json)) as Rule, updatedAt: num(row.updated_at) }));
  }

  loadSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[];
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[String(row.key)] = JSON.parse(String(row.value));
      } catch {
        continue;
      }
    }
    return { ...DEFAULT_SETTINGS, ...(stored as Partial<AppSettings>) };
  }

  saveSettings(patch: Partial<AppSettings>): AppSettings {
    this.transaction(() => {
      const statement = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      for (const [key, value] of Object.entries(patch)) {
        statement.run(key, JSON.stringify(value));
      }
    });
    return this.loadSettings();
  }

  prune(retentionDays: number, now = Date.now()): { telemetry: number; events: number } {
    this.flush();
    const cutoff = now - retentionDays * 86_400_000;
    return this.transaction(() => {
      const telemetry = this.db.prepare('DELETE FROM telemetry WHERE ts < ?').run(cutoff);
      const events = this.db.prepare('DELETE FROM events WHERE ts < ? AND (acknowledged_at IS NOT NULL OR severity < 2)').run(cutoff);
      this.db.prepare('DELETE FROM sessions WHERE ended_at IS NOT NULL AND ended_at < ? AND id NOT IN (SELECT DISTINCT session_id FROM telemetry)').run(cutoff);
      return { telemetry: Number(telemetry.changes), events: Number(events.changes) };
    });
  }

  summary(): StorageSummary {
    const telemetry = this.db.prepare('SELECT COUNT(*) AS total, MIN(ts) AS oldest FROM telemetry').get() as Row;
    const events = this.db.prepare('SELECT COUNT(*) AS total FROM events').get() as Row;
    let sizeBytes = 0;
    for (const suffix of ['', '-wal']) {
      try {
        sizeBytes += statSync(this.path + suffix).size;
      } catch {
        continue;
      }
    }
    return { path: this.path, sizeBytes, telemetryRows: num(telemetry.total), eventRows: num(events.total), oldest: nullableNum(telemetry.oldest) };
  }

  close(): void {
    this.endSession('aplicativo fechado');
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.db.close();
  }
}
