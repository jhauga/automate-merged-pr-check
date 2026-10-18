import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { codeRoot } from './paths.mjs';

/** JSON Schema file that describes the per-user settings. */
export const SCHEMA_FILE = 'auto-check.config.schema.json';

/** Assistants auto-check can drive. */
export const ASSISTANTS = Object.freeze(['claude', 'copilot', 'codex']);

const DEFAULTS = {
  root: '',
  assistant: 'claude',
  models: {
    claude: { generate: 'opus', analyze: 'opus', testDriver: 'haiku', effort: '' },
    copilot: { generate: 'auto', analyze: 'auto', testDriver: 'auto', testDriverAutoTier: 'efficiency', effort: '' },
    codex: { generate: '', analyze: '', testDriver: '', effort: '' },
  },
  notify: {
    dryRun: false,
    onFail: true,
    onError: true,
    onPass: false,
    onRecover: true,
    email: {
      enabled: false,
      to: ['jane.doe@example.com'],
      from: 'auto-check@example.com',
      account: '_default',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'demo-user',
        passwordEnv: 'AUTO_CHECK_SMTP_PASSWORD',
      },
    },
    sms: { enabled: false, provider: 'gateway', to: ['5551234567@txt.example.com'] },
    webhook: { enabled: false, url: '', format: 'json', secretEnv: 'AUTO_CHECK_WEBHOOK_SECRET' },
  },
  schedule: {
    windows: { schedule: 'DAILY', startTime: '03:00', interactive: 'auto' },
    macos: { hour: 3, minute: 0 },
    linux: { cron: '0 3 * * *', unit: 'systemd-user' },
  },
  results: { keep: 14 },
  repos: { localRepo: '', upstreamRemote: 'upstream', originRemote: 'origin', branchPrefix: 'resolve-issue-' },
  assistants: {
    claude: { skills: '.claude/skills', instructions: 'CLAUDE.md', permissionMode: 'bypass' },
    copilot: {
      skills: '.github/skills',
      instructions: '.github/copilot-instructions.md',
      permissionMode: 'allow-all-tools',
    },
    codex: { skills: '.agents/skills', instructions: 'AGENTS.md', permissionMode: 'workspace-write' },
  },
};

/** A fresh copy of the settings auto-check runs with when nothing is configured. */
export function defaults() {
  return structuredClone(DEFAULTS);
}

/** Raised when settings are missing, unreadable, or invalid. */
export class ConfigError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'ConfigError';
    this.problems = problems;
    this.exitCode = 2;
  }
}

/** True for an object that holds keys, and not for an array or null. */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merges `override` onto `base`. Objects merge key by key; arrays and
 * scalar values in `override` replace those in `base`.
 */
export function mergeDefaults(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override);
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isPlainObject(value) && isPlainObject(merged[key])
      ? mergeDefaults(merged[key], value)
      : structuredClone(value);
  }
  return merged;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(type, value) {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'null':
      return value === null;
    default:
      return typeof value === type;
  }
}

function pointer(at, key) {
  return `${at}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, part) => {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isPlainObject(node) || !(key in node)) throw new Error(`Unresolvable $ref: ${ref}`);
      return node[key];
    }, root);
}

const show = (value) => JSON.stringify(value);

/**
 * Validates `value` against a JSON Schema subset: type, enum, const,
 * properties, required, additionalProperties, items, minItems, uniqueItems,
 * minLength, pattern, minimum, maximum, and local $ref. Returns a list of
 * problems, each starting with the JSON Pointer of the offending value.
 */
export function validate(schema, value, root = schema, at = '') {
  if (schema.$ref) return validate(resolveRef(root, schema.$ref), value, root, at);
  const where = at || '/';
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((type) => matchesType(type, value))) {
      return [`${where}: expected ${types.join(' or ')}, got ${typeOf(value)}`];
    }
  }
  const problems = [];
  if ('const' in schema && show(schema.const) !== show(value)) {
    problems.push(`${where}: must be ${show(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((option) => show(option) === show(value))) {
    problems.push(`${where}: must be one of ${schema.enum.map(show).join(', ')}, got ${show(value)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      problems.push(`${where}: must be at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'} long`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      problems.push(`${where}: ${show(value)} does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${where}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${where}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      problems.push(`${where}: needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => {
        const key = show(item);
        if (seen.has(key)) problems.push(`${pointer(at, index)}: repeats ${key}`);
        seen.add(key);
      });
    }
    if (schema.items) {
      value.forEach((item, index) => problems.push(...validate(schema.items, item, root, pointer(at, index))));
    }
  }
  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) problems.push(`${pointer(at, key)}: is required`);
    }
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) {
        problems.push(...validate(property, item, root, pointer(at, key)));
      } else if (schema.additionalProperties === false) {
        problems.push(`${pointer(at, key)}: is not a known setting`);
      } else if (isPlainObject(schema.additionalProperties)) {
        problems.push(...validate(schema.additionalProperties, item, root, pointer(at, key)));
      }
    }
  }
  return problems;
}

let schemaCache = null;

/** Reads the configuration schema that ships with the code. */
export async function loadSchema(root = codeRoot) {
  if (schemaCache?.root !== root) {
    schemaCache = { root, schema: JSON.parse(await readFile(path.join(root, SCHEMA_FILE), 'utf8')) };
  }
  return schemaCache.schema;
}

/**
 * Resolves a check's `notify` and `schedule` against the user settings. Each
 * may be "inherit", left out, or an object that overrides single settings.
 */
export function resolveInherit(check, config) {
  const pick = (name) => {
    const value = check[name];
    if (value === undefined || value === 'inherit') return structuredClone(config[name]);
    if (!isPlainObject(value)) {
      throw new ConfigError(`check.config.json "${name}" must be "inherit" or an object.`);
    }
    return mergeDefaults(config[name], value);
  };
  return { ...check, notify: pick('notify'), schedule: pick('schedule') };
}
