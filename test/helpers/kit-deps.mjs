import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { codeRoot } from '../../lib/paths.mjs';

/** Packages the check kit imports, which a real test folder gets from npm install. */
export const KIT_DEPENDENCIES = Object.freeze(['pngjs']);

/**
 * Puts the check kit's dependencies in `dir`, the way `npm install` does in a
 * real test folder, so a check can run in a temporary folder without network.
 */
export function installKitDependencies(dir) {
  const modules = path.join(dir, 'node_modules');
  mkdirSync(modules, { recursive: true });
  for (const name of KIT_DEPENDENCIES) {
    const target = path.join(modules, name);
    if (!existsSync(target)) cpSync(path.join(codeRoot, 'node_modules', name), target, { recursive: true });
  }
  return modules;
}
