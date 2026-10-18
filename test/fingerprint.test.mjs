import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { collectFingerprint, diffFingerprints, hashTree, hostAppVersion, osInfo } from '../lib/fingerprint.mjs';

function tree(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-tree-'));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, ...file.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('the tree hash follows file names and contents, and skips node_modules and .git', () => {
  const one = tree({ 'a.js': 'a', 'game/b.js': 'b' });
  const same = tree({ 'game/b.js': 'b', 'a.js': 'a', 'node_modules/x/index.js': 'ignored', '.git/HEAD': 'ignored' });
  const edited = tree({ 'a.js': 'a', 'game/b.js': 'B' });
  const renamed = tree({ 'a.js': 'a', 'game/c.js': 'b' });
  try {
    assert.deepEqual(hashTree(one), hashTree(same));
    assert.equal(hashTree(one).files, 2);
    assert.notEqual(hashTree(one).sha256, hashTree(edited).sha256);
    assert.notEqual(hashTree(one).sha256, hashTree(renamed).sha256);
  } finally {
    for (const dir of [one, same, edited, renamed]) rmSync(dir, { recursive: true, force: true });
  }
});

test('fingerprint differences list each changed setting', () => {
  const before = { os: { release: '10.0.1', version: 'A' }, tools: { claude: '2.1' }, hostApp: { name: 'Sample App', version: '1.0' } };
  const after = { os: { release: '10.0.1', version: 'B' }, tools: { claude: '2.1', copilot: '1.0' }, hostApp: { name: 'Sample App', version: '1.1' } };
  assert.deepEqual(diffFingerprints(before, after), [
    { key: 'hostApp.version', before: '1.0', after: '1.1' },
    { key: 'os.version', before: 'A', after: 'B' },
    { key: 'tools.copilot', before: null, after: '1.0' },
  ]);
  assert.deepEqual(diffFingerprints(before, structuredClone(before)), []);
});

test('a fingerprint gathers the machine, the tools found, the host app, and the installed copy', () => {
  const installed = tree({ 'extension.mjs': 'export {};' });
  try {
    const probe = {
      os: () => ({ platform: 'test', release: '1.0' }),
      nodeVersion: () => '24.1.0',
      browser: () => ({ name: 'Microsoft Edge', version: '140.0.0.0' }),
      toolVersion: (command) => ({ git: 'git version 2.49.0', claude: '2.1.0 (Claude Code)' })[command] ?? null,
      hostApp: (hostApp) => (hostApp ? { name: hostApp.name, version: '1.2.3' } : null),
      hashTree,
    };
    const result = collectFingerprint({ subject: { installedPath: installed, hostApp: { name: 'Sample App' } }, probe });
    assert.deepEqual(result.tools, { git: 'git version 2.49.0', claude: '2.1.0 (Claude Code)' });
    assert.deepEqual(result.hostApp, { name: 'Sample App', version: '1.2.3' });
    assert.equal(result.installedCopy.path, installed);
    assert.equal(result.installedCopy.files, 1);
    assert.equal(collectFingerprint({ probe }).installedCopy, null);
  } finally {
    rmSync(installed, { recursive: true, force: true });
  }
});

test('the operating system and a host app version command are read from this machine', () => {
  const info = osInfo();
  assert.equal(info.platform, process.platform);
  assert.ok(info.release.length > 0);
  assert.match(hostAppVersion({ name: 'Node', versionCommand: 'node --version' }).version, /^v\d+\./);
  assert.equal(hostAppVersion(null), null);
});
