import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { AssistantError, assistantFor, createAssistant } from '../lib/assistants/index.mjs';
import { defaults } from '../lib/config.mjs';

// Stands in for an assistant CLI: records its arguments, stdin, and working
// folder next to itself, then prints a reply.
const FAKE = `import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const argv = process.argv.slice(2);
  const env = Object.keys(process.env).filter((key) => /^(claude|mcp_)/i.test(key)).sort();
  const record = { argv, stdin: Buffer.concat(chunks).toString('utf8'), cwd: process.cwd(), env };
  writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'record.json'), JSON.stringify(record));
  process.stdout.write(argv.includes('json')
    ? JSON.stringify({ type: 'result', result: 'done', session_id: '00000000-0000-4000-8000-000000000001' })
    : 'fake output\\n');
});
`;

let dir;
let fake;
let promptFile;
let shot;
let notes;

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-assistants-'));
  fake = path.join(dir, 'fake-assistant.mjs');
  writeFileSync(fake, FAKE);
  promptFile = path.join(dir, 'prompts', 'generate.prompt.md');
  mkdirSync(path.dirname(promptFile));
  writeFileSync(promptFile, '# Task\n\nWrite the check.\n');
  shot = path.join(dir, 'shots', 'view.png');
  notes = path.join(dir, 'shots', 'notes.txt');
  mkdirSync(path.dirname(shot));
  writeFileSync(shot, 'png');
  writeFileSync(notes, 'notes');
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const record = () => JSON.parse(readFileSync(path.join(dir, 'record.json'), 'utf8'));

function assistant(name, change = () => {}) {
  const config = defaults();
  change(config);
  return createAssistant(name, { config, fakeBinary: fake });
}

test('Claude Code gets the prompt on stdin, its model, effort, bypass, and folders last', async () => {
  const work = path.join(dir, 'work');
  const outputFile = path.join(dir, 'out', 'claude.txt');
  const result = await assistant('claude').run({ promptFile, cwd: dir, effort: 'high', addDirs: [work], attachments: [shot], outputFile });
  assert.equal(result.exitCode, 0);
  const { argv, stdin, cwd } = record();
  assert.deepEqual(argv, [
    '--print',
    '--model', 'opus',
    '--effort', 'high',
    '--dangerously-skip-permissions',
    '--add-dir', path.dirname(promptFile), work, path.dirname(shot),
  ]);
  assert.ok(stdin.startsWith('# Task\n\nWrite the check.\n'));
  assert.ok(stdin.includes(`- ${shot}`));
  assert.equal(path.resolve(cwd), path.resolve(dir));
  assert.equal(readFileSync(outputFile, 'utf8'), 'fake output\n');
  assert.equal(result.outputPath, outputFile);
});

test('Claude Code uses the test-driver model and lower permission modes when asked', () => {
  const driver = assistant('claude').plan({ promptFile, role: 'testDriver' });
  assert.deepEqual(driver.args.slice(0, 3), ['--print', '--model', 'haiku']);
  const edits = assistant('claude', (config) => {
    config.assistants.claude.permissionMode = 'acceptEdits';
  }).plan({ promptFile });
  assert.ok(edits.args.join(' ').includes('--permission-mode acceptEdits'));
  assert.ok(!edits.args.includes('--dangerously-skip-permissions'));
  const plain = assistant('claude', (config) => {
    config.assistants.claude.permissionMode = 'default';
  }).plan({ promptFile });
  assert.ok(!plain.args.some((arg) => /permission/.test(arg)));
});

test('Claude Code returns the session id from structured output', async () => {
  const result = await assistant('claude').run({ promptFile, structured: true, sessionName: 'auto-check sample-canvas' });
  const { argv } = record();
  assert.ok(argv.join(' ').includes('--output-format json'));
  assert.ok(argv.join(' ').includes('--name auto-check sample-canvas'));
  assert.equal(result.sessionId, '00000000-0000-4000-8000-000000000001');
});

test('Copilot CLI gets a pointer prompt, --allow-all-tools, the low-cost tier, and one --attachment per file', async () => {
  const transcript = path.join(dir, 'out', 'session.md');
  await assistant('copilot').run({
    promptFile,
    role: 'testDriver',
    attachments: [shot, notes],
    sessionName: 'auto-check sample-canvas',
    transcriptFile: transcript,
  });
  const { argv, stdin } = record();
  assert.deepEqual(argv, [
    '-p', `Read the file ${promptFile} and carry out the instructions in it. That file is the complete task.`,
    '--allow-all-tools',
    '-s',
    '--model', 'auto',
    '--auto-tier', 'efficiency',
    '--name', 'auto-check sample-canvas',
    '--add-dir', path.dirname(promptFile),
    '--attachment', shot,
    '--attachment', notes,
    '--share', transcript,
  ]);
  assert.equal(stdin, '');
});

test('Copilot CLI keeps the routing tier for the test driver only and resumes by name', () => {
  const generate = assistant('copilot').plan({ promptFile, resume: 'auto-check sample-canvas', effort: 'low' });
  assert.ok(!generate.args.includes('--auto-tier'));
  assert.ok(generate.args.join(' ').includes('--resume auto-check sample-canvas'));
  assert.ok(generate.args.join(' ').includes('--reasoning-effort low'));
});

test('Copilot CLI refuses to run unattended without --allow-all-tools', () => {
  const restricted = assistant('copilot', (config) => {
    config.assistants.copilot.permissionMode = 'default';
  });
  assert.throws(() => restricted.plan({ promptFile }), (error) => error instanceof AssistantError && /allow-all-tools/.test(error.message));
});

test('Codex runs exec with the prompt on stdin, images as --image, and other files listed', async () => {
  await assistant('codex').run({ promptFile, attachments: [shot, notes] });
  const { argv, stdin } = record();
  assert.deepEqual(argv, ['--add-dir', path.dirname(promptFile), 'exec', '--sandbox', 'workspace-write', '--image', shot, '-']);
  assert.ok(stdin.startsWith('# Task'));
  assert.ok(stdin.includes(`- ${notes}`));
  assert.ok(!stdin.includes(`- ${shot}`));
  assert.throws(() => assistant('codex').plan({ promptFile, resume: 'last' }), AssistantError);
});

test('an assistant that is not on PATH is unavailable', async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), 'auto-check-empty-path-'));
  try {
    const missing = createAssistant('codex', { config: defaults(), env: { PATH: empty, PATHEXT: '.EXE;.CMD' } });
    assert.equal(missing.available(), false);
    await assert.rejects(missing.run({ promptFile }), (error) => error instanceof AssistantError && /not on PATH/.test(error.message));
    assert.equal(assistant('codex').available(), true);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a run past its timeout is stopped and reported', async () => {
  const sleeper = path.join(dir, 'sleeper.mjs');
  writeFileSync(sleeper, 'setTimeout(() => {}, 60000);\n');
  const slow = createAssistant('claude', { config: defaults(), fakeBinary: sleeper });
  const started = Date.now();
  const result = await slow.run({ promptFile, timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.ok(Date.now() - started < 15000);
});

test('bad requests fail before anything starts', () => {
  const claude = assistant('claude');
  assert.throws(() => claude.plan({}), AssistantError);
  assert.throws(() => claude.plan({ promptFile: path.join(dir, 'missing.md') }), /Prompt file not found/);
  assert.throws(() => claude.plan({ promptFile, role: 'reviewer' }), /Unknown model role/);
  assert.throws(() => claude.plan({ promptFile, effort: 'extreme' }), /effort must be one of/);
  assert.throws(() => createAssistant('other', { config: defaults() }), /Unknown assistant/);
  assert.equal(assistantFor(defaults(), { fakeBinary: fake }).name, 'claude');
});

test('Claude Code starts as a session of its own, without the variables a parent session sets', async () => {
  const env = {
    ...process.env,
    CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'parent-session',
    CLAUDE_CODE_MESSAGING_SOCKET: 'parent-socket',
    CLAUDE_PID: '1234',
    CLAUDE_CONFIG_DIR: dir,
  };
  await createAssistant('claude', { config: defaults(), fakeBinary: fake, env }).run({ promptFile, cwd: dir });
  const { env: seen } = JSON.parse(readFileSync(path.join(dir, 'record.json'), 'utf8'));
  assert.ok(seen.includes('CLAUDE_CONFIG_DIR'));
  for (const name of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_PID']) {
    assert.ok(!seen.includes(name), name);
  }
});

test('the configured effort reaches each command through its own option', () => {
  const config = defaults();
  config.models.claude.effort = 'xhigh';
  config.models.copilot.effort = 'high';
  config.models.codex.effort = 'medium';
  const claude = createAssistant('claude', { config }).plan({ promptFile, cwd: dir });
  assert.deepEqual(claude.args.slice(0, 5), ['--print', '--model', 'opus', '--effort', 'xhigh']);

  const copilot = createAssistant('copilot', { config }).plan({ promptFile, cwd: dir });
  assert.ok(copilot.args.includes('--reasoning-effort'));
  assert.equal(copilot.args[copilot.args.indexOf('--reasoning-effort') + 1], 'high');

  const codex = createAssistant('codex', { config }).plan({ promptFile, cwd: dir, model: 'gpt-5-codex' });
  assert.ok(codex.args.includes('-m'));
  assert.equal(codex.args[codex.args.indexOf('-m') + 1], 'gpt-5-codex');
  assert.ok(codex.args.includes('-c'));
  assert.equal(codex.args[codex.args.indexOf('-c') + 1], 'model_reasoning_effort=medium');

  const asked = createAssistant('claude', { config }).plan({ promptFile, cwd: dir, effort: 'low' });
  assert.equal(asked.args[asked.args.indexOf('--effort') + 1], 'low');
});
