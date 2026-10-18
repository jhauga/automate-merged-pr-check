import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { collectRows, compareVersions, exitCodeFor, formatRows, runDoctor } from '../lib/doctor.mjs';
import { codeRoot } from '../lib/paths.mjs';
import { assistantState } from '../lib/setup.mjs';

const ON_PATH = { git: 'git', gh: 'gh', claude: 'claude', copilot: 'copilot', schtasks: 'schtasks' };

function fakeProbe(overrides = {}) {
  return {
    nodeVersion: '24.1.0',
    platform: 'win32',
    which: (command) => ON_PATH[command] ?? null,
    run: (file, args) => ({ status: 0, stdout: `${file} ${args.join(' ')} 1.0.0\n`, stderr: '' }),
    findEdge: () => ({ path: 'msedge', version: '140.0.0.0' }),
    sendEmail: () => ({ installed: true, linked: false, version: '1.0.0' }),
    skills: () => ['auto-check-context', 'auto-check-write-check'],
    assistant: (name, probe) => assistantState(name, probe),
    effortLevels: (name) => (name === 'claude' ? ['low', 'high', 'max'] : []),
    cachedModels: () => [],
    tasks: () => [],
    ...overrides,
  };
}

function rows(options = {}) {
  return collectRows({
    workRoot: 'demo',
    cwd: 'demo',
    config: defaults(),
    version: '1.0.0-alpha.0.0.0',
    env: {},
    probe: fakeProbe(),
    ...options,
  });
}

const row = (all, name) => all.find((entry) => entry.name === name);

test('versions compare numerically', () => {
  assert.equal(compareVersions('20.19.0', '20.9.0'), 1);
  assert.equal(compareVersions('20.19', '20.19.0'), 0);
  assert.equal(compareVersions('18.20.4', '20.19.0'), -1);
});

test('a missing inactive assistant is reported without failing', () => {
  const report = rows();
  assert.equal(row(report, 'claude').status, 'ok');
  assert.match(row(report, 'claude').detail, /; effort low, high, max$/);
  assert.match(row(report, 'claude').detail, /active assistant/);
  assert.equal(row(report, 'copilot').status, 'ok');
  assert.equal(row(report, 'codex').status, 'missing');
  assert.equal(exitCodeFor(report), 0);
});

test('a missing active assistant fails', () => {
  const config = { ...defaults(), assistant: 'codex' };
  const report = rows({ config });
  assert.equal(row(report, 'codex').status, 'fail');
  assert.equal(exitCodeFor(report), 1);
});

test('an old Node, a signed-out gh, or a linked send-email fails', () => {
  assert.equal(row(rows({ probe: fakeProbe({ nodeVersion: '18.20.4' }) }), 'node').status, 'fail');
  const signedOut = fakeProbe({ run: (file, args) => ({ status: args[0] === 'auth' ? 1 : 0, stdout: 'gh 1.0.0\n', stderr: '' }) });
  assert.match(row(rows({ probe: signedOut }), 'gh').detail, /not authenticated/);
  const linked = fakeProbe({ sendEmail: () => ({ installed: true, linked: true, version: '1.0.0' }) });
  assert.equal(row(rows({ probe: linked }), 'send-email').status, 'fail');
  const missing = fakeProbe({ sendEmail: () => ({ installed: false }) });
  assert.match(row(rows({ probe: missing }), 'send-email').detail, /run npm install/);
});

test('Claude Code that is not signed in fails while it is the active assistant', () => {
  const status = (loggedIn) => fakeProbe({
    run: (file, args) => ({ status: 0, stdout: args[0] === 'auth' ? JSON.stringify({ loggedIn }) : `${file} 1.0.0\n`, stderr: '' }),
  });
  const signedOut = row(rows({ probe: status(false) }), 'claude');
  assert.equal(signedOut.status, 'fail');
  assert.match(signedOut.detail, /not signed in; run claude auth login, or claude setup-token for scheduled runs; effort /);
  assert.equal(row(rows({ probe: status(false), config: { ...defaults(), assistant: 'copilot' } }), 'claude').status, 'warn');
  assert.match(row(rows({ probe: status(true) }), 'claude').detail, /, signed in; effort /);
});

test('secret values never reach the report', () => {
  const env = { AUTO_CHECK_SMTP_PASSWORD: 'placeholder-secret' };
  let output = '';
  runDoctor({
    workRoot: 'demo',
    cwd: 'demo',
    config: defaults(),
    version: '1.0.0-alpha.0.0.0',
    probe: fakeProbe(),
    io: { env, stdout: { write: (text) => { output += text; } } },
  });
  assert.doesNotMatch(output, /placeholder-secret/);
  assert.match(output, /AUTO_CHECK_SMTP_PASSWORD set, AUTO_CHECK_WEBHOOK_SECRET unset/);
});

test('an enabled channel without its secret is a warning', () => {
  const config = defaults();
  config.notify.email.enabled = true;
  assert.equal(row(rows({ config }), 'env').status, 'warn');
});

test('an assistant row lists the models already probed', () => {
  const probe = fakeProbe({
    cachedModels: () => [{ version: '2.1.261', candidates: ['claude-opus-5-5', 'opus'], model: 'opus', accepted: 'alias' }],
  });
  assert.match(row(rows({ probe }), 'claude').detail, /; probed claude-opus-5-5 runs as opus$/);
});

test('the assistant row names the active models and permission mode', () => {
  assert.equal(
    row(rows(), 'assistant').detail,
    'claude: generate opus, analyze opus, test driver haiku; permissions bypass',
  );
  const config = { ...defaults(), assistant: 'copilot' };
  assert.match(row(rows({ config }), 'assistant').detail, /test driver auto \(efficiency tier\); permissions allow-all-tools$/);
});

test('the skills row lists the skills auto-check copies into each test folder', () => {
  assert.equal(row(rows(), 'skills').detail, '2 in skills/, copied into each test folder: auto-check-context, auto-check-write-check');
  const none = row(rows({ probe: fakeProbe({ skills: () => [] }) }), 'skills');
  assert.equal(none.status, 'fail');
  assert.match(none.detail, /^no auto-check skills in /);
});

test('the install, settings, root, and test folder rows say where everything lives', () => {
  const report = rows({ env: { AUTO_CHECK_CONFIG_DIR: path.join('demo', 'settings') } });
  assert.match(row(report, 'install').detail, /^auto-check 1\.0\.0-alpha\.0\.0\.0 in /);
  assert.equal(
    row(report, 'settings').detail,
    `${path.resolve('demo', 'settings', 'config.json')} (not written yet; defaults are in use)`,
  );
  assert.equal(row(report, 'root').status, 'warn');
  assert.match(row(report, 'root').detail, /^not set; auto-check asks for one/);
  assert.equal(row(report, 'test folder').detail, 'demo');
  const missing = rows({ config: { ...defaults(), root: path.join('demo', 'no-such-root') }, workRoot: null, cwd: 'elsewhere' });
  assert.equal(row(missing, 'root').status, 'fail');
  assert.match(row(missing, 'root').detail, /does not exist$/);
  assert.equal(row(missing, 'test folder').detail, 'no context.md in elsewhere or any folder above it');
  const broken = rows({ configProblem: { message: 'config.json has a problem:', problems: ['/assistant: is not a known setting'] } });
  assert.equal(row(broken, 'settings').status, 'fail');
  assert.match(row(broken, 'settings').detail, /\/assistant: is not a known setting$/);
});

test('the report lines up names and statuses', () => {
  const text = formatRows([
    { name: 'node', status: 'ok', detail: 'v24.1.0' },
    { name: 'send-email', status: 'fail', detail: 'not installed' },
  ]);
  assert.equal(text, 'auto-check doctor\n\n  node        ok       v24.1.0\n  send-email  fail     not installed\n');
});

test('the tasks row lists the scheduled checks and warns about one whose folder is gone', () => {
  assert.equal(row(rows(), 'tasks').detail, 'no auto-check task is installed');

  const folder = path.join(codeRoot, 'test');
  const good = {
    name: 'auto-check automate-pr-sample-canvas',
    nextRun: new Date(2026, 0, 2, 3, 30, 0),
    command: path.join(folder, 'schedule', 'run.cmd'),
  };
  const gone = { name: 'auto-check automate-pr-gone', nextRun: null, command: path.join(folder, 'no-such', 'schedule', 'run.cmd') };

  const kept = row(rows({ probe: fakeProbe({ tasks: () => [good] }) }), 'tasks');
  assert.equal(kept.status, 'warn');
  assert.match(kept.detail, /^1 installed: auto-check automate-pr-sample-canvas at 03:30; /);

  const broken = row(rows({ probe: fakeProbe({ tasks: () => [good, gone] }) }), 'tasks');
  assert.equal(broken.status, 'warn');
  assert.match(broken.detail, /"auto-check automate-pr-gone" no longer points at a test folder/);
  assert.match(broken.detail, /schtasks \/Delete \/TN <name>/);
});
