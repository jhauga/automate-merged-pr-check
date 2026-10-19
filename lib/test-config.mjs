import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEST_CONFIG_FILE, codeRoot } from './paths.mjs';
import { readVariable } from './util/env.mjs';
import { normalizeText, withoutComments } from './util/form-text.mjs';

/** The test configuration as it ships, with a comment that explains each field. */
export const TEST_CONFIG_TEMPLATE = path.join(codeRoot, 'templates', TEST_CONFIG_FILE);

/** Outcomes Notify when Test takes. */
export const NOTIFY_WHEN = Object.freeze(['pass', 'fail', 'both']);

/**
 * Every field of the test configuration: its key, its label, the labels it is
 * also read under, what it takes, and the text a new test folder starts with.
 */
export const TEST_CONFIG_FIELDS = Object.freeze([
  { key: 'turnOffOnFail', label: 'Turn Off on Failed Test', type: 'boolean', initial: 'true' },
  { key: 'keepPrior', label: 'Keep Prior Results', type: 'boolean', initial: 'true' },
  { key: 'keepCount', label: 'Number of Test', aliases: ['Number of Tests'], type: 'count', initial: '7' },
  { key: 'notify', label: 'Send Notifications', type: 'boolean', initial: 'false' },
  { key: 'notifyWhen', label: 'Notify when Test', type: 'choice', initial: 'null' },
  { key: 'account', label: 'Account Configuration', type: 'group' },
  { key: 'email', label: 'Email', type: 'address', initial: 'null' },
  { key: 'password', label: 'Password', type: 'secret', initial: 'null' },
]);

/** What each setting means when the file leaves it empty or null. */
export const TEST_CONFIG_DEFAULTS = Object.freeze({
  turnOffOnFail: true,
  keepPrior: true,
  keepCount: 7,
  notify: false,
  notifyWhen: null,
  email: null,
  password: null,
});

const BY_LABEL = new Map(TEST_CONFIG_FIELDS.flatMap((field) => [field.label, ...(field.aliases ?? [])].map((label) => [label.toLowerCase(), field])));
const BULLET = /^\s*[-*]\s+(\*{0,2})([^:*]+?)\1:[ \t]*(.*)$/;
const REFERENCE = /^(?:%([A-Za-z_][A-Za-z0-9_]*)%|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*))$/;
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const label = (key) => TEST_CONFIG_FIELDS.find((field) => field.key === key).label;
const isEmpty = (value) => value === '' || /^null$/i.test(value);

/** The variable a value names as %NAME%, $NAME, or ${NAME}, or null when it names none. */
export function variableName(value) {
  const match = REFERENCE.exec(String(value ?? '').trim());
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

/** True when a value names an environment variable instead of holding the value itself. */
export function isVariableReference(value) {
  return variableName(value) !== null;
}

/**
 * Parses the test configuration. Every value keeps the line it came from, so a
 * problem can name it. Comments are hints and are ignored. A field the
 * settings make irrelevant, such as Number of Test when Keep Prior Results is
 * false, is not checked. A password written into the file is a warning that
 * never repeats the password.
 */
export function parseTestConfig(text) {
  const clean = withoutComments(normalizeText(text).split('\n'));
  const fields = {};
  const problems = [];
  const warnings = [];
  const problem = (key, message, line = fields[key].line) => problems.push({ key, line, message });

  clean.forEach((line, index) => {
    const bullet = BULLET.exec(line);
    if (!bullet) return;
    const name = bullet[2].trim();
    const field = BY_LABEL.get(name.toLowerCase());
    if (!field) {
      if (bullet[1] === '**') warnings.push({ line: index + 1, message: `"${name}" is not a field of this file. Check the spelling, or delete the line.` });
      return;
    }
    if (fields[field.key]) {
      problem(field.key, `${field.label} appears twice. Keep one line for it.`, index + 1);
      return;
    }
    fields[field.key] = { value: bullet[3].trim(), line: index + 1 };
  });

  const settings = { ...TEST_CONFIG_DEFAULTS };
  const unreadable = new Set();
  const given = (key) => fields[key] && !isEmpty(fields[key].value);
  for (const key of ['turnOffOnFail', 'keepPrior', 'notify']) {
    if (!given(key)) continue;
    const value = fields[key].value;
    if (/^true$/i.test(value)) settings[key] = true;
    else if (/^false$/i.test(value)) settings[key] = false;
    else {
      unreadable.add(key);
      problem(key, `${label(key)} takes true or false, not "${value}".`);
    }
  }

  if (settings.keepPrior && !unreadable.has('keepPrior') && given('keepCount')) {
    const value = fields.keepCount.value;
    if (/^\d+$/.test(value) && Number(value) >= 1) settings.keepCount = Number(value);
    else problem('keepCount', `${label('keepCount')} takes a whole number, 1 or more, not "${value}".`);
  }

  if (settings.notify) {
    if (!given('notifyWhen')) {
      problem('notifyWhen', `${label('notifyWhen')} is needed when Send Notifications is true: pass, fail, or both.`, fields.notifyWhen?.line ?? fields.notify.line);
    } else if (NOTIFY_WHEN.includes(fields.notifyWhen.value.toLowerCase())) {
      settings.notifyWhen = fields.notifyWhen.value.toLowerCase();
    } else {
      problem('notifyWhen', `${label('notifyWhen')} takes pass, fail, or both, not "${fields.notifyWhen.value}".`);
    }

    if (given('email')) {
      const value = fields.email.value;
      if (isVariableReference(value) || ADDRESS.test(value)) settings.email = value;
      else problem('email', `Email takes an address or an environment variable such as %AUTO_CHECK_EMAIL%, not "${value}".`);
    }
    if (given('email')) {
      if (!given('password')) {
        problem('password', 'Password is needed when Email is set: name the environment variable that holds it, such as %AUTO_CHECK_EMAIL_PASSWORD%.', fields.password?.line ?? fields.email.line);
      } else {
        settings.password = fields.password.value;
        if (!isVariableReference(settings.password)) {
          warnings.push({
            line: fields.password.line,
            message: "Password holds the password itself. Put it in an environment variable, for example in this folder's .env, and write its name here, such as %AUTO_CHECK_EMAIL_PASSWORD%.",
          });
        }
      }
    }
  }

  return {
    state: problems.length > 0 ? 'invalid' : 'valid',
    fields,
    settings,
    problems: problems.sort((a, b) => a.line - b.line),
    warnings: warnings.sort((a, b) => a.line - b.line),
  };
}

/** Reads and parses the test configuration of a test folder, fresh on every call. */
export function readTestConfigIn(dir) {
  const file = path.join(dir, TEST_CONFIG_FILE);
  if (!existsSync(file)) return { state: 'missing', file, fields: {}, settings: null, problems: [], warnings: [] };
  return { file, ...parseTestConfig(readFileSync(file, 'utf8')) };
}

/** The test configuration a new test folder starts with: the template's fields with their first values, and no comments. */
export function newTestConfig({ template = TEST_CONFIG_TEMPLATE } = {}) {
  const lines = normalizeText(readFileSync(template, 'utf8')).split('\n').map((line) => {
    const clean = line.replace(/\s*<!--.*?-->/g, '');
    const bullet = BULLET.exec(clean);
    const field = bullet ? BY_LABEL.get(bullet[2].trim().toLowerCase()) : null;
    if (!field?.initial) return clean;
    return clean.replace(/:[ \t]*.*$/, `: ${field.initial}`);
  });
  return normalizeText(lines.join('\n'));
}

/** Writes the starting test configuration into `dir` when it has none. Returns true when it wrote one. */
export function writeTestConfigIfMissing(dir, options = {}) {
  const file = path.join(dir, TEST_CONFIG_FILE);
  if (existsSync(file)) return false;
  writeFileSync(file, newTestConfig(options));
  return true;
}

const OUTCOMES = Object.freeze({
  off: { onFail: false, onError: false, onPass: false, onRecover: false },
  fail: { onFail: true, onError: true, onPass: false, onRecover: false },
  pass: { onFail: false, onError: false, onPass: true, onRecover: true },
  both: { onFail: true, onError: true, onPass: true, onRecover: true },
});

/**
 * The notify settings a run of the test uses: with a test configuration, its
 * Send Notifications and Notify when Test decide which outcomes notify; a
 * failure includes a run that could not run, and a pass includes a recovery.
 * Without one, the settings stay as they are.
 */
export function notifyFor(notify, settings) {
  if (!settings) return notify;
  return { ...notify, ...(settings.notify ? OUTCOMES[settings.notifyWhen] ?? OUTCOMES.off : OUTCOMES.off) };
}

/**
 * The account a test sends from: the Email and Password of its test
 * configuration as written, variable references unread, or null when the test
 * sends nothing or uses the settings' channels.
 */
export function accountFor(settings) {
  if (!settings?.notify || !settings.email) return null;
  return { email: settings.email, password: settings.password };
}

/**
 * The environment variables that hold notification secrets: the ones the test
 * configuration names in Email and Password, whether or not it sends, and the
 * settings' email password and webhook secret variables. Child processes are
 * started without them.
 */
export function secretVariables({ testConfig = null, notify = {} } = {}) {
  const named = ['email', 'password'].map((key) => variableName(testConfig?.fields?.[key]?.value));
  return [...new Set([...named, notify?.email?.smtp?.passwordEnv, notify?.webhook?.secretEnv].filter(Boolean))];
}

/**
 * The account values of a test configuration that must never leave the
 * machine, with variable references read from `env`: the address, which a
 * refusal may name, and the password, which it never shows.
 */
export function accountValues(testConfig, env = process.env) {
  const read = (key) => {
    const raw = testConfig?.fields?.[key]?.value;
    if (!raw || isEmpty(raw)) return null;
    const name = variableName(raw);
    return name ? readVariable(env, name) || null : raw;
  };
  return { names: [read('email')].filter(Boolean), secrets: [read('password')].filter(Boolean) };
}

/** How a secret is given, never its value: the variable that holds it and whether it is set, or a hint to move it. */
export function describeSecret(value, env = process.env) {
  if (!value) return 'none';
  const name = variableName(value);
  if (!name) return 'written in the file (move it to an environment variable)';
  return `from ${name} (${readVariable(env, name) ? 'set' : 'unset'})`;
}

/** The account address as the file gives it: the variable that holds it and whether it is set, or the address. */
export function describeAddress(value, env = process.env) {
  if (!value) return 'none';
  const name = variableName(value);
  return name ? `from ${name} (${readVariable(env, name) ? 'set' : 'unset'})` : value;
}

/** One line each for how many results a test keeps, when its scheduled runs run, and whom it notifies. */
export function describeTestConfig(settings, env = process.env) {
  const outcomes = { pass: 'pass', fail: 'fail', both: 'pass and fail' };
  const keep = settings.keepPrior ? settings.keepCount : 1;
  let notifications = 'off';
  if (settings.notify) {
    const channel = settings.email ? `by email as ${describeAddress(settings.email, env)}` : "through the settings' channels";
    notifications = `on ${outcomes[settings.notifyWhen] ?? settings.notifyWhen}, ${channel}`;
  }
  return {
    schedule: settings.turnOffOnFail ? 'skipped after a failed run' : 'run every time',
    keep: settings.keepPrior ? `${keep} run folder${keep === 1 ? '' : 's'}` : 'the newest run folder only',
    notifications,
    password: settings.notify && settings.email ? describeSecret(settings.password, env) : null,
  };
}

/**
 * Checks the test configuration and returns one row per setting for the
 * report, in the shape formatValidation prints, with each row marked fail
 * when a field it reads has a problem.
 */
export function validateTestConfig(parsed, { env = process.env } = {}) {
  const described = describeTestConfig(parsed.settings ?? TEST_CONFIG_DEFAULTS, env);
  const row = (name, detail, keys) => {
    const found = parsed.problems.find((entry) => keys.includes(entry.key));
    return found ? { name, status: 'fail', detail: found.message } : { name, status: 'pass', detail };
  };
  const rows = [
    row('Scheduled runs', described.schedule, ['turnOffOnFail']),
    row('Results kept', described.keep, ['keepPrior', 'keepCount']),
    row('Notifications', described.notifications, ['notify', 'notifyWhen', 'email']),
  ];
  if (described.password || parsed.problems.some((entry) => entry.key === 'password')) rows.push(row('Password', described.password ?? 'none', ['password']));
  return { ok: parsed.problems.length === 0, rows, problems: parsed.problems, warnings: parsed.warnings };
}
