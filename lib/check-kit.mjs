import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pngjs from 'pngjs';

const { PNG } = pngjs;

/** Layers a check can have: the subject on its own, and the subject inside its host app. */
export const LAYERS = Object.freeze(['page', 'hostApp']);

/** Exit codes of a check run. */
export const CHECK_EXIT = Object.freeze({ PASS: 0, FAIL: 1, ERROR: 2 });

/** Share of pixels in one color at which a screenshot counts as blank. */
export const BLANK_SHARE = 0.97;

/** File in baseline/ that records which layer each baseline capture belongs to. */
export const BASELINE_MANIFEST = 'baseline.manifest.json';

const OPTIONS = {
  out: { type: 'string' },
  source: { type: 'string' },
  phase: { type: 'string' },
  'capture-baseline': { type: 'boolean' },
  'simulate-fail': { type: 'string' },
  layers: { type: 'string' },
};

/** Reads a PNG file into { width, height, data } with RGBA bytes. */
export function readImage(file) {
  const png = PNG.sync.read(readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

/** Writes RGBA pixels to a PNG file. */
export function writeImage(file, { width, height, data }) {
  const png = new PNG({ width, height });
  data.copy(png.data);
  writeFileSync(file, PNG.sync.write(png));
}

/** An opaque black image of the given size. */
export function blackImage(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  return { width, height, data };
}

/**
 * Color statistics of an image: the share of pixels in its most common color
 * (colors bucketed to 16 levels per channel), that color, and the mean color.
 */
export function imageStats({ width, height, data }) {
  const buckets = new Map();
  const sum = [0, 0, 0];
  const pixels = width * height;
  for (let index = 0; index < data.length; index += 4) {
    const key = ((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    sum[0] += data[index];
    sum[1] += data[index + 1];
    sum[2] += data[index + 2];
  }
  let topKey = 0;
  let topCount = 0;
  for (const [key, count] of buckets) {
    if (count > topCount) {
      topKey = key;
      topCount = count;
    }
  }
  const level = (bits) => bits * 16 + 8;
  return {
    width,
    height,
    uniformShare: pixels > 0 ? topCount / pixels : 1,
    dominant: [level(topKey >> 8), level((topKey >> 4) & 15), level(topKey & 15)],
    mean: sum.map((total) => Math.round(total / Math.max(pixels, 1))),
    colors: buckets.size,
  };
}

/** True when nearly every pixel shares one color, as in a black or empty view. */
export function isBlank(image, maxUniformShare = BLANK_SHARE) {
  return imageStats(image).uniformShare >= maxUniformShare;
}

function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true });
  if (!values.out) throw new Error('run.mjs needs --out <folder>.');
  if (values.phase !== undefined && !['start', 'collect'].includes(values.phase)) throw new Error('--phase must be start or collect.');
  const layers = values.layers?.split(',').map((layer) => layer.trim()).filter(Boolean);
  for (const layer of layers ?? []) {
    if (!LAYERS.includes(layer)) throw new Error(`--layers takes ${LAYERS.join(', ')}; got "${layer}".`);
  }
  return {
    out: values.out,
    source: values.source ?? null,
    phase: values.phase ?? null,
    captureBaseline: Boolean(values['capture-baseline']),
    simulateFail: values['simulate-fail'] ?? null,
    layers: layers ?? null,
  };
}

const firstLines = (error) => String(error?.stack ?? error).split('\n').slice(0, 4).join('\n');

/**
 * Runs a check. `moduleUrl` is the check's own import.meta.url, which locates
 * its folder and check.config.json. `body(ctx)` does the work through ctx:
 *
 * - ctx.layer(name, fn): runs fn when that layer is enabled, filing what it records under it.
 * - ctx.image(name, capture): capture(file) writes a PNG; returns { name, file, width, height, data }.
 * - ctx.text(name, produce) and ctx.json(name, produce): save what produce() returns and return it.
 * - ctx.assert(name, ok, detail) and ctx.assertNotBlank(name, image).
 * - ctx.note(text), ctx.readState(), ctx.writeState(patch), ctx.baselinePath(file).
 * - ctx.source, ctx.config, ctx.dir, ctx.out, ctx.phase, ctx.capturingBaseline, ctx.layers.
 *
 * Writes <out>/result.json and exits 0 for a pass or a captured baseline, 1
 * when an assertion fails, and 2 when the check throws or asserts nothing. A
 * layer that throws stops only itself; the run then reports an error unless an
 * assertion failed. Under --simulate-fail every capture still runs, and its
 * value is then replaced (a black or given image, empty text, null), so a sound
 * check fails. With --capture-baseline, each layer that finished with all of
 * its assertions passing has its artifacts copied into baseline/; any other
 * layer saves nothing.
 */
export async function runCheck(moduleUrl, body, { argv = process.argv.slice(2), exit = (code) => process.exit(code) } = {}) {
  const dir = path.dirname(fileURLToPath(moduleUrl));
  const startedAt = new Date().toISOString();
  const result = { outcome: null, startedAt, finishedAt: null, phase: null, layers: {}, artifacts: [], assertions: [], notes: [] };
  let options;
  let config;
  try {
    options = parseOptions(argv);
    config = JSON.parse(readFileSync(path.join(dir, 'check.config.json'), 'utf8'));
  } catch (error) {
    process.stderr.write(`run.mjs: ${error.message}\n`);
    return exit(CHECK_EXIT.ERROR);
  }

  const out = path.resolve(options.out);
  mkdirSync(out, { recursive: true });
  const enabled = options.layers ?? LAYERS.filter((layer) => config.layers?.[layer]?.enabled);
  const statePath = path.join(dir, 'state.json');
  const layerErrors = {};
  let current = null;
  result.phase = options.phase;

  const record = (entry) => ({ ...entry, layer: current ?? 'check' });
  const artifact = (name, extension, kind) => {
    if (`${name}${extension}` === BASELINE_MANIFEST) throw new Error(`"${name}" is reserved for the baseline manifest; name the capture something else.`);
    const file = path.join(out, `${name}${extension}`);
    result.artifacts.push(record({ name, file: path.basename(file), kind }));
    return file;
  };
  const ctx = {
    dir,
    config,
    out,
    source: path.resolve(options.source ?? path.join(dir, config.source?.clonePath ?? 'repo')),
    phase: options.phase,
    capturingBaseline: options.captureBaseline,
    simulatingFailure: Boolean(options.simulateFail),
    layers: enabled,
    async layer(name, fn) {
      if (!LAYERS.includes(name)) throw new Error(`Unknown layer "${name}". Use one of ${LAYERS.join(', ')}.`);
      if (!enabled.includes(name)) {
        result.layers[name] = 'skipped';
        return;
      }
      current = name;
      result.layers[name] = 'ran';
      try {
        await fn();
      } catch (error) {
        result.layers[name] = 'error';
        layerErrors[name] = firstLines(error);
      } finally {
        current = null;
      }
    },
    assert(name, ok, detail = '') {
      result.assertions.push(record({ name, ok: Boolean(ok), detail: String(detail) }));
      return Boolean(ok);
    },
    note(text) {
      result.notes.push(record({ text: String(text) }));
    },
    async image(name, capture) {
      const file = path.join(out, `${name}.png`);
      await capture(file);
      if (!existsSync(file)) throw new Error(`The capture for "${name}" wrote no file.`);
      if (options.simulateFail === 'black') {
        const { width, height } = readImage(file);
        writeImage(file, blackImage(width, height));
      } else if (options.simulateFail) {
        copyFileSync(path.resolve(options.simulateFail), file);
      }
      artifact(name, '.png', 'image');
      return { name, file, ...readImage(file) };
    },
    async text(name, produce) {
      const produced = String(await produce());
      const value = options.simulateFail ? '' : produced;
      writeFileSync(artifact(name, '.txt', 'text'), value);
      return value;
    },
    async json(name, produce) {
      const produced = await produce();
      const value = options.simulateFail ? null : (produced ?? null);
      writeFileSync(artifact(name, '.json', 'json'), `${JSON.stringify(value, null, 2)}\n`);
      return value === null ? null : JSON.parse(JSON.stringify(value));
    },
    assertNotBlank(name, image, maxUniformShare = BLANK_SHARE) {
      const stats = imageStats(image);
      return ctx.assert(name, stats.uniformShare < maxUniformShare, `${Math.round(stats.uniformShare * 100)}% of pixels share one color`);
    },
    baselinePath(file) {
      return path.join(dir, 'baseline', file);
    },
    readState() {
      return existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
    },
    writeState(patch) {
      writeFileSync(statePath, `${JSON.stringify({ ...ctx.readState(), ...patch }, null, 2)}\n`);
    },
  };

  let failure = null;
  try {
    await body(ctx);
  } catch (error) {
    failure = error;
  }

  const byLayer = new Map();
  for (const assertion of result.assertions) {
    if (!byLayer.has(assertion.layer)) byLayer.set(assertion.layer, []);
    byLayer.get(assertion.layer).push(assertion);
  }
  const failed = result.assertions.find((assertion) => !assertion.ok);
  const errors = Object.entries(layerErrors).map(([layer, text]) => `${layer}: ${text}`);

  if (failure) {
    result.outcome = 'error';
    result.error = firstLines(failure);
  } else if (failed) {
    result.outcome = 'fail';
  } else if (errors.length > 0) {
    result.outcome = 'error';
  } else if (result.assertions.length === 0) {
    result.outcome = 'error';
    result.error = 'The check made no assertions.';
  } else {
    result.outcome = options.captureBaseline ? 'baseline' : 'pass';
  }
  if (errors.length > 0) result.error = [result.error, ...errors].filter(Boolean).join('\n');

  if (options.captureBaseline && !failure) {
    result.baseline = {};
    const baselineDir = path.join(dir, 'baseline');
    const manifestFile = path.join(baselineDir, BASELINE_MANIFEST);
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { artifacts: {} };
    const layers = new Set([...byLayer.keys(), ...Object.keys(result.layers).filter((layer) => result.layers[layer] !== 'skipped')]);
    for (const layer of layers) {
      const assertions = byLayer.get(layer) ?? [];
      const first = assertions.find((assertion) => !assertion.ok);
      if (layerErrors[layer]) {
        result.baseline[layer] = 'not captured: the layer stopped with an error';
      } else if (assertions.length === 0) {
        result.baseline[layer] = 'not captured: the layer made no assertions';
      } else if (first) {
        result.baseline[layer] = `not captured: ${first.name} failed${first.detail ? ` (${first.detail})` : ''}`;
      } else {
        mkdirSync(baselineDir, { recursive: true });
        const captured = result.artifacts.filter((item) => item.layer === layer);
        for (const [file, info] of Object.entries(manifest.artifacts)) {
          if (info.layer !== layer || captured.some((item) => item.file === file)) continue;
          rmSync(path.join(baselineDir, file), { force: true });
          delete manifest.artifacts[file];
        }
        for (const entry of captured) {
          copyFileSync(path.join(out, entry.file), path.join(baselineDir, entry.file));
          manifest.artifacts[entry.file] = { name: entry.name, kind: entry.kind, layer, capturedAt: startedAt };
        }
        result.baseline[layer] = 'captured';
      }
    }
    if (Object.values(result.baseline).includes('captured')) {
      manifest.updatedAt = new Date().toISOString();
      writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }

  result.finishedAt = new Date().toISOString();
  writeFileSync(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  const code = { pass: CHECK_EXIT.PASS, baseline: CHECK_EXIT.PASS, fail: CHECK_EXIT.FAIL }[result.outcome] ?? CHECK_EXIT.ERROR;
  return exit(code);
}
