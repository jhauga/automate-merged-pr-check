import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHECK_EXIT } from './check-kit.mjs';
import { compareRun } from './compare/index.mjs';
import { resolveInherit } from './config.mjs';
import { readFormIn } from './context.mjs';
import { collectFingerprint } from './fingerprint.mjs';
import { intake } from './pr.mjs';
import { prepareLocalWorktree, refreshManagedClone } from './repo.mjs';
import { accountFor, notifyFor, readTestConfigIn, secretVariables } from './test-config.mjs';
import { installKit } from './test-folder.mjs';
import { TEST_CONFIG_FILE, locksDir } from './paths.mjs';
import { fileTimestamp } from './util/date.mjs';
import { expandPath, withoutVariables } from './util/env.mjs';
import { runProcess } from './util/process.mjs';

/** Raised when a run cannot start, such as for a check that does not exist. */
export class RunError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunError';
    this.exitCode = 2;
  }
}

/** Exit code for each run outcome. */
export const RUN_EXIT = Object.freeze({ pass: CHECK_EXIT.PASS, fail: CHECK_EXIT.FAIL, error: CHECK_EXIT.ERROR });

/**
 * A run folder under results/: the timestamp of a run, then -start or -collect
 * for one half of a two-step check, then a count when two runs share a second.
 * Baseline, simulated, and generate-try folders have other names.
 */
export const RUN_FOLDER = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-(start|collect))?(?:-\d+)?$/;

/** Settings results.keep applies when a test folder has no test-configuration.md. */
export const DEFAULT_KEEP = 14;

const slash = (value) => value.split(path.sep).join('/');
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

/** The check in a test folder, with its settings resolved against the user settings. */
export function loadCheck(testFolder, config) {
  const dir = path.resolve(testFolder);
  const configFile = path.join(dir, 'check.config.json');
  if (!existsSync(configFile) || !existsSync(path.join(dir, 'run.mjs'))) {
    throw new RunError(`${dir} holds no check yet. Run auto-check <pr-url> there to write one.`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch (error) {
    throw new RunError(`${path.join(dir, 'check.config.json')} is not valid JSON: ${error.message}`);
  }
  return { dir, name: path.basename(dir), configFile, raw, check: resolveInherit(raw, config) };
}

/** The check's subject with environment variables and ~ expanded in its paths. */
export function expandSubject(subject = {}, env = process.env) {
  const hostApp = subject.hostApp ? { ...subject.hostApp, exe: expandPath(subject.hostApp.exe, env) } : subject.hostApp ?? null;
  return { ...subject, installedPath: expandPath(subject.installedPath, env), hostApp };
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** True when `dir` already holds a check: its settings and its run.mjs. */
export function hasCheck(dir) {
  return existsSync(path.join(dir, 'check.config.json')) && existsSync(path.join(dir, 'run.mjs'));
}

/** The state a test folder keeps between runs, or an empty object. */
export function readCheckState(dir) {
  return readState(dir);
}

/** The lock one run at a time holds while it drives a desktop app on this machine. */
export function hostAppLockFile(env = process.env, options = {}) {
  return path.join(locksDir(env, options), 'host-app.lock');
}

/**
 * Takes the machine-wide lock for driving a desktop app, waiting while another
 * live run holds it. A lock left by a process that is gone is taken over.
 * Returns the release function, or throws when the wait runs out.
 */
export async function acquireHostAppLock({
  env = process.env,
  timeoutMinutes = 15,
  name = 'a check',
  waitMs = 2000,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ...options
} = {}) {
  const file = hostAppLockFile(env, options);
  mkdirSync(path.dirname(file), { recursive: true });
  const until = now() + timeoutMinutes * 60 * 1000;
  for (;;) {
    let holder = null;
    if (existsSync(file)) {
      try {
        holder = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        holder = null;
      }
      if (holder?.pid && holder.pid !== process.pid && isAlive(holder.pid)) {
        if (now() >= until) {
          throw new RunError(
            `Another check has been driving a desktop app for longer than ${timeoutMinutes} minutes: `
              + `${holder.name ?? 'unknown'}, process ${holder.pid}, started ${holder.startedAt}. `
              + `Delete ${file} if that run is gone.`,
          );
        }
        await sleep(waitMs);
        continue;
      }
    }
    writeFileSync(file, JSON.stringify({ pid: process.pid, name, startedAt: new Date().toISOString() }));
    return () => rmSync(file, { force: true });
  }
}

/** Takes the check's run lock, refusing while another live process holds it. Returns the release function. */
export function acquireLock(dir) {
  const file = path.join(dir, '.run.lock');
  if (existsSync(file)) {
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      holder = null;
    }
    if (holder?.pid && holder.pid !== process.pid && isAlive(holder.pid)) {
      throw new RunError(`Another run of this check is still going: process ${holder.pid}, started ${holder.startedAt}.`);
    }
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return () => rmSync(file, { force: true });
}

/** A short, stable name for a failure: what failed, on which upstream commit, on which machine. */
export function failureSignature({ failing, upstreamSha, fingerprint }) {
  const text = JSON.stringify({ failing: [...failing].sort(), upstreamSha: upstreamSha ?? null, fingerprint: fingerprint ?? null });
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Whether a run's outcome is worth a notification. A failure or error with the
 * same signature as the last one is a repeat: it notifies once and does not
 * run the follow-up features again. A pass after a failure or an error is a
 * recovery. For a simulated run, `state` is the simulated runs' own memory.
 */
export function decideNotification({ outcome, signature, state = {}, notify = {} }) {
  if (outcome === 'fail' || outcome === 'error') {
    const key = outcome === 'fail' ? 'lastFailureSignature' : 'lastErrorSignature';
    const repeat = Boolean(signature) && state[key] === signature;
    const wanted = Boolean(outcome === 'fail' ? notify.onFail : notify.onError);
    return { reason: repeat ? `repeat ${outcome}` : outcome, notify: wanted && !repeat, runFeatures: outcome === 'fail' && !repeat, repeat };
  }
  const previous = state.lastRun?.outcome;
  const recovered = previous === 'fail' || previous === 'error';
  return { reason: recovered ? 'recover' : 'pass', notify: Boolean(recovered ? notify.onRecover : notify.onPass), runFeatures: false, repeat: false };
}

/** state.json after a run, for a run that is not simulated. */
export function nextState(state, { outcome, at, upstreamSha, fingerprint, resultDir, signature }) {
  const next = { ...state, lastRun: { at, outcome, upstreamSha, resultDir } };
  if (outcome === 'pass') {
    next.lastPass = { at, upstreamSha, fingerprint, resultDir };
    next.consecutiveFailures = 0;
    next.lastFailureSignature = null;
    next.lastErrorSignature = null;
  } else if (outcome === 'fail') {
    next.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
    next.lastFailureSignature = signature;
  } else {
    next.lastErrorSignature = signature;
  }
  return next;
}

/**
 * How many run folders a test keeps: what its test-configuration.md says, or,
 * without one, the results.keep setting.
 */
export function keepFor(testConfig, config = {}) {
  if (testConfig?.settings) {
    const { keepPrior, keepCount } = testConfig.settings;
    return { keep: keepPrior ? keepCount : 1, from: 'test-configuration.md' };
  }
  return { keep: config.results?.keep ?? DEFAULT_KEEP, from: 'results.keep' };
}

/**
 * Deletes the oldest run folders past `keep`. Plain, -start, and -collect
 * folders are counted apart, so a two-step check keeps `keep` tests. A folder
 * with any other name is never counted or deleted, and neither is one the
 * state still reads: the open failure's, a pending collect's, and the last
 * run's. Returns the names deleted, oldest first.
 */
export function pruneResults(resultsDir, { keep, state = {} }) {
  if (!existsSync(resultsDir)) return [];
  const pinned = new Set([state.openResolution?.resultDir, state.pendingCollect?.resultDir, state.lastRun?.resultDir]
    .filter(Boolean)
    .map((dir) => path.basename(dir)));
  const kinds = new Map();
  for (const entry of readdirSync(resultsDir, { withFileTypes: true })) {
    const match = entry.isDirectory() ? RUN_FOLDER.exec(entry.name) : null;
    if (!match) continue;
    const kind = match[1] ?? 'run';
    kinds.set(kind, [...(kinds.get(kind) ?? []), entry.name]);
  }
  const removed = [...kinds.values()]
    .flatMap((names) => names.sort().reverse().slice(Math.max(1, keep)))
    .filter((name) => !pinned.has(name))
    .sort();
  for (const name of removed) rmSync(path.join(resultsDir, name), { recursive: true, force: true });
  return removed;
}

/**
 * The newest finished run under results/: the newest run folder that is not
 * the start of a two-step check, with its result.json, or a null result when
 * that file is missing or unreadable. Null when there is no such folder.
 */
export function lastFinishedRun(resultsDir) {
  if (!existsSync(resultsDir)) return null;
  const folder = readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RUN_FOLDER.exec(entry.name)?.[1] !== 'start' && RUN_FOLDER.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .pop();
  if (!folder) return null;
  let result = null;
  try {
    result = JSON.parse(readFileSync(path.join(resultsDir, folder, 'result.json'), 'utf8'));
  } catch {
    result = null;
  }
  return { folder, result };
}

/**
 * Why a scheduled run of the test in `dir` is skipped now: Turn Off on Failed
 * Test is true in its test-configuration.md and the newest finished run
 * failed. Null when the scheduled run goes ahead, which it always does without
 * a test-configuration.md, without a finished run, or after any other outcome.
 */
export function scheduledSkip(dir, testConfig = readTestConfigIn(dir)) {
  if (!testConfig?.settings?.turnOffOnFail) return null;
  const last = lastFinishedRun(path.join(dir, 'results'));
  if (last?.result?.outcome !== 'fail' || last.result.simulated) return null;
  const lastResult = `results/${last.folder}/result.json`;
  return {
    folder: `results/${last.folder}`,
    lastResult,
    reason: `The last run failed (${lastResult}), and Turn Off on Failed Test is true in ${TEST_CONFIG_FILE}. `
      + 'Fix the cause, then run auto-check run here; scheduled runs resume after a run that does not fail.',
  };
}

function newResultDir(resultsDir, label, now) {
  const stamp = fileTimestamp(now);
  let name = label ? `${stamp}-${label}` : stamp;
  for (let count = 2; existsSync(path.join(resultsDir, name)); count += 1) name = `${label ? `${stamp}-${label}` : stamp}-${count}`;
  const dir = path.join(resultsDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readState(dir) {
  const file = path.join(dir, 'state.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function switchToUpstream(configFile, raw) {
  const updated = { ...raw, source: { ...raw.source, mode: 'upstream', clonePath: 'repo', sparsePaths: null } };
  writeJson(configFile, updated);
  return updated.source;
}

/**
 * Gets the code under test ready. Upstream mode refreshes the managed clone to
 * the base tip. Local mode first reads the pull request again: once it has
 * landed the check switches to upstream mode for good; closed without landing
 * leaves nothing to test; still open, it rebuilds the rebased worktree.
 */
function prepareSource({ check, raw, dir, configFile, config, deps, notes }) {
  let source = check.source;
  if (source.mode === 'local') {
    const info = deps.readPr(check.pr.url);
    if (info.merged) {
      source = switchToUpstream(configFile, raw);
      notes.push(`The pull request has ${info.status === 'merged' ? 'merged' : 'landed'}, so the check now tests ${source.baseRef} at its tip instead of the local branch.`);
    } else if (info.status === 'closed') {
      return { closed: true };
    } else {
      const prepared = deps.prepareLocal({
        localRepo: source.localRepo,
        branch: source.branch,
        headRef: check.pr.head?.ref ?? null,
        baseRef: source.baseRef,
        upstreamRemote: config.repos.upstreamRemote,
        originRemote: config.repos.originRemote,
        worktreeDir: path.join(dir, source.clonePath ?? 'worktree'),
      });
      return { mode: 'local', dir: prepared.worktreeDir, sha: prepared.sha, upstreamSha: prepared.baseSha, conflict: prepared.conflict };
    }
  }
  const clone = deps.refreshClone({ dir: path.join(dir, source.clonePath ?? 'repo'), url: source.upstreamUrl, baseRef: source.baseRef, sparse: source.sparsePaths ?? null });
  return { mode: 'upstream', dir: clone.dir, sha: clone.sha, upstreamSha: clone.sha };
}

function syntheticResult({ outcome, startedAt, assertions = [], error = null }) {
  return { outcome, startedAt, finishedAt: new Date().toISOString(), phase: null, layers: {}, artifacts: [], assertions, notes: [], ...(error ? { error } : {}) };
}

function failingNames(result, compared) {
  const assertions = (result.assertions ?? []).filter((entry) => !entry.ok).map((entry) => `${entry.layer}: ${entry.name}`);
  const comparisons = (compared?.failures ?? []).map((entry) => `compare ${entry.artifact} ${entry.method}`);
  return [...assertions, ...comparisons];
}

/**
 * Runs one check the way the schedule does. A `scheduled` run first asks
 * scheduledSkip, and when the test is turned off after a failed run it returns
 * `skipped` without writing anything. Otherwise it takes the lock, prepares the code
 * under test, records the machine fingerprint, runs run.mjs with the check's
 * timeout, compares the captures with the baseline, writes
 * results/<timestamp>/result.json, updates state.json, deletes the run folders
 * past the number test-configuration.md keeps, decides whether to notify, and
 * hands everything to `afterRun`. Every step that reaches outside can be
 * replaced through `deps`.
 */
export async function runTest({
  testFolder,
  config,
  phase = null,
  simulateFail = null,
  noNotify = false,
  scheduled = false,
  env = process.env,
  now = () => new Date(),
  log = () => {},
  deps = {},
}) {
  const {
    readPr = (url) => intake(url),
    hostAppLock = acquireHostAppLock,
    refreshClone = refreshManagedClone,
    prepareLocal = prepareLocalWorktree,
    fingerprint = (subject) => collectFingerprint({ subject }),
    runCheckProcess = runProcess,
    pauseSchedule = null,
    afterRun = async () => ({ notified: false }),
  } = deps;
  const loaded = loadCheck(testFolder, config);
  const { dir, name, configFile, raw } = loaded;
  const workRoot = dir;
  const slug = name;
  const form = readFormIn(dir);
  if (form?.state === 'invalid') {
    throw new RunError(`${path.join(dir, 'context.md')} has problems, so this run would not know what to do:\n${
      form.problems.map((problem) => `  context.md:${problem.line}: ${problem.message}`).join('\n')}`);
  }
  const flags = form?.context.flags ?? {};
  const testConfig = readTestConfigIn(dir);
  if (testConfig.state === 'invalid') {
    throw new RunError(`${testConfig.file} has problems, so this run would not know what to do:\n${
      testConfig.problems.map((problem) => `  ${TEST_CONFIG_FILE}:${problem.line}: ${problem.message}`).join('\n')}`);
  }
  const check = { ...loaded.check, notify: notifyFor(loaded.check.notify, testConfig.settings) };
  const account = accountFor(testConfig.settings);
  for (const warning of testConfig.warnings) log(`${TEST_CONFIG_FILE}:${warning.line}: warning: ${warning.message}`);
  const checkEnv = withoutVariables(env, secretVariables({ testConfig, notify: check.notify }));
  const runMode = check.runMode ?? 'single';
  if (runMode === 'two-step' && !phase) throw new RunError(`${slug} runs in two steps. Run it with --phase start, then with --phase collect once the work is done.`);
  if (runMode !== 'two-step' && phase) throw new RunError(`${slug} runs in one step, so it takes no --phase.`);
  const skip = scheduled && phase !== 'collect' ? scheduledSkip(dir, testConfig) : null;
  if (skip) return { slug, skipped: true, outcome: 'skipped', exitCode: 0, reason: skip.reason, lastResult: skip.lastResult, record: null };
  installKit(dir);

  const release = acquireLock(dir);
  try {
    const startedAt = now();
    const simulated = Boolean(simulateFail);
    const state = readState(dir);
    const notes = [];
    const resultsDir = path.join(dir, 'results');
    const label = [phase, simulated ? 'simulated' : null].filter(Boolean).join('-');
    const outDir = newResultDir(resultsDir, label, startedAt);
    const resultFile = path.join(outDir, 'result.json');
    const timeoutMinutes = Number(check.timeoutMinutes) > 0 ? Number(check.timeoutMinutes) : 15;

    let source;
    if (phase === 'collect') {
      const pending = state.pendingCollect;
      if (!pending) throw new RunError(`${slug} has no started run to collect. Run it with --phase start first.`);
      source = { mode: check.source.mode, dir: path.join(dir, check.source.clonePath ?? 'repo'), sha: pending.sourceSha ?? pending.upstreamSha, upstreamSha: pending.upstreamSha };
    } else {
      log(check.source.mode === 'local' ? 'Preparing the rebased worktree of the branch' : `Refreshing ${check.source.baseRef} to its tip`);
      try {
        source = prepareSource({ check, raw, dir, configFile, config, deps: { readPr, refreshClone, prepareLocal }, notes });
      } catch (error) {
        source = { failed: error };
      }
    }

    log('Recording the machine fingerprint');
    let machine;
    try {
      machine = fingerprint(expandSubject(check.subject));
    } catch (error) {
      machine = { error: firstLine(error.message) };
    }
    let result;
    let compared = null;
    let exitCode = null;
    let timedOut = false;

    if (source.failed) {
      result = syntheticResult({ outcome: 'error', startedAt: startedAt.toISOString(), error: `The code under test could not be prepared: ${firstLine(source.failed.message)}` });
    } else if (source.closed) {
      result = syntheticResult({ outcome: 'error', startedAt: startedAt.toISOString(), error: 'The pull request was closed without landing, so there is nothing left to test. The schedule is paused.' });
      if (pauseSchedule) {
        try {
          await pauseSchedule(slug);
        } catch (error) {
          notes.push(`The schedule could not be paused: ${firstLine(error.message)}`);
        }
      }
    } else if (source.conflict) {
      result = syntheticResult({
        outcome: 'fail',
        startedAt: startedAt.toISOString(),
        assertions: [{ name: `the pull request still applies to ${check.source.baseRef}`, ok: false, detail: 'rebasing the branch onto the newest base conflicts', layer: 'source' }],
      });
    } else {
      log(`Running the check against ${source.sha.slice(0, 7)}`);
      const args = [path.join(dir, 'run.mjs'), '--out', outDir, '--source', source.dir];
      if (phase) args.push('--phase', phase);
      if (simulateFail) args.push('--simulate-fail', simulateFail);
      const drivesApp = Boolean(check.layers?.hostApp?.enabled);
      let releaseApp = () => {};
      if (drivesApp) {
        log('Waiting for the machine-wide lock on the desktop app');
        releaseApp = await hostAppLock({ env, timeoutMinutes, name });
      }
      let run;
      try {
        run = await runCheckProcess({ launcher: { file: process.execPath, args: [] }, args, cwd: dir, timeoutMs: timeoutMinutes * 60 * 1000, env: checkEnv });
      } finally {
        releaseApp();
      }
      exitCode = run.exitCode;
      timedOut = Boolean(run.timedOut);
      writeFileSync(path.join(outDir, 'run.log'), `${run.stdout ?? ''}${run.stderr ? `\n${run.stderr}` : ''}`);
      result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null;
      if (timedOut) {
        result = { ...(result ?? syntheticResult({ outcome: 'error', startedAt: startedAt.toISOString() })), outcome: 'error', error: `run.mjs did not finish within ${timeoutMinutes} minutes.` };
      } else if (!result) {
        const reason = run.error ? run.error.message : firstLine(run.stderr) || `exit code ${run.exitCode}`;
        result = syntheticResult({ outcome: 'error', startedAt: startedAt.toISOString(), error: `run.mjs wrote no result: ${reason}` });
      }
      if (phase !== 'start' && ['pass', 'fail', 'baseline'].includes(result.outcome)) {
        log('Comparing the captures with the baseline');
        try {
          compared = compareRun({ outDir, baselineDir: path.join(dir, 'baseline'), artifacts: result.artifacts, settings: check.compare ?? {}, layers: result.layers });
        } catch (error) {
          result = { ...result, outcome: 'error', error: `The comparison could not run: ${firstLine(error.message)}` };
        }
      }
    }

    const checkOutcome = result.outcome;
    let outcome = checkOutcome === 'baseline' ? 'pass' : checkOutcome;
    if (outcome === 'pass' && compared && !compared.ok) outcome = 'fail';
    if (!['pass', 'fail', 'error'].includes(outcome)) outcome = 'error';

    const failing = outcome === 'error' ? [`error: ${firstLine(result.error)}`] : failingNames(result, compared);
    const signature = outcome === 'pass' ? null : failureSignature({ failing, upstreamSha: source.upstreamSha ?? null, fingerprint: machine });
    const started = phase === 'start' && outcome === 'pass';
    const decision = started
      ? { reason: 'started', notify: false, runFeatures: false, repeat: false }
      : decideNotification({
        outcome,
        signature,
        state: simulated ? { lastFailureSignature: state.simulated?.lastSignature ?? null, lastErrorSignature: state.simulated?.lastErrorSignature ?? null } : state,
        notify: check.notify,
      });
    if (noNotify) decision.notify = false;

    const finishedAt = now().toISOString();
    const record = {
      ...result,
      outcome,
      checkOutcome,
      slug,
      phase,
      simulated,
      sourceMode: source.mode ?? check.source.mode,
      upstreamSha: source.upstreamSha ?? null,
      sourceSha: source.sha ?? null,
      fingerprint: machine,
      compare: compared,
      runner: { startedAt: startedAt.toISOString(), finishedAt, exitCode, timedOut },
      notes: [...(result.notes ?? []), ...notes.map((text) => ({ text, layer: 'runner' }))],
      failing,
      signature,
      notification: decision,
    };
    writeJson(resultFile, record);
    const resultDir = slash(path.relative(dir, outDir));

    if (!simulated) {
      let updated = readState(dir);
      if (started) {
        updated = { ...updated, pendingCollect: { at: finishedAt, resultDir, upstreamSha: record.upstreamSha, sourceSha: record.sourceSha } };
      } else {
        updated = nextState(updated, { outcome, at: finishedAt, upstreamSha: record.upstreamSha, fingerprint: machine, resultDir, signature });
        if (phase === 'collect') delete updated.pendingCollect;
      }
      writeJson(path.join(dir, 'state.json'), updated);
    }

    const { keep } = keepFor(testConfig, config);
    const pins = readState(dir);
    // A real pass closes the open failure, so the folder its report points to is no longer read.
    if (outcome === 'pass' && !simulated && !started) delete pins.openResolution;
    const removed = pruneResults(resultsDir, { keep, state: pins });

    const handled = (await afterRun({ workRoot: dir, slug, dir, check, config, flags, record, resultFile, state, decision, simulated, account, env })) ?? {};
    if (handled.statePatch || (handled.notified && !simulated)) {
      const updated = { ...readState(dir), ...(handled.statePatch ?? {}) };
      if (handled.notified && !simulated) updated.lastNotifiedAt = finishedAt;
      writeJson(path.join(dir, 'state.json'), updated);
    }
    if (handled.lines?.length > 0) writeJson(resultFile, { ...record, followUp: handled.lines });

    return {
      slug,
      outcome,
      exitCode: started ? 0 : RUN_EXIT[outcome],
      started,
      resultDir: outDir,
      resultFile,
      record,
      decision,
      handled,
      kept: keep,
      pruned: removed,
    };
  } finally {
    release();
  }
}

/** Plain-text summary of a run for the terminal and the schedule log. */
export function formatRun(run, { cwd = process.cwd() } = {}) {
  if (run.skipped) return `${run.slug}: skipped. ${run.reason}\n`;
  const { record } = run;
  const lines = [`${run.slug}: ${run.started ? 'started' : run.outcome}${record.simulated ? ' (simulated failure)' : ''}`];
  if (record.sourceSha) lines.push(`  code under test: ${record.sourceMode} ${record.sourceSha.slice(0, 7)}`);
  const assertions = record.assertions ?? [];
  if (assertions.length > 0) {
    const passed = assertions.filter((entry) => entry.ok).length;
    lines.push(`  assertions: ${passed} of ${assertions.length} pass`);
    for (const entry of assertions.filter((item) => !item.ok).slice(0, 5)) lines.push(`    failed ${entry.layer}: ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`);
  }
  if (record.compare) {
    const { compared, failures, strategy } = record.compare;
    lines.push(`  comparison (${strategy}): ${compared - failures.length} of ${compared} match the baseline`);
    for (const entry of failures.slice(0, 5)) lines.push(`    differs ${entry.artifact} ${entry.method}: ${entry.detail}`);
  }
  if (record.error) lines.push(`  error: ${firstLine(record.error)}`);
  for (const note of record.notes.filter((entry) => entry.layer === 'runner')) lines.push(`  note: ${note.text}`);
  lines.push(`  result: ${path.relative(cwd, run.resultFile) || run.resultFile}`);
  if (run.pruned?.length > 0) lines.push(`  kept: ${run.kept} run folder${run.kept === 1 ? '' : 's'}, removed ${run.pruned.join(', ')}`);
  if (run.handled?.message) lines.push(`  ${run.handled.message}`);
  return `${lines.join('\n')}\n`;
}
