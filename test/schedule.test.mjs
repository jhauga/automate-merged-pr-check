import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { codeRoot } from '../lib/paths.mjs';
import {
  ScheduleError,
  applySchedule,
  display,
  listInstalled,
  nextRuns,
  parseWindowsTasks,
  planSchedule,
  refreshScheduleWrapper,
  staggerFor,
  staggerMinutes,
  taskBelongsTo,
  taskFolderName,
  taskTestFolder,
} from '../lib/schedule/index.mjs';
import { cronToOnCalendar, shiftCron } from '../lib/schedule/linux.mjs';
import { nextStart, toolBin } from '../lib/schedule/shared.mjs';
import { logonTypeFor, triggerXml } from '../lib/schedule/windows.mjs';

const NAME = 'automate-pr-sample-canvas';
const NOW = new Date(2026, 0, 1, 10, 0, 0);
let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-schedule-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function check({ runMode = 'single', hostApp = false, schedule = defaults().schedule } = {}) {
  return { runMode, timeoutMinutes: 15, layers: { page: { enabled: true }, hostApp: { enabled: hostApp } }, schedule };
}

const xmlText = (data) => {
  assert.deepEqual([...data.subarray(0, 2)], [0xff, 0xfe]);
  return data.subarray(2).toString('utf16le');
};

/** A stand-in for running commands that records them and answers from `answers`. */
function fakeExec(answers = () => ({ status: 0, stdout: '', stderr: '' })) {
  const calls = [];
  return { calls, exec: (command) => { calls.push(command); return answers(command); } };
}

test('the next start is today when the time is still ahead, tomorrow otherwise', () => {
  assert.deepEqual(nextStart('03:00', NOW), new Date(2026, 0, 2, 3, 0, 0));
  assert.deepEqual(nextStart('23:30', NOW), new Date(2026, 0, 1, 23, 30, 0));
  assert.deepEqual(nextStart('03:00', NOW, 60), new Date(2026, 0, 2, 4, 0, 0));
});

test('the wrapper runs the installed command in the test folder', () => {
  assert.equal(toolBin, path.join(codeRoot, 'bin', 'auto-check.mjs'));
});

test('Windows: a wrapper script and one imported task, signed in for a check that drives a desktop app', () => {
  const folder = `C:\\Users\\demo-user\\auto-checks\\${NAME}`;
  const plan = planSchedule({ testFolder: folder, check: check({ hostApp: true }), platform: 'win32', node: 'C:\\Program Files\\nodejs\\node.exe', now: NOW, elevated: true });
  assert.equal(plan.platform, 'windows');
  assert.equal(plan.summary, 'Task Scheduler, daily from 03:00, while you are signed in');
  assert.deepEqual(plan.tasks, [{ name: `auto-check ${NAME}`, phase: null, firstRun: '2026-01-02T03:00:00' }]);

  const [wrapper, task] = plan.files;
  assert.equal(wrapper.path, `${folder}\\schedule\\run.cmd`);
  assert.ok(wrapper.data.includes(`\r\ncd /d "${folder}" || exit /b 2\r\n`));
  assert.ok(wrapper.data.includes(`\r\n"C:\\Program Files\\nodejs\\node.exe" "${toolBin}" run "${folder}" --scheduled %* < NUL >> "logs\\schedule.log" 2>&1\r\n`));
  assert.ok(wrapper.data.includes('if not exist "logs" mkdir "logs"'));
  assert.doesNotMatch(wrapper.data.replace(/\r\n/g, ''), /\n/);

  assert.equal(task.path, `${folder}\\schedule\\task.xml`);
  const xml = xmlText(task.data);
  for (const part of [
    '<?xml version="1.0" encoding="UTF-16"?>',
    `<Description>auto-check ${NAME}: scheduled check of a pull request</Description>`,
    '<StartBoundary>2026-01-02T03:00:00</StartBoundary>',
    '<DaysInterval>1</DaysInterval>',
    '<LogonType>InteractiveToken</LogonType>',
    '<StartWhenAvailable>true</StartWhenAvailable>',
    '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '<ExecutionTimeLimit>PT45M</ExecutionTimeLimit>',
    `<Command>"${folder}\\schedule\\run.cmd"</Command>`,
    '<Arguments></Arguments>',
    `<WorkingDirectory>${folder}</WorkingDirectory>`,
  ]) {
    assert.ok(xml.includes(part), part);
  }
  assert.doesNotMatch(xml, /\{\{/);

  assert.deepEqual(plan.steps.install.map((step) => step.run), [{ file: 'schtasks', args: ['/Create', '/F', '/TN', `auto-check ${NAME}`, '/XML', task.path] }]);
  assert.equal(display(plan.steps.install[0].run), `schtasks /Create /F /TN "auto-check ${NAME}" /XML ${task.path}`);
  assert.deepEqual(plan.steps.remove[0].run.args, ['/Delete', '/F', '/TN', `auto-check ${NAME}`]);
  assert.deepEqual(plan.steps.pause[0].run.args, ['/Change', '/TN', `auto-check ${NAME}`, '/DISABLE']);
});

test('Windows: two-step checks get a collect task an hour later, and the session follows the settings', () => {
  const plan = planSchedule({ testFolder: `C:\\Users\\demo-user\\auto-checks\\${NAME}`, check: check({ runMode: 'two-step' }), platform: 'win32', node: 'node.exe', now: NOW, elevated: false });
  assert.deepEqual(plan.tasks.map((task) => [task.name, task.firstRun]), [
    [`auto-check ${NAME}`, '2026-01-02T03:00:00'],
    [`auto-check ${NAME} collect`, '2026-01-02T04:00:00'],
  ]);
  assert.match(xmlText(plan.files[1].data), /<Arguments>--phase start<\/Arguments>/);
  assert.match(xmlText(plan.files[2].data), /<Arguments>--phase collect<\/Arguments>/);

  assert.equal(logonTypeFor({ interactive: 'auto', hostApp: false, elevated: false }), 'InteractiveToken');
  assert.equal(logonTypeFor({ interactive: 'auto', hostApp: false, elevated: true }), 'S4U');
  assert.equal(logonTypeFor({ interactive: 'auto', hostApp: true, elevated: true }), 'InteractiveToken');
  assert.equal(logonTypeFor({ interactive: 'always', hostApp: false, elevated: true }), 'InteractiveToken');
  assert.equal(logonTypeFor({ interactive: 'never', hostApp: false, elevated: false }), 'S4U');
  assert.throws(() => logonTypeFor({ interactive: 'never', hostApp: true }), ScheduleError);
});

test('Windows: weekly, monthly, and hourly triggers', () => {
  const friday = new Date(2026, 0, 2, 3, 0, 0);
  assert.match(triggerXml('WEEKLY', friday), /<ScheduleByWeek>\n\s+<DaysOfWeek>\n\s+<Friday \/>\n\s+<\/DaysOfWeek>\n\s+<WeeksInterval>1<\/WeeksInterval>/);
  const monthly = triggerXml('MONTHLY', new Date(2026, 0, 31, 3, 0, 0));
  assert.match(monthly, /<Day>28<\/Day>/);
  assert.match(monthly, /<January \/>[\s\S]*<December \/>/);
  assert.match(triggerXml('HOURLY', friday), /<TimeTrigger>\n\s+<Repetition>\n\s+<Interval>PT1H<\/Interval>/);
  assert.throws(() => triggerXml('YEARLY', friday), /must be DAILY, WEEKLY, MONTHLY, HOURLY, or MINUTE/);
});

test('macOS: one launchd agent per step, with escaped values', () => {
  const folder = `/Users/demo-user/Acme & Co/${NAME}`;
  const plan = planSchedule({ testFolder: folder, check: check({ runMode: 'two-step' }), platform: 'darwin', node: '/usr/local/bin/node', home: '/Users/demo-user', uid: 501 });
  assert.deepEqual(plan.files.map((file) => file.path), [
    `/Users/demo-user/Library/LaunchAgents/auto-check.${NAME}.plist`,
    `/Users/demo-user/Library/LaunchAgents/auto-check.${NAME}.collect.plist`,
  ]);
  const [start, collect] = plan.files.map((file) => file.data);
  assert.ok(start.includes(`<string>auto-check.${NAME}</string>`));
  assert.ok(start.includes('<string>/Users/demo-user/Acme &amp; Co/'));
  assert.ok(start.includes('<key>StandardOutPath</key>'));
  assert.match(start, /<key>Hour<\/key>\n\s+<integer>3<\/integer>/);
  assert.match(start, /<string>run<\/string>\n\s+<string>[^<]+<\/string>\n\s+<string>--scheduled<\/string>\n\s+<string>--phase<\/string>\n\s+<string>start<\/string>\n\s+<\/array>/);
  assert.match(collect, /<key>Hour<\/key>\n\s+<integer>4<\/integer>/);
  assert.deepEqual(plan.steps.install.map((step) => display(step.run)), [
    `launchctl bootout gui/501/auto-check.${NAME}`,
    `launchctl bootstrap gui/501 /Users/demo-user/Library/LaunchAgents/auto-check.${NAME}.plist`,
    `launchctl bootout gui/501/auto-check.${NAME}.collect`,
    `launchctl bootstrap gui/501 /Users/demo-user/Library/LaunchAgents/auto-check.${NAME}.collect.plist`,
  ]);
});

test('Linux: systemd user timers from the cron expression', () => {
  const folder = `/home/demo-user/auto-checks/${NAME}`;
  const plan = planSchedule({ testFolder: folder, check: check(), platform: 'linux', node: '/usr/bin/node', home: '/home/demo-user' });
  const [service, timer] = plan.files;
  assert.equal(service.path, `/home/demo-user/.config/systemd/user/auto-check-${NAME}.service`);
  assert.ok(service.data.includes(`\nExecStart="/usr/bin/node" "${toolBin}" run "${folder}" --scheduled\n`));
  assert.ok(service.data.includes(`\nStandardOutput=append:${folder}/logs/schedule.log\n`));
  assert.match(service.data, /\nTimeoutStartSec=45min\n/);
  assert.match(timer.data, /\nOnCalendar=\*-\*-\* 03:00:00\n/);
  assert.ok(timer.data.includes(`\nUnit=auto-check-${NAME}.service\n`));
  assert.deepEqual(plan.steps.install.map((step) => display(step.run)), [
    'systemctl --user daemon-reload',
    `systemctl --user enable --now auto-check-${NAME}.timer`,
  ]);

  assert.equal(cronToOnCalendar('30 4 * * 1-5'), 'Mon,Tue,Wed,Thu,Fri *-*-* 04:30:00');
  assert.equal(cronToOnCalendar('0 3 * * sat,sun'), 'Sun,Sat *-*-* 03:00:00');
  assert.throws(() => cronToOnCalendar('*/5 * * * *'), /set schedule\.linux\.unit to "cron"/);
  assert.throws(() => cronToOnCalendar('0 3 1 * *'), ScheduleError);
  assert.equal(shiftCron('50 23 * * *', 60), '50 0 * * *');
  assert.throws(() => shiftCron('*/5 * * * *', 60), /fixed minute and hour/);

  const percent = planSchedule({ testFolder: '/home/demo-user/100%', check: check(), platform: 'linux', node: '/usr/bin/node', home: '/home/demo-user' });
  assert.match(percent.files[0].data, /WorkingDirectory=\/home\/demo-user\/100%%\n/);
});

test('Linux: crontab lines replace the test\'s old lines and keep everyone else\'s', () => {
  const settings = { ...defaults().schedule, linux: { cron: '0 3 * * *', unit: 'cron' } };
  const folder = path.join(base, NAME);
  const plan = planSchedule({ testFolder: folder, check: check({ runMode: 'two-step', schedule: settings }), platform: 'linux', node: '/usr/bin/node', home: path.join(base, 'cron-home') });
  const existing = [
    'MAILTO=""',
    `# auto-check ${NAME}: scheduled check of a pull request, written by auto-check schedule install.`,
    `0 1 * * * cd "${folder}" && "/usr/bin/node" "${toolBin}" run "${folder}" --phase start >> "x" 2>&1`,
    '15 2 * * * cd "/old" && "/usr/bin/node" "/old/bin/auto-check.mjs" run "/old/automate-pr-other" >> "y" 2>&1',
  ].join('\n');
  const { calls, exec } = fakeExec((command) => ({ status: 0, stdout: command.args[0] === '-l' ? `${existing}\n` : '', stderr: '' }));
  applySchedule('install', plan, { exec });
  const written = calls.find((command) => command.args[0] === '-').input.trim().split('\n');
  assert.equal(written[0], 'MAILTO=""');
  assert.ok(written[1].includes('automate-pr-other'));
  assert.equal(written.length, 6);
  assert.ok(written[3].startsWith(`0 3 * * * cd "${folder}" && mkdir -p logs && "/usr/bin/node" "${toolBin}" run "${folder}" --scheduled --phase start < /dev/null >> `));
  assert.match(written[5], /^0 4 \* \* \* .* --scheduled --phase collect < \/dev\/null >> /);

  const removal = fakeExec((command) => ({ status: 0, stdout: command.args[0] === '-l' ? `${written.join('\n')}\n` : '', stderr: '' }));
  applySchedule('remove', plan, { exec: removal.exec });
  assert.deepEqual(removal.calls.find((command) => command.args[0] === '-').input.trim().split('\n'), written.slice(0, 2));
});

test('applying a schedule writes the files, runs the steps, and reports what it would do on a dry run', () => {
  const folder = path.join(base, 'applied', NAME);
  const home = path.join(base, 'home');
  const plan = planSchedule({ testFolder: folder, check: check(), node: process.execPath, now: NOW, home, uid: 501, elevated: false });

  const dry = fakeExec();
  const lines = applySchedule('install', plan, { dryRun: true, exec: dry.exec });
  assert.equal(dry.calls.length, 0);
  assert.deepEqual(lines.filter((line) => line.startsWith('Would write')), plan.files.map((file) => `Would write ${file.path}`));
  assert.ok(lines.some((line) => line.startsWith('Would run: ')));
  assert.ok(plan.files.every((file) => !existsSync(file.path)));

  const real = fakeExec();
  applySchedule('install', plan, { exec: real.exec });
  assert.ok(plan.files.every((file) => existsSync(file.path)));
  assert.ok(existsSync(path.join(folder, 'logs')));
  assert.deepEqual(real.calls, plan.steps.install.map((step) => step.run));

  const failing = fakeExec(() => ({ status: 1, stdout: '', stderr: 'ERROR: Access is denied.\n' }));
  assert.throws(() => applySchedule('install', plan, { exec: failing.exec }), (error) => error instanceof ScheduleError && /failed: ERROR: Access is denied\.$/.test(error.message));

  const status = applySchedule('status', plan, { exec: fakeExec(() => ({ status: 1, stdout: '', stderr: 'not found' })).exec });
  assert.ok(status.every((line) => /not (installed|loaded)/.test(line)));

  applySchedule('remove', plan, { exec: fakeExec().exec });
  assert.ok(plan.files.every((file) => !existsSync(file.path)));
});

test('Windows status reads the task\'s state from schtasks', () => {
  const plan = planSchedule({ testFolder: `C:\\Users\\demo-user\\auto-checks\\${NAME}`, check: check(), platform: 'win32', node: 'node.exe', now: NOW, elevated: false });
  const output = [
    'Folder: \\',
    `TaskName:                             \\auto-check ${NAME}`,
    'Next Run Time:                        1/2/2026 3:00:00 AM',
    'Status:                               Ready',
    'Logon Mode:                           Interactive only',
    'Last Run Time:                        11/30/1999 12:00:00 AM',
    'Last Result:                          267011',
    'Scheduled Task State:                 Enabled',
  ].join('\r\n');
  const [line] = applySchedule('status', plan, { exec: () => ({ status: 0, stdout: output, stderr: '' }) });
  assert.equal(line, [
    `auto-check ${NAME}:`,
    '  Next Run Time: 1/2/2026 3:00:00 AM',
    '  Status: Ready',
    '  Logon Mode: Interactive only',
    '  Last Run Time: 11/30/1999 12:00:00 AM',
    '  Last Result: 267011',
    '  Scheduled Task State: Enabled',
  ].join('\n'));
  assert.ok(readFileSync(path.join(codeRoot, 'templates', 'schedule', 'windows.cmd'), 'utf8').includes('\r\n'));
});

test('a task starts at the earliest time that keeps clear of every other test, and a reinstall keeps its own', () => {
  const header = '"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author","Task To Run"';
  const row = (name, when, command) => `"DEMO-PC","\\auto-check ${name}","${when}","Ready","Interactive only","N/A","1","Jane Doe","${command}"`;
  const first = 'C:\\auto-checks\\automate-pr-first';
  const second = 'C:\\auto-checks\\automate-pr-second';
  const text = [
    header,
    row('automate-pr-first', '10/19/2026 3:00:00 AM', `${first}\\schedule\\run.cmd`),
    row('automate-pr-second', '10/19/2026 3:30:00 AM', `${second}\\schedule\\run.cmd`),
    '"DEMO-PC","\\Microsoft\\Windows\\Defrag\\ScheduledDefrag","10/20/2026 1:00:00 AM","Ready","Interactive only","N/A","0","Microsoft","defrag.exe"',
  ].join('\r\n');

  const tasks = parseWindowsTasks(text);
  assert.deepEqual(tasks.map((task) => task.name), ['auto-check automate-pr-first', 'auto-check automate-pr-second']);
  assert.equal(tasks[1].nextRun.getHours(), 3);
  assert.equal(tasks[1].nextRun.getMinutes(), 30);
  assert.equal(taskTestFolder(tasks[1].command), second);
  assert.equal(taskTestFolder('C:\\Windows\\system32\\defrag.exe'), null);

  assert.equal(staggerMinutes({ startTime: '03:00', tasks }), 60);
  assert.equal(staggerMinutes({ startTime: '03:00', tasks: tasks.slice(0, 1) }), 30);
  assert.equal(staggerMinutes({ startTime: '03:00', tasks: [] }), 0);
  assert.equal(staggerMinutes({ startTime: '05:00', tasks }), 0);
  const at = (hours, minutes) => ({ nextRun: new Date(2026, 9, 19, hours, minutes) });
  assert.equal(staggerMinutes({ startTime: '03:00', tasks: [at(3, 30)] }), 0);
  assert.equal(staggerMinutes({ startTime: '03:00', tasks: [at(3, 0), at(4, 0)] }), 30);
  assert.equal(staggerMinutes({ startTime: '00:00', tasks: [at(23, 50)] }), 30);

  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const daily = { schedule: { windows: { startTime: '03:00' } } };
  assert.equal(staggerFor({ check: daily, testFolder: first, tasks, same }), 0);
  assert.equal(staggerFor({ check: daily, testFolder: second.toUpperCase(), tasks, same }), 30);
  assert.equal(staggerFor({ check: daily, testFolder: 'C:\\auto-checks\\automate-pr-third', tasks, same }), 60);
  assert.equal(staggerFor({ check: {}, testFolder: 'C:\\auto-checks\\automate-pr-third', tasks: [], same }), 0);

  assert.deepEqual(tasks.map((task) => task.path), ['\\auto-check automate-pr-first', '\\auto-check automate-pr-second']);
  const listed = listInstalled({ platform: 'win32', exec: () => ({ status: 0, stdout: text, stderr: '' }) });
  assert.equal(listed.length, 2);
  assert.deepEqual(listInstalled({ platform: 'linux' }), []);
  assert.deepEqual(listInstalled({ platform: 'win32', exec: () => ({ status: 1, stdout: '', stderr: 'no tasks' }) }), []);
});

test('a task moved into a Task Scheduler folder is found there and replaced, read, paused, and removed in place', () => {
  const header = '"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author","Task To Run"';
  const folder = `C:\\Users\\demo-user\\auto-checks\\${NAME}`;
  const text = [
    header,
    `"DEMO-PC","\\My Tasks\\auto-check ${NAME}","1/2/2026 3:30:00 AM","Ready","Interactive only","N/A","0","Jane Doe",""${folder}\\schedule\\run.cmd" "`,
    header,
    '"DEMO-PC","\\My Tasks\\Nightly backup","1/2/2026 1:00:00 AM","Ready","Interactive only","N/A","0","Jane Doe","backup.exe"',
  ].join('\r\n');
  const installed = parseWindowsTasks(text);
  assert.deepEqual(installed.map(({ name, path: full }) => [name, full]), [[`auto-check ${NAME}`, `\\My Tasks\\auto-check ${NAME}`]]);
  assert.equal(taskTestFolder(installed[0].command), folder);

  const plan = planSchedule({ testFolder: folder, check: check(), platform: 'win32', node: 'node.exe', now: NOW, elevated: false, installed });
  const moved = `\\My Tasks\\auto-check ${NAME}`;
  assert.deepEqual(plan.steps.install[0].run.args, ['/Create', '/F', '/TN', moved, '/XML', plan.files[1].path]);
  assert.deepEqual(plan.steps.status[0].run.args, ['/Query', '/TN', moved, '/V', '/FO', 'LIST']);
  assert.deepEqual(plan.steps.pause[0].run.args, ['/Change', '/TN', moved, '/DISABLE']);
  assert.deepEqual(plan.steps.remove[0].run.args, ['/Delete', '/F', '/TN', moved]);
  assert.equal(staggerFor({ check: check(), testFolder: folder, tasks: installed, same: (a, b) => a === b }), 0);
  assert.deepEqual(nextRuns(plan, installed), [{ name: moved, at: '2026-01-02T03:30:00' }]);
  assert.deepEqual(nextRuns(plan, []), [{ name: moved, at: '2026-01-02T03:00:00' }]);
});

test('a task another tool installed is recognized by its name', () => {
  const header = '"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author","Task To Run"';
  const text = [
    header,
    `"DEMO-PC","\\My Tasks\\auto-check ${NAME}","1/2/2026 3:00:00 AM","Ready","Interactive only","N/A","0","Jane Doe",""C:\\Users\\demo-user\\scripts\\nightly.bat" ${NAME}"`,
    '"DEMO-PC","\\auto-check automate-pr-other","1/2/2026 3:30:00 AM","Ready","Interactive only","N/A","0","Jane Doe","C:\\auto-checks\\automate-pr-other\\schedule\\run.cmd"',
  ].join('\r\n');
  const tasks = parseWindowsTasks(text);
  assert.equal(taskTestFolder(tasks[0].command), null);
  assert.equal(taskFolderName(tasks[0].name), NAME);
  assert.equal(taskFolderName('auto-check automate-pr-other collect'), 'automate-pr-other');
  assert.equal(taskFolderName('Nightly backup'), null);
  const own = path.join(base, 'auto-checks', NAME);
  assert.equal(taskBelongsTo(tasks[0], own), true);
  assert.equal(taskBelongsTo(tasks[1], own), false);
  assert.equal(staggerFor({ check: check(), testFolder: own, tasks }), 0);
  assert.equal(staggerFor({ check: check(), testFolder: path.join(base, 'auto-checks', 'automate-pr-third'), tasks }), 60);
});

test('an existing schedule wrapper is refreshed without touching any task', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const own = path.join(base, 'wrapper', NAME);
  mkdirSync(own, { recursive: true });
  const options = { testFolder: own, check: check(), platform: 'win32', node: 'node.exe' };
  assert.equal(refreshScheduleWrapper(options), false);
  const wrapper = path.join(own, 'schedule', 'run.cmd');
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(wrapper, '@echo off\r\n"node.exe" "auto-check.mjs" run "old" %*\r\n');
  assert.equal(refreshScheduleWrapper(options), true);
  assert.match(readFileSync(wrapper, 'utf8'), / run "[^"]+" --scheduled %\* < NUL >> /);
  assert.equal(refreshScheduleWrapper(options), false);
  assert.equal(refreshScheduleWrapper({ ...options, platform: 'linux' }), false);
  assert.deepEqual(readdirSync(path.dirname(wrapper)), ['run.cmd']);
});

test('a staggered plan moves the first run, on every platform', () => {
  const folder = `C:\Users\demo-user\auto-checks\${NAME}`;
  const windows = planSchedule({ testFolder: folder, check: check(), platform: 'win32', node: 'node.exe', now: NOW, stagger: 30, elevated: false });
  assert.equal(windows.tasks[0].firstRun, '2026-01-02T03:30:00');

  const linux = planSchedule({ testFolder: `/home/demo-user/${NAME}`, check: check(), platform: 'linux', node: '/usr/bin/node', home: '/home/demo-user', stagger: 90 });
  assert.match(linux.files[1].data, /\nOnCalendar=\*-\*-\* 04:30:00\n/);

  const macos = planSchedule({ testFolder: `/Users/demo-user/${NAME}`, check: check(), platform: 'darwin', node: '/usr/local/bin/node', home: '/Users/demo-user', uid: 501, stagger: 45 });
  assert.match(macos.files[0].data, /<key>Hour<\/key>\n\s+<integer>3<\/integer>/);
  assert.match(macos.files[0].data, /<key>Minute<\/key>\n\s+<integer>45<\/integer>/);
});
