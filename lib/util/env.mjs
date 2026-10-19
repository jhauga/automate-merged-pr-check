import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Parses .env text: KEY=value lines, optional `export` prefix, single or
 * double quotes, and # comments. Double-quoted values expand \n.
 */
export function parseDotEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment);
      value = value.trim();
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Loads `<root>/.env` into `env` without overriding variables that are
 * already set. Returns the names it set.
 */
export function loadDotEnv(root, env = process.env) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return [];
  const loaded = [];
  for (const [name, value] of Object.entries(parseDotEnv(readFileSync(file, 'utf8')))) {
    if (env[name] === undefined) {
      env[name] = value;
      loaded.push(name);
    }
  }
  return loaded;
}

/** The value of one environment variable, its name matched without regard to case on Windows. */
export function readVariable(env, name, { platform = process.platform } = {}) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((entry) => entry.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * A copy of `env` without the variables `names` lists, matched without regard
 * to case on Windows. A child process gets this copy, so a secret the parent
 * reads never reaches it.
 */
export function withoutVariables(env, names = [], { platform = process.platform } = {}) {
  const wanted = new Set(names.filter(Boolean).map((name) => (platform === 'win32' ? name.toUpperCase() : name)));
  if (wanted.size === 0) return env;
  return Object.fromEntries(Object.entries(env).filter(([key]) => !wanted.has(platform === 'win32' ? key.toUpperCase() : key)));
}

/**
 * Expands environment variables and a leading ~ in a path from a check's
 * settings: %NAME% as on Windows, $NAME and ${NAME} as in a POSIX shell.
 * Names match without regard to case on Windows. Unknown names stay as written.
 */
export function expandPath(value, env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  if (typeof value !== 'string') return value;
  const get = (name) => readVariable(env, name, { platform });
  let out = value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name) => get(name) ?? whole);
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced, bare) => get(braced ?? bare) ?? whole);
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) out = `${home}${out.slice(1)}`;
  return out;
}
