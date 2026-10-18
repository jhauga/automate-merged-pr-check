import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  RepoError,
  findLandedCommit,
  gitDirFor,
  gitReason,
  listCommits,
  prepareLocalWorktree,
  refreshManagedClone,
  removeLocalWorktree,
} from '../lib/repo.mjs';

// Git for Windows turns core.autocrlf on for the whole machine, and GitHub's
// Windows runners keep it on. Every git call in this file runs with it on, on
// every platform, so the tool must still check files out as the repository
// stores them.
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf';
process.env.GIT_CONFIG_VALUE_0 = 'true';

let base;
let work;
let bare;
let upstreamUrl;

function run(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=Jane Doe', '-c', 'user.email=jane.doe@example.com', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(dir, file, content, message) {
  const full = path.join(dir, ...file.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  run(dir, 'add', '-A');
  run(dir, 'commit', '-q', '-m', message);
  return run(dir, 'rev-parse', 'HEAD');
}

function publish(message, file, content) {
  const sha = commit(work, file, content, message);
  run(work, 'push', '-q', bare, 'main');
  return sha;
}

function cloneOf(name, url = bare) {
  const dir = path.join(base, name);
  run(base, 'clone', '-q', url, dir);
  return dir;
}

const state = (dir) => ({
  status: run(dir, 'status', '--short'),
  branch: run(dir, 'branch', '--show-current'),
  refs: run(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'),
  worktrees: run(dir, 'worktree', 'list', '--porcelain'),
});

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-repo-'));
  work = path.join(base, 'upstream-work');
  mkdirSync(work);
  run(work, 'init', '-q');
  commit(work, 'README.md', 'one\n', 'Start the project');
  commit(work, 'src/app.js', 'export const version = 1;\n', 'Add the app (#123)');
  commit(work, 'docs/guide.md', 'Guide\n', 'Document the app #1234');
  bare = path.join(base, 'upstream.git');
  run(base, 'clone', '-q', '--bare', work, bare);
  run(bare, 'config', 'uploadpack.allowFilter', 'true');
  upstreamUrl = pathToFileURL(bare).href;
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test('a managed clone tracks the base branch tip and discards local changes', () => {
  const dir = path.join(base, 'check', 'repo');
  const first = refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  assert.equal(first.sha, run(work, 'rev-parse', 'HEAD'));

  writeFileSync(path.join(dir, 'src', 'app.js'), 'local edit\n');
  writeFileSync(path.join(dir, 'stray.txt'), 'left behind\n');
  const again = refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  assert.equal(again.sha, first.sha);
  assert.equal(readFileSync(path.join(dir, 'src', 'app.js'), 'utf8'), 'export const version = 1;\n');
  assert.equal(existsSync(path.join(dir, 'stray.txt')), false);

  const next = publish('Bump the version', 'src/app.js', 'export const version = 2;\n');
  assert.equal(refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' }).sha, next);
});

test('a clone made without the stored line endings is cloned again once, then kept', () => {
  const dir = path.join(base, 'converted-check', 'repo');
  mkdirSync(path.dirname(dir), { recursive: true });
  run(base, 'clone', '-q', bare, dir);
  assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), 'one\r\n');

  refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  assert.equal(readFileSync(path.join(dir, 'README.md'), 'utf8'), 'one\n');
  assert.equal(run(dir, 'remote', 'get-url', 'origin'), upstreamUrl);
  assert.equal(run(dir, 'config', '--local', '--get', 'core.eol'), 'lf');

  run(dir, 'config', 'auto-check.probe', 'kept');
  refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  assert.equal(run(dir, 'config', '--local', '--get', 'auto-check.probe'), 'kept');
});

test('a sparse managed clone holds the root files and the named folders only, until it is made whole again', () => {
  const dir = path.join(base, 'sparse-check', 'repo');
  const sparse = refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main', sparse: ['src/'] });
  assert.deepEqual(sparse.sparse, ['src']);
  assert.ok(existsSync(path.join(dir, 'README.md')));
  assert.ok(existsSync(path.join(dir, 'src', 'app.js')));
  assert.equal(existsSync(path.join(dir, 'docs', 'guide.md')), false);

  const whole = refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  assert.equal(whole.sparse, null);
  assert.equal(whole.sha, sparse.sha);
  assert.ok(existsSync(path.join(dir, 'docs', 'guide.md')));
  assert.throws(() => refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main', sparse: ['--force'] }), RepoError);
});

test('a clone too deep for git on Windows keeps its git folder in a short per-user folder', () => {
  const deep = `C:\\Users\\demo-user\\Projects\\${'nested-folder\\'.repeat(8)}acme-check\\checks\\acme-demo-app-pr-123\\repo`;
  const env = { LOCALAPPDATA: 'C:\\Users\\demo-user\\AppData\\Local' };
  const gitDir = gitDirFor(deep, { platform: 'win32', env });
  assert.match(gitDir, /^C:\\Users\\demo-user\\AppData\\Local\\auto-check\\git\\acme-demo-app-pr-123-[0-9a-f]{12}$/);
  assert.equal(gitDirFor(deep, { platform: 'win32', env }), gitDir);
  assert.equal(gitDirFor('C:\\Users\\demo-user\\acme-check\\checks\\acme-demo-app-pr-123\\repo', { platform: 'win32', env }), null);
  assert.equal(gitDirFor(`/home/demo-user/${'nested-folder/'.repeat(20)}repo`, { platform: 'linux', env }), null);

  const dir = path.join(base, 'separate-check', 'repo');
  const separate = path.join(base, 'short-git', 'acme-demo-app-pr-123');
  const first = refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main', gitDir: separate });
  assert.ok(statSync(path.join(dir, '.git')).isFile());
  assert.ok(existsSync(path.join(separate, 'HEAD')));
  assert.ok(existsSync(path.join(dir, 'src', 'app.js')));
  assert.equal(refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main', gitDir: separate }).sha, first.sha);

  rmSync(separate, { recursive: true, force: true });
  writeFileSync(path.join(dir, 'stray.txt'), 'left behind\n');
  const again = refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main', gitDir: separate });
  assert.equal(again.sha, first.sha);
  assert.ok(existsSync(path.join(separate, 'HEAD')));
  assert.equal(existsSync(path.join(dir, 'stray.txt')), false);
});

test('git errors name the line that says what failed', () => {
  assert.equal(gitReason("Cloning into 'repo'...\nerror: unable to write file x.pack\nfatal: index-pack failed\n"), 'error: unable to write file x.pack');
  assert.equal(gitReason('warning: something\nlast words\n'), 'last words');
  assert.equal(gitReason(''), '');
});

test('the landed commit is found by its #number, and only that number', () => {
  const dir = path.join(base, 'check', 'repo');
  refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  assert.equal(findLandedCommit(dir, 'main', 123).subject, 'Add the app (#123)');
  assert.equal(findLandedCommit(dir, 'main', 1234).subject, 'Document the app #1234');
  assert.equal(findLandedCommit(dir, 'main', 12), null);
});

test('commits are listed for watched paths, newest first', () => {
  const dir = path.join(base, 'check', 'repo');
  refreshManagedClone({ dir, url: upstreamUrl, baseRef: 'main' });
  const subjects = (options) => listCommits(dir, options).map((entry) => entry.subject);
  assert.deepEqual(subjects({ paths: ['src/**'] }).slice(0, 2), ['Bump the version', 'Add the app (#123)']);
  const start = run(dir, 'rev-list', '--max-parents=0', 'HEAD');
  assert.deepEqual(subjects({ from: start, paths: ['docs/guide.md'] }), ['Document the app #1234']);
});

test('an unmerged branch is rebased onto the upstream base in a worktree, leaving the clone as it was', () => {
  const fork = path.join(base, 'fork.git');
  run(base, 'clone', '-q', '--bare', bare, fork);
  const clone = cloneOf('user-clone', fork);
  run(clone, 'remote', 'add', 'upstream', bare);
  run(clone, 'checkout', '-q', '-b', 'fix-typo');
  const branchTip = commit(clone, 'README.md', 'one, fixed\n', 'Fix a typo');
  run(clone, 'checkout', '-q', 'main');
  const upstreamTip = publish('Add a second module', 'src/extra.js', 'export const extra = true;\n');
  const before = state(clone);

  const worktreeDir = path.join(base, 'check', 'worktree');
  const result = prepareLocalWorktree({ localRepo: clone, branch: 'fix-typo', baseRef: 'main', worktreeDir });
  assert.equal(result.conflict, false);
  assert.equal(result.upstream, 'upstream');
  assert.equal(result.ref, 'refs/heads/fix-typo');
  assert.equal(result.branchSha, branchTip);
  assert.equal(result.baseSha, upstreamTip);
  assert.equal(run(worktreeDir, 'rev-parse', 'HEAD~1'), upstreamTip);
  assert.equal(readFileSync(path.join(worktreeDir, 'README.md'), 'utf8'), 'one, fixed\n');
  assert.ok(existsSync(path.join(worktreeDir, 'src', 'extra.js')));

  removeLocalWorktree({ localRepo: clone, worktreeDir });
  assert.equal(existsSync(worktreeDir), false);
  assert.deepEqual(state(clone), before);
});

test('a branch that no longer applies is reported as a conflict at its own tip', () => {
  const clone = cloneOf('conflict-clone');
  run(clone, 'checkout', '-q', '-b', 'old-version');
  const tip = commit(clone, 'src/app.js', 'export const version = 99;\n', 'Pin the version');
  run(clone, 'checkout', '-q', 'main');
  publish('Bump the version again', 'src/app.js', 'export const version = 3;\n');

  const worktreeDir = path.join(base, 'check', 'conflict-worktree');
  const result = prepareLocalWorktree({ localRepo: clone, branch: 'old-version', baseRef: 'main', worktreeDir });
  assert.equal(result.conflict, true);
  assert.equal(result.upstream, 'origin');
  assert.equal(result.sha, tip);
  assert.equal(existsSync(run(worktreeDir, 'rev-parse', '--path-format=absolute', '--git-path', 'rebase-merge')), false);
  removeLocalWorktree({ localRepo: clone, worktreeDir });
});

test('a branch that does not exist fails without leaving a worktree', () => {
  const clone = cloneOf('missing-branch-clone');
  const worktreeDir = path.join(base, 'check', 'missing-worktree');
  assert.throws(
    () => prepareLocalWorktree({ localRepo: clone, branch: 'no-such-branch', baseRef: 'main', worktreeDir }),
    (error) => error instanceof RepoError && /no-such-branch/.test(error.message),
  );
  assert.equal(existsSync(worktreeDir), false);
  assert.equal(run(clone, 'worktree', 'list').split(/\r?\n/).length, 1);
});
