export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE devices (
        id INTEGER PRIMARY KEY,
        device_id TEXT NOT NULL UNIQUE,
        hardware TEXT NOT NULL,
        firmware TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        device_ref INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        end_reason TEXT,
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      );
      CREATE INDEX idx_sessions_device ON sessions(device_ref, started_at);

      CREATE TABLE telemetry (
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        uptime_ms INTEGER NOT NULL,
        flags INTEGER NOT NULL,
        c0 REAL,
        c1 REAL,
        c2 REAL,
        c3 REAL,
        c4 REAL,
        o0 INTEGER NOT NULL CHECK (o0 BETWEEN 0 AND 1),
        o1 INTEGER NOT NULL CHECK (o1 BETWEEN 0 AND 1),
        o2 INTEGER NOT NULL CHECK (o2 BETWEEN 0 AND 1000),
        active_rules INTEGER NOT NULL CHECK (active_rules BETWEEN 0 AND 255)
      );
      CREATE INDEX idx_telemetry_ts ON telemetry(ts);
      CREATE INDEX idx_telemetry_session ON telemetry(session_id, ts);

      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
        ts INTEGER NOT NULL,
        code INTEGER NOT NULL,
        severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 3),
        idx INTEGER NOT NULL,
        value REAL,
        uptime_ms INTEGER NOT NULL,
        message TEXT NOT NULL,
        acknowledged_at INTEGER
      );
      CREATE INDEX idx_events_ts ON events(ts DESC);
      CREATE INDEX idx_events_open ON events(severity) WHERE acknowledged_at IS NULL;

      CREATE TABLE rule_backups (
        device_ref INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 7),
        rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (device_ref, slot)
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL CHECK (json_valid(value))
      );
    `,
  },
];
