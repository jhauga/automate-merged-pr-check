import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, test } from 'node:test';
import { main } from '../lib/cli.mjs';
import { codeRoot } from '../lib/paths.mjs';
import { newTestConfig } from '../lib/test-config.mjs';
import { CONFIG_DIR_VAR, SETTINGS_FILE } from '../lib/user-config.mjs';
import { installFakeAssistant, installFakeGh } from './helpers/fake-github.mjs';
import { shippedContext } from './helpers/shipped.mjs';

const BIN = path.join(codeRoot, 'bin', 'auto-check.mjs');
const PR = 'https://github.com/acme/demo-app/pull/123';
const CANVAS_PR = 'https://github.com/acme/demo-app/pull/101';
const OPEN_PR = 'https://github.com/acme/demo-app/pull/103';
let base;
let baseEnv;
let ghEnv;

function copyNamed(name) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'context.md'), shippedContext());
  return dir;
}

/** An environment with a settings folder of its own, holding `settings`. */
function ownSettings(name, settings = {}) {
  const dir = path.join(base, 'settings', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify(settings, null, 2));
  return { ...baseEnv, [CONFIG_DIR_VAR]: dir };
}

function cli(args, cwd = base, env = baseEnv) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs the command line in this process, on a terminal that answers with `answers`. */
async function onTerminal(args, { cwd = base, env = baseEnv, answers = [] } = {}) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  for (const answer of answers) stdin.write(`${answer}\n`);
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    env,
    stdin,
    stdout: { write: (text) => { out += text; } },
    stderr: { write: (text) => { err += text; } },
  });
  return { code, stdout: out, stderr: err };
}

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-cli-'));
  const bin = path.join(base, 'fake-bin');
  baseEnv = installFakeAssistant(bin, { ...process.env, [CONFIG_DIR_VAR]: path.join(base, 'settings', 'default') });
  ghEnv = installFakeGh(bin, baseEnv);
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test('--help lists every command and exits 0', () => {
  const { code, stdout } = cli(['--help']);
  assert.equal(code, 0);
  const commands = ['<pr-url>', '-n, --name', 'run', 'inspect', 'context validate', 'schedule', 'notify test', 'resolve', 'config', 'setup', 'doctor'];
  for (const command of commands) {
    assert.match(stdout, new RegExp(`auto-check ${command.replace(/[<>]/g, '.')}`));
  }
  assert.match(stdout, /^ {2}0 {2}pass or done$/m);
});

test('--version prints the version of the installed tool', () => {
  const expected = JSON.parse(readFileSync(path.join(codeRoot, 'package.json'), 'utf8')).version;
  for (const flag of ['--version', '-v']) {
    const { code, stdout } = cli([flag]);
    assert.equal(code, 0);
    assert.equal(stdout, `auto-check ${expected}\n`);
  }
});

test('a command and --help lists that command\'s options, one line each', () => {
  const { code, stdout } = cli(['run', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /^Usage:\n {2}auto-check run \[<folder>\]/);
  assert.match(stdout, /^ {2}--phase start\|collect {2,}Run one half of a two-phase check/m);
  assert.match(stdout, /^ {2}--no-notify {2,}Do not send notifications for this run\.$/m);
  assert.match(stdout, /^ {2}--scheduled {2,}Run the way the schedule does: follow Turn Off on Failed Test in test-configuration\.md\.$/m);
  assert.match(cli(['--help']).stdout, /^ {2}auto-check run \[<folder>\] .*\[--scheduled\]$/m);
  assert.match(stdout, /^ {2}-v, --version {2,}Print the version of auto-check and exit\.$/m);
  assert.match(cli(['resolve', '--help']).stdout, /^ {2}--push {2,}Push the branch to your fork\./m);
  assert.match(cli(['config', '--help']).stdout, /^ {2}auto-check config get\|set\|unset\|list\|path/m);
});

test('config writes, reads, and clears one setting in the settings file', () => {
  const env = ownSettings('config-command');
  const file = path.join(env[CONFIG_DIR_VAR], SETTINGS_FILE);
  assert.equal(cli(['config', 'path'], base, env).stdout.trim(), file);

  const root = path.join(base, 'auto-checks');
  const saved = cli(['config', 'set', 'root', root], base, env);
  assert.equal(saved.code, 0, saved.stderr);
  assert.match(saved.stdout, /^root = /);
  assert.equal(cli(['config', 'get', 'root'], base, env).stdout.trim(), root);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { root });

  const list = cli(['config', 'list'], base, env);
  assert.match(list.stdout, /^ {2}assistant {2,}claude {2}\(default\)$/m);
  assert.match(list.stdout, /^ {2}results\.keep {2,}14 {2}\(default\)$/m);

  assert.match(cli(['config', 'unset', 'root'], base, env).stdout, /^Removed root\. It falls back to no value\.$/m);
  assert.equal(cli(['config', 'get', 'root'], base, env).stdout, '\n');

  assert.equal(cli(['config'], base, env).code, 4);
  assert.equal(cli(['config', 'frobnicate'], base, env).code, 4);
  assert.equal(cli(['config', 'get'], base, env).code, 4);
  assert.equal(cli(['config', 'set', 'root'], base, env).code, 4);
  assert.equal(cli(['config', 'set', 'rout', 'x'], base, env).code, 4);
  assert.equal(cli(['config', 'set', 'results.keep', 'seven'], base, env).code, 4);
  const rejected = cli(['config', 'set', 'assistant', 'other'], base, env);
  assert.equal(rejected.code, 4);
  assert.match(rejected.stderr, /\/assistant: must be one of/);
});

test('no arguments prints the usage and exits 4', () => {
  const { code, stderr } = cli([]);
  assert.equal(code, 4);
  assert.match(stderr, /^Usage:/);
});

test('unknown commands and options another command owns exit 4', () => {
  assert.equal(cli(['frobnicate']).code, 4);
  assert.equal(cli(['doctor', '--json']).code, 4);
  assert.equal(cli(['run']).code, 2);
  assert.equal(cli(['run', 'demo', '--phase', 'middle']).code, 2);
  assert.equal(cli(['frobnicate', '--name', 'demo']).code, 4);
});

test('a test folder inside the installation is refused with exit 3', () => {
  const inside = path.join(codeRoot, 'automate-pr-inside');
  mkdirSync(inside, { recursive: true });
  writeFileSync(path.join(inside, 'context.md'), shippedContext());
  try {
    const { code, stderr } = cli([PR], inside);
    assert.equal(code, 3);
    assert.match(stderr, /inside the auto-check installation/);
  } finally {
    rmSync(inside, { recursive: true, force: true });
  }
});

test('auto-check --name writes the scaffold, and nothing else, under the root', () => {
  const env = ownSettings('scaffold');
  const holder = path.join(base, 'scaffold-root');
  mkdirSync(holder, { recursive: true });
  const { code, stdout, stderr } = cli(['--name', 'automate-pr-sample-canvas', '--root', holder], base, env);
  assert.equal(code, 0, stderr);
  const dir = path.join(holder, 'automate-pr-sample-canvas');
  assert.match(stdout, new RegExp(`^Test folder: ${dir.replace(/[\\]/g, '\\\\')}$`, 'm'));
  assert.match(stdout, /^Wrote: context\.md, test-configuration\.md, \.gitignore$/m);
  assert.deepEqual(readdirSync(dir).sort(), ['.gitignore', 'context.md', 'test-configuration.md']);
  assert.equal(readFileSync(path.join(dir, 'test-configuration.md'), 'utf8'), newTestConfig());
  const form = readFileSync(path.join(dir, 'context.md'), 'utf8');
  assert.match(form, /^- \*\*Test folder name\*\*: automate-pr-sample-canvas /m);
  assert.match(form, /^- \*\*Find Issue\*\*: true /m);
  assert.ok(form.includes(`- **Test folder root**: ${holder} `));

  assert.equal(cli(['--name', 'a/b', '--root', holder], base, env).code, 4);
  assert.equal(cli(['--name', 'automate-pr-other'], base, ownSettings('no-root')).code, 4);
});

test('a dry run in a test folder writes the prompt and the planned settings only', () => {
  const dir = copyNamed('acme-check');
  const { code, stdout, stderr } = cli([CANVAS_PR, '--dry-run'], dir, ghEnv);
  assert.equal(code, 0, stderr);
  const checkDir = dir;
  assert.match(stdout, /^Prompt: generate\.prompt\.md$/m);
  assert.match(stderr, /^Pull request: acme\/demo-app#101, source \/ gui-canvas-extension$/m);
  const prompt = readFileSync(path.join(checkDir, 'generate.prompt.md'), 'utf8');
  assert.match(prompt, /^## The capability ladder$/m);
  assert.match(prompt, /^## The check contract$/m);
  assert.match(prompt, /Test the base branch tip, never the pull request's own commit\./);
  assert.equal(JSON.parse(readFileSync(path.join(checkDir, 'check.config.json'), 'utf8')).slug, 'acme-demo-app-pr-101');
  assert.equal(existsSync(path.join(checkDir, 'run.mjs')), false);
  assert.equal(existsSync(path.join(checkDir, 'repo')), false);
});

test('a dry run names the assistant command, and --assistant changes only the adapter settings', () => {
  const claudeDir = copyNamed('acme-claude');
  const copilotDir = copyNamed('acme-copilot');
  const claude = cli([CANVAS_PR, '--dry-run'], claudeDir, ghEnv);
  const copilot = cli([CANVAS_PR, '--dry-run', '--assistant', 'copilot'], copilotDir, ghEnv);
  assert.equal(claude.code, 0, claude.stderr);
  assert.equal(copilot.code, 0, copilot.stderr);
  assert.match(claude.stdout, /^Claude Code would run: claude --print --model opus --dangerously-skip-permissions --add-dir .+ < prompt$/m);
  assert.match(copilot.stdout, /^GitHub Copilot CLI would run: copilot -p "Read the file .+generate\.prompt\.md and carry out .+" --allow-all-tools -s --model auto --add-dir /m);

  const prompt = (dir) => readFileSync(path.join(dir, 'generate.prompt.md'), 'utf8').split(dir).join('<root>');
  const copilotLines = prompt(copilotDir).split('\n');
  const differing = prompt(claudeDir).split('\n').filter((line, index) => line !== copilotLines[index]);
  assert.equal(differing.length, 1);
  assert.match(differing[0], /The configured choice is `haiku`/);
  assert.match(prompt(copilotDir), /The configured choice is `auto`/);
});

test('--unmerged takes the local repository path after the URL, in either order', () => {
  const dir = copyNamed('acme-unmerged');
  const localRepo = path.join(base, 'demo-app');
  mkdirSync(localRepo, { recursive: true });
  assert.equal(cli(['--unmerged', OPEN_PR], dir).code, 4);
  assert.equal(cli([OPEN_PR, localRepo], dir).code, 4);
  assert.equal(cli([OPEN_PR, '--branch', 'fix-typo'], dir).code, 4);

  const first = cli(['--unmerged', OPEN_PR, localRepo, '--branch', 'fix-typo', '--dry-run'], dir, ghEnv);
  assert.equal(first.code, 0, first.stderr);
  const config = JSON.parse(readFileSync(path.join(dir, 'check.config.json'), 'utf8'));
  assert.equal(config.source.mode, 'local');
  assert.equal(config.source.localRepo, localRepo);
  assert.equal(config.source.branch, 'fix-typo');

  const second = cli([OPEN_PR, '--unmerged', localRepo, '--dry-run'], copyNamed('acme-unmerged-2'), ghEnv);
  assert.equal(second.code, 0, second.stderr);

  const missing = cli([OPEN_PR, '--unmerged', path.join(base, 'no-such-repo'), '--dry-run'], copyNamed('acme-unmerged-3'), ghEnv);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /The local repository .* was not found\./);
});

test('a pull request gh cannot read is a tool error', () => {
  const { code, stderr } = cli([PR, '--dry-run'], copyNamed('acme-unknown'), ghEnv);
  assert.equal(code, 2);
  assert.match(stderr, /fake gh has no answer/);
});

function copyWithCheck(name) {
  const dir = copyNamed(name);
  copyFileSync(path.join(codeRoot, 'templates', 'check', 'check.config.json'), path.join(dir, 'check.config.json'));
  copyFileSync(path.join(codeRoot, 'templates', 'check', 'run.mjs'), path.join(dir, 'run.mjs'));
  return dir;
}

test('schedule install --dry-run prints the plan and changes nothing', () => {
  const dir = copyWithCheck('automate-pr-schedule');
  const { code, stdout, stderr } = cli(['schedule', 'install', '--dry-run'], dir);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^Dry run: nothing was written or run\.\nSchedule for automate-pr-schedule: /);
  assert.match(stdout, /^Would (run: |add to the crontab)/m);
  assert.equal(existsSync(path.join(dir, 'schedule')), false);
  assert.equal(cli(['schedule', 'pause'], dir).code, 4);
  assert.match(cli(['schedule', 'status', path.join(base, 'acme-missing')], dir).stderr, /is not a test folder/);
});

test('run needs an existing check and a real picture for --simulate-fail', () => {
  const dir = copyWithCheck('automate-pr-run');
  const missing = cli(['run'], copyNamed('automate-pr-no-check'));
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /holds no check yet/);
  assert.equal(cli(['run', '--simulate-fail', 'no-such.png'], dir).code, 4);
  const both = cli(['run', '--scheduled', '--simulate-fail', 'black'], dir);
  assert.equal(both.code, 4);
  assert.match(both.stderr, /--scheduled and --simulate-fail do not go together/);
});

test('a scheduled run after a failed one is skipped with one line, and exits 0', () => {
  const dir = copyWithCheck('automate-pr-skipped');
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig());
  mkdirSync(path.join(dir, 'results', '2026-01-02T03-00-00'), { recursive: true });
  writeFileSync(path.join(dir, 'results', '2026-01-02T03-00-00', 'result.json'), JSON.stringify({ outcome: 'fail' }));
  const { code, stdout, stderr } = cli(['run', '--scheduled'], dir);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, 'automate-pr-skipped: skipped. The last run failed (results/2026-01-02T03-00-00/result.json), '
    + 'and Turn Off on Failed Test is true in test-configuration.md. Fix the cause, then run auto-check run here; '
    + 'scheduled runs resume after a run that does not fail.\n');
  assert.deepEqual(readdirSync(path.join(dir, 'results')), ['2026-01-02T03-00-00']);
});

test('notify test --dry-run prints what each enabled channel would receive', () => {
  const quiet = cli(['notify', 'test', '--dry-run'], copyNamed('acme-notify-off'));
  assert.equal(quiet.code, 0);
  assert.match(quiet.stdout, /^No notification channel is enabled\./);

  const dir = copyNamed('acme-notify');
  const env = ownSettings('notify', { notify: { email: { enabled: true }, sms: { enabled: true } } });
  const { code, stdout, stderr } = cli(['notify', 'test', '--dry-run'], dir, env);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^Dry run: nothing was sent\. These messages would go out:\n\nemail\nFrom: auto-check@example\.com\nTo: jane\.doe@example\.com\nSubject: auto-check: test message\n/);
  assert.match(stdout, /\nsms\nFrom: auto-check@example\.com\nTo: 5551234567@txt\.example\.com\n/);
  assert.equal(cli(['notify', 'send'], dir, env).code, 4);
});

test('run <folder> started elsewhere loads that folder\'s .env, never over a variable already set', async () => {
  const dir = copyWithCheck('automate-pr-dotenv');
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig());
  mkdirSync(path.join(dir, 'results', '2026-01-02T03-00-00'), { recursive: true });
  writeFileSync(path.join(dir, 'results', '2026-01-02T03-00-00', 'result.json'), JSON.stringify({ outcome: 'fail' }));
  writeFileSync(path.join(dir, '.env'), 'AUTO_CHECK_EMAIL_PASSWORD=from-the-folder\n');

  const env = { ...baseEnv };
  delete env.AUTO_CHECK_EMAIL_PASSWORD;
  const loaded = await onTerminal(['run', dir, '--scheduled'], { cwd: base, env });
  assert.equal(loaded.code, 0, loaded.stderr);
  assert.match(loaded.stdout, /^automate-pr-dotenv: skipped\./);
  assert.equal(env.AUTO_CHECK_EMAIL_PASSWORD, 'from-the-folder');

  const kept = { ...baseEnv, AUTO_CHECK_EMAIL_PASSWORD: 'already-set' };
  await onTerminal(['run', dir, '--scheduled'], { cwd: base, env: kept });
  assert.equal(kept.AUTO_CHECK_EMAIL_PASSWORD, 'already-set');
});

test('notify test in a test folder follows its test-configuration.md', () => {
  const dir = copyNamed('acme-notify-config');
  const env = ownSettings('notify-config', { notify: { email: { enabled: true }, sms: { enabled: true } } });
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig());
  const off = cli(['notify', 'test', '--dry-run'], dir, env);
  assert.equal(off.code, 0, off.stderr);
  assert.equal(off.stdout, 'test-configuration.md turns notifications off for this test (Send Notifications: false).\n');

  const secret = 'correct-horse-battery-staple';
  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig()
    .replace('**Send Notifications**: false', '**Send Notifications**: true')
    .replace('**Notify when Test**: null', '**Notify when Test**: fail')
    .replace('**Email**: null', '**Email**: jane.doe@example.com')
    .replace('**Password**: null', '**Password**: %AUTO_CHECK_EMAIL_PASSWORD%'));
  const own = cli(['notify', 'test', '--dry-run'], dir, { ...env, AUTO_CHECK_EMAIL_PASSWORD: secret });
  assert.equal(own.code, 0, own.stderr);
  assert.match(own.stdout, /\n\nemail\nFrom: jane\.doe@example\.com\nTo: jane\.doe@example\.com\nSubject: auto-check: test message\n/);
  assert.match(own.stdout, /\nsms\nFrom: jane\.doe@example\.com\nTo: 5551234567@txt\.example\.com\n/);
  assert.ok(!`${own.stdout}${own.stderr}`.includes(secret));

  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig().replace('**Send Notifications**: false', '**Send Notifications**: maybe'));
  const invalid = cli(['notify', 'test', '--dry-run'], dir, env);
  assert.equal(invalid.code, 4);
  assert.match(invalid.stderr, /^test-configuration\.md:11: Send Notifications takes true or false, not "maybe"\.$/m);
});

test('resolve needs one step, and --propose needs an open failure', () => {
  const dir = copyWithCheck('automate-pr-resolve');
  assert.equal(cli(['resolve'], dir).code, 4);
  assert.equal(cli(['resolve', '--propose', '--pr'], dir).code, 4);
  assert.equal(cli(['resolve', '--propose', '--push'], dir).code, 4);
  assert.match(cli(['resolve', '--issue', '--dry-run'], dir).stderr, /automate-pr-resolve has no open failure\./);
  const none = cli(['resolve', '--propose'], dir);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /automate-pr-resolve has no open failure\./);
});

test('inspect needs one pull request URL', () => {
  assert.equal(cli(['inspect']).code, 4);
  assert.match(cli(['inspect', 'https://github.com/acme/demo-app/issues/9']).stderr, /is not a pull request URL/);
  assert.equal(cli(['inspect', PR, 'extra']).code, 4);
  assert.equal(cli(['https://github.com/acme/demo-app/pulls']).code, 4);
});

test('inspect prints the intake summary', () => {
  const { code, stdout, stderr } = cli(['inspect', CANVAS_PR], base, ghEnv);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^acme\/demo-app#101 {2}Add a sample canvas extension$/m);
  assert.match(stdout, /^ {2}alias {4}sample-canvas$/m);
});

test('context validate reports one line per rule, and fails on a form with problems', () => {
  const holder = path.join(base, 'validate-root');
  const dir = path.join(holder, 'automate-pr-sample-canvas');
  mkdirSync(dir, { recursive: true });
  const env = ownSettings('validate', { root: holder });
  const form = readFileSync(path.join(codeRoot, 'test', 'fixtures', 'context-filled.md'), 'utf8')
    .replace('- **Test folder root**: <!-- filled in by the test -->', `- **Test folder root**: ${holder}`)
    .replace('- **Local Repository**: <!-- filled in by the test -->', '- **Local Repository**:')
    .replace('- **Commit Solution**: true', '- **Commit Solution**: false')
    .replace('  - **Local Commit**: true', '  - **Local Commit**: false');
  writeFileSync(path.join(dir, 'context.md'), form);

  const { code, stdout, stderr } = cli(['context', 'validate'], dir, { ...ghEnv, [CONFIG_DIR_VAR]: env[CONFIG_DIR_VAR] });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^A\.I\. Tool +claude .+ +pass$/m);
  assert.match(stdout, /^Test folder +automate-pr-sample-canvas is the current folder +pass$/m);
  assert.match(stdout, /^Merged PR +acme\/demo-app#101, merged +pass$/m);
  assert.match(stdout, /^Commit Solution +false$/m);

  const broken = path.join(dir, 'broken-context.md');
  writeFileSync(broken, form.replace('- **Find Issue**: true', '- **Find Issue**: maybe'));
  const invalid = cli(['context', 'validate', broken], dir, { ...ghEnv, [CONFIG_DIR_VAR]: env[CONFIG_DIR_VAR] });
  assert.equal(invalid.code, 4);
  assert.match(invalid.stderr, /^broken-context\.md:16: Find Issue takes true or false, not "maybe"\.$/m);

  assert.equal(cli(['context', 'check'], dir).code, 4);
  assert.equal(cli(['context', 'validate', path.join(dir, 'missing.md')], dir).code, 2);
});

test('setup needs a known assistant', () => {
  const dir = copyNamed('acme-setup');
  assert.equal(cli(['setup'], dir).code, 4);
  assert.equal(cli(['setup', '--assistant', 'other'], dir).code, 4);
  assert.equal(cli(['setup', '--assistant', 'claude', 'extra'], dir).code, 4);
});

test('outside a test folder, a pull request URL needs a root folder to put the test in', () => {
  const env = ownSettings('no-root-url');
  const { code, stderr } = cli([CANVAS_PR], base, { ...ghEnv, [CONFIG_DIR_VAR]: env[CONFIG_DIR_VAR] });
  assert.equal(code, 4);
  assert.match(stderr, /No root folder is configured to hold the test folders/);
  assert.match(stderr, /auto-check config set root <folder>/);
});

test('session A: a pull request URL asks for the root and the name, then writes the check', async () => {
  const holder = path.join(base, 'session-a');
  mkdirSync(holder, { recursive: true });
  const env = { ...ghEnv, [CONFIG_DIR_VAR]: ownSettings('session-a')[CONFIG_DIR_VAR] };
  const first = await onTerminal([CANVAS_PR, '--dry-run'], { env, answers: [holder, 'automate-pr-mine'] });
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /^No root folder is configured to hold the test folders\.$/m);
  assert.match(first.stdout, /To use the current folder, enter "\."\./);
  assert.match(first.stdout, /No -n, --name was given\. What should the test folder be called\? \[automate-pr-sample-canvas\]/);
  assert.ok(first.stdout.includes(`Root: ${holder} (saved in the auto-check user settings)`));
  const dir = path.join(holder, 'automate-pr-mine');
  assert.ok(first.stdout.includes(`Test folder: ${dir}`));
  assert.match(first.stdout, /^Wrote: context\.md, test-configuration\.md, \.gitignore$/m);

  const form = readFileSync(path.join(dir, 'context.md'), 'utf8');
  assert.ok(form.includes(`- **Test folder root**: ${holder} `));
  assert.match(form, /^- \*\*Test folder name\*\*: automate-pr-mine /m);
  assert.match(form, /^- \*\*Merged PR URI\*\*: https:\/\/github\.com\/acme\/demo-app\/pull\/101 /m);
  assert.match(form, /^- \*\*Find Issue\*\*: true /m);
  assert.match(first.stdout, /^Dry run: no assistant was started and nothing was cloned\.$/m);
  assert.equal(JSON.parse(readFileSync(path.join(env[CONFIG_DIR_VAR], SETTINGS_FILE), 'utf8')).root, holder);

  const dot = await onTerminal([CANVAS_PR, '--dry-run'], {
    cwd: holder,
    env: { ...ghEnv, [CONFIG_DIR_VAR]: ownSettings('session-a-dot')[CONFIG_DIR_VAR] },
    answers: ['.', ''],
  });
  assert.equal(dot.code, 0, dot.stderr);
  assert.ok(existsSync(path.join(holder, 'automate-pr-sample-canvas', 'context.md')));

  const clone = path.join(base, 'demo-app');
  mkdirSync(clone, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: clone });
  spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/demo-app.git'], { cwd: clone });
  const again = cli([OPEN_PR, '--name', 'automate-pr-second', '--unmerged', clone, '--dry-run'], base, { ...ghEnv, [CONFIG_DIR_VAR]: env[CONFIG_DIR_VAR] });
  assert.equal(again.code, 0, again.stderr);
  assert.ok(existsSync(path.join(holder, 'automate-pr-second', 'context.md')));
});

test('session B: --name and --edit-context fill in the form before the check is written', () => {
  const holder = path.join(base, 'session-b');
  mkdirSync(holder, { recursive: true });
  const env = ownSettings('session-b', { root: holder });
  const editor = path.join(base, 'fill-form.mjs');
  writeFileSync(editor, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    'const file = process.argv[process.argv.length - 1];',
    "let text = readFileSync(file, 'utf8');",
    "text = text.replace('- Command: <!--', '- Command: claude <!--');",
    "text = text.replace('- **PR Context**: <!--', '- **PR Context**: A drawing surface in the side panel. <!--');",
    'writeFileSync(file, text);',
    '',
  ].join('\n'));
  const withEditor = {
    ...ghEnv,
    [CONFIG_DIR_VAR]: env[CONFIG_DIR_VAR],
    EDITOR: `"${process.execPath}" "${editor}"`,
  };
  const { code, stdout, stderr } = cli([CANVAS_PR, '--name', 'automate-pr-edited', '--edit-context', '--dry-run'], base, withEditor);
  assert.equal(code, 0, stderr);
  const dir = path.join(holder, 'automate-pr-edited');
  const form = readFileSync(path.join(dir, 'context.md'), 'utf8');
  assert.match(form, /^- Command: claude /m);
  assert.match(form, /^- \*\*PR Context\*\*: A drawing surface in the side panel\. /m);
  assert.match(stdout, /^Dry run: no assistant was started and nothing was cloned\.$/m);
  const prompt = readFileSync(path.join(dir, 'generate.prompt.md'), 'utf8');
  assert.match(prompt, /A drawing surface in the side panel\./);
});

test('session C: a bare run checks the form, then writes the check', () => {
  const holder = path.join(base, 'session-c');
  mkdirSync(holder, { recursive: true });
  const env = { ...ghEnv, [CONFIG_DIR_VAR]: ownSettings('session-c', { root: holder })[CONFIG_DIR_VAR] };
  const scaffolded = cli(['--name', 'automate-pr-bare'], base, env);
  assert.equal(scaffolded.code, 0, scaffolded.stderr);
  const dir = path.join(holder, 'automate-pr-bare');

  const empty = cli([], dir, env);
  assert.equal(empty.code, 4);
  assert.match(empty.stdout, /^Merged PR +no pull request URL is filled in +fail$/m);
  assert.match(empty.stderr, /^context\.md:\d+: Merged PR URI is required/m);

  const form = path.join(dir, 'context.md');
  writeFileSync(form, readFileSync(form, 'utf8').replace('- **Merged PR URI**: <!--', `- **Merged PR URI**: ${CANVAS_PR} <!--`));
  const filled = cli([], dir, env);
  assert.equal(filled.code, 2, filled.stderr);
  assert.match(filled.stdout, /^Test folder +automate-pr-bare is the current folder +pass$/m);
  assert.match(filled.stdout, /^Merged PR +acme\/demo-app#101, merged +pass$/m);
  assert.match(filled.stdout, /^No check here yet, so claude writes one for /m);
  assert.match(filled.stderr, /^Pull request: acme\/demo-app#101, source \/ gui-canvas-extension$/m);
  assert.match(filled.stderr, /git clone failed|not available on this machine/);
});

test('a bare run in a folder that holds a check reports where it stands', () => {
  const dir = copyWithCheck('automate-pr-standing');
  writeFileSync(path.join(dir, 'context.md'), [
    '# `automate-merged-pr-check`',
    '',
    '## Test Context',
    '',
    `- **Test folder root**: ${base}`,
    '- **Test folder name**: automate-pr-standing',
    `- **Merged PR URI**: ${CANVAS_PR}`,
    '- **Find Issue**: true',
    '',
  ].join('\n'));
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    lastRun: { at: '2026-01-02T03:15:00.000Z', outcome: 'fail', resultDir: 'results/2026-01-02T03-15-00' },
    openResolution: { day: '01-02-2026', foundIssue: 'found-issue/01-02-2026/found-issue.md' },
  }));
  mkdirSync(path.join(dir, 'results', '2026-01-02T03-15-00'), { recursive: true });
  writeFileSync(path.join(dir, 'results', '2026-01-02T03-15-00', 'result.json'), JSON.stringify({ outcome: 'fail' }));
  const { code, stdout, stderr } = cli([], dir, ghEnv);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^Wrote test-configuration\.md with the defaults\.$/m);
  assert.match(stdout, /^Scheduled runs +skipped after a failed run +pass$/m);
  assert.match(stdout, /^Results kept +7 run folders +pass$/m);
  assert.match(stdout, /^Notifications +off +pass$/m);
  assert.match(stdout, /^Refreshed AGENTS\.md, CLAUDE\.md, and \d+ skills in \.claude\/skills\.$/m);
  assert.match(stdout, /^Check +acme-demo-app-pr-123, source \/ gui-canvas-extension$/m);
  assert.match(stdout, /^Last run +fail at 2026-01-02T03:15:00\.000Z, results\/2026-01-02T03-15-00$/m);
  assert.match(stdout, /^Next run +auto-check[- ]automate-pr-standing[^\n]* at [^\n]+ \(skipped: the last run failed, results\/2026-01-02T03-15-00\)$/m);
  assert.match(stdout, /^Open failure +found-issue[\\/]01-02-2026[\\/]found-issue\.md$/m);
  assert.match(stdout, /^Next steps +auto-check run, auto-check schedule status, auto-check resolve --propose$/m);
  assert.equal(readFileSync(path.join(dir, 'test-configuration.md'), 'utf8'), newTestConfig());
  for (const file of ['AGENTS.md', 'CLAUDE.md', path.join('.claude', 'skills', 'auto-check-context', 'SKILL.md')]) {
    assert.ok(existsSync(path.join(dir, file)), file);
  }

  const edited = newTestConfig().replace('**Number of Test**: 7', '**Number of Test**: 2');
  writeFileSync(path.join(dir, 'test-configuration.md'), edited);
  const again = cli([], dir, ghEnv);
  assert.equal(again.code, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /^Wrote test-configuration\.md/m);
  assert.match(again.stdout, /^Results kept +2 run folders +pass$/m);
  assert.equal(readFileSync(path.join(dir, 'test-configuration.md'), 'utf8'), edited);

  writeFileSync(path.join(dir, 'test-configuration.md'), edited.replace('**Turn Off on Failed Test**: true', '**Turn Off on Failed Test**: maybe'));
  const invalid = cli([], dir, ghEnv);
  assert.equal(invalid.code, 4);
  assert.match(invalid.stderr, /^test-configuration\.md:5: Turn Off on Failed Test takes true or false, not "maybe"\.$/m);
  assert.doesNotMatch(invalid.stdout, /^Check +/m);
});

test('context validate checks test-configuration.md by its name, and both forms without a path', () => {
  const holder = path.join(base, 'validate-config-root');
  const dir = path.join(holder, 'automate-pr-sample-canvas');
  mkdirSync(dir, { recursive: true });
  const env = { ...ghEnv, [CONFIG_DIR_VAR]: ownSettings('validate-config', { root: holder })[CONFIG_DIR_VAR] };
  const form = readFileSync(path.join(codeRoot, 'test', 'fixtures', 'context-filled.md'), 'utf8')
    .replace('- **Test folder root**: <!-- filled in by the test -->', `- **Test folder root**: ${holder}`)
    .replace('- **Local Repository**: <!-- filled in by the test -->', '- **Local Repository**:')
    .replace('- **Commit Solution**: true', '- **Commit Solution**: false')
    .replace('  - **Local Commit**: true', '  - **Local Commit**: false');
  writeFileSync(path.join(dir, 'context.md'), form);

  const without = cli(['context', 'validate'], dir, env);
  assert.equal(without.code, 0, without.stderr);
  assert.match(without.stdout, /^Merged PR +acme\/demo-app#101, merged +pass$/m);
  assert.match(without.stdout, /^test-configuration\.md: none, so the settings decide what is kept and who is notified\./m);
  assert.equal(existsSync(path.join(dir, 'test-configuration.md')), false);

  writeFileSync(path.join(dir, 'test-configuration.md'), newTestConfig()
    .replace('**Send Notifications**: false', '**Send Notifications**: true')
    .replace('**Notify when Test**: null', '**Notify when Test**: sometimes'));
  const both = cli(['context', 'validate'], dir, env);
  assert.equal(both.code, 4);
  assert.match(both.stdout, /^Merged PR +acme\/demo-app#101, merged +pass$/m);
  assert.match(both.stdout, /^Notifications +Notify when Test takes pass, fail, or both, not "sometimes"\. +fail$/m);
  assert.match(both.stderr, /^test-configuration\.md:12: Notify when Test takes pass, fail, or both, not "sometimes"\.$/m);

  const one = cli(['context', 'validate', 'test-configuration.md'], dir, env);
  assert.equal(one.code, 4);
  assert.doesNotMatch(one.stdout, /^Merged PR/m);
  assert.match(one.stdout, /^Scheduled runs +skipped after a failed run +pass$/m);
  assert.match(one.stderr, /^test-configuration\.md:12: /m);
});
