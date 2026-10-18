import nodePath from 'node:path';
import { escapeXml, fillTemplate } from '../util/template.mjs';
import { ScheduleError, localStamp, nextStart, phasesOf, readTemplate, timeLimitOf, toolBin } from './shared.mjs';

const path = nodePath.win32;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_KEYS = ['Status', 'Scheduled Task State', 'Logon Mode', 'Next Run Time', 'Last Run Time', 'Last Result'];

/** Task Scheduler trigger XML for a schedule type (DAILY, WEEKLY, MONTHLY, HOURLY, MINUTE) starting at `start`. */
export function triggerXml(schedule, start) {
  const boundary = localStamp(start);
  const calendar = (inner) => [
    '    <CalendarTrigger>',
    `      <StartBoundary>${boundary}</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    ...inner.map((line) => `      ${line}`),
    '    </CalendarTrigger>',
  ].join('\n');
  const repeating = (interval) => [
    '    <TimeTrigger>',
    '      <Repetition>',
    `        <Interval>${interval}</Interval>`,
    '        <StopAtDurationEnd>false</StopAtDurationEnd>',
    '      </Repetition>',
    `      <StartBoundary>${boundary}</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    '    </TimeTrigger>',
  ].join('\n');
  switch (schedule) {
    case 'DAILY':
      return calendar(['<ScheduleByDay>', '  <DaysInterval>1</DaysInterval>', '</ScheduleByDay>']);
    case 'WEEKLY':
      return calendar(['<ScheduleByWeek>', '  <DaysOfWeek>', `    <${DAY_NAMES[start.getDay()]} />`, '  </DaysOfWeek>', '  <WeeksInterval>1</WeeksInterval>', '</ScheduleByWeek>']);
    case 'MONTHLY':
      return calendar([
        '<ScheduleByMonth>',
        '  <DaysOfMonth>',
        `    <Day>${Math.min(start.getDate(), 28)}</Day>`,
        '  </DaysOfMonth>',
        '  <Months>',
        ...MONTH_NAMES.map((month) => `    <${month} />`),
        '  </Months>',
        '</ScheduleByMonth>',
      ]);
    case 'HOURLY':
      return repeating('PT1H');
    case 'MINUTE':
      return repeating('PT1M');
    default:
      throw new ScheduleError(`schedule.windows.schedule must be DAILY, WEEKLY, MONTHLY, HOURLY, or MINUTE; got "${schedule}".`);
  }
}

/**
 * How the task signs in. A check that drives a desktop app needs the signed-in
 * session. Otherwise "auto" runs whether or not anyone is signed in when the
 * install runs elevated, which Windows requires for that, and "never" always
 * asks for it.
 */
export function logonTypeFor({ interactive, hostApp, elevated }) {
  if (interactive === 'never') {
    if (hostApp) throw new ScheduleError('This check drives a desktop app, which needs the signed-in session, so schedule.windows.interactive cannot be "never" for it.');
    return 'S4U';
  }
  if (interactive === 'auto' && !hostApp && elevated) return 'S4U';
  return 'InteractiveToken';
}

function describeStatus(outputs) {
  return outputs.map(({ step, result }) => {
    if (result.status !== 0) return `${step.task}: not installed`;
    const fields = new Map();
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^([^:]+?):\s+(.*)$/.exec(line.trim());
      if (match && STATUS_KEYS.includes(match[1]) && !fields.has(match[1])) fields.set(match[1], match[2].trim());
    }
    if (fields.size === 0) return `${step.task}: installed`;
    return `${step.task}:\n${[...fields].map(([key, value]) => `  ${key}: ${value}`).join('\n')}`;
  });
}

/**
 * The Windows schedule of a test: schedule/run.cmd in the test folder, which
 * runs auto-check run and appends to the test's schedule log, and one Task
 * Scheduler task per step, imported from XML so that a run missed while the
 * computer was off or asleep starts when it is back, and runs on battery too.
 */
export function planWindows({ root, name: testName, check, settings, node, now, stagger = 0, elevated }) {
  const windows = settings.windows;
  const hostApp = Boolean(check.layers?.hostApp?.enabled);
  const logonType = logonTypeFor({ interactive: windows.interactive, hostApp, elevated });
  const dir = path.join(root, 'schedule');
  const wrapper = path.join(dir, 'run.cmd');
  const files = [{ path: wrapper, data: fillTemplate(readTemplate('windows.cmd'), { root, node, tool: toolBin }, { escape: (value) => value.replace(/%/g, '%%') }) }];
  const steps = { install: [], remove: [], status: [], pause: [], afterRemove: [] };
  const tasks = [];
  for (const phase of phasesOf(check)) {
    const name = phase === 'collect' ? `auto-check ${testName} collect` : `auto-check ${testName}`;
    const start = nextStart(windows.startTime, now, stagger + (phase === 'collect' ? 60 : 0));
    const xmlFile = path.join(dir, phase === 'collect' ? 'task-collect.xml' : 'task.xml');
    const xml = fillTemplate(readTemplate('windows.xml'), {
      description: `auto-check ${testName}${phase ? ` (${phase})` : ''}: scheduled check of a pull request`,
      trigger: triggerXml(windows.schedule, start),
      logonType,
      timeLimitMinutes: timeLimitOf(check),
      wrapper,
      root,
      args: phase ? `--phase ${phase}` : '',
    }, { escape: escapeXml, raw: ['trigger'] }).replace('encoding="UTF-8"', 'encoding="UTF-16"');
    files.push({ path: xmlFile, data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]) });
    steps.install.push({ run: { file: 'schtasks', args: ['/Create', '/F', '/TN', name, '/XML', xmlFile] } });
    steps.remove.push({ run: { file: 'schtasks', args: ['/Delete', '/F', '/TN', name] }, allowFail: true });
    steps.status.push({ run: { file: 'schtasks', args: ['/Query', '/TN', name, '/V', '/FO', 'LIST'] }, allowFail: true, task: name });
    steps.pause.push({ run: { file: 'schtasks', args: ['/Change', '/TN', name, '/DISABLE'] } });
    tasks.push({ name, phase, firstRun: localStamp(start) });
  }
  const session = logonType === 'S4U' ? 'whether or not anyone is signed in' : 'while you are signed in';
  return {
    platform: 'windows',
    tasks,
    files,
    dirs: [path.join(root, 'logs')],
    steps,
    summary: `Task Scheduler, ${windows.schedule.toLowerCase()} from ${windows.startTime}, ${session}`,
    describeStatus,
  };
}
