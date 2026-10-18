import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { settingsDir } from './user-config.mjs';
import { capture } from './util/which.mjs';

/** Where the answers of model probes are remembered, in the settings folder. */
export const MODEL_CACHE_FILE = 'model-cache.json';

/** Model families Claude Code names, newest first in each family. */
export const CLAUDE_FAMILIES = Object.freeze(['opus', 'sonnet', 'haiku', 'fable']);

/** The option each assistant takes for thinking effort. */
export const EFFORT_FLAGS = Object.freeze({
  claude: '--effort',
  copilot: '--reasoning-effort',
  codex: 'model_reasoning_effort',
});

/** Effort levels to fall back on when a command's help cannot be read. */
export const EFFORT_FALLBACK = Object.freeze({
  claude: Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']),
  copilot: Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  codex: Object.freeze([]),
});

const PROBE_PROMPT = 'Reply with OK and nothing else.';
const PROBE_TIMEOUT_MS = 90000;

/** The line of a refusal that says why: the last line that names an error. */
export function refusalReason({ stdout = '', stderr = '', status = null }) {
  const text = [stderr, stdout].join('\n');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const named = lines.filter((line) => /error|not support|unrecognized|unknown|invalid|isn't|is not/i.test(line));
  return (named.at(-1) ?? lines.at(-1) ?? `exit code ${status}`).slice(0, 300);
}

/**
 * How a message names an assistant command and its version. A version that
 * already carries the product name, such as "2.1.261 (Claude Code)", reads as
 * "Claude Code 2.1.261".
 */
export function commandLabel(assistant, version = '') {
  const text = String(version).trim();
  if (!text) return assistant;
  const parenthesized = /^(\S+)\s+\((.+)\)\.?$/.exec(text);
  if (parenthesized) return `${parenthesized[2]} ${parenthesized[1]}`;
  if (/[A-Za-z]/.test(text)) return text.replace(/\.$/, '');
  return `${assistant} ${text}`;
}

/** Raised when a model cannot be used with the command that would run it. */
export class ModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelError';
    this.exitCode = 4;
  }
}

const hyphenate = (value) => String(value).trim().toLowerCase().replace(/[\s_]+/g, '-');

/**
 * The names a model may run under, for the assistant that would run it:
 * `id` is the full identifier, `alias` the family name Claude Code also
 * accepts, and `candidates` the order to try them in. A name auto-check does
 * not recognize passes through as written.
 */
export function normalizeModel(assistant, model) {
  const label = String(model ?? '').trim();
  if (!label) return { label: '', id: '', alias: '', candidates: [] };
  if (assistant === 'claude') {
    const bare = hyphenate(label).replace(/^claude-/, '').replace(/\./g, '-');
    const match = /^(opus|sonnet|haiku|fable)(?:-(\d+(?:-\d+)*))?$/.exec(bare);
    if (match) {
      const [, family, version] = match;
      const id = version ? `claude-${family}-${version}` : family;
      const alias = family;
      return { label, id, alias, candidates: [...new Set([id, alias])] };
    }
    const id = hyphenate(label);
    return { label, id, alias: '', candidates: [id] };
  }
  if (assistant === 'copilot') {
    const id = hyphenate(label);
    return { label, id, alias: '', candidates: [id] };
  }
  return { label, id: label, alias: '', candidates: [label] };
}

/** Path of the model cache, in the same folder as the settings. */
export function cacheFile(env = process.env, options = {}) {
  return path.join(settingsDir(env, options), MODEL_CACHE_FILE);
}

/** The remembered probe answers, or an empty cache. */
export function readModelCache(env = process.env, options = {}) {
  const file = cacheFile(env, options);
  if (!existsSync(file)) return {};
  try {
    const cache = JSON.parse(readFileSync(file, 'utf8'));
    return cache && typeof cache === 'object' ? cache : {};
  } catch {
    return {};
  }
}

/** Writes the cache in one step, so a failed write leaves the old file in place. */
export function writeModelCache(cache, env = process.env, options = {}) {
  const file = cacheFile(env, options);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`);
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return file;
}

/** The command line a probe runs to see whether `id` is a model the command accepts. */
export function probeCall(assistant, id) {
  if (assistant === 'claude') return { args: ['--print', '--model', id], input: PROBE_PROMPT };
  if (assistant === 'copilot') return { args: ['-p', PROBE_PROMPT, '--model', id, '--allow-all-tools', '-s'], input: undefined };
  return null;
}

/** The effort levels a command's help lists, or an empty list when it names none. */
export function effortLevelsFrom(help, flag) {
  const text = String(help ?? '');
  const index = text.indexOf(flag);
  if (index === -1) return [];
  const window = text.slice(index, index + 400);
  const possible = /\[possible values:([^\]]+)\]/i.exec(window);
  const listed = possible ?? /\(([a-z][a-z, ]+[a-z])\)/i.exec(window);
  if (!listed) return [];
  return listed[1].split(',').map((level) => level.trim().toLowerCase()).filter(Boolean);
}

const helpCache = new Map();

/** The effort levels an installed command offers, read from its help once per run. */
export function effortLevels(assistant, { file = null, run = (target, args) => capture(target, args) } = {}) {
  if (!file) return [...(EFFORT_FALLBACK[assistant] ?? [])];
  if (helpCache.has(file)) return helpCache.get(file);
  const flag = EFFORT_FLAGS[assistant];
  const result = run(file, ['--help']);
  const levels = effortLevelsFrom(`${result.stdout ?? ''}${result.stderr ?? ''}`, flag);
  const answer = levels.length > 0 ? levels : [...(EFFORT_FALLBACK[assistant] ?? [])];
  helpCache.set(file, answer);
  return answer;
}

/**
 * Settles which name a model runs under. A name with one candidate is used as
 * written. A Claude model with both an identifier and a family alias is
 * probed once per command version: the identifier first, then the alias, and
 * the answer is remembered in the model cache. Throws ModelError when the
 * command accepts neither.
 */
export function resolveModel({
  assistant,
  model,
  file = null,
  version = '',
  label: commandLabel = assistant,
  env = process.env,
  run = (target, args, options) => capture(target, args, options),
  cache = null,
  save = true,
  ...options
}) {
  const normalized = normalizeModel(assistant, model);
  if (normalized.candidates.length === 0) {
    return { ...normalized, model: '', accepted: 'default', rejected: [], cached: false, commandLabel };
  }
  if (normalized.candidates.length === 1 || !file) {
    return { ...normalized, model: normalized.candidates[0], accepted: 'only', rejected: [], cached: false, commandLabel };
  }
  const store = cache ?? readModelCache(env, options);
  const key = normalized.candidates.join('|');
  const remembered = store[assistant]?.[version || 'unknown']?.[key];
  if (remembered?.model) {
    return { ...normalized, ...remembered, cached: true, commandLabel };
  }
  const rejected = [];
  for (const candidate of normalized.candidates) {
    const call = probeCall(assistant, candidate);
    if (!call) {
      return { ...normalized, model: candidate, accepted: 'only', rejected, cached: false, commandLabel };
    }
    const result = run(file, call.args, { input: call.input, timeoutMs: PROBE_TIMEOUT_MS });
    if (result.status === 0) {
      const answer = {
        model: candidate,
        accepted: candidate === normalized.id ? 'id' : 'alias',
        refused: rejected.map((entry) => entry.name),
        at: new Date().toISOString(),
      };
      if (save) {
        store[assistant] ??= {};
        store[assistant][version || 'unknown'] ??= {};
        store[assistant][version || 'unknown'][key] = answer;
        writeModelCache(store, env, options);
      }
      return { ...normalized, ...answer, rejected, cached: false, commandLabel };
    }
    rejected.push({ name: candidate, reason: refusalReason(result) });
  }
  const why = rejected.map((entry) => `${entry.name}: ${entry.reason}`).join('; ');
  throw new ModelError(
    `${commandLabel} accepts neither ${normalized.candidates.join(' nor ')} for the model "${normalized.label}". `
      + `Update the assistant, or name a model it offers. ${why}`,
  );
}

/** How a run says which model it uses, and why. */
export function describeModel(resolution) {
  if (!resolution?.model) return 'the command default';
  if (resolution.accepted === 'alias') {
    const refused = resolution.refused?.[0] ?? resolution.rejected?.[0]?.name ?? resolution.id;
    return `${resolution.label} (runs as ${resolution.model}: ${resolution.commandLabel} does not accept ${refused})`;
  }
  if (resolution.model === resolution.label) return resolution.label;
  return `${resolution.label} (runs as ${resolution.model})`;
}

/** Every remembered probe answer, as flat lines for the doctor report. */
export function cachedModels(assistant, { env = process.env, cache = null, ...options } = {}) {
  const store = cache ?? readModelCache(env, options);
  const versions = store[assistant] ?? {};
  const lines = [];
  for (const [version, entries] of Object.entries(versions)) {
    for (const [key, answer] of Object.entries(entries)) {
      lines.push({ version, candidates: key.split('|'), model: answer.model, accepted: answer.accepted });
    }
  }
  return lines;
}
