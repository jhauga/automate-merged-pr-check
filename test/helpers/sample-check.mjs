import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KIT_IMPORT, installKit } from '../../lib/test-folder.mjs';
import { installKitDependencies } from './kit-deps.mjs';

/** A README long enough for the contract, naming run.mjs. */
export const SAMPLE_README = [
  '# Check: the greeting still prints',
  '',
  'This check proves that the sample command still prints its greeting at the newest commit of the base branch.',
  '',
  '## Rung and layers',
  '',
  'Rung 2, a command line or a library. The page layer runs the command with the process driver and saves its output.',
  '',
  '## Run it by hand',
  '',
  'Run `node run.mjs --out results/manual` in this folder. Exit code 0 means the greeting printed; 1 means it did not.',
  '',
  '## Baseline',
  '',
  'The baseline holds greeting.txt with the greeting text. Look at it once.',
  '',
].join('\n');

/**
 * run.mjs for a check that captures two 40x40 frames of a striped scene, the
 * second with its first `changed` pixels inverted.
 */
const framesRun = (changed) => (kit) => [
  `import { runCheck, writeImage } from '${kit}';`,
  '',
  'const frame = (changed) => {',
  '  const data = Buffer.alloc(40 * 40 * 4);',
  '  for (let index = 0; index < 40 * 40; index += 1) {',
  '    const light = (index % 40 < 20) !== (index < changed);',
  '    data.set(light ? [240, 220, 120, 255] : [60, 50, 30, 255], index * 4);',
  '  }',
  '  return { width: 40, height: 40, data };',
  '};',
  '',
  'await runCheck(import.meta.url, async (ctx) => {',
  "  await ctx.layer('page', async () => {",
  "    const scene = await ctx.image('scene', async (file) => writeImage(file, frame(0)));",
  `    await ctx.image('scene-later', async (file) => writeImage(file, frame(${changed})));`,
  "    ctx.assertNotBlank('the scene is not blank', scene);",
  '  });',
  '});',
  '',
].join('\n');

/** run.mjs bodies for the sample check. `sound` asserts on the capture; `blind` asserts nothing it captured. `still` and `moving` capture a pair of frames that differ in 1% and 25% of their pixels. */
export const SAMPLE_RUN = {
  sound: (kit) => [
    `import { runCheck } from '${kit}';`,
    '',
    'await runCheck(import.meta.url, async (ctx) => {',
    "  await ctx.layer('page', async () => {",
    "    const text = await ctx.text('greeting', async () => 'hello from the base tip');",
    "    ctx.assert('the greeting is printed', text.includes('hello'), text);",
    '  });',
    '});',
    '',
  ].join('\n'),
  blind: (kit) => [
    `import { runCheck } from '${kit}';`,
    '',
    'await runCheck(import.meta.url, async (ctx) => {',
    "  await ctx.layer('page', async () => {",
    "    await ctx.text('greeting', async () => 'hello from the base tip');",
    "    ctx.assert('the greeting is printed', true);",
    '  });',
    '});',
    '',
  ].join('\n'),
  still: framesRun(16),
  moving: framesRun(400),
  noKit: () => "console.log('hello');\n",
};

/**
 * Writes a complete check into `dir` the way an assistant would: README,
 * run.mjs, package.json, and check.config.json updated from the planned one.
 */
export function writeSampleCheck(dir, { run = 'sound', config = {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const configFile = path.join(dir, 'check.config.json');
  const planned = JSON.parse(readFileSync(configFile, 'utf8'));
  const updated = {
    ...planned,
    layers: { page: { enabled: true, driver: 'process' }, hostApp: { enabled: false, driver: 'pending' } },
    compare: { ...planned.compare, strategy: 'text', threshold: 0 },
    ...config,
  };
  writeFileSync(configFile, `${JSON.stringify(updated, null, 2)}\n`);
  writeFileSync(path.join(dir, 'README.md'), SAMPLE_README);
  writeFileSync(path.join(dir, 'run.mjs'), SAMPLE_RUN[run](KIT_IMPORT));
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'sample-check', private: true, type: 'module', dependencies: { pngjs: '^7.0.0' } }, null, 2)}\n`);
  installKit(dir);
  installKitDependencies(dir);
}
