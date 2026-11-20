import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const withTests = process.argv.includes('--tests');
const production = process.env.NODE_ENV !== 'development';

const fonts = [
  ['@fontsource-variable/instrument-sans/files', 'instrument-sans-latin-standard-normal.woff2'],
  ['@fontsource-variable/bricolage-grotesque/files', 'bricolage-grotesque-latin-standard-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files', 'ibm-plex-mono-latin-500-normal.woff2'],
];

const common = {
  bundle: true,
  sourcemap: production ? false : 'inline',
  minify: production,
  legalComments: 'none',
  logLevel: 'warning',
};

async function buildApp() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(join(dist, 'renderer', 'fonts'), { recursive: true });
  await Promise.all([
    build({
      ...common,
      entryPoints: [join(root, 'src/main/main.ts')],
      outfile: join(dist, 'main.js'),
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron', 'serialport'],
    }),
    build({
      ...common,
      entryPoints: [join(root, 'src/preload/preload.ts')],
      outfile: join(dist, 'preload.js'),
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
    }),
    build({
      ...common,
      entryPoints: { app: join(root, 'src/renderer/main.tsx') },
      outdir: join(dist, 'renderer'),
      platform: 'browser',
      format: 'iife',
      target: 'chrome130',
      jsx: 'automatic',
      jsxImportSource: 'preact',
      external: ['fonts/*'],
    }),
  ]);
  await copyFile(join(root, 'src/renderer/index.html'), join(dist, 'renderer/index.html'));
  await copyFile(join(root, 'assets/firmware-core.wasm'), join(dist, 'firmware-core.wasm'));
  await copyFile(join(root, 'assets/icon.png'), join(dist, 'icon.png'));
  for (const [folder, file] of fonts) {
    await copyFile(join(root, 'node_modules', folder, file), join(dist, 'renderer/fonts', file));
  }
}

async function buildTests() {
  const out = join(root, 'out-test');
  await rm(out, { recursive: true, force: true });
  const files = (await readdir(join(root, 'test'))).filter((file) => file.endsWith('.test.ts'));
  await build({
    ...common,
    minify: false,
    sourcemap: 'inline',
    entryPoints: files.map((file) => join(root, 'test', file)),
    outdir: out,
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'serialport'],
  });
}

await buildApp();
if (withTests) {
  await buildTests();
}
