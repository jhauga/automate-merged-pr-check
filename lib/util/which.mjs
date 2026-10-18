import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves a command name to an executable on PATH, trying each PATHEXT
 * extension on Windows. Returns the full path, or null when it is not found.
 */
export function which(command, env = process.env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = isWindows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, command + extension);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Script that an npm .cmd shim hands to node, such as
 * node_modules\pkg\cli.js next to the shim. Returns null for other shims.
 */
export function shimScript(shimText, shimDir) {
  const match = /"%(?:~dp0|dp0%)\\?([^"%]+\.[cm]?js)"/i.exec(shimText);
  return match ? path.join(shimDir, match[1]) : null;
}

/**
 * How to start an executable without a shell. An npm .cmd shim starts as
 * node plus the script it wraps, which avoids cmd.exe and its quoting and
 * length limits. Any other .cmd or .bat file comes back with `shell: true`.
 */
export function launcherFor(file) {
  if (!isWindows || !/\.(cmd|bat)$/i.test(file)) return { file, args: [] };
  const script = shimScript(readFileSync(file, 'utf8'), path.dirname(file));
  if (script && existsSync(script)) {
    const localNode = path.join(path.dirname(file), 'node.exe');
    return { file: existsSync(localNode) ? localNode : process.execPath, args: [script] };
  }
  return { file, args: [], shell: true };
}

/** Launcher for a command on PATH, or null when the command is not found. */
export function resolveCommand(command, env = process.env) {
  const file = which(command, env);
  return file ? launcherFor(file) : null;
}

/**
 * Runs an executable with fixed arguments and captures its output. Files
 * that still need cmd.exe get their arguments quoted; callers pass internal
 * constants, never user input.
 */
export function capture(file, args = [], { timeoutMs = 20000, cwd, input } = {}) {
  const launcher = launcherFor(file);
  const options = { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, cwd, input };
  const result = launcher.shell
    ? spawnSync([file, ...args].map((part) => `"${part}"`).join(' '), { ...options, shell: true })
    : spawnSync(launcher.file, [...launcher.args, ...args], options);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

/** First non-empty line of a command's output, trimmed. */
export function firstLine(text = '') {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
}
