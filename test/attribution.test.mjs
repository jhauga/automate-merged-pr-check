import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { attribute, attributionMarkdown, compareCopies } from '../lib/attribution.mjs';

let base;
let checkDir;
const shas = {};

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=Jane Doe', '-c', 'user.email=jane.doe@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(repo, file, content, message) {
  const full = path.join(repo, ...file.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

const check = {
  source: { clonePath: 'repo' },
  classification: { watchPaths: ['extensions/sample-canvas/**'] },
  subject: { path: 'extensions/sample-canvas', installedPath: null },
};

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-attribution-'));
  checkDir = path.join(base, 'checks', 'acme-demo-app-pr-123');
  const repo = path.join(checkDir, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  shas.passed = commit(repo, 'extensions/sample-canvas/game/app.js', 'draw();\n', 'Add the sample canvas');
  commit(repo, 'docs/guide.md', 'Guide\n', 'Document the guide');
  shas.fix = commit(repo, 'extensions/sample-canvas/game/app.js', 'draw({ fit: true });\n', 'Fit the canvas to its view');
  commit(repo, 'extensions/sample-canvas/README.md', 'Sample canvas\n', 'Describe the sample canvas');
  shas.now = git(repo, 'rev-parse', 'HEAD');
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const fingerprint = (overrides = {}) => ({ os: { version: 'Windows 11' }, node: '24.1.0', hostApp: { name: 'Sample App', version: '1.0.0' }, ...overrides });

test('commits in the watched paths since the last pass are listed, newest first', () => {
  const state = { lastPass: { at: '2026-01-01T03:00:00.000Z', upstreamSha: shas.passed, fingerprint: fingerprint() } };
  const result = attribute({ check, checkDir, record: { upstreamSha: shas.now, fingerprint: fingerprint() }, state });
  assert.deepEqual(result.commits.map((entry) => entry.subject), ['Describe the sample canvas', 'Fit the canvas to its view']);
  assert.deepEqual(result.machine, []);
  const markdown = attributionMarkdown(result);
  assert.match(markdown, new RegExp(`From \`${shas.passed.slice(0, 7)}\`, the last pass on 2026-01-01T03:00:00.000Z, to \`${shas.now.slice(0, 7)}\`:`));
  assert.match(markdown, new RegExp(`- \`${shas.fix.slice(0, 7)}\` Fit the canvas to its view`));
  assert.match(markdown, /The operating system, Node\.js, the browser, the tools, and the host app are the same as at the last pass\./);
});

test('machine changes are named, and a run with no earlier pass says so', () => {
  const state = { lastPass: { at: '2026-01-01T03:00:00.000Z', upstreamSha: shas.now, fingerprint: fingerprint() } };
  const updated = attribute({ check, checkDir, record: { upstreamSha: shas.now, fingerprint: fingerprint({ hostApp: { name: 'Sample App', version: '1.1.0' } }) }, state });
  assert.deepEqual(updated.commits, []);
  const markdown = attributionMarkdown(updated);
  assert.match(markdown, /No commit touched the watched paths since the last pass/);
  assert.match(markdown, /- `hostApp\.version`: was `1\.0\.0`, now `1\.1\.0`/);

  const first = attributionMarkdown(attribute({ check, checkDir, record: { upstreamSha: shas.now, fingerprint: fingerprint() }, state: {} }));
  assert.match(first, /The check has not passed since it was written/);
  assert.match(first, /There is no fingerprint of a passing run to compare with\./);

  const missing = attribute({ check, checkDir, record: { upstreamSha: shas.now }, state: { lastPass: { at: 'x', upstreamSha: 'f'.repeat(40) } } });
  assert.match(missing.commitsNote, /^The commits could not be listed: /);
});

test('an installed copy is compared with the code under test file by file', () => {
  const installed = path.join(base, 'installed', 'sample-canvas');
  mkdirSync(path.join(installed, 'game'), { recursive: true });
  mkdirSync(path.join(installed, 'node_modules', 'three'), { recursive: true });
  writeFileSync(path.join(installed, 'game', 'app.js'), 'draw();\n');
  writeFileSync(path.join(installed, 'node_modules', 'three', 'index.js'), 'skipped\n');
  writeFileSync(path.join(installed, 'notes.txt'), 'local notes\n');

  const repoCopy = path.join(checkDir, 'repo', 'extensions', 'sample-canvas');
  assert.deepEqual(compareCopies(installed, repoCopy), { changed: ['game/app.js'], onlyInRepo: ['README.md'], onlyInstalled: ['notes.txt'], same: false });

  const env = { SAMPLE_APP_HOME: path.join(base, 'installed') };
  const result = attribute({ check: { ...check, subject: { ...check.subject, installedPath: '$SAMPLE_APP_HOME/sample-canvas' } }, checkDir, record: { upstreamSha: shas.now }, state: {}, env });
  assert.equal(result.installed.path, installed);
  const markdown = attributionMarkdown(result);
  assert.match(markdown, /### The installed copy\n\nThe host app loads the installed copy at `[^`]+`, which differs from the code under test:\n\n- Different contents:\n {2}- `game\/app\.js`\n- Only in the code under test:\n {2}- `README\.md`\n- Only in the installed copy:\n {2}- `notes\.txt`/);
});
