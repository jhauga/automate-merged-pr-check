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
  keepFor,
  lastFinishedRun,
  pruneResults,
  RUN_FOLDER,
  runTest,
} from '../lib/runner.mjs';
import { newTestConfig } from '../lib/test-config.mjs';
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
/** A clock fixed at a local time in October 2026, two seconds past the minute. */
const at = (day, hour, minute = 0) => () => new Date(2026, 9, day, hour, minute, 2);

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

test('test-configuration.md decides which outcomes notify and hands its account to the pipeline', async () => {
  const { root, dir } = await workRoot('notify-config');
  const config = path.join(dir, 'test-configuration.md');
  const { calls, deps, setSha } = fakes();
  setMode(dir, 'fail');

  writeFileSync(config, newTestConfig());
  const silenced = await run(root, deps, { now: at(19, 3) });
  assert.equal(silenced.outcome, 'fail');
  assert.deepEqual(silenced.decision, { reason: 'fail', notify: false, runFeatures: true, repeat: false });
  assert.equal(calls.afterRun.at(-1).check.notify.onFail, false);
  assert.equal(calls.afterRun.at(-1).account, null);

  writeFileSync(config, newTestConfig()
    .replace('**Send Notifications**: false', '**Send Notifications**: true')
    .replace('**Notify when Test**: null', '**Notify when Test**: pass')
    .replace('**Email**: null', '**Email**: jane.doe@example.com')
    .replace('**Password**: null', '**Password**: %AUTO_CHECK_EMAIL_PASSWORD%'));
  setSha('c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3');
  const passOnly = await run(root, deps, { now: at(20, 3) });
  assert.equal(passOnly.decision.reason, 'fail');
  assert.equal(passOnly.decision.notify, false);
  assert.deepEqual(calls.afterRun.at(-1).account, { email: 'jane.doe@example.com', password: '%AUTO_CHECK_EMAIL_PASSWORD%' });
  setMode(dir, 'pass');
  const recovered = await run(root, deps, { now: at(21, 3) });
  assert.deepEqual(recovered.decision, { reason: 'recover', notify: true, runFeatures: false, repeat: false });
  assert.ok(!readFileSync(recovered.resultFile, 'utf8').includes('AUTO_CHECK_EMAIL_PASSWORD'));
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

test('an invalid test-configuration.md stops the run before anything is written', async () => {
  const { root, dir } = await workRoot('invalid-config');
  writeFileSync(path.join(dir, 'test-configuration.md'), '# Test Configuration\n\n- **Keep Prior Results**: maybe\n');
  const before = readdirSync(path.join(dir, 'results'));
  const { calls, deps } = fakes();
  await assert.rejects(run(root, deps), (error) => {
    assert.ok(error instanceof RunError);
    assert.equal(error.exitCode, 2);
    assert.match(error.message, /\n {2}test-configuration\.md:3: Keep Prior Results takes true or false, not "maybe"\.$/);
    return true;
  });
  assert.equal(calls.refresh, 0);
  assert.deepEqual(readdirSync(path.join(dir, 'results')), before);
  assert.equal(existsSync(path.join(dir, 'state.json')), false);
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

const PROTECTED = [
  '2026-01-01T01-01-40-simulated-failure',
  '2026-01-01T01-03-13-baseline',
  '2026-01-04T03-00-00-simulated',
  '2026-01-04T03-00-00-start-simulated',
  'generate-try',
  'generate-try-simulated',
  'manual',
];

/** The run folders under `results`, oldest first. */
const runFolders = (results) => readdirSync(results).filter((name) => RUN_FOLDER.test(name)).sort();

test('only run folders count, the oldest go first, and the last pass is not kept past the count', () => {
  const resultsDir = path.join(base, 'prune', 'results');
  const runs = ['2026-01-01T03-00-00', '2026-01-02T03-00-00', '2026-01-03T03-00-00', '2026-01-03T03-00-00-2', '2026-01-05T03-00-00'];
  for (const name of [...runs, ...PROTECTED]) mkdirSync(path.join(resultsDir, name), { recursive: true });
  writeFileSync(path.join(resultsDir, '2026-01-06T03-00-00'), 'a file, not a run folder');
  const removed = pruneResults(resultsDir, { keep: 2, state: { lastPass: { resultDir: 'results/2026-01-01T03-00-00' } } });
  assert.deepEqual(removed, ['2026-01-01T03-00-00', '2026-01-02T03-00-00', '2026-01-03T03-00-00']);
  assert.deepEqual(readdirSync(resultsDir).sort(), [...PROTECTED, '2026-01-03T03-00-00-2', '2026-01-05T03-00-00', '2026-01-06T03-00-00'].sort());
  assert.deepEqual(pruneResults(resultsDir, { keep: 1 }), ['2026-01-03T03-00-00-2']);
  assert.deepEqual(readdirSync(resultsDir).filter((name) => PROTECTED.includes(name)).sort(), [...PROTECTED].sort());
  assert.deepEqual(pruneResults(path.join(base, 'prune', 'missing'), { keep: 1 }), []);
});

test('a two-step check keeps the count of each half, and folders the state reads are kept past it', () => {
  const resultsDir = path.join(base, 'prune-two-step', 'results');
  const names = [1, 2, 3, 4].flatMap((day) => [`2026-01-0${day}T03-00-00-start`, `2026-01-0${day}T04-00-00-collect`]);
  for (const name of names) mkdirSync(path.join(resultsDir, name), { recursive: true });
  const removed = pruneResults(resultsDir, {
    keep: 2,
    state: {
      openResolution: { resultDir: 'results/2026-01-01T04-00-00-collect' },
      pendingCollect: { resultDir: 'results/2026-01-01T03-00-00-start' },
      lastRun: { resultDir: 'results/2026-01-02T04-00-00-collect' },
    },
  });
  assert.deepEqual(removed, ['2026-01-02T03-00-00-start']);
  assert.deepEqual(runFolders(resultsDir), names.filter((name) => name !== '2026-01-02T03-00-00-start').sort());
});

test('a run keeps the number of run folders test-configuration.md sets, deleting the oldest first', async () => {
  const { root, dir } = await workRoot('keep-two');
  const results = path.join(dir, 'results');
  rmSync(results, { recursive: true, force: true });
  const kept = ['2026-10-16T01-01-40-simulated-failure', '2026-10-16T01-03-13-baseline', 'generate-try', 'generate-try-simulated'];
  for (const name of [...kept, '2026-10-17T03-00-02', '2026-10-18T03-00-02']) mkdirSync(path.join(results, name), { recursive: true });
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig().replace('**Number of Test**: 7', '**Number of Test**: 2'));

  let seenByAfterRun = null;
  const afterRun = async () => {
    seenByAfterRun = runFolders(results);
    return { notified: false };
  };
  const result = await run(root, fakes({ afterRun }).deps, { now: () => new Date(2026, 9, 19, 3, 0, 2) });
  assert.equal(result.outcome, 'pass');
  assert.equal(path.basename(result.resultDir), '2026-10-19T03-00-02');
  assert.deepEqual(seenByAfterRun, ['2026-10-18T03-00-02', '2026-10-19T03-00-02']);
  assert.equal(result.kept, 2);
  assert.deepEqual(result.pruned, ['2026-10-17T03-00-02']);
  assert.deepEqual(readdirSync(results).sort(), [...kept, '2026-10-18T03-00-02', '2026-10-19T03-00-02'].sort());
  assert.match(formatRun(result, { cwd: dir }), /^ {2}kept: 2 run folders, removed 2026-10-17T03-00-02$/m);
});

test('Keep Prior Results false keeps only the newest run folder, and each run still makes its own', async () => {
  const { root, dir } = await workRoot('keep-newest');
  const results = path.join(dir, 'results');
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig().replace('**Keep Prior Results**: true', '**Keep Prior Results**: false'));
  const first = await run(root, fakes().deps, { now: () => new Date(2026, 9, 19, 3, 0, 2) });
  assert.equal(first.kept, 1);
  assert.deepEqual(runFolders(results), ['2026-10-19T03-00-02']);
  const second = await run(root, fakes().deps, { now: () => new Date(2026, 9, 20, 3, 0, 2) });
  assert.deepEqual(second.pruned, ['2026-10-19T03-00-02']);
  assert.deepEqual(runFolders(results), ['2026-10-20T03-00-02']);
  assert.match(formatRun(second, { cwd: dir }), /^ {2}kept: 1 run folder, removed 2026-10-19T03-00-02$/m);
  assert.ok(readdirSync(results).some((name) => name.endsWith('-baseline')));
});

test('the folder of an open failure is kept past the count until a pass closes it', async () => {
  const { root, dir } = await workRoot('keep-open-failure');
  const results = path.join(dir, 'results');
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig().replace('**Number of Test**: 7', '**Number of Test**: 1'));
  setMode(dir, 'fail');
  const failed = await run(root, fakes().deps, { now: () => new Date(2026, 9, 21, 3, 0, 2) });
  assert.equal(failed.outcome, 'fail');
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...state(dir), openResolution: { resultDir: 'results/2026-10-21T03-00-02' } }));
  const repeat = await run(root, fakes().deps, { now: () => new Date(2026, 9, 22, 3, 0, 2) });
  assert.deepEqual(repeat.pruned, []);
  assert.deepEqual(runFolders(results), ['2026-10-21T03-00-02', '2026-10-22T03-00-02']);
  setMode(dir, 'pass');
  const passed = await run(root, fakes().deps, { now: () => new Date(2026, 9, 23, 3, 0, 2) });
  assert.equal(passed.outcome, 'pass');
  assert.deepEqual(passed.pruned, ['2026-10-21T03-00-02', '2026-10-22T03-00-02']);
  assert.deepEqual(runFolders(results), ['2026-10-23T03-00-02']);
});

test('without test-configuration.md, the results.keep setting decides', async () => {
  const { root, dir } = await workRoot('keep-settings');
  const results = path.join(dir, 'results');
  for (const day of [20, 21, 22]) mkdirSync(path.join(results, `2026-10-${day}T03-00-02`), { recursive: true });
  const config = { ...defaults(), results: { keep: 2 } };
  const result = await runTest({ testFolder: root, config, deps: fakes().deps, now: () => new Date(2026, 9, 23, 3, 0, 2) });
  assert.equal(result.kept, 2);
  assert.deepEqual(result.pruned, ['2026-10-20T03-00-02', '2026-10-21T03-00-02']);
  assert.deepEqual(runFolders(results), ['2026-10-22T03-00-02', '2026-10-23T03-00-02']);
  assert.deepEqual(keepFor({ state: 'missing', settings: null }, {}), { keep: 14, from: 'results.keep' });
});

/** Writes a run folder under the test's results, with `result` as its result.json: an object, raw text, or none. */
function writeRun(dir, name, result) {
  const folder = path.join(dir, 'results', name);
  mkdirSync(folder, { recursive: true });
  if (result !== undefined) writeFileSync(path.join(folder, 'result.json'), typeof result === 'string' ? result : JSON.stringify(result));
}

test('the newest finished run is the newest run folder that is not a start, with its result when it can be read', () => {
  const dir = path.join(base, 'last-finished');
  const resultsDir = path.join(dir, 'results');
  assert.equal(lastFinishedRun(resultsDir), null);
  mkdirSync(resultsDir, { recursive: true });
  assert.equal(lastFinishedRun(resultsDir), null);
  writeRun(dir, '2026-10-18T03-00-02', { outcome: 'pass' });
  writeRun(dir, '2026-10-19T03-00-02', { outcome: 'fail' });
  writeRun(dir, '2026-10-19T09-00-00-simulated', { outcome: 'pass' });
  writeRun(dir, '2026-10-19T10-00-00-baseline', { outcome: 'pass' });
  writeRun(dir, '2026-10-20T03-00-00-start', { outcome: 'pass' });
  writeRun(dir, 'generate-try', { outcome: 'pass' });
  assert.deepEqual(lastFinishedRun(resultsDir), { folder: '2026-10-19T03-00-02', result: { outcome: 'fail' } });
  writeRun(dir, '2026-10-20T04-00-00-collect');
  assert.deepEqual(lastFinishedRun(resultsDir), { folder: '2026-10-20T04-00-00-collect', result: null });
  writeRun(dir, '2026-10-21T03-00-02', '{ not json');
  assert.deepEqual(lastFinishedRun(resultsDir), { folder: '2026-10-21T03-00-02', result: null });
});

test('a scheduled run is skipped while the newest finished run failed, writes nothing, and a hand run turns it back on', async () => {
  const { root, dir } = await workRoot('skip-after-fail');
  const results = path.join(dir, 'results');
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig());
  writeRun(dir, '2026-10-18T03-00-02', { outcome: 'fail' });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ lastRun: { outcome: 'fail', resultDir: 'results/2026-10-18T03-00-02' } }));
  writeRun(dir, '2026-10-18T09-00-00-simulated', { outcome: 'fail', simulated: true });
  writeRun(dir, '2026-10-18T10-00-00-baseline', { outcome: 'baseline' });
  const before = { results: readdirSync(results).sort(), state: readFileSync(path.join(dir, 'state.json'), 'utf8') };

  const { calls, deps } = fakes();
  const skipped = await run(root, deps, { scheduled: true, now: at(19, 3) });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.outcome, 'skipped');
  assert.equal(skipped.exitCode, 0);
  assert.equal(skipped.lastResult, 'results/2026-10-18T03-00-02/result.json');
  assert.equal(calls.refresh, 0);
  assert.equal(calls.afterRun.length, 0);
  assert.deepEqual(readdirSync(results).sort(), before.results);
  assert.equal(readFileSync(path.join(dir, 'state.json'), 'utf8'), before.state);
  assert.equal(existsSync(path.join(dir, '.run.lock')), false);
  assert.equal(formatRun(skipped), 'skip-after-fail: skipped. The last run failed (results/2026-10-18T03-00-02/result.json), '
    + 'and Turn Off on Failed Test is true in test-configuration.md. Fix the cause, then run auto-check run here; '
    + 'scheduled runs resume after a run that does not fail.\n');

  const hand = await run(root, deps, { now: at(19, 9) });
  assert.equal(hand.outcome, 'pass');
  const next = await run(root, deps, { scheduled: true, now: at(20, 3) });
  assert.equal(next.skipped, undefined);
  assert.equal(next.outcome, 'pass');
});

test('a scheduled run goes ahead after an error, without a readable result, without the file, or with Turn Off false', async () => {
  const { root, dir } = await workRoot('skip-or-not');
  const config = path.join(dir, 'test-configuration.md');
  const scheduled = (day) => run(root, fakes().deps, { scheduled: true, now: at(day, 3) });

  writeRun(dir, '2026-10-10T03-00-02', { outcome: 'fail' });
  assert.equal((await scheduled(11)).outcome, 'pass');

  writeFileSync(config, newTestConfig());
  writeRun(dir, '2026-10-12T03-00-02', { outcome: 'error' });
  assert.equal((await scheduled(13)).outcome, 'pass');
  writeRun(dir, '2026-10-14T03-00-02');
  assert.equal((await scheduled(15)).outcome, 'pass');
  writeRun(dir, '2026-10-16T03-00-02', '{ not json');
  assert.equal((await scheduled(17)).outcome, 'pass');

  writeFileSync(config, newTestConfig().replace('**Turn Off on Failed Test**: true', '**Turn Off on Failed Test**: false'));
  writeRun(dir, '2026-10-18T03-00-02', { outcome: 'fail' });
  assert.equal((await scheduled(19)).outcome, 'pass');

  writeFileSync(config, newTestConfig());
  writeRun(dir, '2026-10-20T03-00-02', { outcome: 'fail' });
  assert.equal((await scheduled(21)).skipped, true);
});

test('the collect half of a two-step check is never skipped, and its start is', async () => {
  const { root, dir } = await workRoot('skip-two-step', { runMode: 'two-step' });
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig());
  const { deps } = fakes();
  const started = await run(root, deps, { phase: 'start', scheduled: true, now: at(18, 3) });
  assert.equal(started.started, true);
  writeRun(dir, '2026-10-18T03-30-00-collect', { outcome: 'fail' });
  const collected = await run(root, deps, { phase: 'collect', scheduled: true, now: at(18, 4) });
  assert.equal(collected.skipped, undefined);
  assert.equal(collected.outcome, 'pass');
  writeRun(dir, '2026-10-18T05-00-00-collect', { outcome: 'fail' });
  const next = await run(root, deps, { phase: 'start', scheduled: true, now: at(19, 3) });
  assert.equal(next.skipped, true);
  assert.equal(next.lastResult, 'results/2026-10-18T05-00-00-collect/result.json');
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
