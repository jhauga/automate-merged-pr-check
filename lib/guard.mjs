import { existsSync } from 'node:fs';
import path from 'node:path';
import { MARKER_FILE, codeRoot } from './paths.mjs';

/** Raised when auto-check refuses to work in a folder. */
export class GuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardError';
    this.exitCode = 3;
  }
}

const same = (a, b) => {
  const [left, right] = [path.resolve(a), path.resolve(b)];
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

/** True when `child` sits inside `parent`, and is not `parent` itself. */
export function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The nearest folder at or above `dir` that holds the marker file, or null. */
export function nearestTestFolder(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(current, MARKER_FILE))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Refuses a root folder that sits inside the installed tool. Test folders hold
 * clones, results, and node_modules, so they never belong in the installation.
 */
export function guardRoot(root, { toolRoot = codeRoot } = {}) {
  const where = same(root, toolRoot) ? 'is the auto-check installation' : `is inside the auto-check installation at ${toolRoot}`;
  if (same(root, toolRoot) || isInside(root, toolRoot)) {
    throw new GuardError(`${root} ${where}. Pick a root folder outside it with --root or auto-check config set root.`);
  }
  return path.resolve(root);
}

/**
 * Refuses a test folder that sits inside the installed tool, or inside another
 * test folder. Returns the folder it accepted.
 */
export function guardTestFolder(dir, { toolRoot = codeRoot } = {}) {
  const folder = path.resolve(dir);
  if (same(folder, toolRoot) || isInside(folder, toolRoot)) {
    const where = same(folder, toolRoot) ? 'is the auto-check installation' : `is inside the auto-check installation at ${toolRoot}`;
    throw new GuardError(
      `${folder} ${where}. Create test folders outside it, under the root folder auto-check config set root names.`,
    );
  }
  const parent = path.dirname(folder);
  const enclosing = parent === folder ? null : nearestTestFolder(parent);
  if (enclosing) {
    throw new GuardError(`${folder} sits inside the test folder ${enclosing}. A test folder cannot hold another one.`);
  }
  return folder;
}
