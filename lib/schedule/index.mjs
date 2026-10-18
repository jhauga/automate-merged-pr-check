import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { planLinux } from './linux.mjs';
import { planMacos } from './macos.mjs';
import { display, execCommand } from '../util/command.mjs';
import { ScheduleError, TASK_PREFIX, staggerMinutes } from './shared.mjs';
import { planWindows } from './windows.mjs';

export { ScheduleError, TASK_PREFIX, display, execCommand, staggerMinutes };

/** Schedule actions the command line offers. */
export const ACTIONS = Object.freeze(['install', 'remove', 'status']);

/** True when this process runs with administrator rights on Windows. */
export function isElevated() {
  if (process.platform !== 'win32') return false;
  return spawnSync('net', ['session'], { windowsHide: true, stdio: 'ignore' }).status === 0;
}

/** True for a path that is absolute on Windows or on a POSIX system. */
function isAbsoluteAnywhere(value) {
  return path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

/** The last part of a path, whichever separator it uses. */
function folderName(value) {
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

/** One row of `schtasks /Query /FO CSV /V`, split on commas outside quotes. */
export function csvRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

/** The auto-check tasks in `schtasks /Query /FO CSV /V` output, with their next run and their wrapper. */
export function parseWindowsTasks(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const header = csvRow(lines[0]).map((cell) => cell.trim().toLowerCase());
  const column = (name) => header.indexOf(name);
  const nameAt = column('taskname');
  const runAt = column('next run time');
  const commandAt = column('task to run');
  if (nameAt === -1) return [];
  const tasks = [];
  for (const line of lines.slice(1)) {
    const cells = csvRow(line);
    const full = (cells[nameAt] ?? '').trim();
    const name = full.replace(/^\\+/, '');
    if (!name.startsWith(TASK_PREFIX)) continue;
    const when = runAt === -1 ? '' : (cells[runAt] ?? '').trim();
    const parsed = when && !/^n\/a|disabled/i.test(when) ? new Date(when) : null;
    tasks.push({
      name,
      nextRun: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      command: commandAt === -1 ? '' : (cells[commandAt] ?? '').trim(),
    });
  }
  return tasks;
}

/**
 * The auto-check tasks the operating system already holds, each with its next
 * run and the wrapper it runs. Only Windows is read; the other platforms come
 * back empty until their schedules are verified.
 */
export function listInstalled({ platform = process.platform, exec = execCommand } = {}) {
  if (platform !== 'win32') return [];
  const result = exec({ file: 'schtasks', args: ['/Query', '/FO', 'CSV', '/V'] });
  if (result.status !== 0) return [];
  return parseWindowsTasks(result.stdout);
}

/** The test folder a task's wrapper belongs to: the folder above its schedule folder. */
export function taskTestFolder(command) {
  const match = /([^"]+)[\\/]schedule[\\/]run\.cmd/i.exec(String(command ?? ''));
  return match ? match[1] : null;
}

/**
 * The schedule for one test folder on `platform`: the files to write, the
 * commands for each action, and a one-line summary. Plans nothing on disk;
 * `check` is the check's settings with `schedule` already resolved against the
 * user settings. The task is named after the test folder.
 */
export function planSchedule({ testFolder, check, platform = process.platform, node = process.execPath, now = new Date(), stagger = 0, home, uid, elevated }) {
  const root = isAbsoluteAnywhere(testFolder) ? testFolder : path.resolve(testFolder);
  const options = { root, name: folderName(root), check, settings: check.schedule, node, now, stagger };
  if (platform === 'win32') return planWindows({ ...options, elevated: elevated ?? isElevated() });
  if (platform === 'darwin') return planMacos({ ...options, home, uid });
  return planLinux({ ...options, home });
}

const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

function runCrontab({ owns, add }, { exec, dryRun, lines }) {
  if (dryRun) {
    lines.push(add.length > 0 ? `Would add to the crontab:\n${add.map((line) => `  ${line}`).join('\n')}` : 'Would remove the check\'s lines from the crontab');
    return;
  }
  const current = exec({ file: 'crontab', args: ['-l'] });
  const kept = (current.status === 0 ? current.stdout : '').split(/\r?\n/).filter((line) => line !== '' && !owns(line));
  const written = exec({ file: 'crontab', args: ['-'], input: `${[...kept, ...add].join('\n')}\n` });
  if (written.status !== 0) throw new ScheduleError(`crontab - failed: ${firstLine(written.stderr || written.stdout)}`);
}

/**
 * Carries out `action` (install, remove, status, or pause) for a planned
 * schedule. With `dryRun` it changes nothing and says what it would do.
 * Returns the lines to print.
 */
export function applySchedule(action, plan, { dryRun = false, exec = execCommand } = {}) {
  const lines = [];
  if (action === 'install') {
    for (const dir of plan.dirs ?? []) {
      if (!dryRun) mkdirSync(dir, { recursive: true });
    }
    for (const file of plan.files) {
      if (dryRun) {
        lines.push(`Would write ${file.path}`);
      } else {
        mkdirSync(path.dirname(file.path), { recursive: true });
        writeFileSync(file.path, file.data);
      }
    }
  }
  const outputs = [];
  const run = (steps) => {
    for (const step of steps ?? []) {
      if (step.crontab) {
        runCrontab(step.crontab, { exec, dryRun, lines });
      } else if (dryRun && action !== 'status') {
        lines.push(`Would run: ${display(step.run)}`);
      } else {
        const result = exec(step.run);
        outputs.push({ step, result });
        if (result.status !== 0 && !step.allowFail) {
          throw new ScheduleError(`${display(step.run)} failed: ${firstLine(result.stderr || result.stdout) || `exit code ${result.status}`}`);
        }
      }
    }
  };
  run(plan.steps[action]);
  if (action === 'remove') {
    for (const file of plan.files) {
      if (dryRun) lines.push(`Would delete ${file.path}`);
      else rmSync(file.path, { force: true });
    }
    run(plan.steps.afterRemove);
  }
  if (action === 'status') lines.push(...plan.describeStatus(outputs));
  return lines;
}
