import os from 'node:os';
import nodePath from 'node:path';
import { fillTemplate } from '../util/template.mjs';
import { ScheduleError, pad, phasesOf, readTemplate, runArgs, timeLimitOf, toolBin } from './shared.mjs';

const path = nodePath.posix;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayList(field) {
  if (field === '*') return '';
  const names = DAYS.map((day) => day.toLowerCase());
  const index = (value) => {
    const number = /^\d+$/.test(value) ? Number(value) % 7 : names.indexOf(value.toLowerCase().slice(0, 3));
    if (number < 0 || Number.isNaN(number)) throw new ScheduleError(`"${value}" is not a day of the week.`);
    return number;
  };
  const days = new Set();
  for (const part of field.split(',')) {
    const [from, to] = part.split('-');
    if (to === undefined) {
      days.add(index(from));
    } else {
      for (let day = index(from); ; day = (day + 1) % 7) {
        days.add(day);
        if (day === index(to)) break;
      }
    }
  }
  return [...days].sort().map((day) => DAYS[day]).join(',');
}

/** Moves a cron expression with a fixed minute and hour by `offsetMinutes`, wrapping past midnight. */
export function shiftCron(expression, offsetMinutes) {
  if (!offsetMinutes) return expression;
  const [minute, hour, ...rest] = expression.trim().split(/\s+/);
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) {
    throw new ScheduleError(`A two-step check needs a fixed minute and hour in schedule.linux.cron, such as "0 3 * * *"; got "${expression}".`);
  }
  const total = (Number(hour) * 60 + Number(minute) + offsetMinutes) % (24 * 60);
  return [String(total % 60), String(Math.floor(total / 60)), ...rest].join(' ');
}

/**
 * The systemd OnCalendar form of a cron expression with a fixed minute and
 * hour, any day of the month and month, and any days of the week. Other
 * expressions need schedule.linux.unit set to "cron".
 */
export function cronToOnCalendar(expression) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.trim().split(/\s+/);
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || dayOfMonth !== '*' || month !== '*') {
    throw new ScheduleError(`systemd timers take cron expressions with a fixed minute and hour only, such as "0 3 * * *"; set schedule.linux.unit to "cron" for "${expression}".`);
  }
  const days = dayList(dayOfWeek);
  return `${days ? `${days} ` : ''}*-*-* ${pad(hour)}:${pad(minute)}:00`;
}

const systemdEscape = (value) => value.replace(/%/g, '%%');
const cronEscape = (value) => value.replace(/%/g, '\\%');

function ownsCronLine(root, testName) {
  return (line) => line.includes(`run "${root}"`) || line.startsWith(`# auto-check ${testName}:`) || line.startsWith(`# auto-check ${testName} collect:`);
}

function describeStatus(outputs) {
  return outputs.map(({ step, result }) => {
    if (step.crontabOwner) {
      const lines = result.status === 0 ? result.stdout.split(/\r?\n/).filter((line) => step.crontabOwner(line) && !line.startsWith('#')) : [];
      return lines.length > 0 ? `crontab:\n${lines.map((line) => `  ${line}`).join('\n')}` : 'crontab: not installed';
    }
    if (result.status !== 0) return `${step.task}: not installed`;
    const row = result.stdout.split(/\r?\n/).find((line) => line.includes(step.task));
    return row ? `${step.task}: ${row.trim().replace(/\s{2,}/g, ' | ')}` : `${step.task}: not installed`;
  });
}

/**
 * The Linux schedule of a check: systemd user timers in
 * ~/.config/systemd/user, or crontab lines when schedule.linux.unit is "cron".
 * Not yet verified on Linux.
 */
export function planLinux({ root, name: testName, check, settings, node, stagger = 0, home = os.homedir() }) {
  const linux = settings.linux;
  const phases = phasesOf(check);
  const steps = { install: [], remove: [], status: [], pause: [], afterRemove: [] };
  const tasks = [];
  const dirs = [path.join(root, 'logs')];

  if (linux.unit === 'cron') {
    const owns = ownsCronLine(root, testName);
    const lines = phases.flatMap((phase) => {
      const cron = shiftCron(linux.cron, stagger + (phase === 'collect' ? 60 : 0));
      tasks.push({ name: `crontab ${testName}${phase === 'collect' ? ' collect' : ''}`, phase, firstRun: cron });
      const text = fillTemplate(readTemplate('linux.cron'), {
        name: phase === 'collect' ? `${testName} collect` : testName,
        cron,
        root,
        tool: toolBin,
        node,
        args: runArgs(phase).join(' '),
      }, { escape: cronEscape, raw: ['cron'] });
      return text.split('\n').filter(Boolean);
    });
    steps.install.push({ crontab: { owns, add: lines } });
    steps.remove.push({ crontab: { owns, add: [] } });
    steps.pause.push({ crontab: { owns, add: [] } });
    steps.status.push({ run: { file: 'crontab', args: ['-l'] }, allowFail: true, crontabOwner: owns, task: 'crontab' });
    return { platform: 'linux', tasks, files: [], dirs, steps, summary: `crontab, "${linux.cron}"`, describeStatus };
  }

  const unitDir = path.join(home, '.config', 'systemd', 'user');
  const files = [];
  for (const phase of phases) {
    const unitName = `auto-check-${testName}${phase === 'collect' ? '-collect' : ''}`;
    const name = phase === 'collect' ? `${testName} collect` : testName;
    const onCalendar = cronToOnCalendar(shiftCron(linux.cron, stagger + (phase === 'collect' ? 60 : 0)));
    files.push({
      path: path.join(unitDir, `${unitName}.service`),
      data: fillTemplate(readTemplate('linux.service'), { name, unitName, root, tool: toolBin, node, args: runArgs(phase).join(' '), timeLimitMinutes: timeLimitOf(check) }, { escape: systemdEscape }),
    });
    files.push({ path: path.join(unitDir, `${unitName}.timer`), data: fillTemplate(readTemplate('linux.timer'), { name, unitName, onCalendar }, { escape: systemdEscape }) });
    steps.install.push({ run: { file: 'systemctl', args: ['--user', 'enable', '--now', `${unitName}.timer`] } });
    steps.remove.push({ run: { file: 'systemctl', args: ['--user', 'disable', '--now', `${unitName}.timer`] }, allowFail: true });
    steps.status.push({ run: { file: 'systemctl', args: ['--user', 'list-timers', '--all', `${unitName}.timer`] }, allowFail: true, task: `${unitName}.timer` });
    steps.pause.push({ run: { file: 'systemctl', args: ['--user', 'disable', '--now', `${unitName}.timer`] } });
    tasks.push({ name: `${unitName}.timer`, phase, firstRun: onCalendar });
  }
  steps.install.unshift({ run: { file: 'systemctl', args: ['--user', 'daemon-reload'] } });
  steps.afterRemove.push({ run: { file: 'systemctl', args: ['--user', 'daemon-reload'] }, allowFail: true });
  return { platform: 'linux', tasks, files, dirs, steps, summary: `systemd user timers, "${linux.cron}"`, describeStatus };
}
