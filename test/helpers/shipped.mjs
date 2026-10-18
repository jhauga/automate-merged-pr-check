import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATE_FILE } from '../../lib/context.mjs';
import { MARKER_FILE, codeRoot } from '../../lib/paths.mjs';
import { CONFIG_DIR_VAR } from '../../lib/user-config.mjs';

/** The context.md a new test folder starts with. */
export const shippedContext = () => readFileSync(path.join(codeRoot, TEMPLATE_FILE), 'utf8');

/** Creates `<base>/<name>` as a test folder: a folder with the form in it. */
export function makeTestFolder(base, name, { form = shippedContext() } = {}) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, MARKER_FILE), form);
  return dir;
}

/**
 * Runs `fn` with an empty settings folder of its own, through an environment
 * that points AUTO_CHECK_CONFIG_DIR at it. No test reads or writes the
 * settings of the person running it.
 */
export async function withSettings(fn, { env = {} } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-settings-'));
  try {
    return await fn({ dir, env: { ...env, [CONFIG_DIR_VAR]: dir } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
