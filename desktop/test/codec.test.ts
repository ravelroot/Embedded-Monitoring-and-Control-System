import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  cobsDecode,
  cobsEncode,
  crc16,
  decodePayload,
  encodeFrame,
  FrameDecoder,
  MsgType,
  Reader,
  readConfig,
  readInfo,
  readRules,
  readRule,
  readTelemetry,
  writeConfig,
  writeRule,
  Writer,
} from '../src/main/device/codec';
import { DEFAULT_CONFIG, type Rule } from '../src/shared/model';

interface Vectors {
  valid: { name: string; type: number; seq: number; body: string; wire: string }[];
  invalid: { name: string; wire: string; error: string }[];
}

const vectors = JSON.parse(readFileSync(join(process.cwd(), '..', 'protocol', 'vectors.json'), 'utf8')) as Vectors;
const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));

describe('codec', () => {
  it('CRC-16/CCITT-FALSE confere com o valor de verificação', () => {
    assert.equal(crc16(new TextEncoder().encode('123456789')), 0x29b1);
  });

  it('COBS ida e volta com zeros e blocos longos', () => {
    for (const size of [0, 1, 253, 254, 255, 600]) {
      const data = Uint8Array.from({ length: size }, (_, index) => (index % 7 === 0 ? 0 : index % 256));
      const encoded = cobsEncode(data);
      assert.ok(!encoded.includes(0));
      assert.deepEqual(cobsDecode(encoded), data);
    }
    assert.equal(cobsDecode(Uint8Array.of(5, 1, 2)), null);
  });

  it('gera exatamente os bytes dos vetores oficiais', () => {
    assert.ok(vectors.valid.length >= 10);
    for (const vector of vectors.valid) {
      assert.equal(Buffer.from(encodeFrame(vector.type, vector.seq, hex(vector.body))).toString('hex'), vector.wire, vector.name);
    }
  });

  it('decodifica os vetores válidos e rejeita os inválidos pelo motivo certo', () => {
    const decoder = new FrameDecoder();
    for (const vector of vectors.valid) {
      const frames: number[] = [];
      decoder.push(hex(vector.wire), (frame) => frames.push(frame.seq), (error) => assert.fail(`${vector.name}: ${error}`));
      assert.deepEqual(frames, [vector.seq], vector.name);
    }
    for (const vector of vectors.invalid) {
      const errors: string[] = [];
      decoder.push(hex(vector.wire), () => assert.fail(vector.name), (error) => errors.push(error));
      assert.deepEqual(errors, [vector.error], vector.name);
    }
  });

  it('remonta quadros entregues byte a byte e misturados com lixo', () => {
    const decoder = new FrameDecoder();
    const wire = new Uint8Array([0x13, 0x37, 0x00, ...encodeFrame(MsgType.Ping, 9, Uint8Array.of(1, 2, 3, 4))]);
    const seqs: number[] = [];
    const errors: string[] = [];
    for (const byte of wire) {
      decoder.push(Uint8Array.of(byte), (frame) => seqs.push(frame.seq), (error) => errors.push(error));
    }
    assert.deepEqual(seqs, [9]);
    assert.equal(errors.length, 1);
  });

  it('detecta estouro de buffer sem travar', () => {
    const decoder = new FrameDecoder();
    const errors: string[] = [];
    decoder.push(new Uint8Array(400).fill(0x11), () => assert.fail(), (error) => errors.push(error));
    decoder.push(Uint8Array.of(0), () => assert.fail(), (error) => errors.push(error));
    assert.deepEqual(errors, ['overflow']);
  });

  it('recusa corpo acima do limite', () => {
    assert.throws(() => encodeFrame(MsgType.Ping, 1, new Uint8Array(241)));
    assert.equal(decodePayload(new Uint8Array(3)), 'short');
  });

  it('regra e configuração fazem ida e volta', () => {
    const rule: Rule = { enabled: true, channel: 2, comparison: 'below', threshold: 20, hysteresis: 60, delayS: 3, output: 0, onValue: 1, offValue: 0, severity: 1 };
    assert.deepEqual(readRule(new Reader(writeRule(new Writer(), rule).done())), rule);
    const alarmOnly: Rule = { ...rule, output: null, severity: 3 };
    assert.deepEqual(readRule(new Reader(writeRule(new Writer(), alarmOnly).done())), alarmOnly);
    const config = { ...DEFAULT_CONFIG, sampleIntervalMs: 500, calibration: DEFAULT_CONFIG.calibration.map((item, index) => ({ gain: item.gain, offset: index * 0.5 })) };
    assert.deepEqual(readConfig(writeConfig(config)), config);
  });

  it('interpreta telemetria, info e lista de regras dos vetores', () => {
    const body = (name: string) => hex(vectors.valid.find((vector) => vector.name === name)?.body ?? '');
    const telemetry = readTelemetry(body('telemetry'));
    assert.equal(telemetry.uptimeMs, 123456);
    assert.deepEqual(telemetry.outputs, [1, 0, 750]);
    assert.equal(telemetry.values[0], 24.5);
    const info = readInfo(body('info'));
    assert.equal(info.firmware, '1.0.0');
    assert.equal(info.deviceId, 'A1B2C3D4E5F6');
    const rules = readRules(body('rules_empty'));
    assert.equal(rules.length, 8);
    assert.ok(rules.every((slot) => !slot.rule.enabled && slot.rule.output === null));
  });
});
