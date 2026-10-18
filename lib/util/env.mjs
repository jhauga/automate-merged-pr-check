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

/**
 * Expands environment variables and a leading ~ in a path from a check's
 * settings: %NAME% as on Windows, $NAME and ${NAME} as in a POSIX shell.
 * Names match without regard to case on Windows. Unknown names stay as written.
 */
export function expandPath(value, env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  if (typeof value !== 'string') return value;
  const keys = Object.keys(env);
  const get = (name) => {
    const key = platform === 'win32' ? keys.find((entry) => entry.toUpperCase() === name.toUpperCase()) : name;
    return key === undefined ? undefined : env[key];
  };
  let out = value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name) => get(name) ?? whole);
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced, bare) => get(braced ?? bare) ?? whole);
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) out = `${home}${out.slice(1)}`;
  return out;
}
