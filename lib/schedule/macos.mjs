import os from 'node:os';
import nodePath from 'node:path';
import { escapeXml, fillTemplate } from '../util/template.mjs';
import { pad, phasesOf, readTemplate, runArgs, toolBin } from './shared.mjs';

const path = nodePath.posix;

function describeStatus(outputs) {
  return outputs.map(({ step, result }) => {
    if (result.status !== 0) return `${step.task}: not loaded`;
    const state = /^\s*state = (.+)$/m.exec(result.stdout)?.[1] ?? 'loaded';
    const last = /^\s*last exit code = (.+)$/m.exec(result.stdout)?.[1];
    return `${step.task}: ${state}${last ? `, last exit code ${last}` : ''}`;
  });
}

/**
 * The macOS schedule of a check: one launchd agent per step in
 * ~/Library/LaunchAgents, run at the configured hour and minute in the
 * signed-in session. Not yet verified on a Mac.
 */
export function planMacos({ root, name: testName, check, settings, node, stagger = 0, home = os.homedir(), uid = process.getuid?.() ?? 501 }) {
  const agents = path.join(home, 'Library', 'LaunchAgents');
  const domain = `gui/${uid}`;
  const files = [];
  const steps = { install: [], remove: [], status: [], pause: [], afterRemove: [] };
  const tasks = [];
  for (const phase of phasesOf(check)) {
    const label = `auto-check.${testName}${phase === 'collect' ? '.collect' : ''}`;
    const shifted = settings.macos.hour * 60 + settings.macos.minute + stagger + (phase === 'collect' ? 60 : 0);
    const hour = Math.floor(shifted / 60) % 24;
    const minute = shifted % 60;
    const extraArguments = runArgs(phase).map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n');
    const file = path.join(agents, `${label}.plist`);
    files.push({ path: file, data: fillTemplate(readTemplate('macos.plist'), { label, node, root, tool: toolBin, extraArguments, hour, minute }, { escape: escapeXml, raw: ['extraArguments'] }) });
    steps.install.push({ run: { file: 'launchctl', args: ['bootout', `${domain}/${label}`] }, allowFail: true });
    steps.install.push({ run: { file: 'launchctl', args: ['bootstrap', domain, file] } });
    steps.remove.push({ run: { file: 'launchctl', args: ['bootout', `${domain}/${label}`] }, allowFail: true });
    steps.status.push({ run: { file: 'launchctl', args: ['print', `${domain}/${label}`] }, allowFail: true, task: label });
    steps.pause.push({ run: { file: 'launchctl', args: ['disable', `${domain}/${label}`] } });
    steps.pause.push({ run: { file: 'launchctl', args: ['bootout', `${domain}/${label}`] }, allowFail: true });
    tasks.push({ name: label, phase, firstRun: `${pad(hour)}:${pad(minute)} daily` });
  }
  return {
    platform: 'macos',
    tasks,
    files,
    dirs: [path.join(root, 'logs')],
    steps,
    summary: `launchd agents, daily at ${pad(settings.macos.hour)}:${pad(settings.macos.minute)}, while you are signed in`,
    describeStatus,
  };
}
