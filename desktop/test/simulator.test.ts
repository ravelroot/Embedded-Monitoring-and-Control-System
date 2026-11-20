import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { DeviceManager } from '../src/main/device/manager';
import type { LinkStatus, RuleSlot, Telemetry } from '../src/shared/model';

const wasmPath = join(process.cwd(), 'assets', 'firmware-core.wasm');

function waitFor<T>(predicate: () => T | undefined | null | false, timeoutMs = 6000): Promise<NonNullable<T>> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = predicate();
      if (value) {
        clearInterval(timer);
        resolve(value as NonNullable<T>);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('tempo esgotado'));
      }
    }, 25);
  });
}

describe('simulador com o núcleo do firmware em WebAssembly', () => {
  let dir: string;
  let manager: DeviceManager;
  let status: LinkStatus | null = null;
  let telemetry: Telemetry | null = null;
  const events: number[] = [];

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'malha-sim-'));
    manager = new DeviceManager({ wasmPath, simulatorNvsPath: join(dir, 'nvs.bin'), heartbeatMs: 300, reconnectMs: 200 });
    manager.on('status', (value) => {
      status = value;
    });
    manager.on('telemetry', (value) => {
      telemetry = value;
    });
    manager.on('event', (value) => events.push(value.code));
    await manager.connect({ kind: 'simulator' });
    await waitFor(() => status?.state === 'online');
  });

  after(async () => {
    await manager.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it('faz o aperto de mão e recebe telemetria', async () => {
    assert.equal(status?.info?.firmware, '1.0.0');
    assert.equal(status?.info?.channels, 5);
    const sample = await waitFor(() => telemetry);
    assert.equal(sample.values.length, 5);
    assert.ok(sample.values[0] !== null && sample.values[0] > 0);
    assert.ok(events.includes(1));
  });

  it('aplica comandos de saída e recusa valores fora do intervalo', async () => {
    await manager.setOutput(2, 600);
    await waitFor(() => telemetry?.outputs[2] === 600);
    await assert.rejects(manager.setOutput(0, 7), /recusado/);
  });

  it('executa regras no firmware e gera eventos', async () => {
    const rules: RuleSlot[] = await manager.setRule(0, {
      enabled: true,
      channel: 0,
      comparison: 'above',
      threshold: -50,
      hysteresis: 1,
      delayS: 0,
      output: 1,
      onValue: 1,
      offValue: 0,
      severity: 3,
    });
    assert.equal(rules[0].rule.enabled, true);
    await waitFor(() => telemetry?.outputs[1] === 1 && (telemetry.activeRules & 1) === 1);
    await waitFor(() => events.includes(2));
    await manager.clearRule(0);
    await waitFor(() => telemetry?.outputs[1] === 0);
  });

  it('grava na memória e mantém após reiniciar', async () => {
    const config = await manager.refreshConfig();
    await manager.setConfig({ ...config, sampleIntervalMs: 500 });
    await waitFor(() => telemetry?.dirty === true);
    await manager.save();
    await manager.reboot();
    await waitFor(() => status?.state === 'reconnecting' || status?.state === 'online', 4000);
    await waitFor(() => status?.state === 'online' && (telemetry?.uptimeMs ?? 99999) < 5000, 10000);
    const reloaded = await manager.refreshConfig();
    assert.equal(reloaded.sampleIntervalMs, 500);
  });

  it('restaura os padrões de fábrica', async () => {
    await manager.factoryReset();
    const config = await manager.refreshConfig();
    assert.equal(config.sampleIntervalMs, 1000);
  });

  it('detecta falha de sensor simulada', async () => {
    manager.setSimulatorControls({ ...manager.getSimulatorControls(), temperatureFault: true });
    await waitFor(() => telemetry?.values[0] === null && telemetry.sensorFault);
    await waitFor(() => events.includes(8));
    manager.setSimulatorControls({ ...manager.getSimulatorControls(), temperatureFault: false });
    await waitFor(() => telemetry?.values[0] !== null);
  });
});
