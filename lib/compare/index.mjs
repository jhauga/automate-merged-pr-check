import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BASELINE_MANIFEST, readImage } from '../check-kit.mjs';
import { COLOR_THRESHOLD, compareColors } from './color-sample.mjs';
import { checkLiveness, checkMotion } from './liveness.mjs';
import { PIXEL_THRESHOLD, comparePixels } from './pixel.mjs';
import { TEXT_THRESHOLD, compareText } from './text.mjs';

/** Comparison strategies a check can name in compare.strategy. */
export const STRATEGIES = Object.freeze(['pixel', 'color-sample', 'liveness', 'text', 'composite']);

/** What each strategy does with image captures and with text and JSON captures. */
const METHODS = {
  pixel: { image: ['pixel'], text: [] },
  'color-sample': { image: ['color-sample'], text: [] },
  liveness: { image: ['liveness'], text: [] },
  text: { image: [], text: ['text'] },
  composite: { image: ['color-sample', 'liveness'], text: ['text'] },
};

const DEFAULT_THRESHOLDS = { pixel: PIXEL_THRESHOLD, 'color-sample': COLOR_THRESHOLD, text: TEXT_THRESHOLD };

const groupOf = (kind) => (kind === 'image' ? 'image' : kind === 'text' || kind === 'json' ? 'text' : null);

/** The baseline's manifest: which layer each baseline file belongs to. Null for a baseline captured without one. */
export function readManifest(baselineDir) {
  const file = path.join(baselineDir, BASELINE_MANIFEST);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function attempt(entry, compare) {
  try {
    return { ...entry, ...compare() };
  } catch (error) {
    return { ...entry, ok: false, detail: `could not compare: ${error.message.split('\n')[0]}` };
  }
}

/**
 * Compares a run's captures with the baseline the way `settings.strategy`
 * says. A capture with no baseline yet is skipped; a capture the baseline has
 * but a layer that ran did not make fails. `settings` is check.config.json's
 * compare block: strategy, threshold, masks, and optional motion pairs, each
 * a pair of image names that must differ. Returns every result and the failures.
 */
export function compareRun({ outDir, baselineDir, artifacts = [], settings = {}, layers = {} }) {
  const strategy = settings.strategy ?? 'pixel';
  if (!STRATEGIES.includes(strategy)) throw new Error(`compare.strategy must be one of ${STRATEGIES.join(', ')}; got "${strategy}".`);
  const threshold = (method) => (settings.threshold === undefined || settings.threshold === null ? DEFAULT_THRESHOLDS[method] : Number(settings.threshold));
  const results = [];

  for (const artifact of artifacts) {
    const group = groupOf(artifact.kind);
    const methods = group ? METHODS[strategy][group] : [];
    const file = path.join(outDir, artifact.file);
    const base = path.join(baselineDir, artifact.file);
    for (const method of methods) {
      const entry = { artifact: artifact.name, file: artifact.file, layer: artifact.layer, method };
      if (method === 'liveness') {
        results.push(attempt(entry, () => checkLiveness(readImage(file))));
      } else if (!existsSync(base)) {
        results.push({ ...entry, ok: true, skipped: true, detail: 'no baseline for this capture yet' });
      } else if (method === 'pixel') {
        const diffFile = path.join(outDir, `${artifact.name}.diff.png`);
        results.push(attempt(entry, () => comparePixels(readImage(base), readImage(file), { threshold: threshold('pixel'), masks: settings.masks, artifact: artifact.name, diffFile })));
      } else if (method === 'color-sample') {
        results.push(attempt(entry, () => compareColors(readImage(base), readImage(file), { threshold: threshold('color-sample'), masks: settings.masks, artifact: artifact.name })));
      } else {
        const json = artifact.kind === 'json' || artifact.file.endsWith('.json');
        results.push(attempt(entry, () => compareText(readFileSync(base, 'utf8'), readFileSync(file, 'utf8'), { threshold: threshold('text'), json })));
      }
    }
  }

  const made = new Set(artifacts.map((artifact) => artifact.file));
  for (const [file, info] of Object.entries(readManifest(baselineDir)?.artifacts ?? {})) {
    const group = groupOf(info.kind);
    if (made.has(file) || layers[info.layer] !== 'ran' || !group || METHODS[strategy][group].length === 0) continue;
    results.push({ artifact: info.name, file, layer: info.layer, method: 'presence', ok: false, detail: 'the baseline has this capture, but the run did not make it' });
  }

  for (const pair of settings.motion ?? []) {
    const [first, second] = pair.map((name) => artifacts.find((artifact) => artifact.name === name && artifact.kind === 'image'));
    if (!first && !second) continue;
    const entry = { artifact: pair.join(' and '), layer: (first ?? second).layer, method: 'motion' };
    if (!first || !second) {
      results.push({ ...entry, ok: false, detail: `the run made ${(first ?? second).name} but not the frame it is compared with` });
      continue;
    }
    results.push(attempt(entry, () => checkMotion(readImage(path.join(outDir, first.file)), readImage(path.join(outDir, second.file)))));
  }

  const failures = results.filter((result) => !result.ok);
  return { strategy, ok: failures.length === 0, compared: results.filter((result) => !result.skipped).length, results, failures };
}
