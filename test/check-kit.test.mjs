import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { BASELINE_MANIFEST, BLANK_SHARE, CHECK_EXIT, blackImage, imageStats, isBlank, readImage, runCheck, writeImage } from '../lib/check-kit.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-kit-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A many-colored image, like a rendered scene. */
function textured(width = 40, height = 30) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = (x * 37) % 256;
      data[index + 1] = (y * 53 + 90) % 256;
      data[index + 2] = ((x + y) * 29) % 256;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

function makeCheck(layers = { page: { enabled: true }, hostApp: { enabled: false } }) {
  const dir = mkdtempSync(path.join(base, 'check-'));
  writeFileSync(path.join(dir, 'check.config.json'), JSON.stringify({ source: { clonePath: 'repo' }, layers }));
  return dir;
}

async function run(dir, extra, body) {
  const out = path.join(dir, 'out');
  let code = null;
  await runCheck(pathToFileURL(path.join(dir, 'run.mjs')).href, body, {
    argv: ['--out', out, ...extra],
    exit: (value) => {
      code = value;
    },
  });
  const file = path.join(out, 'result.json');
  return { code, out, result: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}

const capturePng = (image) => async (file) => writeImage(file, image);

test('a black image is blank and a textured one is not', () => {
  const black = blackImage(20, 10);
  const stats = imageStats(black);
  assert.equal(stats.uniformShare, 1);
  assert.deepEqual(stats.dominant, [8, 8, 8]);
  assert.equal(isBlank(black), true);
  const scene = textured();
  assert.ok(imageStats(scene).uniformShare < BLANK_SHARE);
  assert.equal(isBlank(scene), false);

  const file = path.join(base, 'roundtrip.png');
  writeImage(file, scene);
  const back = readImage(file);
  assert.equal(back.width, scene.width);
  assert.ok(back.data.equals(scene.data));
});

test('a run whose assertions pass exits 0 and records its artifacts by layer', async () => {
  const dir = makeCheck();
  const { code, result } = await run(dir, [], async (ctx) => {
    assert.equal(ctx.source, path.join(dir, 'repo'));
    await ctx.layer('page', async () => {
      const text = await ctx.text('greeting', async () => 'hello');
      ctx.assert('the greeting is printed', text === 'hello', text);
    });
    await ctx.layer('hostApp', async () => {
      throw new Error('a disabled layer never runs');
    });
  });
  assert.equal(code, CHECK_EXIT.PASS);
  assert.equal(result.outcome, 'pass');
  assert.deepEqual(result.layers, { page: 'ran', hostApp: 'skipped' });
  assert.deepEqual(result.artifacts, [{ name: 'greeting', file: 'greeting.txt', kind: 'text', layer: 'page' }]);
  assert.deepEqual(result.assertions, [{ name: 'the greeting is printed', ok: true, detail: 'hello', layer: 'page' }]);
});

test('a failed assertion exits 1, a thrown error or no assertion at all exits 2', async () => {
  const failed = await run(makeCheck(), [], async (ctx) => {
    await ctx.layer('page', async () => ctx.assert('two equals three', 2 === 3));
  });
  assert.equal(failed.code, CHECK_EXIT.FAIL);
  assert.equal(failed.result.outcome, 'fail');

  const thrown = await run(makeCheck(), [], async () => {
    throw new Error('no browser is installed');
  });
  assert.equal(thrown.code, CHECK_EXIT.ERROR);
  assert.match(thrown.result.error, /no browser is installed/);

  const silent = await run(makeCheck(), [], async () => {});
  assert.equal(silent.code, CHECK_EXIT.ERROR);
  assert.equal(silent.result.error, 'The check made no assertions.');

  const unknown = await run(makeCheck(), [], async (ctx) => ctx.layer('desktop', async () => {}));
  assert.equal(unknown.code, CHECK_EXIT.ERROR);
  assert.match(unknown.result.error, /Unknown layer "desktop"/);
});

test('a layer that throws stops only itself; a failed assertion still reports a failure', async () => {
  const both = { page: { enabled: true }, hostApp: { enabled: true } };
  const errored = await run(makeCheck(both), [], async (ctx) => {
    await ctx.layer('hostApp', async () => {
      throw new Error('no desktop session');
    });
    await ctx.layer('page', async () => ctx.assert('the page works', true));
  });
  assert.equal(errored.code, CHECK_EXIT.ERROR);
  assert.deepEqual(errored.result.layers, { hostApp: 'error', page: 'ran' });
  assert.match(errored.result.error, /^hostApp: Error: no desktop session/);

  const failed = await run(makeCheck(both), [], async (ctx) => {
    await ctx.layer('page', async () => ctx.assert('the page works', false));
    await ctx.layer('hostApp', async () => {
      throw new Error('no desktop session');
    });
  });
  assert.equal(failed.code, CHECK_EXIT.FAIL);
  assert.equal(failed.result.outcome, 'fail');
});

test('--simulate-fail black still captures, then replaces every value so a sound check fails', async () => {
  const produced = [];
  const dir = makeCheck();
  const { code, out, result } = await run(dir, ['--simulate-fail', 'black'], async (ctx) => {
    await ctx.layer('page', async () => {
      const shot = await ctx.image('page-initial', capturePng(textured()));
      ctx.assertNotBlank('the view is not blank', shot);
      const text = await ctx.text('version', async () => {
        produced.push('text');
        return 'demo-app 1.2.3';
      });
      ctx.assert('the version is printed', text.startsWith('demo-app'), text);
      const facts = await ctx.json('facts', async () => {
        produced.push('json');
        return { canvas: { width: 800 } };
      });
      ctx.assert('the canvas fills the view', facts?.canvas?.width === 800, JSON.stringify(facts));
    });
  });
  assert.equal(code, CHECK_EXIT.FAIL);
  assert.deepEqual(produced, ['text', 'json']);
  assert.deepEqual(result.assertions.map((entry) => entry.ok), [false, false, false]);
  assert.equal(isBlank(readImage(path.join(out, 'page-initial.png'))), true);
  assert.equal(readFileSync(path.join(out, 'version.txt'), 'utf8'), '');
  assert.equal(readFileSync(path.join(out, 'facts.json'), 'utf8'), 'null\n');
});

test('--simulate-fail with a picture puts that picture in place of each capture', async () => {
  const replacement = path.join(base, 'broken.png');
  writeImage(replacement, blackImage(12, 8));
  const { code, result } = await run(makeCheck(), ['--simulate-fail', replacement], async (ctx) => {
    await ctx.layer('page', async () => {
      const shot = await ctx.image('page-initial', capturePng(textured()));
      ctx.assert('the capture keeps its size', shot.width === 40, `${shot.width}x${shot.height}`);
    });
  });
  assert.equal(code, CHECK_EXIT.FAIL);
  assert.equal(result.assertions[0].detail, '12x8');
});

test('--capture-baseline saves only the layers whose assertions all pass', async () => {
  const both = { page: { enabled: true }, hostApp: { enabled: true } };
  const body = (hostAppWorks) => async (ctx) => {
    await ctx.layer('page', async () => {
      const shot = await ctx.image('page-initial', capturePng(textured()));
      ctx.assertNotBlank('the page is not blank', shot);
    });
    await ctx.layer('hostApp', async () => {
      const shot = await ctx.image('host-app-view', capturePng(hostAppWorks ? textured() : blackImage(40, 30)));
      ctx.assertNotBlank('the host app view is not blank', shot);
    });
  };

  const partial = makeCheck(both);
  const first = await run(partial, ['--capture-baseline'], body(false));
  assert.equal(first.code, CHECK_EXIT.FAIL);
  assert.equal(first.result.outcome, 'fail');
  assert.equal(first.result.baseline.page, 'captured');
  assert.match(first.result.baseline.hostApp, /^not captured: the host app view is not blank failed \(100% of pixels share one color\)$/);
  assert.deepEqual(readdirSync(path.join(partial, 'baseline')).sort(), [BASELINE_MANIFEST, 'page-initial.png']);
  const manifest = JSON.parse(readFileSync(path.join(partial, 'baseline', BASELINE_MANIFEST), 'utf8'));
  assert.deepEqual(Object.keys(manifest.artifacts), ['page-initial.png']);
  assert.equal(manifest.artifacts['page-initial.png'].layer, 'page');

  const whole = makeCheck(both);
  const second = await run(whole, ['--capture-baseline'], body(true));
  assert.equal(second.code, CHECK_EXIT.PASS);
  assert.equal(second.result.outcome, 'baseline');
  assert.deepEqual(readdirSync(path.join(whole, 'baseline')).sort(), [BASELINE_MANIFEST, 'host-app-view.png', 'page-initial.png']);

  const recapture = await run(whole, ['--capture-baseline'], async (ctx) => {
    await ctx.layer('page', async () => {
      const shot = await ctx.image('page-renamed', capturePng(textured()));
      ctx.assertNotBlank('the page is not blank', shot);
    });
  });
  assert.equal(recapture.code, CHECK_EXIT.PASS);
  assert.deepEqual(readdirSync(path.join(whole, 'baseline')).sort(), [BASELINE_MANIFEST, 'host-app-view.png', 'page-renamed.png']);

  const errored = makeCheck(both);
  const third = await run(errored, ['--capture-baseline'], async (ctx) => {
    await ctx.layer('page', async () => ctx.assert('the page works', true));
    await ctx.layer('hostApp', async () => {
      throw new Error('the host app never started');
    });
  });
  assert.equal(third.code, CHECK_EXIT.ERROR);
  assert.deepEqual(third.result.baseline, { page: 'captured', hostApp: 'not captured: the layer stopped with an error' });
});

test('--layers picks the layers to run, and bad options exit 2 without a result', async () => {
  const both = { page: { enabled: true }, hostApp: { enabled: true } };
  const picked = await run(makeCheck(both), ['--layers', 'page'], async (ctx) => {
    assert.deepEqual(ctx.layers, ['page']);
    await ctx.layer('page', async () => ctx.assert('the page works', true));
    await ctx.layer('hostApp', async () => ctx.assert('never reached', false));
  });
  assert.equal(picked.code, CHECK_EXIT.PASS);
  assert.equal(picked.result.layers.hostApp, 'skipped');

  const badLayer = await run(makeCheck(), ['--layers', 'desktop'], async () => {});
  assert.equal(badLayer.code, CHECK_EXIT.ERROR);
  assert.equal(badLayer.result, null);

  let code = null;
  await runCheck(pathToFileURL(path.join(makeCheck(), 'run.mjs')).href, async () => {}, { argv: [], exit: (value) => { code = value; } });
  assert.equal(code, CHECK_EXIT.ERROR);
});

test('state merges across writes, and --source points the check at other code', async () => {
  const dir = makeCheck();
  const source = path.join(base, 'elsewhere');
  const { code } = await run(dir, ['--source', source], async (ctx) => {
    assert.equal(ctx.source, source);
    assert.deepEqual(ctx.readState(), {});
    ctx.writeState({ storedConversation: { name: 'auto-check sample-canvas', id: 'demo-id' } });
    ctx.writeState({ lastRun: 'now' });
    assert.deepEqual(ctx.readState(), { storedConversation: { name: 'auto-check sample-canvas', id: 'demo-id' }, lastRun: 'now' });
    ctx.assert('state was kept', ctx.readState().lastRun === 'now');
  });
  assert.equal(code, CHECK_EXIT.PASS);
  assert.ok(existsSync(path.join(dir, 'state.json')));
});
