import { spawnSync } from 'node:child_process';
import { askLine, interactive } from './test-folder.mjs';
import { capture, firstLine } from './util/which.mjs';

/** Raised when the form cannot be opened for editing. */
export class EditorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditorError';
    this.exitCode = 2;
  }
}

/**
 * The editor command to open the form with: VISUAL, then EDITOR, then git's
 * own editor, then Notepad on Windows or vi elsewhere. The command may carry
 * arguments, such as `code --wait`, because it runs through the shell.
 */
export function editorCommand({ env = process.env, platform = process.platform, gitEditor = readGitEditor } = {}) {
  const named = [env.VISUAL, env.EDITOR].map((value) => String(value ?? '').trim()).find(Boolean);
  if (named) return { command: named, from: env.VISUAL?.trim() ? 'VISUAL' : 'EDITOR' };
  const git = String(gitEditor() ?? '').trim();
  if (git) return { command: git, from: 'git var GIT_EDITOR' };
  return platform === 'win32' ? { command: 'notepad.exe', from: 'default' } : { command: 'vi', from: 'default' };
}

function readGitEditor() {
  const result = capture('git', ['var', 'GIT_EDITOR']);
  return result.status === 0 ? firstLine(result.stdout) : '';
}

/**
 * Opens `file` in the terminal's editor and waits for it to close. The command
 * runs through the shell, so an editor with arguments works as written.
 */
export function openEditor(file, { env = process.env, platform = process.platform, spawn = spawnSync, ...options } = {}) {
  const { command, from } = editorCommand({ env, platform, ...options });
  const result = spawn(`${command} "${file}"`, { shell: true, stdio: 'inherit', env });
  if (result.error) throw new EditorError(`${command} could not start: ${result.error.message} (editor from ${from})`);
  if (result.status !== 0) {
    throw new EditorError(`${command} ended with exit code ${result.status} and the form was not saved (editor from ${from}).`);
  }
  return { command, from };
}

/**
 * Opens the form, then validates it. On a terminal a form with problems is
 * offered for another round of editing; without one the problems are returned.
 * `validate` returns { ok, lines } for the form as it stands.
 */
export async function editForm({ file, validate, io, env = process.env, platform = process.platform, spawn = spawnSync, rounds = 5 }) {
  let opened = null;
  for (let round = 0; round < rounds; round += 1) {
    opened = openEditor(file, { env, platform, spawn });
    const result = await validate();
    if (result.ok) return { ...result, edited: true, editor: opened.command };
    for (const line of result.lines ?? []) io.stderr.write(`${line}\n`);
    if (!interactive(io)) return { ...result, edited: true, editor: opened.command };
    const again = await askLine({ io, question: 'The form still has problems. Edit it again?', suggestion: 'Y/n' });
    if (/^n/i.test(again)) return { ...result, edited: true, editor: opened.command };
  }
  return { ok: false, lines: [`The form still has problems after ${rounds} rounds of editing.`], edited: true, editor: opened?.command };
}
