import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { captureBaseline } from '../../lib/harness.mjs';
import { KIT_IMPORT, installKit } from '../../lib/test-folder.mjs';
import { installKitDependencies } from './kit-deps.mjs';

/** Folder name of the sample check. */
export const SLUG = 'acme-demo-app-pr-123';

/** run.mjs of the sample check. mode.txt next to it picks what the run does. */
export function runScript(kit) {
  return `import { existsSync, readFileSync } from 'node:fs';
import { runCheck, writeImage } from '${kit}';

const modeFile = new URL('./mode.txt', import.meta.url);
const mode = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : 'pass';

function scene([red, green, blue]) {
  const width = 48;
  const height = 32;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = ((x * 7 + y * 13) % 23) - 11;
      data.set([red + wave, green + wave * 2, blue + wave, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

await runCheck(import.meta.url, async (ctx) => {
  if (mode === 'hang') await new Promise((resolve) => setTimeout(resolve, 60000));
  if (mode === 'throw') throw new Error('no browser is installed');
  await ctx.layer('page', async () => {
    if (ctx.phase === 'start') {
      ctx.assert('the work started', true);
      return;
    }
    const text = await ctx.text('greeting', async () => (mode === 'fail' ? 'goodbye' : 'hello from the base tip'));
    ctx.assert('the greeting is printed', text.includes('hello'), text);
    const color = mode === 'repainted' ? [200, 40, 40] : [40, 150, 60];
    const shot = await ctx.image('page-initial', async (file) => writeImage(file, scene(color)));
    ctx.assertNotBlank('page-initial is not blank', shot);
  });
});
`;
}

/** A test folder holding one check, with its baseline captured. */
export async function makeTestFolder(base, name, { source = {}, runMode = 'single', timeoutMinutes = 2, notify = 'inherit', features = 'inherit' } = {}) {
  const dir = path.join(base, name);
  mkdirSync(path.join(dir, 'repo'), { recursive: true });
  const config = {
    slug: SLUG,
    alias: 'demo-app',
    pr: { url: 'https://github.com/acme/demo-app/pull/123', owner: 'acme', repo: 'demo-app', base: 'main', head: { ref: 'fix-typo' } },
    classification: { kind: 'source', subtype: 'cli', watchPaths: ['bin/**'] },
    source: { mode: 'upstream', upstreamUrl: 'https://github.com/acme/demo-app.git', baseRef: 'main', localRepo: null, branch: null, clonePath: 'repo', sparsePaths: null, ...source },
    subject: { type: 'cli', path: 'bin', installedPath: null, hostApp: null },
    layers: { page: { enabled: true, driver: 'process' }, hostApp: { enabled: false, driver: 'pending' } },
    runMode,
    timeoutMinutes,
    compare: { strategy: 'composite', threshold: 0.25, masks: [] },
    models: { testDriver: 'haiku' },
    schedule: 'inherit',
    notify,
    features,
  };
  writeFileSync(path.join(dir, 'check.config.json'), JSON.stringify(config, null, 2));
  writeFileSync(path.join(dir, 'run.mjs'), runScript(KIT_IMPORT));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sample-check', private: true, type: 'module', dependencies: { pngjs: '^7.0.0' } }));
  writeFileSync(path.join(dir, 'context.md'), '# Context\n');
  installKit(dir);
  installKitDependencies(dir);
  const captured = await captureBaseline(dir, { timeoutMinutes: 2 });
  assert.equal(captured.exitCode, 0, captured.stderr);
  return { root: dir, dir };
}

export function fakes(extra = {}) {
  const calls = { refresh: 0, afterRun: [] };
  let sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  return {
    calls,
    setSha: (value) => {
      sha = value;
    },
    deps: {
      refreshClone: ({ dir }) => {
        calls.refresh += 1;
        mkdirSync(dir, { recursive: true });
        return { dir, sha };
      },
      fingerprint: () => ({ os: { platform: 'test' }, node: '24.0.0' }),
      afterRun: async (context) => {
        calls.afterRun.push(context);
        return { notified: context.decision.notify };
      },
      ...extra,
    },
  };
}

export const setMode = (dir, mode) => writeFileSync(path.join(dir, 'mode.txt'), mode);
export const readState = (dir) => JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
