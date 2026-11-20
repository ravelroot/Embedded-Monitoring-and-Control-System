import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { Database } from '../src/main/storage/database';
import type { DeviceInfo, Rule, Telemetry } from '../src/shared/model';

const info: DeviceInfo = { protocol: 1, firmware: '1.0.0', deviceId: 'A1B2C3D4E5F6', channels: 5, outputs: 3, ruleSlots: 8, uptimeMs: 0, bootReason: 1, hardware: 'ESP32 DevKit' };

function sample(at: number, temperature: number | null): Telemetry {
  return { at, uptimeMs: at, linkUp: true, sensorFault: temperature === null, dirty: false, values: [temperature, 50, 40, 5, 0], outputs: [0, 1, 500], activeRules: 1 };
}

describe('banco de dados', () => {
  let dir: string;
  let db: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'malha-db-'));
    db = new Database(join(dir, 'malha.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('aplica as migrações uma vez só', () => {
    assert.equal(db.schemaVersion(), 1);
    db.close();
    db = new Database(join(dir, 'malha.db'));
    assert.equal(db.schemaVersion(), 1);
  });

  it('grava telemetria em lote e agrega o histórico', () => {
    db.startSession(info, 'COM5', 0);
    for (let i = 0; i < 120; i++) {
      db.queueTelemetry(sample(i * 1000, i < 60 ? 20 : 30));
    }
    db.queueTelemetry(sample(121_000, null));
    assert.equal(db.flush(), 121);
    const history = db.history({ from: 0, to: 120_000, buckets: 2 });
    assert.equal(history.bucketMs, 60_000);
    assert.equal(history.samples, 120);
    assert.equal(history.points[0].avg[0], 20);
    assert.equal(history.points[1].max[0], 30);
    assert.equal(history.points[1].min[0], 30);
    const rows = [...db.telemetryRows(0, 200_000)];
    assert.equal(rows.length, 121);
    assert.equal(rows.at(-1)?.values[0], null);
  });

  it('ignora telemetria fora de sessão', () => {
    db.queueTelemetry(sample(1, 20));
    assert.equal(db.flush(), 0);
  });

  it('registra, filtra e reconhece alarmes', () => {
    db.startSession(info, 'COM5');
    db.addEvent({ at: 1, code: 2, severity: 3, index: 0, value: 40, uptimeMs: 1, message: 'crítico' });
    db.addEvent({ at: 2, code: 2, severity: 1, index: 1, value: 10, uptimeMs: 2, message: 'baixo' });
    const second = db.addEvent({ at: 3, code: 4, severity: 2, index: 0, value: null, uptimeMs: 3, message: 'link' });
    assert.equal(db.openAlarmCount(), 2);
    assert.equal(db.listEvents({ limit: 10, minSeverity: 2, onlyOpen: true }).length, 2);
    assert.equal(db.acknowledge(second.id), 1);
    assert.equal(db.openAlarmCount(), 1);
    assert.equal(db.acknowledge(null), 2);
    assert.equal(db.openAlarmCount(), 0);
    assert.equal(db.listEvents({ limit: 10, minSeverity: 0, onlyOpen: false })[0].message, 'link');
  });

  it('remove dados antigos sem apagar alarmes em aberto', () => {
    db.startSession(info, 'COM5', 0);
    db.queueTelemetry(sample(1000, 20));
    db.queueTelemetry(sample(10 * 86_400_000, 21));
    db.addEvent({ at: 1000, code: 2, severity: 3, index: 0, value: 1, uptimeMs: 0, message: 'velho em aberto' });
    db.addEvent({ at: 1000, code: 1, severity: 0, index: 1, value: null, uptimeMs: 0, message: 'velho info' });
    const removed = db.prune(5, 10 * 86_400_000 + 1);
    assert.deepEqual(removed, { telemetry: 1, events: 1 });
    assert.equal(db.listEvents({ limit: 10, minSeverity: 0, onlyOpen: false }).length, 1);
  });

  it('guarda preferências e cópias de regras', () => {
    assert.equal(db.loadSettings().retentionDays, 30);
    assert.equal(db.saveSettings({ retentionDays: 90, theme: 'dark' }).theme, 'dark');
    db.startSession(info, 'COM5');
    const rule: Rule = { enabled: true, channel: 0, comparison: 'above', threshold: 30, hysteresis: 1, delayS: 5, output: 2, onValue: 1000, offValue: 0, severity: 1 };
    db.saveRuleBackup(info.deviceId, 3, rule);
    db.saveRuleBackup(info.deviceId, 3, { ...rule, threshold: 31 });
    assert.deepEqual(db.ruleBackups(info.deviceId).map((item) => [item.slot, item.rule.threshold]), [[3, 31]]);
    db.deleteRuleBackup(info.deviceId, 3);
    assert.equal(db.ruleBackups(info.deviceId).length, 0);
  });

  it('usa consultas parametrizadas contra injeção', () => {
    db.saveSettings({ theme: 'light' });
    db.startSession({ ...info, deviceId: "x'); DROP TABLE events; --" }, 'COM1');
    db.addEvent({ at: 1, code: 1, severity: 0, index: 0, value: null, uptimeMs: 0, message: "'; DELETE FROM events; --" });
    assert.equal(db.listEvents({ limit: 5, minSeverity: 0, onlyOpen: false }).length, 1);
  });
});
