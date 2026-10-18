import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, defaults, isPlainObject, loadSchema, mergeDefaults, validate } from './config.mjs';
import { loadDotEnv } from './util/env.mjs';

/** Name of the per-user settings file inside the settings folder. */
export const SETTINGS_FILE = 'config.json';

/** Environment variable that moves the settings folder, for tests and CI. */
export const CONFIG_DIR_VAR = 'AUTO_CHECK_CONFIG_DIR';

/**
 * Folder that holds the per-user settings: AUTO_CHECK_CONFIG_DIR when set,
 * else %APPDATA%\auto-check on Windows, else $XDG_CONFIG_HOME/auto-check,
 * else ~/.config/auto-check.
 */
export function settingsDir(env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  if (env[CONFIG_DIR_VAR]) return path.resolve(env[CONFIG_DIR_VAR]);
  if (platform === 'win32' && env.APPDATA) return path.join(env.APPDATA, 'auto-check');
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'auto-check');
  return path.join(home, '.config', 'auto-check');
}

/** Path of the per-user settings file. */
export function settingsPath(env = process.env, options = {}) {
  return path.join(settingsDir(env, options), SETTINGS_FILE);
}

/** A fresh copy of the settings a new installation starts with. */
export function userDefaults() {
  return defaults();
}

/** Every setting name as a dotted path, in the order the defaults list them. */
export function settingKeys(node = userDefaults(), prefix = '') {
  const keys = [];
  for (const [name, value] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (isPlainObject(value)) keys.push(...settingKeys(value, key));
    else keys.push(key);
  }
  return keys;
}

/** The value at a dotted path, or undefined when the path leads nowhere. */
export function valueAt(node, key) {
  return key.split('.').reduce((current, part) => (isPlainObject(current) ? current[part] : undefined), node);
}

function assignAt(node, key, value) {
  const parts = key.split('.');
  const last = parts.pop();
  let current = node;
  for (const part of parts) {
    if (!isPlainObject(current[part])) current[part] = {};
    current = current[part];
  }
  current[last] = value;
}

function removeAt(node, key) {
  const parts = key.split('.');
  const last = parts.pop();
  const chain = [node];
  let current = node;
  for (const part of parts) {
    if (!isPlainObject(current[part])) return false;
    current = current[part];
    chain.push(current);
  }
  if (!Object.hasOwn(current, last)) return false;
  delete current[last];
  for (let index = chain.length - 1; index > 0; index -= 1) {
    if (Object.keys(chain[index]).length > 0) break;
    delete chain[index - 1][parts[index - 1]];
  }
  return true;
}

/** Raised when a setting name or value cannot be used. */
export class SettingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingError';
    this.exitCode = 4;
  }
}

/** Checks that `key` names a setting, and returns it. */
export function requireKey(key) {
  if (!settingKeys().includes(key)) {
    throw new SettingError(`"${key}" is not a setting. Run auto-check config list to see every setting.`);
  }
  return key;
}

/**
 * Turns a value typed on the command line into the type the setting holds:
 * booleans, numbers, arrays (JSON or a comma-separated list), and strings.
 */
export function parseSetting(key, text) {
  const current = valueAt(userDefaults(), key);
  const trimmed = String(text).trim();
  if (typeof current === 'boolean') {
    if (/^(true|yes|on)$/i.test(trimmed)) return true;
    if (/^(false|no|off)$/i.test(trimmed)) return false;
    throw new SettingError(`${key} takes true or false, not "${text}".`);
  }
  if (typeof current === 'number') {
    const number = Number(trimmed);
    if (!Number.isFinite(number)) throw new SettingError(`${key} takes a number, not "${text}".`);
    return number;
  }
  if (Array.isArray(current)) {
    if (trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        throw new SettingError(`${key} takes a list: ${error.message}`);
      }
    }
    return trimmed === '' ? [] : trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return String(text);
}

/** The settings file as written, or an empty object when there is none. */
export function readSettings(env = process.env, options = {}) {
  const file = settingsPath(env, options);
  if (!existsSync(file)) return { file, raw: {}, exists: false };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(raw)) throw new ConfigError(`${file} must contain a JSON object.`);
  return { file, raw, exists: true };
}

/** Writes the settings file in one step, so a failed write leaves the old file in place. */
export function writeSettings(raw, env = process.env, options = {}) {
  const file = settingsPath(env, options);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(raw, null, 2)}\n`);
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return file;
}

/** Loads `.env` from the settings folder into `env`, without overriding what is set. */
export function loadUserEnv(env = process.env, options = {}) {
  return loadDotEnv(settingsDir(env, options), env);
}

async function validated(raw, file, { schemaRoot } = {}) {
  const settings = mergeDefaults(userDefaults(), raw);
  const problems = validate(await loadSchema(schemaRoot), settings);
  if (problems.length > 0) {
    const count = problems.length === 1 ? 'a problem' : `${problems.length} problems`;
    throw new ConfigError(`${file} has ${count}:`, problems);
  }
  return settings;
}

/**
 * Reads the per-user settings, fills in a default for every setting left out,
 * and validates the result. Throws ConfigError with every problem found.
 */
export async function loadUserConfig({ env = process.env, schemaRoot, ...options } = {}) {
  const { raw, file } = readSettings(env, options);
  return validated(raw, file, { schemaRoot });
}

/** The settings auto-check runs with. Each test's own form decides its follow-up steps. */
export async function loadConfig(options = {}) {
  return loadUserConfig(options);
}

/** Reads one setting, with whether the settings file sets it. */
export async function getSetting(key, { env = process.env, ...options } = {}) {
  requireKey(key);
  const { raw } = readSettings(env, options);
  const settings = await loadUserConfig({ env, ...options });
  return { key, value: valueAt(settings, key), set: valueAt(raw, key) !== undefined };
}

/** Writes one setting, after checking that the file stays valid. */
export async function setSetting(key, value, { env = process.env, ...options } = {}) {
  requireKey(key);
  const { raw, file } = readSettings(env, options);
  const next = structuredClone(raw);
  assignAt(next, key, value);
  const settings = await validated(next, file, options);
  return { file: writeSettings(next, env, options), value: valueAt(settings, key) };
}

/** Removes one setting, so it falls back to its default. */
export async function unsetSetting(key, { env = process.env, ...options } = {}) {
  requireKey(key);
  const { raw, file } = readSettings(env, options);
  const next = structuredClone(raw);
  const removed = removeAt(next, key);
  if (removed) {
    await validated(next, file, options);
    writeSettings(next, env, options);
  }
  return { file, removed, value: valueAt(userDefaults(), key) };
}

/** Every setting, its value, and whether the settings file sets it. */
export async function listSettings({ env = process.env, ...options } = {}) {
  const { raw, file, exists } = readSettings(env, options);
  const settings = await loadUserConfig({ env, ...options });
  return {
    file,
    exists,
    entries: settingKeys().map((key) => ({ key, value: valueAt(settings, key), set: valueAt(raw, key) !== undefined })),
  };
}

/** Renders one setting value the way `auto-check config` prints it. */
export function showSetting(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
