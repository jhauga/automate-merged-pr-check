import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { GuardError, guardRoot, guardTestFolder, isInside, nearestTestFolder } from '../lib/guard.mjs';
import { MARKER_FILE } from '../lib/paths.mjs';

let base;
let tool;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-guard-'));
  tool = path.join(base, 'automate-merged-pr-check');
  mkdirSync(tool, { recursive: true });
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function testFolder(...parts) {
  const dir = path.join(base, ...parts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, MARKER_FILE), '# Context\n');
  return dir;
}

test('a path inside another is recognized, and a folder is not inside itself', () => {
  assert.equal(isInside(path.join(base, 'a', 'b'), path.join(base, 'a')), true);
  assert.equal(isInside(path.join(base, 'a'), path.join(base, 'a')), false);
  assert.equal(isInside(path.join(base, 'a'), path.join(base, 'a', 'b')), false);
});

test('the root folder may not sit in the installation', () => {
  assert.equal(guardRoot(path.join(base, 'auto-checks'), { toolRoot: tool }), path.join(base, 'auto-checks'));
  for (const bad of [tool, path.join(tool, 'checks'), path.join(tool, 'a', 'b')]) {
    assert.throws(() => guardRoot(bad, { toolRoot: tool }), (error) => {
      assert.ok(error instanceof GuardError);
      assert.equal(error.exitCode, 3);
      assert.match(error.message, /(is|is inside) the auto-check installation/);
      return true;
    });
  }
});

test('a test folder may not sit in the installation or in another test folder', () => {
  const good = testFolder('auto-checks', 'automate-pr-sample-canvas');
  assert.equal(guardTestFolder(good, { toolRoot: tool }), good);

  assert.throws(() => guardTestFolder(path.join(tool, 'automate-pr-sample-canvas'), { toolRoot: tool }), GuardError);

  const outer = testFolder('auto-checks', 'automate-pr-outer');
  const inner = path.join(outer, 'automate-pr-inner');
  mkdirSync(inner, { recursive: true });
  assert.throws(() => guardTestFolder(inner, { toolRoot: tool }), (error) => {
    assert.ok(error instanceof GuardError);
    assert.match(error.message, /cannot hold another one/);
    return true;
  });
  const deeper = path.join(outer, 'nested', 'automate-pr-deeper');
  mkdirSync(deeper, { recursive: true });
  assert.throws(() => guardTestFolder(deeper, { toolRoot: tool }), GuardError);
});

test('the nearest test folder is the one a path sits in', () => {
  const folder = testFolder('auto-checks', 'automate-pr-nearest');
  const inside = path.join(folder, 'results', '2026-01-01T03-00-00');
  mkdirSync(inside, { recursive: true });
  assert.equal(nearestTestFolder(inside), folder);
  assert.equal(nearestTestFolder(tool), null);
});
