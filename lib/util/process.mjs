import { spawn, spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

/** Characters cmd.exe treats specially; arguments holding them never go through it. */
const CMD_UNSAFE = /["%!^&|<>\r\n]/;

function stopTree(child) {
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Runs a launcher from resolveCommand with extra arguments, optional stdin
 * text, and a timeout that stops the whole process tree. Resolves with the
 * exit code, the captured output, and whether the timeout fired; a process
 * that cannot start resolves with `error` set.
 */
export function runProcess({ launcher, args = [], cwd, input, timeoutMs, env = process.env }) {
  return new Promise((resolve) => {
    let command = launcher.file;
    let commandArgs = [...launcher.args, ...args];
    let shell = false;
    if (launcher.shell) {
      const unsafe = commandArgs.find((arg) => CMD_UNSAFE.test(arg));
      if (unsafe !== undefined) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          error: new Error(`${launcher.file} only starts through cmd.exe, which cannot pass ${JSON.stringify(unsafe)} safely.`),
        });
        return;
      }
      command = [launcher.file, ...commandArgs].map((part) => `"${part}"`).join(' ');
      commandArgs = [];
      shell = true;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, ...outcome });
    };

    const child = spawn(command, commandArgs, { cwd, env, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        stopTree(child);
      }, timeoutMs);
    }
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish({ exitCode: null, error }));
    child.on('close', (code) => finish({ exitCode: code }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
