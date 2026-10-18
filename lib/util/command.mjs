import { spawnSync } from 'node:child_process';

/** How a command reads when printed, quoting the arguments that need it. */
export function display({ file, args = [] }) {
  return [file, ...args].map((part) => (part === '' || /[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part)).join(' ');
}

/** Runs a command and returns its exit status and output, never throwing. */
export function execCommand({ file, args = [], input, cwd }) {
  const result = spawnSync(file, args, { input, cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.error) return { status: null, stdout: '', stderr: result.error.message };
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
