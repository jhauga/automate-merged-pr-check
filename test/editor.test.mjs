import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, test } from 'node:test';
import { EditorError, editForm, editorCommand, openEditor } from '../lib/editor.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-editor-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const noGit = () => '';

/** A terminal that answers with `lines`. */
function fakeTerminal(lines = []) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  let written = '';
  for (const line of lines) stdin.write(`${line}\n`);
  return {
    io: { stdin, stdout: { write: (text) => { written += text; } }, stderr: { write: (text) => { written += text; } } },
    output: () => written,
  };
}

test('the editor comes from VISUAL, then EDITOR, then git, then the platform default', () => {
  assert.deepEqual(editorCommand({ env: { VISUAL: 'code --wait', EDITOR: 'vim' }, gitEditor: noGit }), { command: 'code --wait', from: 'VISUAL' });
  assert.deepEqual(editorCommand({ env: { EDITOR: 'vim' }, gitEditor: noGit }), { command: 'vim', from: 'EDITOR' });
  assert.deepEqual(editorCommand({ env: {}, gitEditor: () => 'nano' }), { command: 'nano', from: 'git var GIT_EDITOR' });
  assert.deepEqual(editorCommand({ env: {}, platform: 'win32', gitEditor: noGit }), { command: 'notepad.exe', from: 'default' });
  assert.deepEqual(editorCommand({ env: {}, platform: 'linux', gitEditor: noGit }), { command: 'vi', from: 'default' });
});

test('the editor runs through the shell with the file as its last argument', () => {
  const file = path.join(base, 'context.md');
  writeFileSync(file, '# Context\n');
  const calls = [];
  const spawn = (command, options) => {
    calls.push({ command, shell: options.shell, stdio: options.stdio });
    return { status: 0 };
  };
  const result = openEditor(file, { env: { EDITOR: 'code --wait' }, spawn, platform: 'linux' });
  assert.deepEqual(result, { command: 'code --wait', from: 'EDITOR' });
  assert.deepEqual(calls, [{ command: `code --wait "${file}"`, shell: true, stdio: 'inherit' }]);
});

test('an editor that cannot start, or ends badly, is an error', () => {
  const file = path.join(base, 'context.md');
  assert.throws(
    () => openEditor(file, { env: { EDITOR: 'no-such-editor' }, spawn: () => ({ error: new Error('spawn ENOENT') }), platform: 'linux' }),
    (error) => error instanceof EditorError && /could not start/.test(error.message),
  );
  assert.throws(
    () => openEditor(file, { env: { EDITOR: 'vi' }, spawn: () => ({ status: 1 }), platform: 'linux' }),
    (error) => error instanceof EditorError && /exit code 1/.test(error.message),
  );
});

test('a form with problems is offered for another round, and the answer decides', async () => {
  const file = path.join(base, 'loop.md');
  writeFileSync(file, 'first\n');
  let round = 0;
  const spawn = () => {
    round += 1;
    writeFileSync(file, `round ${round}\n`);
    return { status: 0 };
  };
  const validate = () => (round >= 2 ? { ok: true, lines: [] } : { ok: false, lines: [`loop.md:1: still wrong after round ${round}`] });

  const again = fakeTerminal(['y']);
  const fixed = await editForm({ file, validate, io: again.io, env: { EDITOR: 'vi' }, platform: 'linux', spawn });
  assert.equal(fixed.ok, true);
  assert.equal(round, 2);
  assert.match(again.output(), /still wrong after round 1/);
  assert.equal(readFileSync(file, 'utf8'), 'round 2\n');

  round = 0;
  const stop = fakeTerminal(['n']);
  const given = await editForm({ file, validate, io: stop.io, env: { EDITOR: 'vi' }, platform: 'linux', spawn });
  assert.equal(given.ok, false);
  assert.equal(round, 1);
});

test('without a terminal the problems come back after one round', async () => {
  const file = path.join(base, 'quiet.md');
  writeFileSync(file, 'nothing\n');
  const io = { stdin: new PassThrough(), stdout: { write: () => {} }, stderr: { write: () => {} } };
  const result = await editForm({
    file,
    validate: () => ({ ok: false, lines: ['quiet.md:1: wrong'] }),
    io,
    env: { EDITOR: 'vi' },
    platform: 'linux',
    spawn: () => ({ status: 0 }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ['quiet.md:1: wrong']);
});
