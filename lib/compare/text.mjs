import { percent } from './shared.mjs';

/** Default share of lines or JSON fields that may differ before a text comparison fails. */
export const TEXT_THRESHOLD = 0;

const lines = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean);

function shape(value, at = '$', out = new Map()) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  out.set(at, type);
  if (type === 'object') {
    for (const [key, child] of Object.entries(value)) shape(child, `${at}.${key}`, out);
  } else if (type === 'array' && value.length > 0) {
    shape(value[0], `${at}[]`, out);
  }
  return out;
}

function compareLines(baselineText, currentText, threshold) {
  const before = new Set(lines(baselineText));
  const after = new Set(lines(currentText));
  const missing = [...before].filter((line) => !after.has(line));
  const added = [...after].filter((line) => !before.has(line));
  const union = new Set([...before, ...after]).size;
  const ratio = union === 0 ? 0 : (missing.length + added.length) / union;
  const ok = ratio <= threshold;
  let detail = `${percent(ratio)} of lines differ from the baseline (allowed ${percent(threshold)})`;
  if (!ok && missing.length > 0) detail += `; missing: "${missing[0].slice(0, 120)}"`;
  else if (!ok && added.length > 0) detail += `; new: "${added[0].slice(0, 120)}"`;
  return { method: 'text', ok, ratio, missing: missing.length, added: added.length, detail };
}

function compareShape(baselineText, currentText, threshold) {
  let before;
  let after;
  try {
    before = shape(JSON.parse(baselineText));
  } catch {
    return compareLines(baselineText, currentText, threshold);
  }
  try {
    after = shape(JSON.parse(currentText));
  } catch {
    return { method: 'text', ok: false, ratio: 1, detail: 'the capture is not valid JSON, where the baseline is' };
  }
  const changed = [...before].filter(([at, type]) => after.get(at) !== type);
  const ratio = before.size === 0 ? 0 : changed.length / before.size;
  const ok = ratio <= threshold;
  let detail = `${percent(ratio)} of the baseline's fields are missing or changed type (allowed ${percent(threshold)})`;
  if (!ok) {
    const [at, type] = changed[0];
    detail += `; ${at} was ${type}${after.has(at) ? ` and is now ${after.get(at)}` : ' and is gone'}`;
  }
  return { method: 'text', ok, ratio, detail };
}

/**
 * Compares a text capture with its baseline. Plain text compares by lines,
 * ignoring order and spacing. JSON compares by shape: the fields the baseline
 * has and their types, not their values, which change from run to run.
 */
export function compareText(baselineText, currentText, { threshold = TEXT_THRESHOLD, json = false } = {}) {
  return json ? compareShape(baselineText, currentText, threshold) : compareLines(baselineText, currentText, threshold);
}
