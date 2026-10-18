import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cachedModels, effortLevels } from './models.mjs';
import { listInstalled, taskTestFolder } from './schedule/index.mjs';
import { MARKER_FILE, codeRoot } from './paths.mjs';
import { assistantState } from './setup.mjs';
import { toolSkills } from './test-folder.mjs';
import { settingsPath } from './user-config.mjs';
import { capture, firstLine, which } from './util/which.mjs';

const MIN_NODE = '20.19.0';
const SEND_EMAIL = '@isocialpractice/send-email';

/** Compares two dotted version strings numerically: -1, 0, or 1. */
export function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** Microsoft Edge in its standard install locations, with its version when known. */
export function findEdge(env = process.env) {
  if (process.platform === 'win32') {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)) {
      const appDir = path.join(base, 'Microsoft', 'Edge', 'Application');
      const exe = path.join(appDir, 'msedge.exe');
      if (existsSync(exe)) {
        const version = readdirSync(appDir)
          .filter((entry) => /^\d+(\.\d+){3}$/.test(entry))
          .sort(compareVersions)
          .pop();
        return { path: exe, version };
      }
    }
    return null;
  }
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(existsSync)
    : ['microsoft-edge', 'microsoft-edge-stable'].map((name) => which(name, env)).filter(Boolean);
  if (candidates.length === 0) return null;
  return { path: candidates[0], version: firstLine(capture(candidates[0], ['--version']).stdout) };
}

/** Install state of the send-email dependency that sits next to the code. */
export function readSendEmail(root = codeRoot) {
  const dir = path.join(root, 'node_modules', ...SEND_EMAIL.split('/'));
  if (!existsSync(dir)) return { installed: false };
  const { version } = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return { installed: true, linked: lstatSync(dir).isSymbolicLink(), version };
}

/** Probes that read the machine. Tests replace them with fakes. */
export function defaultProbe() {
  return {
    nodeVersion: process.versions.node,
    platform: process.platform,
    which: (command) => which(command),
    run: (file, args) => capture(file, args),
    findEdge: () => findEdge(),
    sendEmail: () => readSendEmail(codeRoot),
    skills: () => toolSkills(),
    assistant: (name, probe) => assistantState(name, probe),
    effortLevels: (name, file) => effortLevels(name, { file }),
    cachedModels: (name, env) => cachedModels(name, { env }),
    tasks: () => listInstalled(),
  };
}

function describeAssistant(config) {
  const name = config.assistant;
  const models = config.models?.[name] ?? {};
  const model = (role) => models[role] || 'assistant default';
  const tier = models.testDriver === 'auto' && models.testDriverAutoTier ? ` (${models.testDriverAutoTier} tier)` : '';
  const effort = models.effort ? `, effort ${models.effort}` : '';
  return `${name}: generate ${model('generate')}, analyze ${model('analyze')}, `
    + `test driver ${model('testDriver')}${tier}${effort}; permissions ${config.assistants?.[name]?.permissionMode}`;
}

/**
 * The scheduled checks this machine holds, and whether each one still points
 * at a test folder that exists. A task whose folder is gone is a warning with
 * the command that removes it.
 */
function tasksRow(probe) {
  const tasks = probe.tasks();
  if (tasks.length === 0) return ['info', 'no auto-check task is installed'];
  const broken = tasks.filter((task) => {
    const folder = taskTestFolder(task.command);
    return !folder || !existsSync(folder) || !existsSync(path.join(folder, 'check.config.json'));
  });
  const clock = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const next = tasks.map((task) => `${task.name}${task.nextRun ? ` at ${clock(task.nextRun)}` : ''}`).join('; ');
  if (broken.length === 0) return ['ok', `${tasks.length} installed: ${next}`];
  const names = broken.map((task) => `"${task.name}"`).join(', ');
  return ['warn', `${tasks.length} installed: ${next}; ${names} no longer points at a test folder, so remove it with schtasks /Delete /TN <name>`];
}

function skillsRow(probe) {
  const skills = probe.skills();
  if (skills.length === 0) return ['fail', `no auto-check skills in ${path.join(codeRoot, 'skills')}; reinstall the tool`];
  return ['ok', `${skills.length} in skills/, copied into each test folder: ${skills.join(', ')}`];
}

function versionOf(probe, command) {
  const file = probe.which(command);
  if (!file) return { file: null };
  const result = probe.run(file, ['--version']);
  return { file, version: firstLine(result.stdout) || firstLine(result.stderr) || 'version unknown' };
}

/**
 * Builds the doctor report: one row per tool or setting, each with a status
 * of ok, missing, info, warn, or fail. Secret values are never read into a
 * row; only whether each named variable is set.
 */
export function collectRows({ workRoot, cwd, config, configProblem, version = '', env = process.env, probe = defaultProbe() }) {
  const rows = [];
  const add = (name, status, detail) => rows.push({ name, status, detail });

  const nodeOk = compareVersions(probe.nodeVersion, MIN_NODE) >= 0;
  add('node', nodeOk ? 'ok' : 'fail', `v${probe.nodeVersion} (needs ${MIN_NODE} or newer)`);

  add('install', 'info', `auto-check ${version} in ${codeRoot}`);
  const settingsFile = settingsPath(env);
  if (configProblem) add('settings', 'fail', [configProblem.message, ...(configProblem.problems ?? [])].join(' '));
  else add('settings', 'ok', `${settingsFile}${existsSync(settingsFile) ? '' : ' (not written yet; defaults are in use)'}`);
  if (!config.root) add('root', 'warn', 'not set; auto-check asks for one, or set it with auto-check config set root <folder>');
  else if (existsSync(config.root)) add('root', 'ok', config.root);
  else add('root', 'fail', `${config.root} does not exist`);
  add('test folder', 'info', workRoot ?? `no ${MARKER_FILE} in ${cwd} or any folder above it`);

  const git = versionOf(probe, 'git');
  add('git', git.file ? 'ok' : 'fail', git.file ? git.version : 'not on PATH');

  const gh = versionOf(probe, 'gh');
  if (!gh.file) {
    add('gh', 'fail', 'not on PATH; install GitHub CLI');
  } else {
    const authenticated = probe.run(gh.file, ['auth', 'status']).status === 0;
    add('gh', authenticated ? 'ok' : 'fail', `${gh.version}, ${authenticated ? 'authenticated' : 'not authenticated; run gh auth login'}`);
  }

  for (const name of ['claude', 'copilot', 'codex']) {
    const active = config.assistant === name;
    const suffix = active ? ' (active assistant)' : '';
    const tool = probe.assistant(name, probe);
    if (!tool.file) {
      add(name, active ? 'fail' : 'missing', `not on PATH${suffix}`);
      continue;
    }
    const extra = [];
    const levels = probe.effortLevels(name, tool.file);
    if (levels.length > 0) extra.push(`effort ${levels.join(', ')}`);
    const probed = probe.cachedModels(name, env);
    if (probed.length > 0) {
      extra.push(`probed ${probed.map((entry) => `${entry.candidates[0]} runs as ${entry.model}`).join('; ')}`);
    }
    const tail = extra.length > 0 ? `; ${extra.join('; ')}` : '';
    if (tool.signedIn === false) {
      add(name, active ? 'fail' : 'warn', `${tool.version}${suffix}, not signed in; run claude auth login, or claude setup-token for scheduled runs${tail}`);
    } else {
      add(name, 'ok', `${tool.version}${suffix}${tool.signedIn ? ', signed in' : ''}${tail}`);
    }
  }
  add('assistant', 'info', describeAssistant(config));
  add('skills', ...skillsRow(probe));

  const playwright = versionOf(probe, 'playwright');
  add(
    'playwright',
    playwright.file ? 'ok' : 'missing',
    playwright.file ? playwright.version : 'not on PATH; generated GUI checks install their own copy',
  );

  const edge = probe.findEdge();
  add('edge', edge ? 'ok' : 'missing', edge ? [edge.version, edge.path].filter(Boolean).join(' at ') : 'not in the standard locations');

  const schedulers = { win32: ['schtasks'], darwin: ['launchctl'] }[probe.platform] ?? ['systemctl', 'crontab'];
  const found = schedulers.filter((command) => probe.which(command));
  add('scheduler', found.length > 0 ? 'ok' : 'missing', found.length > 0 ? found.join(', ') : `none of ${schedulers.join(', ')} on PATH`);
  add('tasks', ...tasksRow(probe));

  const sendEmail = probe.sendEmail();
  if (!sendEmail.installed) add('send-email', 'fail', 'not installed; run npm install');
  else if (sendEmail.linked) add('send-email', 'fail', `${sendEmail.version} is linked; install it from the npm registry with npm install`);
  else add('send-email', 'ok', sendEmail.version);

  const wanted = [
    [config.notify?.email?.smtp?.passwordEnv, config.notify?.email?.enabled],
    [config.notify?.webhook?.secretEnv, config.notify?.webhook?.enabled],
  ].filter(([name]) => name);
  const missingNeeded = wanted.some(([name, enabled]) => enabled && !env[name]);
  add(
    'env',
    missingNeeded ? 'warn' : 'info',
    wanted.map(([name]) => `${name} ${env[name] ? 'set' : 'unset'}`).join(', ') || 'no variables named under notify',
  );

  return rows;
}

/** Aligned, plain-text rendering of the report rows. */
export function formatRows(rows) {
  const width = Math.max(...rows.map((row) => row.name.length)) + 2;
  const lines = rows.map((row) => `  ${row.name.padEnd(width)}${row.status.padEnd(9)}${row.detail}`);
  return `auto-check doctor\n\n${lines.join('\n')}\n`;
}

/** 1 when any row failed, otherwise 0. */
export function exitCodeFor(rows) {
  return rows.some((row) => row.status === 'fail') ? 1 : 0;
}

/** Prints the doctor report and returns its exit code. */
export function runDoctor({ io = {}, ...options }) {
  const rows = collectRows({ ...options, env: io.env ?? process.env });
  (io.stdout ?? process.stdout).write(formatRows(rows));
  return exitCodeFor(rows);
}
