import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { describeProblems, outboundProblems } from '../lib/outbound.mjs';
import { TEST_CONFIG_FILE } from '../lib/paths.mjs';
import {
  TEST_CONFIG_DEFAULTS,
  TEST_CONFIG_TEMPLATE,
  accountFor,
  accountValues,
  describeSecret,
  describeTestConfig,
  isVariableReference,
  newTestConfig,
  notifyFor,
  parseTestConfig,
  readTestConfigIn,
  secretVariables,
  validateTestConfig,
  variableName,
  writeTestConfigIfMissing,
} from '../lib/test-config.mjs';

const DEFAULT = [
  '# Test Configuration',
  '',
  '## Scheduled Test',
  '',
  '- **Turn Off on Failed Test**: true',
  '- **Keep Prior Results**: true',
  '  - **Number of Test**: 7',
  '',
  '## Send Notifications',
  '',
  '- **Send Notifications**: false',
  '  - **Notify when Test**: null',
  '  - **Account Configuration**:',
  '    - **Email**: null',
  '    - **Password**: null',
  '',
].join('\n');

/** The default file with some values replaced, by label. */
function withValues(values) {
  let text = DEFAULT;
  for (const [label, value] of Object.entries(values)) {
    text = text.replace(new RegExp(`(\\*\\*${label}\\*\\*:) .*`), `$1 ${value}`);
  }
  return text;
}

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-test-config-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test('a new test folder starts with the defaults, written from the template without its comments', () => {
  assert.equal(newTestConfig(), DEFAULT);
  assert.match(readFileSync(TEST_CONFIG_TEMPLATE, 'utf8'), /<!-- true or false\. If true, a scheduled run first reads result\.json/);
  const parsed = parseTestConfig(DEFAULT);
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(parsed.settings, TEST_CONFIG_DEFAULTS);
  assert.deepEqual(parsed.warnings, []);
});

test('the template parses to the defaults, since its fields hold only comments', () => {
  const parsed = parseTestConfig(readFileSync(TEST_CONFIG_TEMPLATE, 'utf8'));
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(parsed.settings, TEST_CONFIG_DEFAULTS);
});

test('every value is read, labels and booleans without regard to case', () => {
  const parsed = parseTestConfig(withValues({
    'Turn Off on Failed Test': 'FALSE',
    'Keep Prior Results': 'True',
    'Number of Test': '3',
    'Send Notifications': 'true',
    'Notify when Test': 'Both',
    Email: 'jane.doe@example.com',
    Password: '%AUTO_CHECK_EMAIL_PASSWORD%',
  }).replace('**Keep Prior Results**', '**keep prior results**'));
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(parsed.settings, {
    turnOffOnFail: false,
    keepPrior: true,
    keepCount: 3,
    notify: true,
    notifyWhen: 'both',
    email: 'jane.doe@example.com',
    password: '%AUTO_CHECK_EMAIL_PASSWORD%',
  });
  assert.deepEqual(parsed.warnings, []);
});

test('Number of Tests is read as Number of Test', () => {
  const parsed = parseTestConfig(DEFAULT.replace('**Number of Test**: 7', '**Number of Tests**: 2'));
  assert.equal(parsed.settings.keepCount, 2);
});

test('each problem names its line', () => {
  const parsed = parseTestConfig(withValues({
    'Turn Off on Failed Test': 'maybe',
    'Number of Test': '0',
    'Send Notifications': 'true',
    'Notify when Test': 'sometimes',
    Email: 'not an address',
  }));
  assert.equal(parsed.state, 'invalid');
  assert.deepEqual(parsed.problems.map(({ line, message }) => [line, message]), [
    [5, 'Turn Off on Failed Test takes true or false, not "maybe".'],
    [7, 'Number of Test takes a whole number, 1 or more, not "0".'],
    [12, 'Notify when Test takes pass, fail, or both, not "sometimes".'],
    [14, 'Email takes an address or an environment variable such as %AUTO_CHECK_EMAIL%, not "not an address".'],
    [15, 'Password is needed when Email is set: name the environment variable that holds it, such as %AUTO_CHECK_EMAIL_PASSWORD%.'],
  ]);
  const twice = parseTestConfig(`${DEFAULT}- **Keep Prior Results**: false\n`);
  assert.deepEqual(twice.problems.map(({ line, message }) => [line, message]), [[16, 'Keep Prior Results appears twice. Keep one line for it.']]);
  assert.equal(parseTestConfig(`${DEFAULT}- **Keep Results**: true\n`).warnings[0].line, 16);
});

test('a field its parent turns off is not checked', () => {
  const parsed = parseTestConfig(withValues({ 'Keep Prior Results': 'false', 'Number of Test': 'many', 'Notify when Test': 'sometimes', Email: 'nobody' }));
  assert.equal(parsed.state, 'valid');
  assert.equal(parsed.settings.keepPrior, false);
  assert.equal(parsed.settings.keepCount, 7);
  assert.equal(parsed.settings.notifyWhen, null);
});

test('sending needs an outcome, and an account email needs a password', () => {
  const noWhen = parseTestConfig(withValues({ 'Send Notifications': 'true' }));
  assert.deepEqual(noWhen.problems.map(({ line, message }) => [line, message]), [
    [12, 'Notify when Test is needed when Send Notifications is true: pass, fail, or both.'],
  ]);
  const noPassword = parseTestConfig(withValues({ 'Send Notifications': 'true', 'Notify when Test': 'fail', Email: '$AUTO_CHECK_EMAIL' }));
  assert.deepEqual(noPassword.problems.map(({ line, message }) => [line, message]), [
    [15, 'Password is needed when Email is set: name the environment variable that holds it, such as %AUTO_CHECK_EMAIL_PASSWORD%.'],
  ]);
  const settingsChannels = parseTestConfig(withValues({ 'Send Notifications': 'true', 'Notify when Test': 'pass' }));
  assert.equal(settingsChannels.state, 'valid');
  assert.equal(settingsChannels.settings.email, null);
});

test('a password written into the file is a warning that never repeats it', () => {
  const secret = 'correct-horse-battery-staple';
  const parsed = parseTestConfig(withValues({ 'Send Notifications': 'true', 'Notify when Test': 'fail', Email: 'jane.doe@example.com', Password: secret }));
  assert.equal(parsed.state, 'valid');
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].line, 15);
  assert.match(parsed.warnings[0].message, /^Password holds the password itself\./);
  const report = validateTestConfig(parsed, { env: {} });
  assert.ok(!JSON.stringify({ warnings: parsed.warnings, problems: parsed.problems, rows: report.rows }).includes(secret));
  assert.deepEqual(report.rows.find((row) => row.name === 'Password'), {
    name: 'Password',
    status: 'pass',
    detail: 'written in the file (move it to an environment variable)',
  });
});

test('a variable reference is %NAME%, $NAME, or ${NAME}, and is shown with whether it is set', () => {
  assert.equal(variableName('%AUTO_CHECK_EMAIL_PASSWORD%'), 'AUTO_CHECK_EMAIL_PASSWORD');
  assert.equal(variableName('$AUTO_CHECK_EMAIL_PASSWORD'), 'AUTO_CHECK_EMAIL_PASSWORD');
  assert.equal(variableName('${AUTO_CHECK_EMAIL_PASSWORD}'), 'AUTO_CHECK_EMAIL_PASSWORD');
  assert.equal(variableName(' %_varName% '), '_varName');
  assert.equal(isVariableReference('pa$$word'), false);
  assert.equal(isVariableReference('%NOT CLOSED'), false);
  assert.equal(describeSecret('%AUTO_CHECK_EMAIL_PASSWORD%', { AUTO_CHECK_EMAIL_PASSWORD: 'x' }), 'from AUTO_CHECK_EMAIL_PASSWORD (set)');
  assert.equal(describeSecret('$AUTO_CHECK_EMAIL_PASSWORD', {}), 'from AUTO_CHECK_EMAIL_PASSWORD (unset)');
  assert.equal(describeSecret(null, {}), 'none');
});

test('the description says what is kept, when scheduled runs run, and who is notified', () => {
  assert.deepEqual(describeTestConfig(TEST_CONFIG_DEFAULTS, {}), {
    schedule: 'skipped after a failed run',
    keep: '7 run folders',
    notifications: 'off',
    password: null,
  });
  const sending = { ...TEST_CONFIG_DEFAULTS, turnOffOnFail: false, keepPrior: false, notify: true, notifyWhen: 'both', email: '%AUTO_CHECK_EMAIL%', password: '%AUTO_CHECK_EMAIL_PASSWORD%' };
  assert.deepEqual(describeTestConfig(sending, { AUTO_CHECK_EMAIL: 'jane.doe@example.com' }), {
    schedule: 'run every time',
    keep: 'the newest run folder only',
    notifications: 'on pass and fail, by email as from AUTO_CHECK_EMAIL (set)',
    password: 'from AUTO_CHECK_EMAIL_PASSWORD (unset)',
  });
  assert.equal(describeTestConfig({ ...TEST_CONFIG_DEFAULTS, keepCount: 1 }).keep, '1 run folder');
  assert.equal(describeTestConfig({ ...TEST_CONFIG_DEFAULTS, notify: true, notifyWhen: 'fail' }).notifications, "on fail, through the settings' channels");
});

test('Send Notifications and Notify when Test decide which outcomes notify, and the account is passed on unread', () => {
  const notify = { ...defaults().notify, onFail: true, onError: true, onPass: true, onRecover: true };
  const switches = (settings) => {
    const { onFail, onError, onPass, onRecover } = notifyFor(notify, settings);
    return [onFail, onError, onPass, onRecover];
  };
  assert.deepEqual(switches(TEST_CONFIG_DEFAULTS), [false, false, false, false]);
  assert.deepEqual(switches({ ...TEST_CONFIG_DEFAULTS, notify: true, notifyWhen: 'fail' }), [true, true, false, false]);
  assert.deepEqual(switches({ ...TEST_CONFIG_DEFAULTS, notify: true, notifyWhen: 'pass' }), [false, false, true, true]);
  assert.deepEqual(switches({ ...TEST_CONFIG_DEFAULTS, notify: true, notifyWhen: 'both' }), [true, true, true, true]);
  assert.equal(notifyFor(notify, null), notify);
  assert.deepEqual(notifyFor(notify, TEST_CONFIG_DEFAULTS).email, notify.email);

  assert.equal(accountFor(TEST_CONFIG_DEFAULTS), null);
  assert.equal(accountFor({ ...TEST_CONFIG_DEFAULTS, notify: true, notifyWhen: 'fail' }), null);
  assert.equal(accountFor({ ...TEST_CONFIG_DEFAULTS, email: 'jane.doe@example.com', password: '%P%' }), null);
  assert.deepEqual(accountFor({ ...TEST_CONFIG_DEFAULTS, notify: true, notifyWhen: 'fail', email: 'jane.doe@example.com', password: '%AUTO_CHECK_EMAIL_PASSWORD%' }), {
    email: 'jane.doe@example.com',
    password: '%AUTO_CHECK_EMAIL_PASSWORD%',
  });
  assert.equal(accountFor(null), null);
});

test('the secret variables are the ones the file names and the settings\' own, whether or not the test sends', () => {
  const quiet = parseTestConfig(withValues({ Email: '%AUTO_CHECK_EMAIL%', Password: '$AUTO_CHECK_EMAIL_PASSWORD' }));
  assert.equal(quiet.settings.notify, false);
  assert.deepEqual(secretVariables({ testConfig: quiet, notify: defaults().notify }), [
    'AUTO_CHECK_EMAIL',
    'AUTO_CHECK_EMAIL_PASSWORD',
    'AUTO_CHECK_SMTP_PASSWORD',
    'AUTO_CHECK_WEBHOOK_SECRET',
  ]);
  assert.deepEqual(secretVariables({ testConfig: parseTestConfig(DEFAULT) }), []);
  assert.deepEqual(secretVariables(), []);
});

test('the account values the outbound scan refuses: the address named, the password never shown', () => {
  const secret = 'correct-horse-battery-staple';
  const literal = parseTestConfig(withValues({ 'Send Notifications': 'true', 'Notify when Test': 'fail', Email: 'jane.doe@example.com', Password: secret }));
  assert.deepEqual(accountValues(literal, {}), { names: ['jane.doe@example.com'], secrets: [secret] });
  const referenced = parseTestConfig(withValues({ Email: '%AUTO_CHECK_EMAIL%', Password: '%AUTO_CHECK_EMAIL_PASSWORD%' }));
  assert.deepEqual(accountValues(referenced, { AUTO_CHECK_EMAIL: 'jane.doe@example.com', AUTO_CHECK_EMAIL_PASSWORD: secret }), { names: ['jane.doe@example.com'], secrets: [secret] });
  assert.deepEqual(accountValues(referenced, {}), { names: [], secrets: [] });
  assert.deepEqual(accountValues(parseTestConfig(DEFAULT), {}), { names: [], secrets: [] });

  const { names, secrets } = accountValues(literal, {});
  const problems = outboundProblems(`Fix the canvas size\n\nReported by jane.doe@example.com with ${secret}.`, { names, secrets });
  assert.deepEqual(problems.map(({ kind }) => kind), ['local name', 'a password from test-configuration.md']);
  const described = describeProblems('commit-message.txt', problems);
  assert.deepEqual(described, ['commit-message.txt:3: local name "jane.doe@example.com"', 'commit-message.txt:3: a password from test-configuration.md']);
  assert.ok(!described.join('\n').includes(secret));
});

test('validation marks the row a problem belongs to', () => {
  const report = validateTestConfig(parseTestConfig(withValues({ 'Number of Test': 'seven' })), { env: {} });
  assert.equal(report.ok, false);
  assert.deepEqual(report.rows.map(({ name, status }) => [name, status]), [
    ['Scheduled runs', 'pass'],
    ['Results kept', 'fail'],
    ['Notifications', 'pass'],
  ]);
  assert.equal(report.rows[1].detail, 'Number of Test takes a whole number, 1 or more, not "seven".');
});

test('a folder without the file reads as missing, and the default is written only when it is missing', () => {
  const dir = mkdtempSync(path.join(base, 'folder-'));
  assert.equal(readTestConfigIn(dir).state, 'missing');
  assert.equal(writeTestConfigIfMissing(dir), true);
  assert.equal(readFileSync(path.join(dir, TEST_CONFIG_FILE), 'utf8'), DEFAULT);
  assert.equal(readTestConfigIn(dir).state, 'valid');
  writeFileSync(path.join(dir, TEST_CONFIG_FILE), withValues({ 'Number of Test': '2' }));
  assert.equal(writeTestConfigIfMissing(dir), false);
  assert.equal(readTestConfigIn(dir).settings.keepCount, 2);
});
