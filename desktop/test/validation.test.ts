import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TelnetFilter } from '../src/main/device/tcp-transport';
import { csvCell, telemetryHeader, telemetryLine } from '../src/main/services/exporter';
import { DEFAULT_CONFIG, type Rule } from '../src/shared/model';
import { parseConfig, parseOutputCommand, parseRule, parseSettingsPatch, parseTarget, ValidationError } from '../src/shared/validation';

const base: Rule = { enabled: true, channel: 0, comparison: 'above', threshold: 30, hysteresis: 1, delayS: 5, output: 2, onValue: 1000, offValue: 0, severity: 1 };

describe('validação de entrada', () => {
  it('aceita uma regra válida e recusa as inválidas', () => {
    assert.deepEqual(parseRule(base), base);
    const invalid: unknown[] = [
      null,
      { ...base, channel: 5 },
      { ...base, comparison: 'equal' },
      { ...base, threshold: Number.NaN },
      { ...base, hysteresis: -1 },
      { ...base, delayS: 1.5 },
      { ...base, output: 0, onValue: 2 },
      { ...base, output: 2, onValue: 1001 },
      { ...base, output: null, severity: 0 },
      { ...base, severity: 4 },
      { ...base, enabled: 'sim' },
    ];
    for (const value of invalid) {
      assert.throws(() => parseRule(value), ValidationError, JSON.stringify(value));
    }
  });

  it('limita comandos de saída ao tipo da saída', () => {
    assert.deepEqual(parseOutputCommand(0, 1), { output: 0, value: 1 });
    assert.throws(() => parseOutputCommand(0, 2));
    assert.throws(() => parseOutputCommand(3, 0));
    assert.throws(() => parseOutputCommand(2, -1));
  });

  it('valida configuração completa', () => {
    assert.deepEqual(parseConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
    assert.throws(() => parseConfig({ ...DEFAULT_CONFIG, sampleIntervalMs: 50 }));
    assert.throws(() => parseConfig({ ...DEFAULT_CONFIG, calibration: [] }));
    assert.throws(() => parseConfig({ ...DEFAULT_CONFIG, calibration: DEFAULT_CONFIG.calibration.map(() => ({ gain: 0, offset: 0 })) }));
  });

  it('só aceita destinos de conexão bem formados', () => {
    assert.deepEqual(parseTarget({ kind: 'serial', path: 'COM12' }), { kind: 'serial', path: 'COM12' });
    assert.deepEqual(parseTarget({ kind: 'tcp', host: 'localhost', port: 4000 }), { kind: 'tcp', host: 'localhost', port: 4000, telnet: true });
    for (const value of [{ kind: 'serial', path: '\\\\.\\COM1 & calc' }, { kind: 'serial', path: '../etc/passwd' }, { kind: 'tcp', host: 'a b', port: 1 }, { kind: 'tcp', host: 'x', port: 70000 }, { kind: 'usb' }]) {
      assert.throws(() => parseTarget(value), ValidationError);
    }
  });

  it('filtra preferências desconhecidas', () => {
    assert.deepEqual(parseSettingsPatch({ theme: 'dark', hacker: true }), { theme: 'dark' });
    assert.throws(() => parseSettingsPatch({ retentionDays: 0 }));
  });
});

describe('exportação CSV', () => {
  it('neutraliza fórmulas e usa vírgula decimal', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('-2+3'), "'-2+3");
    assert.equal(csvCell(3.25), '3,25');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell('a;b'), '"a;b"');
  });

  it('gera cabeçalho e linhas alinhados', () => {
    const header = telemetryHeader().split(';');
    const line = telemetryLine({ ts: 0, values: [24.5, 50, 40, 5.02, 1], outputs: [1, 0, 750], activeRules: 3 }).split(';');
    assert.equal(header.length, line.length);
    assert.ok(header.includes('temperatura_c'));
    assert.equal(line[2], '24,5');
  });
});

describe('telnet (RFC 2217)', () => {
  it('remove negociações, responde recusando e desfaz o escape de 0xFF', () => {
    const replies: number[][] = [];
    const filter = new TelnetFilter((bytes) => replies.push([...bytes]));
    const out = filter.feed(Uint8Array.of(0x01, 0xff, 0xfd, 0x2c, 0x02, 0xff, 0xff, 0x03, 0xff, 0xfa, 0x2c, 0x01, 0xff, 0xf0, 0x04));
    assert.deepEqual([...out], [0x01, 0x02, 0xff, 0x03, 0x04]);
    assert.deepEqual(replies, [[0xff, 0xfc, 0x2c]]);
    assert.deepEqual([...TelnetFilter.escape(Uint8Array.of(0xff, 0x00))], [0xff, 0xff, 0x00]);
  });
});
