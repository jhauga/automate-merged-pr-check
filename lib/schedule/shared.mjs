import { readFileSync } from 'node:fs';
import path from 'node:path';
import { codeRoot } from '../paths.mjs';
import { display } from '../util/command.mjs';

/** The command a wrapper runs: bin/auto-check.mjs of the installed tool. */
export const toolBin = path.join(codeRoot, 'bin', 'auto-check.mjs');

/** Raised when a schedule cannot be planned or changed. */
export class ScheduleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScheduleError';
    this.exitCode = 2;
  }
}

/** Text of templates/schedule/<name> next to the code. */
export function readTemplate(name) {
  return readFileSync(path.join(codeRoot, 'templates', 'schedule', name), 'utf8');
}

/** The prefix every scheduled task auto-check installs carries. */
export const TASK_PREFIX = 'auto-check ';

/** Minutes past midnight of a local time. */
const minutesOf = (date) => date.getHours() * 60 + date.getMinutes();

/**
 * How far to move a task's first run so that it starts at the earliest time,
 * from `startTime` on in steps of `pad` minutes, that is at least `pad`
 * minutes from every other auto-check task on the machine. That keeps two
 * checks from driving the same desktop app at once. Returns 0 when there is
 * no other task, or when the start time is already clear.
 */
export function staggerMinutes({ startTime, tasks = [], pad = 30 }) {
  const runs = tasks.map((task) => task.nextRun).filter((run) => run instanceof Date && !Number.isNaN(run.getTime())).map(minutesOf);
  if (runs.length === 0) return 0;
  const [hours, minutes] = startTime.split(':').map(Number);
  const start = hours * 60 + minutes;
  const apart = (a, b) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));
  for (let offset = 0; offset < 1440; offset += pad) {
    if (runs.every((run) => apart((start + offset) % 1440, run) >= pad)) return offset;
  }
  return Math.max(0, Math.max(...runs) + pad - start);
}

/** The arguments a schedule that starts auto-check directly, on macOS and Linux, passes to auto-check run after the test folder. */
export function runArgs(phase = null) {
  return ['--scheduled', ...(phase ? ['--phase', phase] : [])];
}

const pad = (value) => String(value).padStart(2, '0');

/** The next local time at `startTime` (HH:MM) after `now`, moved by `offsetMinutes`. */
export function nextStart(startTime, now = new Date(), offsetMinutes = 0) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const start = new Date(now);
  start.setHours(hours, minutes, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 1);
  return new Date(start.getTime() + offsetMinutes * 60 * 1000);
}

/** A local date and time as YYYY-MM-DDTHH:MM:SS, with no time zone. */
export function localStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

/** The task names a check's schedule uses: one, or a start and a collect task for a two-step check. */
export function phasesOf(check) {
  return check.runMode === 'two-step' ? ['start', 'collect'] : [null];
}

/** How long the operating system lets one scheduled run take, in minutes. */
export function timeLimitOf(check) {
  return (Number(check.timeoutMinutes) > 0 ? Number(check.timeoutMinutes) : 15) * 2 + 15;
}

export { display, pad };
