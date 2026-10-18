import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** File that marks a test folder: the form that describes the test. */
export const MARKER_FILE = 'context.md';

/** Folder that holds this package's code: bin/, lib/, templates/, and the schema. */
export const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Finds the test folder that `start` sits in: the nearest folder, walking up
 * from `start`, that holds the marker file. Returns null when there is none.
 */
export function findTestFolder(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, MARKER_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Folder for the locks auto-check holds across test folders:
 * %LOCALAPPDATA%\auto-check\locks on Windows, else ~/.local/state/auto-check/locks.
 * AUTO_CHECK_STATE_DIR moves it, for tests.
 */
export function locksDir(env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  if (env.AUTO_CHECK_STATE_DIR) return path.join(path.resolve(env.AUTO_CHECK_STATE_DIR), 'locks');
  if (platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'auto-check', 'locks');
  return path.join(home, '.local', 'state', 'auto-check', 'locks');
}
