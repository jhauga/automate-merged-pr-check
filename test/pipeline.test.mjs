import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { DRY_RUN_FILE } from '../lib/notify/index.mjs';
import { createPipeline } from '../lib/pipeline.mjs';
import { formatRun, runTest } from '../lib/runner.mjs';
import { newTestConfig } from '../lib/test-config.mjs';
import { runProcess } from '../lib/util/process.mjs';
import { dayFolder } from '../lib/util/date.mjs';
import { SLUG, fakes, makeTestFolder, readState, setMode } from './helpers/run-check.mjs';
import { writeForm } from './helpers/form.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-pipeline-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function settings() {
  const config = defaults();
  config.notify.dryRun = true;
  config.notify.email.enabled = true;
  config.notify.sms.enabled = true;
  return config;
}

test('a failure writes its report, notifies, and asks for a proposal once; a pass closes the report', async () => {
  const { root, dir } = await makeTestFolder(base, 'pipeline');
  writeForm(root, { findIssue: true, resolveIssue: true });
  const config = settings();
  const proposals = [];
  const propose = async ({ open }) => {
    proposals.push(open);
    writeFileSync(path.join(root, open.proposedSolution), 'proposed');
    return { proposedSolutionFile: path.join(root, open.proposedSolution) };
  };
  const afterRun = createPipeline({ deps: { propose } });
  const run = (options = {}) => runTest({ testFolder: root, config, deps: { ...fakes().deps, afterRun }, ...options });
  const day = `found-issue/${dayFolder(new Date())}`;
  const notifyFile = (result) => path.join(result.resultDir, DRY_RUN_FILE);

  const passed = await run();
  assert.equal(passed.outcome, 'pass');
  assert.equal(existsSync(notifyFile(passed)), false);

  setMode(dir, 'fail');
  const failed = await run();
  assert.equal(failed.outcome, 'fail');
  assert.deepEqual(failed.handled.lines, [
    `Failure report: ${day}/found-issue.md`,
    `Notification: dry run, email and sms written to ${path.relative(root, notifyFile(failed))}.`,
    `Proposed solution: proposed-solution/${dayFolder(new Date())}/proposed-solution.prompt.md`,
  ]);
  const report = readFileSync(path.join(root, day, 'found-issue.md'), 'utf8');
  assert.match(report, /^## Observed and expected\n\nAssertions that failed:\n\n- page: the greeting is printed\. Detail: goodbye$/m);
  assert.match(report, /No commit touched the watched paths since the last pass/);
  assert.match(report, /are the same as at the last pass\./);
  const sent = readFileSync(notifyFile(failed), 'utf8');
  assert.match(sent, /^email\nFrom: auto-check@example\.com\nTo: jane\.doe@example\.com\nSubject: auto-check: pipeline failed\n/);
  assert.match(sent, new RegExp(`Failure report: ${day}/found-issue\\.md`));
  assert.match(sent, /\nsms\n.*\n.*\nSubject: auto-check\n\nauto-check: pipeline failed: the greeting is printed\n/);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].foundIssue, `${day}/found-issue.md`);
  assert.equal(proposals[0].proposedSolution, `proposed-solution/${dayFolder(new Date())}/proposed-solution.prompt.md`);
  let state = readState(dir);
  assert.equal(state.openResolution.foundIssue, `${day}/found-issue.md`);
  assert.ok(state.lastNotifiedAt);
  assert.deepEqual(JSON.parse(readFileSync(failed.resultFile, 'utf8')).followUp, failed.handled.lines);

  const repeated = await run();
  assert.deepEqual(repeated.handled.lines, [`Failure report: unchanged, ${day}/found-issue.md`, 'Notification: already notified for this failure.']);
  assert.equal(existsSync(notifyFile(repeated)), false);
  assert.equal(proposals.length, 1);

  const simulated = await run({ simulateFail: 'black' });
  assert.deepEqual(simulated.handled.lines, [
    `Failure report: ${day}/found-issue-2.md`,
    `Notification: dry run, email and sms written to ${path.relative(root, notifyFile(simulated))}.`,
    'Proposed solution: not asked for a simulated failure. Run auto-check resolve with --propose to try it.',
  ]);
  assert.match(readFileSync(path.join(root, day, 'found-issue-2.md'), 'utf8'), /This failure was simulated with `--simulate-fail`/);
  assert.match(readFileSync(notifyFile(simulated), 'utf8'), /Subject: \[simulated\] auto-check: pipeline failed/);
  state = readState(dir);
  assert.equal(state.openResolution.foundIssue, `${day}/found-issue.md`);
  assert.equal(state.simulated.openResolution.foundIssue, `${day}/found-issue-2.md`);
  assert.equal(state.consecutiveFailures, 2);

  const simulatedAgain = await run({ simulateFail: 'black' });
  assert.deepEqual(simulatedAgain.handled.lines, [`Failure report: unchanged, ${day}/found-issue-2.md`, 'Notification: already notified for this failure.']);
  assert.equal(existsSync(notifyFile(simulatedAgain)), false);

  setMode(dir, 'pass');
  const recovered = await run();
  assert.equal(recovered.decision.reason, 'recover');
  assert.deepEqual(recovered.handled.lines, [
    `Notification: dry run, email and sms written to ${path.relative(root, notifyFile(recovered))}.`,
    `Failure report closed: ${day}/found-issue.md`,
  ]);
  assert.match(readFileSync(notifyFile(recovered), 'utf8'), /Subject: auto-check: pipeline passes again/);
  assert.equal(readState(dir).openResolution, null);
});

test('without notification channels, a failure with Find Issue on still writes its report', async () => {
  const { root, dir } = await makeTestFolder(base, 'quiet');
  writeForm(root, { findIssue: true });
  const afterRun = createPipeline({ deps: { propose: async () => { throw new Error('Resolve Issue is off'); } } });
  setMode(dir, 'fail');
  const result = await runTest({ testFolder: root, config: defaults(), deps: { ...fakes().deps, afterRun } });
  assert.deepEqual(result.handled.lines, [
    `Failure report: found-issue/${dayFolder(new Date())}/found-issue.md`,
    'Notification: none sent, no notification channel is enabled.',
  ]);
  assert.match(readFileSync(path.join(root, 'found-issue', dayFolder(new Date()), 'found-issue.md'), 'utf8'), /The check has not passed since it was written/);
});

test('a test\'s own account carries the notification, with its password read from the run\'s environment and written nowhere', async () => {
  const { root, dir } = await makeTestFolder(base, 'account');
  writeForm(root, { findIssue: true });
  writeFileSync(path.join(root, 'test-configuration.md'), newTestConfig()
    .replace('**Send Notifications**: false', '**Send Notifications**: true')
    .replace('**Notify when Test**: null', '**Notify when Test**: fail')
    .replace('**Email**: null', '**Email**: jane.doe@example.com')
    .replace('**Password**: null', '**Password**: %AUTO_CHECK_EMAIL_PASSWORD%'));
  const secret = 'correct-horse-battery-staple';
  const sends = [];
  const emailSender = ({ transport }) => ({ send: async (mail) => sends.push([mail.from, mail.to, transport.host, transport.auth]) });
  const afterRun = createPipeline({ deps: { notify: { emailSender }, propose: async () => { throw new Error('Resolve Issue is off'); } } });
  const config = defaults();
  config.notify.email.smtp.host = 'mail.example.com';
  setMode(dir, 'fail');
  const result = await runTest({ testFolder: root, config, env: { AUTO_CHECK_EMAIL_PASSWORD: secret }, deps: { ...fakes().deps, afterRun } });
  assert.ok(result.handled.lines.includes('Notification: sent by email.'), result.handled.lines.join('\n'));
  assert.deepEqual(sends, [['jane.doe@example.com', ['jane.doe@example.com'], 'mail.example.com', { user: 'jane.doe@example.com', pass: secret }]]);
  const written = [
    readFileSync(result.resultFile, 'utf8'),
    readFileSync(path.join(root, 'state.json'), 'utf8'),
    readFileSync(path.join(root, 'found-issue', dayFolder(new Date()), 'found-issue.md'), 'utf8'),
  ];
  for (const text of written) assert.ok(!text.includes(secret));
});

test('a password, written in the file or named by a variable, reaches no file, no output, and not run.mjs', async () => {
  const secret = 'correct-horse-battery-staple';
  for (const [label, password] of [['literal', secret], ['variable', '%AUTO_CHECK_EMAIL_PASSWORD%']]) {
    const { root, dir } = await makeTestFolder(base, `secret-${label}`);
    writeForm(root, { findIssue: true });
    writeFileSync(path.join(root, 'test-configuration.md'), newTestConfig()
      .replace('**Send Notifications**: false', '**Send Notifications**: true')
      .replace('**Notify when Test**: null', '**Notify when Test**: fail')
      .replace('**Email**: null', '**Email**: jane.doe@example.com')
      .replace(`**Password**: null`, `**Password**: ${password}`));
    const config = settings();
    let childEnv = null;
    const runCheckProcess = (options) => {
      childEnv = options.env;
      return runProcess(options);
    };
    const logs = [];
    const log = (line) => logs.push(line);
    const afterRun = createPipeline({ log, deps: { propose: async () => { throw new Error('Resolve Issue is off'); } } });
    const env = { ...process.env, AUTO_CHECK_SMTP_PASSWORD: 'placeholder-secret', ...(label === 'variable' ? { AUTO_CHECK_EMAIL_PASSWORD: secret } : {}) };
    setMode(dir, 'fail');
    const result = await runTest({ testFolder: root, config, env, log, deps: { ...fakes({ runCheckProcess }).deps, afterRun } });
    assert.equal(result.outcome, 'fail');
    assert.ok(existsSync(path.join(result.resultDir, DRY_RUN_FILE)), label);
    assert.equal(childEnv.AUTO_CHECK_EMAIL_PASSWORD, undefined, label);
    assert.equal(childEnv.AUTO_CHECK_SMTP_PASSWORD, undefined, label);
    assert.ok(Object.keys(childEnv).some((key) => key.toUpperCase() === 'PATH'), label);
    const warned = logs.some((line) => /^test-configuration\.md:15: warning: Password holds the password itself\./.test(line));
    assert.equal(warned, label === 'literal');

    const files = ['results', 'found-issue']
      .flatMap((folder) => readdirSync(path.join(root, folder), { recursive: true }).map((name) => path.join(root, folder, name)))
      .filter((file) => statSync(file).isFile() && /\.(json|md|txt|log)$/.test(file));
    files.push(path.join(root, 'state.json'));
    assert.ok(files.some((file) => file.endsWith(DRY_RUN_FILE)));
    for (const file of files) assert.ok(!readFileSync(file, 'utf8').includes(secret), `${label}: ${file}`);
    assert.ok(!`${formatRun(result, { cwd: root })}${logs.join('\n')}`.includes(secret), label);
  }
});

test('with the chain on, a proposal is followed by the fix branch and the pull request text', async () => {
  const { root, dir } = await makeTestFolder(base, 'resolve-chain');
  writeForm(root, { findIssue: true, resolveIssue: true, commitSolution: true, localCommit: true, remotePush: true, makePr: true });
  const config = settings();
  config.notify.email.enabled = false;
  config.notify.sms.enabled = false;
  const calls = [];
  const afterRun = createPipeline({
    deps: {
      propose: async ({ open }) => ({ proposedSolutionFile: path.join(root, open.proposedSolution) }),
      resolveIssue: async ({ open, push }) => {
        calls.push(['issue', push]);
        return { branch: 'resolve-issue-demo-app', commit: 'c0ffee0123456789', pushed: push, open: { ...open, branch: 'resolve-issue-demo-app', commit: 'c0ffee0123456789' } };
      },
      resolvePr: async ({ open }) => {
        calls.push(['pr', open.branch]);
        return { prUrl: null, pullRequestFile: path.join(root, 'proposed-solution', open.day, 'resolve', 'pull-request.md'), open: { ...open, issue: null } };
      },
    },
  });
  setMode(dir, 'fail');
  const result = await runTest({ testFolder: root, config, deps: { ...fakes().deps, afterRun } });
  const day = dayFolder(new Date());
  assert.deepEqual(result.handled.lines.slice(-3), [
    `Proposed solution: proposed-solution/${day}/proposed-solution.prompt.md`,
    'Fix branch: resolve-issue-demo-app at c0ffee0, pushed to origin',
    `Pull request: written to proposed-solution/${day}/resolve/pull-request.md`,
  ]);
  assert.deepEqual(calls, [['issue', true], ['pr', 'resolve-issue-demo-app']]);
  assert.equal(readState(dir).openResolution.branch, 'resolve-issue-demo-app');
});
