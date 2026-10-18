// Runs the test files in test/ with the Node test runner. Listing the files
// keeps the runner out of checks/, whose managed clones hold other projects'
// tests. Extra arguments, such as --test-name-pattern, pass through.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test');
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(dir, name));

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
