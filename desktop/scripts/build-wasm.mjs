import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const firmware = join(root, '..', 'firmware');
const core = join(firmware, 'lib', 'malha_core', 'src');
const sources = readdirSync(join(core, 'malha'))
  .filter((file) => file.endsWith('.cpp'))
  .map((file) => join(core, 'malha', file));

const args = [
  'c++',
  '-target',
  'wasm32-wasi',
  '-mexec-model=reactor',
  '-Os',
  '-std=c++17',
  '-fno-exceptions',
  '-fno-rtti',
  '-Wall',
  '-Wextra',
  '-Werror',
  `-I${core}`,
  join(firmware, 'wasm', 'malha_wasm.cpp'),
  ...sources,
  '-o',
  join(root, 'assets', 'firmware-core.wasm'),
];

function available(command, prefix) {
  try {
    execFileSync(command, [...prefix, 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const candidates = process.env.ZIG ? [[process.env.ZIG, []]] : [['zig', []], ['python', ['-m', 'ziglang']], ['python3', ['-m', 'ziglang']]];
const found = candidates.find(([command, prefix]) => available(command, prefix));
if (!found) {
  console.error('Zig não encontrado. Instale com "pip install ziglang" ou defina a variável ZIG.');
  process.exit(1);
}
const [command, prefix] = found;
execFileSync(command, [...prefix, ...args], { stdio: 'inherit' });
console.log('assets/firmware-core.wasm atualizado.');
