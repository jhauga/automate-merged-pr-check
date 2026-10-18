import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import {
  RunError,
  acquireHostAppLock,
  acquireLock,
  decideNotification,
  expandSubject,
  failureSignature,
  formatRun,
  hostAppLockFile,
  pruneResults,
  runTest,
} from '../lib/runner.mjs';
import { SLUG, fakes, makeTestFolder, readState, setMode } from './helpers/run-check.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-runner-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const state = readState;
const workRoot = (name, options) => makeTestFolder(base, name, options);
const run = (root, deps, options = {}) => runTest({ testFolder: root, config: defaults(), deps, now: () => new Date(), ...options });

test('a passing run records the code under test, the fingerprint, and the comparison, and updates the state', async () => {
  const { root, dir } = await workRoot('pass');
  const { calls, deps } = fakes();
  const result = await run(root, deps);
  assert.equal(result.outcome, 'pass');
  assert.equal(result.exitCode, 0);
  const record = JSON.parse(readFileSync(result.resultFile, 'utf8'));
  assert.equal(record.checkOutcome, 'pass');
  assert.equal(record.upstreamSha, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
  assert.equal(record.sourceMode, 'upstream');
  assert.deepEqual(record.fingerprint, { os: { platform: 'test' }, node: '24.0.0' });
  assert.equal(record.compare.ok, true);
  assert.deepEqual(record.compare.results.map((entry) => `${entry.artifact} ${entry.method}`), [
    'greeting text',
    'page-initial color-sample',
    'page-initial liveness',
  ]);
  assert.match(path.basename(result.resultDir), /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  assert.ok(existsSync(path.join(result.resultDir, 'run.log')));
  assert.equal(calls.refresh, 1);
  assert.deepEqual(result.decision, { reason: 'pass', notify: false, runFeatures: false, repeat: false });
  const saved = state(dir);
  assert.equal(saved.lastPass.upstreamSha, record.upstreamSha);
  assert.equal(saved.lastPass.resultDir, `results/${path.basename(result.resultDir)}`);
  assert.equal(saved.lastRun.outcome, 'pass');
  assert.equal(saved.consecutiveFailures, 0);
  assert.equal(existsSync(path.join(dir, '.run.lock')), false);
  assert.match(formatRun(result, { cwd: root }), /^pass: pass\n {2}code under test: upstream a1b2c3d\n {2}assertions: 2 of 2 pass\n {2}comparison \(composite\): 3 of 3 match the baseline\n/);
});

test('a failure notifies once, a repeat stays quiet, a new commit notifies again, and a pass is a recovery', async () => {
  const { root, dir } = await workRoot('repeat');
  const { calls, deps, setSha } = fakes();
  setMode(dir, 'fail');
  const first = await run(root, deps);
  assert.equal(first.outcome, 'fail');
  assert.equal(first.exitCode, 1);
  assert.deepEqual(first.decision, { reason: 'fail', notify: true, runFeatures: true, repeat: false });
  assert.deepEqual(first.record.failing, ['page: the greeting is printed', 'compare greeting text']);
  assert.equal(state(dir).consecutiveFailures, 1);
  assert.ok(state(dir).lastNotifiedAt);

  const second = await run(root, deps);
  assert.equal(second.decision.reason, 'repeat fail');
  assert.equal(second.decision.notify, false);
  assert.equal(second.decision.runFeatures, false);
  assert.equal(state(dir).consecutiveFailures, 2);

  setSha('b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2');
  const third = await run(root, deps);
  assert.equal(third.decision.reason, 'fail');
  assert.notEqual(third.record.signature, second.record.signature);

  setMode(dir, 'pass');
  const recovered = await run(root, deps);
  assert.deepEqual(recovered.decision, { reason: 'recover', notify: true, runFeatures: false, repeat: false });
  assert.equal(state(dir).consecutiveFailures, 0);
  assert.equal(state(dir).lastFailureSignature, null);
  assert.equal(calls.afterRun.length, 4);
  assert.equal(calls.afterRun[0].state.lastRun, undefined);
});

test('a capture that no longer matches the baseline turns a pass into a failure', async () => {
  const { root, dir } = await workRoot('repainted');
  setMode(dir, 'repainted');
  const result = await run(root, fakes().deps);
  assert.equal(result.record.checkOutcome, 'pass');
  assert.equal(result.outcome, 'fail');
  assert.deepEqual(result.record.failing, ['compare page-initial color-sample']);
  assert.match(result.record.compare.failures[0].detail, /mostly red, where the baseline is mostly green$/);
});

test('a simulated failure fails without touching the state', async () => {
  const { root, dir } = await workRoot('simulated');
  await run(root, fakes().deps);
  const before = state(dir);
  const result = await run(root, fakes().deps, { simulateFail: 'black' });
  assert.equal(result.outcome, 'fail');
  assert.equal(result.record.simulated, true);
  assert.equal(result.decision.notify, true);
  assert.match(path.basename(result.resultDir), /-simulated$/);
  assert.deepEqual(state(dir), before);
  const quiet = await run(root, fakes().deps, { simulateFail: 'black', noNotify: true });
  assert.equal(quiet.decision.notify, false);
});

test('a check that throws, a source that cannot be prepared, and a run that hangs are errors', async () => {
  const { root, dir } = await workRoot('errors', { timeoutMinutes: 0.03 });
  setMode(dir, 'throw');
  const thrown = await run(root, fakes().deps);
  assert.equal(thrown.outcome, 'error');
  assert.equal(thrown.exitCode, 2);
  assert.match(thrown.record.error, /no browser is installed/);
  assert.equal(thrown.decision.reason, 'error');
  assert.equal(state(dir).lastErrorSignature, thrown.record.signature);

  const offline = await run(root, fakes({ refreshClone: () => { throw new Error('git fetch failed in repo: could not resolve host'); } }).deps);
  assert.equal(offline.outcome, 'error');
  assert.equal(offline.record.error, 'The code under test could not be prepared: git fetch failed in repo: could not resolve host');

  setMode(dir, 'hang');
  const hung = await run(root, fakes().deps);
  assert.equal(hung.outcome, 'error');
  assert.equal(hung.record.error, 'run.mjs did not finish within 0.03 minutes.');
  assert.equal(hung.record.runner.timedOut, true);
});

test('local mode follows the pull request: landed switches to the base branch, closed pauses, a conflict fails', async () => {
  const local = { mode: 'local', localRepo: path.join(base, 'demo-app'), branch: 'fix-typo', clonePath: 'worktree' };
  const merged = await workRoot('local-merged', { source: local });
  const landed = fakes({ readPr: () => ({ merged: true, status: 'landed' }) });
  const switched = await run(merged.root, landed.deps);
  assert.equal(switched.outcome, 'pass');
  assert.equal(landed.calls.refresh, 1);
  assert.equal(JSON.parse(readFileSync(path.join(merged.dir, 'check.config.json'), 'utf8')).source.mode, 'upstream');
  assert.match(switched.record.notes.at(-1).text, /^The pull request has landed, so the check now tests main at its tip/);

  const closedRoot = await workRoot('local-closed', { source: local });
  const paused = [];
  const closed = await run(closedRoot.root, fakes({ readPr: () => ({ merged: false, status: 'closed' }), pauseSchedule: async (slug) => paused.push(slug) }).deps);
  assert.equal(closed.outcome, 'error');
  assert.match(closed.record.error, /closed without landing/);
  assert.deepEqual(paused, [path.basename(closedRoot.dir)]);

  const conflictRoot = await workRoot('local-conflict', { source: local });
  const conflict = await run(conflictRoot.root, fakes({
    readPr: () => ({ merged: false, status: 'open' }),
    prepareLocal: ({ worktreeDir }) => ({ worktreeDir, sha: 'c3c3c3c3', baseSha: 'd4d4d4d4', conflict: true }),
  }).deps);
  assert.equal(conflict.outcome, 'fail');
  assert.deepEqual(conflict.record.failing, ['source: the pull request still applies to main']);
  assert.equal(existsSync(path.join(conflict.resultDir, 'run.log')), false);

  const openRoot = await workRoot('local-open', { source: local });
  const open = await run(openRoot.root, fakes({
    readPr: () => ({ merged: false, status: 'open' }),
    prepareLocal: ({ worktreeDir }) => {
      mkdirSync(worktreeDir, { recursive: true });
      return { worktreeDir, sha: 'e5e5e5e5e5e5', baseSha: 'f6f6f6f6f6f6', conflict: false };
    },
  }).deps);
  assert.equal(open.outcome, 'pass');
  assert.equal(open.record.sourceMode, 'local');
  assert.equal(open.record.sourceSha, 'e5e5e5e5e5e5');
  assert.equal(open.record.upstreamSha, 'f6f6f6f6f6f6');
});

test('a two-step check starts in one run and is collected in the next', async () => {
  const { root, dir } = await workRoot('two-step', { runMode: 'two-step' });
  await assert.rejects(run(root, fakes().deps), (error) => error instanceof RunError && /runs in two steps/.test(error.message));
  await assert.rejects(run(root, fakes().deps, { phase: 'collect' }), /no started run to collect/);
  const { calls, deps } = fakes();
  const started = await run(root, deps, { phase: 'start' });
  assert.equal(started.started, true);
  assert.equal(started.exitCode, 0);
  assert.equal(started.record.compare, null);
  assert.equal(started.decision.reason, 'started');
  assert.ok(state(dir).pendingCollect);
  const collected = await run(root, deps, { phase: 'collect' });
  assert.equal(collected.outcome, 'pass');
  assert.equal(calls.refresh, 1);
  assert.equal(collected.record.upstreamSha, started.record.upstreamSha);
  assert.equal(state(dir).pendingCollect, undefined);
  assert.equal(state(dir).lastPass.upstreamSha, started.record.upstreamSha);

  const single = await workRoot('single-phase');
  await assert.rejects(run(single.root, fakes().deps, { phase: 'start' }), /runs in one step/);
  const empty = path.join(base, 'no-check');
  mkdirSync(empty, { recursive: true });
  await assert.rejects(runTest({ testFolder: empty, config: defaults() }), /holds no check yet/);
});

test('a live run holds the lock, and a lock left by a process that is gone is taken over', () => {
  const dir = path.join(base, 'lock');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, '.run.lock'), JSON.stringify({ pid: process.ppid, startedAt: '2026-01-01T03:00:00Z' }));
  assert.throws(() => acquireLock(dir), (error) => error instanceof RunError && /still going: process \d+/.test(error.message));
  writeFileSync(path.join(dir, '.run.lock'), JSON.stringify({ pid: 2147483646, startedAt: '2026-01-01T03:00:00Z' }));
  const release = acquireLock(dir);
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.run.lock'), 'utf8')).pid, process.pid);
  release();
  assert.equal(existsSync(path.join(dir, '.run.lock')), false);
});

test('old result folders are pruned, keeping the newest and the ones the state points to', () => {
  const resultsDir = path.join(base, 'prune', 'results');
  const names = ['2026-01-01T03-00-00', '2026-01-02T03-00-00', '2026-01-03T03-00-00', '2026-01-04T03-00-00-simulated', '2026-01-05T03-00-00', 'generate-try'];
  for (const name of names) mkdirSync(path.join(resultsDir, name), { recursive: true });
  const removed = pruneResults(resultsDir, { keep: 2, state: { lastPass: { resultDir: 'results/2026-01-01T03-00-00' } } });
  assert.deepEqual(removed, ['2026-01-03T03-00-00', '2026-01-02T03-00-00']);
  assert.deepEqual(readdirSync(resultsDir).sort(), ['2026-01-01T03-00-00', '2026-01-04T03-00-00-simulated', '2026-01-05T03-00-00', 'generate-try']);
});

test('notification decisions, signatures, and expanded subject paths', () => {
  const notify = defaults().notify;
  assert.deepEqual(decideNotification({ outcome: 'error', signature: 'e1', state: { lastErrorSignature: 'e1' }, notify }), { reason: 'repeat error', notify: false, runFeatures: false, repeat: true });
  assert.deepEqual(decideNotification({ outcome: 'fail', signature: 'f1', state: { lastFailureSignature: 'f1' }, notify }), { reason: 'repeat fail', notify: false, runFeatures: false, repeat: true });
  assert.deepEqual(decideNotification({ outcome: 'fail', signature: 'f2', state: { lastFailureSignature: 'f1' }, notify }), { reason: 'fail', notify: true, runFeatures: true, repeat: false });
  assert.equal(decideNotification({ outcome: 'pass', state: { lastRun: { outcome: 'pass' } }, notify: { ...notify, onPass: true } }).notify, true);
  const one = failureSignature({ failing: ['b', 'a'], upstreamSha: 'abc', fingerprint: { node: '24' } });
  assert.equal(one, failureSignature({ failing: ['a', 'b'], upstreamSha: 'abc', fingerprint: { node: '24' } }));
  assert.notEqual(one, failureSignature({ failing: ['a', 'b'], upstreamSha: 'abc', fingerprint: { node: '25' } }));
  assert.match(one, /^[0-9a-f]{16}$/);
  const env = { SAMPLE_HOME: path.join(base, 'home') };
  const subject = expandSubject({ installedPath: '$SAMPLE_HOME/extension', hostApp: { name: 'Sample App', exe: '${SAMPLE_HOME}/sample-app' } }, env);
  assert.equal(subject.installedPath, `${env.SAMPLE_HOME}/extension`);
  assert.equal(subject.hostApp.exe, `${env.SAMPLE_HOME}/sample-app`);
});

test('a check that drives a desktop app holds a machine-wide lock while it runs', async () => {
  const { root } = await workRoot('host-app');
  const file = path.join(root, 'check.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  config.layers.hostApp = { enabled: true, driver: 'cdp' };
  writeFileSync(file, JSON.stringify(config, null, 2));

  const held = [];
  const deps = {
    ...fakes().deps,
    hostAppLock: async (options) => {
      held.push(options.name);
      return () => held.push(`released ${options.name}`);
    },
  };
  const result = await runTest({ testFolder: root, config: defaults(), deps });
  assert.equal(result.outcome, 'pass');
  assert.deepEqual(held, ['host-app', 'released host-app']);

  const quiet = await workRoot('no-host-app');
  const calls = [];
  await runTest({
    testFolder: quiet.root,
    config: defaults(),
    deps: { ...fakes().deps, hostAppLock: async () => { calls.push('taken'); return () => {}; } },
  });
  assert.deepEqual(calls, []);
});

test('the machine-wide lock waits for a live holder, takes over a dead one, and gives up in the end', async () => {
  const state = path.join(base, 'locks');
  const env = { AUTO_CHECK_STATE_DIR: state };
  const file = hostAppLockFile(env);
  assert.equal(file, path.join(state, 'locks', 'host-app.lock'));

  const release = await acquireHostAppLock({ env, name: 'first' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
  release();
  assert.equal(existsSync(file), false);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ pid: 999999999, name: 'gone', startedAt: '2026-01-01T03:00:00.000Z' }));
  const takenOver = await acquireHostAppLock({ env, name: 'second' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).name, 'second');
  takenOver();

  writeFileSync(file, JSON.stringify({ pid: process.pid + 0, name: 'mine', startedAt: '2026-01-01T03:00:00.000Z' }));
  const own = await acquireHostAppLock({ env, name: 'same process' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).name, 'same process');
  own();

  const alive = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    writeFileSync(file, JSON.stringify({ pid: alive.pid, name: 'another check', startedAt: '2026-01-01T03:00:00.000Z' }));
    let clock = 0;
    await assert.rejects(
      acquireHostAppLock({
        env,
        name: 'waiting',
        timeoutMinutes: 1,
        waitMs: 1,
        now: () => clock,
        sleep: async () => { clock += 30000; },
      }),
      (error) => {
        assert.ok(error instanceof RunError);
        assert.match(error.message, /Another check has been driving a desktop app for longer than 1 minutes: another check/);
        return true;
      },
    );
  } finally {
    alive.kill();
    rmSync(file, { force: true });
  }
});
