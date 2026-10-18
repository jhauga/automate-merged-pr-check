import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { BASELINE_MANIFEST, writeImage } from '../lib/check-kit.mjs';
import { compareColors } from '../lib/compare/color-sample.mjs';
import { STRATEGIES, compareRun } from '../lib/compare/index.mjs';
import { checkLiveness, checkMotion } from '../lib/compare/liveness.mjs';
import { comparePixels } from '../lib/compare/pixel.mjs';
import { colorName, describeImage } from '../lib/compare/shared.mjs';
import { compareText } from '../lib/compare/text.mjs';

const WIDTH = 64;
const HEIGHT = 48;
let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-compare-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A textured scene, mostly green, like terrain seen from above. `seed` shifts the texture. */
function passImage(seed = 0) {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      const wave = ((x * 7 + y * 13 + seed * 5) % 23) - 11;
      data[index] = 40 + wave;
      data[index + 1] = 150 + wave * 2;
      data[index + 2] = 60 + wave;
      data[index + 3] = 255;
      if (y < 8 && x >= 48) {
        data[index] = 90;
        data[index + 1] = 150;
        data[index + 2] = 230;
      }
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

/** A uniform near-black view, as a canvas that never drew looks. */
function failImage() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let index = 0; index < data.length; index += 4) data.set([8, 8, 10, 255], index);
  return { width: WIDTH, height: HEIGHT, data };
}

/** The pass image with its heads-up display region, the top left corner, repainted. */
function hudChanged() {
  const image = passImage();
  const data = Buffer.from(image.data);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 16; x += 1) data.set([220, 30, 30, 255], (y * WIDTH + x) * 4);
  }
  return { ...image, data };
}

test('colors get plain names', () => {
  assert.equal(colorName([8, 8, 10]), 'near-black');
  assert.equal(colorName([250, 250, 250]), 'near-white');
  assert.equal(colorName([128, 128, 128]), 'gray');
  assert.equal(colorName([40, 150, 60]), 'green');
  assert.equal(colorName([90, 150, 230]), 'blue');
  assert.equal(colorName([220, 30, 30]), 'red');
  assert.equal(describeImage(passImage()).dominant, 'green');
  assert.equal(describeImage(failImage()).dominant, 'near-black');
});

test('pixel: the same scene matches, a black view is far above the threshold, and sizes must agree', () => {
  assert.equal(comparePixels(passImage(), passImage()).ok, true);
  const black = comparePixels(passImage(), failImage(), { threshold: 0.01 });
  assert.equal(black.ok, false);
  assert.ok(black.ratio > 0.9, `ratio ${black.ratio}`);
  const small = { width: 32, height: 24, data: Buffer.alloc(32 * 24 * 4, 255) };
  const sized = comparePixels(passImage(), small);
  assert.equal(sized.ok, false);
  assert.equal(sized.detail, 'the capture is 32x24 where the baseline is 64x48');
});

test('pixel: a mask hides a changed heads-up display, and a failure writes a diff image', () => {
  const diffFile = path.join(base, 'hud.diff.png');
  const unmasked = comparePixels(passImage(), hudChanged(), { threshold: 0.01, artifact: 'page-initial', diffFile });
  assert.equal(unmasked.ok, false);
  assert.equal(unmasked.diffFile, diffFile);
  assert.ok(existsSync(diffFile));
  const masks = [{ artifact: 'page-initial', x: 0, y: 0, width: 16, height: 8 }];
  assert.equal(comparePixels(passImage(), hudChanged(), { threshold: 0.01, masks, artifact: 'page-initial' }).ok, true);
  assert.equal(comparePixels(passImage(), hudChanged(), { threshold: 0.01, masks, artifact: 'page-after-click' }).ok, false);
});

test('color-sample: a shifted scene keeps its palette, a black view does not', () => {
  const shifted = compareColors(passImage(0), passImage(3));
  assert.equal(shifted.ok, true, shifted.detail);
  assert.equal(shifted.dominant, 'green');
  const black = compareColors(passImage(), failImage());
  assert.equal(black.ok, false);
  assert.equal(black.dominant, 'near-black');
  assert.equal(black.baselineDominant, 'green');
  assert.match(black.detail, /^the capture is uniform: 100% of it is near-black, where the baseline is mostly green$/);
});

test('liveness: the scene is live, the black view is uniform, and frames must move', () => {
  assert.equal(checkLiveness(passImage()).ok, true);
  const black = checkLiveness(failImage());
  assert.equal(black.ok, false);
  assert.match(black.detail, /^the capture is uniform: 100% of it is near-black$/);
  assert.equal(checkMotion(passImage(), hudChanged()).ok, true);
  assert.equal(checkMotion(passImage(), passImage()).ok, false);
});

test('text: lines compare without regard to order or spacing, JSON by its fields and their types', () => {
  assert.equal(compareText('curl 8.15.0\nRelease-Date: 2026-01-01\n', 'Release-Date:   2026-01-01\ncurl 8.15.0\n').ok, true);
  const missing = compareText('curl 8.15.0\nProtocols: http https\n', 'curl 8.15.0\n');
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /missing: "Protocols: http https"$/);
  assert.equal(compareText('a\nb\nc\nd\n', 'a\nb\nc\nx\n', { threshold: 0.5 }).ok, true);

  const facts = JSON.stringify({ canvas: { width: 1280, height: 800 }, prompt: { visible: false }, tiles: [{ x: 1 }] });
  const moved = JSON.stringify({ canvas: { width: 1280, height: 800 }, prompt: { visible: true }, tiles: [{ x: 9 }, { x: 10 }] });
  assert.equal(compareText(facts, moved, { json: true }).ok, true);
  const gone = compareText(facts, JSON.stringify({ canvas: { width: 1 }, prompt: null }), { json: true });
  assert.equal(gone.ok, false);
  assert.match(gone.detail, /\$\.canvas\.height was number and is gone$/);
  assert.equal(compareText(facts, 'null', { json: true }).ok, false);
  assert.equal(compareText(facts, '{ not json', { json: true }).detail, 'the capture is not valid JSON, where the baseline is');
});

function runFolders(name) {
  const outDir = path.join(base, name, 'out');
  const baselineDir = path.join(base, name, 'baseline');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(baselineDir, { recursive: true });
  return { outDir, baselineDir };
}

test('every strategy passes the pass scene against itself and fails the black view against it', () => {
  for (const strategy of STRATEGIES.filter((entry) => entry !== 'text')) {
    const { outDir, baselineDir } = runFolders(`strategy-${strategy}`);
    writeImage(path.join(baselineDir, 'page-initial.png'), passImage());
    writeImage(path.join(outDir, 'page-initial.png'), passImage());
    const artifacts = [{ name: 'page-initial', file: 'page-initial.png', kind: 'image', layer: 'page' }];
    assert.equal(compareRun({ outDir, baselineDir, artifacts, settings: { strategy } }).ok, true, strategy);
    writeImage(path.join(outDir, 'page-initial.png'), failImage());
    const failed = compareRun({ outDir, baselineDir, artifacts, settings: { strategy } });
    assert.equal(failed.ok, false, strategy);
    assert.ok(failed.failures.every((failure) => failure.artifact === 'page-initial'));
  }
  const { outDir, baselineDir } = runFolders('strategy-text');
  writeFileSync(path.join(baselineDir, 'claims.txt'), '--verbose\n--output <file>\n');
  writeFileSync(path.join(outDir, 'claims.txt'), '--verbose\n--output <file>\n');
  const artifacts = [{ name: 'claims', file: 'claims.txt', kind: 'text', layer: 'page' }];
  assert.equal(compareRun({ outDir, baselineDir, artifacts, settings: { strategy: 'text' } }).ok, true);
  writeFileSync(path.join(outDir, 'claims.txt'), '');
  assert.equal(compareRun({ outDir, baselineDir, artifacts, settings: { strategy: 'text' } }).ok, false);
  assert.throws(() => compareRun({ outDir, baselineDir, artifacts, settings: { strategy: 'auto' } }), /compare\.strategy must be one of/);
});

test('a run is compared capture by capture: new captures are skipped, lost ones fail, and motion pairs must differ', () => {
  const { outDir, baselineDir } = runFolders('composite');
  writeImage(path.join(baselineDir, 'page-initial.png'), passImage());
  writeImage(path.join(baselineDir, 'page-config.png'), passImage());
  writeImage(path.join(baselineDir, 'host-app-view.png'), passImage());
  writeFileSync(path.join(baselineDir, 'page-facts.json'), JSON.stringify({ canvas: { width: 1280 } }));
  writeFileSync(path.join(baselineDir, BASELINE_MANIFEST), JSON.stringify({
    artifacts: {
      'page-initial.png': { name: 'page-initial', kind: 'image', layer: 'page' },
      'page-config.png': { name: 'page-config', kind: 'image', layer: 'page' },
      'host-app-view.png': { name: 'host-app-view', kind: 'image', layer: 'hostApp' },
      'page-facts.json': { name: 'page-facts', kind: 'json', layer: 'page' },
    },
  }));
  writeImage(path.join(outDir, 'page-initial.png'), passImage(2));
  writeImage(path.join(outDir, 'page-flying.png'), passImage(5));
  writeImage(path.join(outDir, 'page-flying-later.png'), passImage(5));
  writeFileSync(path.join(outDir, 'page-facts.json'), JSON.stringify({ canvas: { width: 1279 } }));
  const artifacts = [
    { name: 'page-initial', file: 'page-initial.png', kind: 'image', layer: 'page' },
    { name: 'page-flying', file: 'page-flying.png', kind: 'image', layer: 'page' },
    { name: 'page-flying-later', file: 'page-flying-later.png', kind: 'image', layer: 'page' },
    { name: 'page-facts', file: 'page-facts.json', kind: 'json', layer: 'page' },
  ];
  const settings = { strategy: 'composite', threshold: 0.25, motion: [['page-flying', 'page-flying-later']] };
  const result = compareRun({ outDir, baselineDir, artifacts, settings, layers: { page: 'ran', hostApp: 'skipped' } });
  const summary = result.results.map((entry) => `${entry.artifact} ${entry.method} ${entry.skipped ? 'skipped' : entry.ok ? 'ok' : 'failed'}`);
  assert.deepEqual(summary, [
    'page-initial color-sample ok',
    'page-initial liveness ok',
    'page-flying color-sample skipped',
    'page-flying liveness ok',
    'page-flying-later color-sample skipped',
    'page-flying-later liveness ok',
    'page-facts text ok',
    'page-config presence failed',
    'page-flying and page-flying-later motion failed',
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 2);
});
