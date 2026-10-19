import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ASSISTANTS, ConfigError, defaults } from './config.mjs';
import { CONTEXT_FILE, formProbe, formatValidation, readContext, validateForm } from './context.mjs';
import { defaultProbe, runDoctor } from './doctor.mjs';
import { editForm } from './editor.mjs';
import { generateCheck } from './generate.mjs';
import { GuardError, guardRoot, guardTestFolder } from './guard.mjs';
import { MARKER_FILE, TEST_CONFIG_FILE, codeRoot, findTestFolder } from './paths.mjs';
import { createPipeline } from './pipeline.mjs';
import { describeNotification, sendNotifications, testMessage } from './notify/index.mjs';
import { createGitHub, ghRunner } from './github.mjs';
import { PrError, formatIntake, intake, parsePrUrl } from './pr.mjs';
import { proposeSolution, resolveIssue, resolvePr, saveOpen } from './resolve.mjs';
import { formatRun, hasCheck, loadCheck, readCheckState, runTest, scheduledSkip } from './runner.mjs';
import { ACTIONS, applySchedule, listInstalled, nextRuns, planSchedule, refreshScheduleWrapper, staggerFor } from './schedule/index.mjs';
import { setupAssistant } from './setup.mjs';
import { accountFor, parseTestConfig, validateTestConfig, writeTestConfigIfMissing } from './test-config.mjs';
import {
  createTestFolder,
  installAssistantFiles,
  resolveName,
  resolveRoot,
  resolveTestFolder,
  suggestedName,
  validateFolderName,
} from './test-folder.mjs';
import {
  getSetting,
  listSettings,
  loadConfig,
  loadUserEnv,
  parseSetting,
  setSetting,
  settingsPath,
  showSetting,
  unsetSetting,
} from './user-config.mjs';
import { loadDotEnv } from './util/env.mjs';

/** Process exit codes. */
export const EXIT = Object.freeze({ OK: 0, FAIL: 1, ERROR: 2, REFUSED: 3, USAGE: 4 });

/** Options every command takes. */
const GLOBAL_FLAGS = [
  ['-h, --help', "Show this help. After a command, show that command's help."],
  ['-v, --version', 'Print the version of auto-check and exit.'],
];

/** Raised for arguments the command line cannot accept. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = EXIT.USAGE;
  }
}

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  unmerged: { type: 'boolean' },
  branch: { type: 'string' },
  assistant: { type: 'string' },
  model: { type: 'string' },
  'dry-run': { type: 'boolean' },
  name: { type: 'string', short: 'n' },
  root: { type: 'string' },
  'edit-context': { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  'no-schedule': { type: 'boolean' },
  'no-baseline': { type: 'boolean' },
  phase: { type: 'string' },
  'simulate-fail': { type: 'string' },
  'no-notify': { type: 'boolean' },
  scheduled: { type: 'boolean' },
  json: { type: 'boolean' },
  propose: { type: 'boolean' },
  issue: { type: 'boolean' },
  pr: { type: 'boolean' },
  push: { type: 'boolean' },
};

const COMMANDS = {
  generate: {
    label: 'auto-check <pr-url>',
    usage: [
      'auto-check <pr-url> [-n, --name <folder>] [--root <folder>] [--edit-context]',
      '           [--unmerged <local-repo> [--branch <name>]]',
      '           [--assistant claude|copilot|codex] [--model <name>]',
      '           [--dry-run] [-y, --yes] [--no-schedule] [--no-baseline]',
    ],
    options: ['name', 'root', 'edit-context', 'unmerged', 'branch', 'assistant', 'model', 'dry-run', 'yes', 'no-schedule', 'no-baseline'],
    flags: [
      ['-n, --name <folder>', 'Name of the test folder to create. Without it, auto-check asks.'],
      ['--root <folder>', 'Folder that holds the test folders, instead of the configured root.'],
      ['--edit-context', "Open the new context.md in the terminal's editor before writing the check."],
      ['--unmerged <local-repo>', 'Test a pull request that is still open, from a local clone of it.'],
      ['--branch <name>', 'Branch of the local clone to test. Goes with --unmerged.'],
      ['--assistant <name>', 'Assistant that writes the check: claude, copilot, or codex.'],
      ['--model <name>', 'Model the assistant writes the check with.'],
      ['--dry-run', 'Write the prompt and the planned settings, and start no assistant.'],
      ['-y, --yes', 'Accept every suggested answer instead of asking.'],
      ['--no-schedule', 'Do not install a scheduled task for the new check.'],
      ['--no-baseline', 'Do not capture a baseline after the check is written.'],
    ],
    run: generate,
  },
  status: {
    label: 'auto-check',
    usage: ['auto-check                        (inside a test folder)'],
    options: [],
    flags: [],
    run: status,
  },
  scaffold: {
    label: 'auto-check --name',
    usage: ['auto-check -n, --name <folder> [--root <folder>] [--edit-context]'],
    options: ['name', 'root', 'edit-context', 'yes'],
    flags: [
      ['-n, --name <folder>', 'Name of the test folder to create under the root folder.'],
      ['--root <folder>', 'Folder that holds the test folders, instead of the configured root.'],
      ['--edit-context', 'Open the new context.md in the terminal\'s editor before finishing.'],
      ['-y, --yes', 'Accept every suggested answer instead of asking.'],
    ],
    run: scaffold,
  },
  run: {
    label: 'auto-check run',
    usage: ['auto-check run [<folder>] [--phase start|collect] [--simulate-fail <png>|black] [--no-notify] [--scheduled]'],
    options: ['phase', 'simulate-fail', 'no-notify', 'scheduled'],
    flags: [
      ['--phase start|collect', 'Run one half of a two-phase check: start it, or collect its result.'],
      ['--simulate-fail <png>|black', 'Replace the capture with a picture, to prove a failure is reported.'],
      ['--no-notify', 'Do not send notifications for this run.'],
      ['--scheduled', 'Run the way the schedule does: follow Turn Off on Failed Test in test-configuration.md.'],
    ],
    run: runCheck,
  },
  inspect: {
    label: 'auto-check inspect',
    usage: ['auto-check inspect <pr-url> [--json]'],
    options: ['json'],
    flags: [['--json', 'Print the intake summary as JSON.']],
    run: inspect,
  },
  context: {
    label: 'auto-check context',
    usage: ['auto-check context validate [<path>]'],
    options: [],
    flags: [],
    run: context,
  },
  schedule: {
    label: 'auto-check schedule',
    usage: ['auto-check schedule install|remove|status [<folder>] [--dry-run]'],
    options: ['dry-run'],
    flags: [['--dry-run', 'Print the commands the action would run, and change nothing.']],
    run: schedule,
  },
  notify: {
    label: 'auto-check notify',
    usage: ['auto-check notify test [--dry-run]'],
    options: ['dry-run'],
    flags: [['--dry-run', 'Print the messages instead of sending them.']],
    run: notify,
  },
  resolve: {
    label: 'auto-check resolve',
    usage: ['auto-check resolve [<folder>] [--propose|--issue|--pr] [--push] [--dry-run]'],
    options: ['propose', 'issue', 'pr', 'push', 'dry-run'],
    flags: [
      ['--propose', 'Have the assistant write a proposed solution for the open failure.'],
      ['--issue', 'Apply the proposed solution on a branch of the local clone and commit it.'],
      ['--pr', 'Open a pull request for the committed branch.'],
      ['--push', 'Push the branch to your fork. Goes with --issue or --pr.'],
      ['--dry-run', 'Print every command the step would run, and change nothing.'],
    ],
    run: resolve,
  },
  config: {
    label: 'auto-check config',
    usage: ['auto-check config get|set|unset|list|path [<key> [<value>]]'],
    options: [],
    flags: [],
    run: config,
  },
  setup: {
    label: 'auto-check setup',
    usage: ['auto-check setup --assistant claude|copilot|codex'],
    options: ['assistant'],
    flags: [['--assistant <name>', 'Assistant auto-check drives from now on: claude, copilot, or codex.']],
    run: setup,
  },
  doctor: {
    label: 'auto-check doctor',
    usage: ['auto-check doctor'],
    options: [],
    flags: [],
    run: doctor,
  },
};

const EXIT_CODES = [
  '0  pass or done',
  '1  check failed',
  '2  tool error',
  '3  refused by the guard',
  '4  bad arguments, or an invalid context.md or test-configuration.md',
];

/** A test folder holds one check: <folder> is a path, or a name under the root folder. */
const FOLDER_NOTE = '<folder> is a path, or the name of a test folder under the root. It defaults to the current folder.';

/** The help that lists every command. */
export function usageText() {
  const lines = ['Usage:'];
  for (const spec of Object.values(COMMANDS)) {
    for (const line of spec.usage) lines.push(`  ${line}`);
  }
  lines.push('  auto-check -h, --help             (and auto-check <command> --help)');
  lines.push('  auto-check -v, --version');
  lines.push('', 'For a pull request that is not merged yet, --unmerged may also come first:');
  lines.push('  auto-check --unmerged <pr-url> <local-repo-path> [--branch <name>]');
  lines.push('', FOLDER_NOTE);
  lines.push('', 'Exit codes:');
  for (const code of EXIT_CODES) lines.push(`  ${code}`);
  return `${lines.join('\n')}\n`;
}

/** The help of one command: how to call it, and one line per option. */
export function helpFor(name) {
  const spec = COMMANDS[name];
  const flags = [...spec.flags, ...GLOBAL_FLAGS];
  const width = Math.max(...flags.map(([flag]) => flag.length)) + 2;
  const lines = ['Usage:', ...spec.usage.map((line) => `  ${line}`), '', 'Options:'];
  for (const [flag, text] of flags) lines.push(`  ${flag.padEnd(width)}${text}`);
  return `${lines.join('\n')}\n`;
}

/** The help auto-check prints when no command is named. */
export const USAGE = usageText();

function parse(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error.message);
  }
}

function commandFor(positionals) {
  const [first] = positionals;
  if (first === undefined) return null;
  if (first !== 'generate' && Object.hasOwn(COMMANDS, first)) return { name: first, args: positionals.slice(1) };
  if (/^https?:\/\//i.test(first)) return { name: 'generate', args: positionals };
  throw new UsageError(`Unknown command "${first}".`);
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(codeRoot, 'package.json'), 'utf8')).version;
}

function report(error, stderr) {
  if (error instanceof UsageError) {
    stderr.write(`auto-check: ${error.message}\nRun auto-check --help for usage.\n`);
    return EXIT.USAGE;
  }
  if (error instanceof GuardError) {
    stderr.write(`auto-check: ${error.message}\n`);
    return EXIT.REFUSED;
  }
  const problems = error.problems ?? [];
  stderr.write(`auto-check: ${error.message}\n${problems.map((problem) => `  ${problem}\n`).join('')}`);
  const known = Object.values(EXIT).filter((code) => code !== EXIT.OK);
  return known.includes(error.exitCode) ? error.exitCode : EXIT.ERROR;
}

/**
 * Runs the command line. `io` replaces process streams, environment, and
 * working directory, so tests can drive it in-process. Resolves to an exit code.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const ctx = {
    io: { stdout, stderr, stdin: io.stdin ?? process.stdin, env: io.env ?? process.env },
    cwd: io.cwd ?? process.cwd(),
  };
  try {
    const { values, positionals } = parse(argv);
    if (values.version) {
      stdout.write(`auto-check ${packageVersion()}\n`);
      return EXIT.OK;
    }
    const asked = values.help || positionals[0] === 'help';
    const named = positionals.find((positional) => Object.hasOwn(COMMANDS, positional) && positional !== 'generate');
    if (asked) {
      stdout.write(named ? helpFor(named) : USAGE);
      return EXIT.OK;
    }
    loadUserEnv(ctx.io.env);
    ctx.workRoot = findTestFolder(ctx.cwd);
    if (ctx.workRoot) loadDotEnv(ctx.workRoot, ctx.io.env);
    const command = commandFor(positionals) ?? bareCommand(ctx, values);
    if (!command) {
      stderr.write(USAGE);
      return EXIT.USAGE;
    }
    const spec = COMMANDS[command.name];
    const foreign = Object.keys(values).find((name) => !spec.options.includes(name));
    if (foreign) throw new UsageError(`${spec.label} does not take --${foreign}.`);
    return await spec.run({ ...ctx, values, args: command.args });
  } catch (error) {
    return report(error, stderr);
  }
}

function noMoreArgs(args, from) {
  if (args.length > from) throw new UsageError(`Unexpected argument "${args[from]}".`);
}

function requireWorkRoot(ctx) {
  if (!ctx.workRoot) {
    throw new Error(`No ${MARKER_FILE} in ${ctx.cwd} or any folder above it. Run auto-check inside a test folder.`);
  }
  return ctx.workRoot;
}

/** The test folder a command works in: the argument, or the folder the command ran in. */
async function testFolderFor(ctx, folder) {
  if (folder === undefined) return requireWorkRoot(ctx);
  const settings = await loadConfig({ env: ctx.io.env });
  const dir = resolveTestFolder({ folder, cwd: ctx.cwd, root: settings.root });
  if (!existsSync(path.join(dir, MARKER_FILE))) {
    throw new Error(`${dir} is not a test folder: it has no ${MARKER_FILE}. Run auto-check --name <folder> to make one.`);
  }
  return dir;
}

/** Prints one line per file the scaffold wrote, then what to do next. */
function reportScaffold(ctx, { dir, written, root, saved }) {
  const out = ctx.io.stdout;
  if (saved) out.write(`Root: ${root} (saved in the auto-check user settings)\n`);
  else out.write(`Root: ${root}\n`);
  out.write(`Test folder: ${dir}\n`);
  out.write(written.length > 0 ? `Wrote: ${written.join(', ')}\n` : 'The folder already held its form.\n');
}

function requirePrUrl(label, url) {
  if (url === undefined) throw new UsageError(`${label} needs a pull request URL.`);
  try {
    return parsePrUrl(url);
  } catch (error) {
    if (error instanceof PrError) throw new UsageError(error.message);
    throw error;
  }
}

function notImplemented(ctx, label) {
  ctx.io.stderr.write(`auto-check: ${label} is not implemented in this phase.\n`);
  return EXIT.ERROR;
}

/** Which command a bare `auto-check` runs: the status of this test folder, or the scaffold. */
function bareCommand(ctx, values) {
  if (values.name !== undefined) return { name: 'scaffold', args: [] };
  return ctx.workRoot ? { name: 'status', args: [] } : null;
}

/** The test folder a generate run writes in, creating it when the command is not in one. */
async function folderToGenerateIn(ctx, { inPlace, url, localRepo = null, readInfo }) {
  const { values } = ctx;
  if (inPlace) return { testFolder: guardTestFolder(ctx.workRoot), created: null, info: null };
  const settings = await loadConfig({ env: ctx.io.env });
  const { root, saved } = await resolveRoot({
    cliRoot: values.root ?? null,
    settingsRoot: settings.root,
    cwd: ctx.cwd,
    io: ctx.io,
    save: (folder) => setSetting('root', folder, { env: ctx.io.env }),
  });
  guardRoot(root);
  const ref = parsePrUrl(url);
  const info = values.name === undefined ? readInfo() : null;
  const name = await resolveName({
    cliName: values.name ?? null,
    suggestion: suggestedName(info?.classification?.alias ?? `${ref.repo}-${ref.number}`),
    io: ctx.io,
    yes: Boolean(values.yes),
  });
  const created = createTestFolder({
    root,
    name,
    prefill: {
      'Test folder root': root,
      'Test folder name': name,
      'Merged PR URI': url,
      ...(localRepo ? { 'Local Repository': localRepo } : {}),
      'Find Issue': 'true',
    },
  });
  guardTestFolder(created.dir);
  reportScaffold(ctx, { ...created, root, saved });
  return { testFolder: created.dir, created, info };
}

async function generate(ctx) {
  const { values, args } = ctx;
  const [url, localRepo] = args;
  noMoreArgs(args, 2);
  requirePrUrl(COMMANDS.generate.label, url);
  if (values.unmerged && !localRepo) {
    throw new UsageError('--unmerged needs the local repository path after the pull request URL.');
  }
  if (!values.unmerged && localRepo) {
    throw new UsageError(`Unexpected argument "${localRepo}". A local repository path goes with --unmerged.`);
  }
  if (values.branch !== undefined && !values.unmerged) throw new UsageError('--branch goes with --unmerged.');
  if (values.assistant !== undefined && !ASSISTANTS.includes(values.assistant)) {
    throw new UsageError(`--assistant must be one of ${ASSISTANTS.join(', ')}.`);
  }
  const inPlace = Boolean(ctx.workRoot) && values.name === undefined && values.root === undefined;
  const { testFolder, info } = await folderToGenerateIn(ctx, {
    inPlace,
    url,
    localRepo: values.unmerged && localRepo ? path.resolve(ctx.cwd, localRepo) : null,
    readInfo: () => intake(url, { github: githubFor(ctx) }),
  });
  if (values['edit-context']) {
    const form = path.join(testFolder, CONTEXT_FILE);
    const edited = await editForm({ file: form, validate: () => checkForm(form, ctx), io: ctx.io, env: ctx.io.env });
    if (!edited.ok) {
      for (const line of edited.lines ?? []) ctx.io.stderr.write(`${line}\n`);
      return EXIT.USAGE;
    }
  }
  const config = await loadConfig({ env: ctx.io.env });
  const checked = await checkForm(path.join(testFolder, CONTEXT_FILE), ctx);
  if (!inPlace && !checked.ok) {
    ctx.io.stdout.write(formatValidation(checked.rows));
    for (const line of checked.lines) ctx.io.stderr.write(`${line}\n`);
    return EXIT.USAGE;
  }
  let local = null;
  if (values.unmerged) {
    local = {
      repo: path.resolve(ctx.cwd, localRepo),
      branch: values.branch ?? null,
      upstreamRemote: config.repos.upstreamRemote,
      originRemote: config.repos.originRemote,
    };
    if (!existsSync(local.repo)) throw new Error(`The local repository ${local.repo} was not found.`);
  }
  return generateIn(ctx, { testFolder, url, config, local, info, tool: checked.resolved });
}

/** Writes the check in `testFolder`, captures its baseline, and installs its schedule. */
async function generateIn(ctx, { testFolder, url, config, local = null, info = null, tool = null }) {
  const { values } = ctx;
  const assistant = values.assistant ?? tool?.assistant ?? null;
  const sameAssistant = !assistant || !tool?.assistant || assistant === tool.assistant;
  const result = await generateCheck({
    url,
    testFolder,
    config,
    dryRun: Boolean(values['dry-run']),
    assistantName: assistant,
    model: values.model ?? (sameAssistant ? tool?.model : null) ?? null,
    effort: (sameAssistant ? tool?.effort : null) ?? null,
    noBaseline: Boolean(values['no-baseline']),
    local,
    log: (line) => ctx.io.stderr.write(`${line}\n`),
    deps: { readPr: info ? () => info : (prUrl) => intake(prUrl, { github: githubFor(ctx) }) },
  });
  let scheduled = null;
  if (!result.dryRun && !values['no-schedule']) {
    try {
      const check = loadCheck(testFolder, config).check;
      const installed = installedTasks();
      const plan = planSchedule({ testFolder, check, installed, stagger: staggerOf(check, testFolder, installed) });
      applySchedule('install', plan);
      scheduled = { plan };
    } catch (error) {
      scheduled = { error };
    }
  }
  return reportGenerated(ctx, result, scheduled);
}

/** The auto-check tasks this machine holds, or none when they cannot be read. */
function installedTasks() {
  try {
    return listInstalled();
  } catch {
    return [];
  }
}

/** Minutes to move a test's schedule by, so two checks never drive the same desktop app at once. */
function staggerOf(check, testFolder, tasks) {
  try {
    return staggerFor({ check, testFolder, tasks });
  } catch {
    return 0;
  }
}

function reportGenerated(ctx, result, scheduled) {
  const shown = (file) => path.relative(ctx.cwd, file) || file;
  const out = ctx.io.stdout;
  if (result.dryRun) {
    out.write(
      'Dry run: no assistant was started and nothing was cloned.\n'
        + `Prompt: ${shown(result.promptFile)}\n`
        + `Planned settings: ${shown(result.configFile)}\n`,
    );
    if (result.command) {
      const quoted = result.command.map((part) => (/[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(' ');
      out.write(`${result.assistant} would run: ${quoted}${result.promptOnStdin ? ' < prompt' : ''}\n`);
    }
    return EXIT.OK;
  }
  out.write(`Check written by ${result.assistant}${result.repaired ? ' after one repair round' : ''}: ${shown(result.checkDir)}\n`);
  out.write(`Code under test: ${result.sourceSha}\n`);
  let code = EXIT.OK;
  if (result.baseline) {
    const { result: outcome, exitCode, out: folder } = result.baseline;
    const layers = Object.entries(outcome?.baseline ?? {}).map(([layer, state]) => `${layer} ${state}`);
    out.write(`Baseline: ${layers.join('; ') || `none captured (exit code ${exitCode})`}\n`);
    if (exitCode !== 0) {
      out.write(
        `The baseline run did not pass. Its result is in ${shown(folder)}. After fixing the cause, capture the baseline again with:\n`
          + `  node ${shown(path.join(result.checkDir, 'run.mjs'))} --out <folder> --capture-baseline\n`,
      );
      code = exitCode === 1 ? EXIT.FAIL : EXIT.ERROR;
    }
  } else {
    out.write('Baseline: skipped (--no-baseline)\n');
  }
  if (scheduled?.plan) {
    out.write(`Schedule: ${scheduled.plan.summary}; first run ${scheduled.plan.tasks.map((task) => task.firstRun).join(' and ')}\n`);
  } else if (scheduled?.error) {
    out.write(`Schedule: not installed: ${scheduled.error.message}\nFix that, then run auto-check schedule install ${result.slug}\n`);
  } else {
    out.write('Schedule: skipped (--no-schedule). Run auto-check schedule install to add it.\n');
  }
  return code;
}

async function scaffold(ctx) {
  const { values } = ctx;
  noMoreArgs(ctx.args, 0);
  const settings = await loadConfig({ env: ctx.io.env });
  const { root, saved } = await resolveRoot({
    cliRoot: values.root ?? null,
    settingsRoot: settings.root,
    cwd: ctx.cwd,
    io: ctx.io,
    save: (folder) => setSetting('root', folder, { env: ctx.io.env }),
  });
  guardRoot(root);
  const name = validateFolderName(values.name);
  const created = createTestFolder({
    root,
    name,
    prefill: { 'Test folder root': root, 'Test folder name': name, 'Find Issue': 'true' },
  });
  guardTestFolder(created.dir);
  reportScaffold(ctx, { ...created, root, saved });
  if (values['edit-context']) {
    const form = path.join(created.dir, CONTEXT_FILE);
    const result = await editForm({ file: form, validate: () => checkForm(form, ctx), io: ctx.io, env: ctx.io.env });
    if (!result.ok) return EXIT.USAGE;
  }
  ctx.io.stdout.write(`Next: fill in ${CONTEXT_FILE}, then run auto-check in ${created.dir}\n`);
  return EXIT.OK;
}

/** Reads GitHub through the environment this command was given. */
function githubFor(ctx) {
  return createGitHub({ gh: ghRunner({ env: ctx.io.env }) });
}

/** Checks the form in `file` and turns its problems into lines to show. */
async function checkForm(file, ctx) {
  const settings = await loadConfig({ env: ctx.io.env });
  const probe = formProbe({ env: ctx.io.env, github: githubFor(ctx) });
  const result = validateForm(readContext(file), { folder: path.dirname(file), settings, probe });
  const shown = path.relative(ctx.cwd, file) || file;
  const line = (problem, kind = '') => `${shown}:${problem.line}: ${kind}${problem.message}`;
  return {
    ...result,
    lines: [...result.warnings.map((warning) => line(warning, 'warning: ')), ...result.problems.map((problem) => line(problem))],
  };
}

/** Checks the test configuration in `file` and turns its problems into lines to show. */
function checkTestConfig(file, ctx) {
  const result = validateTestConfig(parseTestConfig(readFileSync(file, 'utf8')), { env: ctx.io.env });
  const shown = path.relative(ctx.cwd, file) || file;
  const line = (problem, kind = '') => `${shown}:${problem.line}: ${kind}${problem.message}`;
  return {
    ...result,
    lines: [...result.warnings.map((warning) => line(warning, 'warning: ')), ...result.problems.map((problem) => line(problem))],
  };
}

/** Prints a checked form: its rows on stdout, its warnings and problems on stderr. Returns whether it passed. */
function printChecked(ctx, result) {
  ctx.io.stdout.write(formatValidation(result.rows));
  for (const line of result.lines) ctx.io.stderr.write(`${line}\n`);
  return result.ok;
}

/**
 * The bare run in a test folder: check both forms, writing the test
 * configuration when there is none, then write the check, or refresh the
 * folder's instructions and skills and report where the test stands.
 */
async function status(ctx) {
  noMoreArgs(ctx.args, 0);
  const testFolder = requireWorkRoot(ctx);
  const form = path.join(testFolder, CONTEXT_FILE);
  if (!existsSync(form)) throw new Error(`${form} was not found.`);
  const result = await checkForm(form, ctx);
  if (!printChecked(ctx, result)) return EXIT.USAGE;
  if (writeTestConfigIfMissing(testFolder)) ctx.io.stdout.write(`\nWrote ${TEST_CONFIG_FILE} with the defaults.\n`);
  ctx.io.stdout.write('\n');
  if (!printChecked(ctx, checkTestConfig(path.join(testFolder, TEST_CONFIG_FILE), ctx))) return EXIT.USAGE;
  const config = await loadConfig({ env: ctx.io.env });
  if (!hasCheck(testFolder)) {
    ctx.io.stdout.write(`\nNo check here yet, so ${result.resolved.assistant} writes one for ${result.resolved.prUrl}.\n`);
    return generateIn(ctx, { testFolder, url: result.resolved.prUrl, config, tool: result.resolved });
  }
  const installed = installAssistantFiles(testFolder, { assistant: result.resolved.assistant, config });
  const skills = installed.skills.length;
  ctx.io.stdout.write(`\nRefreshed ${installed.instructions.join(', ')}, and ${skills} skill${skills === 1 ? '' : 's'} in ${installed.skillsFolder}.\n`);
  if (refreshScheduleWrapper({ testFolder, check: loadCheck(testFolder, config).check })) {
    ctx.io.stdout.write(`Refreshed ${path.join('schedule', 'run.cmd')}; the scheduled task was left as it is.\n`);
  }
  ctx.io.stdout.write(`\n${formatStatus({ ctx, testFolder, config })}`);
  return EXIT.OK;
}

/** Where a test folder stands: its check, its last run, its next run, and what to do next. */
function formatStatus({ ctx, testFolder, config }) {
  const { check, name } = loadCheck(testFolder, config);
  const state = readCheckState(testFolder);
  const shown = (file) => path.relative(ctx.cwd, path.join(testFolder, file)) || file;
  const rows = [
    ['Check', `${check.slug}, ${check.classification?.kind ?? 'unknown'} / ${check.classification?.subtype ?? 'unknown'}`],
    ['Pull request', check.pr?.url ?? 'unknown'],
  ];
  const last = state.lastRun;
  rows.push(['Last run', last ? `${last.outcome} at ${last.at}, ${last.resultDir}` : 'none yet']);
  if (state.lastPass) rows.push(['Last pass', `${state.lastPass.at}, code under test ${(state.lastPass.upstreamSha ?? '').slice(0, 7)}`]);
  try {
    const installed = installedTasks();
    const plan = planSchedule({ testFolder, check, installed });
    const skip = scheduledSkip(testFolder);
    const note = skip ? ` (skipped: the last run failed, ${skip.folder})` : '';
    rows.push(['Next run', `${nextRuns(plan, installed).map((task) => `${task.name} at ${task.at}`).join('; ')}${note}`]);
  } catch (error) {
    rows.push(['Next run', `no schedule: ${error.message}`]);
  }
  const open = state.openResolution;
  rows.push(['Open failure', open ? shown(open.foundIssue) : 'none']);
  const next = ['auto-check run', 'auto-check schedule status'];
  if (open) next.push('auto-check resolve --propose');
  rows.push(['Next steps', next.join(', ')]);
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return `${rows.map(([label, detail]) => `${label.padEnd(width)}${detail}`).join('\n')}\n`;
}

async function runCheck(ctx) {
  const { values, args } = ctx;
  const testFolder = await testFolderFor(ctx, args[0]);
  noMoreArgs(args, 1);
  loadDotEnv(testFolder, ctx.io.env);
  if (values.phase !== undefined && !['start', 'collect'].includes(values.phase)) {
    throw new UsageError('--phase must be start or collect.');
  }
  let simulateFail = null;
  if (values['simulate-fail'] !== undefined) {
    simulateFail = values['simulate-fail'] === 'black' ? 'black' : path.resolve(ctx.cwd, values['simulate-fail']);
    if (simulateFail !== 'black' && !existsSync(simulateFail)) throw new UsageError('--simulate-fail takes black or the path of a PNG file.');
  }
  if (simulateFail && values.scheduled) throw new UsageError('--scheduled and --simulate-fail do not go together: a schedule never simulates a failure.');
  const config = await loadConfig({ env: ctx.io.env });
  const pauseSchedule = async () => {
    applySchedule('pause', planSchedule({ testFolder, check: loadCheck(testFolder, config).check, installed: installedTasks() }));
  };
  const result = await runTest({
    testFolder,
    config,
    phase: values.phase ?? null,
    simulateFail,
    noNotify: Boolean(values['no-notify']),
    scheduled: Boolean(values.scheduled),
    env: ctx.io.env,
    log: (line) => ctx.io.stderr.write(`${line}\n`),
    deps: { pauseSchedule, afterRun: createPipeline({ log: (line) => ctx.io.stderr.write(`${line}\n`) }) },
  });
  ctx.io.stdout.write(formatRun(result, { cwd: ctx.cwd }));
  return result.exitCode;
}

async function inspect(ctx) {
  const [url] = ctx.args;
  requirePrUrl(COMMANDS.inspect.label, url);
  noMoreArgs(ctx.args, 1);
  const info = intake(url, { github: githubFor(ctx) });
  ctx.io.stdout.write(ctx.values.json ? `${JSON.stringify(info, null, 2)}\n` : formatIntake(info));
  return EXIT.OK;
}

/**
 * Checks one form, the test configuration when the file is named
 * test-configuration.md, or, with no path, both forms of the test folder.
 */
async function context(ctx) {
  if (ctx.args[0] !== 'validate') throw new UsageError('Usage: auto-check context validate [<path>]');
  noMoreArgs(ctx.args, 2);
  const check = async (file) => {
    if (!existsSync(file)) throw new Error(`${file} was not found.`);
    return path.basename(file).toLowerCase() === TEST_CONFIG_FILE ? checkTestConfig(file, ctx) : checkForm(file, ctx);
  };
  if (ctx.args[1]) return printChecked(ctx, await check(path.resolve(ctx.cwd, ctx.args[1]))) ? EXIT.OK : EXIT.USAGE;
  const testFolder = requireWorkRoot(ctx);
  const formOk = printChecked(ctx, await check(path.join(testFolder, CONTEXT_FILE)));
  const configFile = path.join(testFolder, TEST_CONFIG_FILE);
  if (!existsSync(configFile)) {
    ctx.io.stdout.write(`\n${TEST_CONFIG_FILE}: none, so the settings decide what is kept and who is notified. A bare auto-check writes one.\n`);
    return formOk ? EXIT.OK : EXIT.USAGE;
  }
  ctx.io.stdout.write('\n');
  const configOk = printChecked(ctx, await check(configFile));
  return formOk && configOk ? EXIT.OK : EXIT.USAGE;
}

async function schedule(ctx) {
  const [action, folder] = ctx.args;
  if (!ACTIONS.includes(action)) {
    throw new UsageError('Usage: auto-check schedule install|remove|status [<folder>]');
  }
  noMoreArgs(ctx.args, 2);
  const testFolder = await testFolderFor(ctx, folder);
  const name = path.basename(testFolder);
  const config = await loadConfig({ env: ctx.io.env });
  const check = loadCheck(testFolder, config).check;
  const installed = installedTasks();
  const plan = planSchedule({ testFolder, check, installed, stagger: action === 'install' ? staggerOf(check, testFolder, installed) : 0 });
  const dryRun = Boolean(ctx.values['dry-run']);
  const lines = applySchedule(action, plan, { dryRun });
  const out = ctx.io.stdout;
  if (action === 'install') {
    out.write(`${dryRun ? 'Dry run: nothing was written or run.\n' : ''}Schedule for ${name}: ${plan.summary}\n`);
    for (const task of plan.tasks) out.write(`  ${task.name}: first run ${task.firstRun}\n`);
  } else if (action === 'remove') {
    out.write(dryRun ? 'Dry run: nothing was deleted or run.\n' : `Removed the schedule for ${name}.\n`);
  }
  for (const line of lines) out.write(`${line}\n`);
  return EXIT.OK;
}

async function notify(ctx) {
  if (ctx.args[0] !== 'test') throw new UsageError('Usage: auto-check notify test [--dry-run]');
  noMoreArgs(ctx.args, 1);
  const root = ctx.workRoot ?? ctx.cwd;
  const config = await loadConfig({ env: ctx.io.env });
  const dryRun = Boolean(ctx.values['dry-run']);
  let account = null;
  if (ctx.workRoot) {
    const file = path.join(ctx.workRoot, TEST_CONFIG_FILE);
    if (existsSync(file)) {
      const checked = checkTestConfig(file, ctx);
      if (!checked.ok) {
        printChecked(ctx, checked);
        return EXIT.USAGE;
      }
      const { settings } = parseTestConfig(readFileSync(file, 'utf8'));
      if (!settings.notify) {
        ctx.io.stdout.write(`${TEST_CONFIG_FILE} turns notifications off for this test (Send Notifications: false).\n`);
        return EXIT.OK;
      }
      account = accountFor(settings);
    }
  }
  const result = await sendNotifications({ notify: config.notify, message: testMessage({ workRoot: root }), dryRun, account, env: ctx.io.env });
  if (result.channels.length === 0) {
    ctx.io.stdout.write('No notification channel is enabled. Turn one on with auto-check config set notify.email.enabled true, or notify.sms, or notify.webhook.\n');
    return EXIT.OK;
  }
  if (dryRun) {
    ctx.io.stdout.write(`Dry run: nothing was sent. These messages would go out:\n\n${result.text}`);
    return EXIT.OK;
  }
  ctx.io.stdout.write(`${describeNotification(result, { workRoot: root })}\n`);
  return result.failed.length > 0 ? EXIT.ERROR : EXIT.OK;
}

async function resolve(ctx) {
  const { values, args } = ctx;
  const testFolder = await testFolderFor(ctx, args[0]);
  const slug = path.basename(testFolder);
  noMoreArgs(args, 1);
  const steps = ['propose', 'issue', 'pr'].filter((step) => values[step]);
  if (steps.length > 1) throw new UsageError('Pick one of --propose, --issue, or --pr.');
  if (steps.length === 0) throw new UsageError('auto-check resolve needs --propose, --issue, or --pr.');
  if (values.push && steps[0] === 'propose') throw new UsageError('--push goes with --issue or --pr.');
  const config = await loadConfig({ env: ctx.io.env });
  if (steps[0] !== 'propose') {
    const step = steps[0] === 'issue' ? resolveIssue : resolvePr;
    const report = await step({
      testFolder,
      config,
      push: Boolean(values.push),
      makePr: steps[0] === 'pr',
      dryRun: Boolean(values['dry-run']),
      log: (line) => ctx.io.stderr.write(`${line}\n`),
    });
    if (!report.dryRun) saveOpen(testFolder, report.open);
    ctx.io.stdout.write(formatResolve(report, { step: steps[0], slug, cwd: ctx.cwd }));
    return EXIT.OK;
  }
  const result = await proposeSolution({
    testFolder,
    config,
    dryRun: Boolean(values['dry-run']),
    log: (line) => ctx.io.stderr.write(`${line}\n`),
  });
  const shown = (file) => path.relative(ctx.cwd, file) || file;
  if (result.dryRun) {
    ctx.io.stdout.write(`Dry run: no assistant was started.\nPrompt: ${shown(result.promptFile)}\nIt would write: ${shown(result.proposedSolutionFile)}\n`);
    return EXIT.OK;
  }
  ctx.io.stdout.write(
    `Proposed solution written by ${result.assistant}${result.repaired ? ' after one repair round' : ''}: ${shown(result.proposedSolutionFile)}\n`
      + (result.headline ? `${result.headline}\n` : '')
      + (result.simulated ? 'It answers a simulated failure, so there was nothing real to fix.\n' : ''),
  );
  return EXIT.OK;
}

function formatResolve(report, { step, slug, cwd }) {
  const shown = (file) => path.relative(cwd, file) || file;
  const lines = [];
  if (report.dryRun) lines.push(`Dry run: nothing in ${report.repo} was changed, and no command below was run.`);
  lines.push(`Local clone: ${report.repo}`, `Branch: ${report.branch}, from ${report.upstreamRef}`);
  const guide = report.contributing;
  if (guide.file) {
    lines.push(`Contributing guide: ${guide.file}${guide.signOff ? ' (commits need a sign-off)' : ''}`);
    for (const item of guide.items) lines.push(`  - ${item}`);
    if (guide.commands.length > 0) lines.push(`Checks it names: ${guide.commands.join(', ')}`);
  } else {
    lines.push('Contributing guide: none found');
  }
  if (report.commands.length > 0) lines.push(report.dryRun ? 'Commands it would run:' : 'Commands:', ...report.commands.map((command) => `  ${command}`));
  for (const note of report.notes) lines.push(`Note: ${note}`);
  for (const blocker of report.blockers ?? []) lines.push(`A real run would stop here: ${blocker}`);
  if (!report.dryRun && step === 'issue') {
    lines.push(`Commit: ${report.commit.slice(0, 7)} on ${report.branch}, ${report.pushed ? 'pushed to your fork' : 'not pushed'}`);
    if (report.summaryFile) lines.push(`Summary: ${shown(report.summaryFile)}`);
    lines.push(`Next: auto-check resolve ${slug} --pr`);
  }
  if (!report.dryRun && step === 'pr') {
    lines.push(report.prUrl ? `Pull request: ${report.prUrl}` : `Pull request: written to ${shown(report.pullRequestFile)}, with ${shown(report.patchFile)}`);
    if (report.issue) lines.push(`Issue: #${report.issue}`);
  }
  return `${lines.join('\n')}\n`;
}

const CONFIG_ACTIONS = ['get', 'set', 'unset', 'list', 'path'];

async function config(ctx) {
  const [action, key, ...rest] = ctx.args;
  if (!CONFIG_ACTIONS.includes(action)) {
    throw new UsageError(`Usage: ${COMMANDS.config.usage[0]}`);
  }
  const out = ctx.io.stdout;
  const options = { env: ctx.io.env };
  if (action === 'path') {
    noMoreArgs(ctx.args, 1);
    out.write(`${settingsPath(ctx.io.env)}\n`);
    return EXIT.OK;
  }
  if (action === 'list') {
    noMoreArgs(ctx.args, 1);
    const { file, exists, entries } = await listSettings(options);
    const width = Math.max(...entries.map((entry) => entry.key.length)) + 2;
    out.write(`${file}${exists ? '' : ' (not written yet)'}\n\n`);
    for (const entry of entries) {
      out.write(`  ${entry.key.padEnd(width)}${showSetting(entry.value)}${entry.set ? '' : '  (default)'}\n`);
    }
    return EXIT.OK;
  }
  if (key === undefined) throw new UsageError(`auto-check config ${action} needs a setting name.`);
  if (action === 'get') {
    noMoreArgs(ctx.args, 2);
    const result = await getSetting(key, options);
    out.write(`${showSetting(result.value)}\n`);
    return EXIT.OK;
  }
  if (action === 'unset') {
    noMoreArgs(ctx.args, 2);
    const result = await unsetSetting(key, options);
    const fallback = result.value === '' ? 'no value' : showSetting(result.value);
    out.write(result.removed
      ? `Removed ${key}. It falls back to ${fallback}.\n`
      : `${key} was not set. It stays at ${fallback}.\n`);
    return EXIT.OK;
  }
  if (rest.length === 0) throw new UsageError(`auto-check config set ${key} needs a value.`);
  noMoreArgs(ctx.args, 3);
  let result;
  try {
    result = await setSetting(key, parseSetting(key, rest[0]), options);
  } catch (error) {
    if (error instanceof ConfigError) error.exitCode = EXIT.USAGE;
    throw error;
  }
  out.write(`${key} = ${showSetting(result.value)}\nSaved in ${result.file}\n`);
  return EXIT.OK;
}

async function setup(ctx) {
  const { values, args } = ctx;
  noMoreArgs(args, 0);
  if (values.assistant === undefined) throw new UsageError('auto-check setup needs --assistant.');
  if (!ASSISTANTS.includes(values.assistant)) throw new UsageError(`--assistant must be one of ${ASSISTANTS.join(', ')}.`);
  const result = await setupAssistant({ assistant: values.assistant, env: ctx.io.env, probe: defaultProbe() });
  ctx.io.stdout.write(
    `Assistant: ${result.assistant} (${result.state.version})\n`
      + `Saved in ${result.file}\n\n`,
  );
  await doctor({ ...ctx, args: [] });
  return EXIT.OK;
}

async function doctor(ctx) {
  noMoreArgs(ctx.args, 0);
  let settings = defaults();
  let configProblem = null;
  try {
    settings = await loadConfig({ env: ctx.io.env });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    configProblem = error;
  }
  return runDoctor({
    workRoot: ctx.workRoot,
    cwd: ctx.cwd,
    config: settings,
    configProblem,
    version: packageVersion(),
    io: ctx.io,
  });
}
