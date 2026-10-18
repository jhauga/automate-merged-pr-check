import { existsSync } from 'node:fs';
import path from 'node:path';
import { attribute } from './attribution.mjs';
import { readFormIn } from './context.mjs';
import { buildMessage, describeNotification, sendNotifications } from './notify/index.mjs';
import { proposeSolution, resolveIssue, resolvePr } from './resolve.mjs';
import { reserve, writeFoundIssue } from './resolutions.mjs';
import { dayFolder } from './util/date.mjs';

const slash = (value) => value.split(path.sep).join('/');
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

/**
 * The failure pipeline the runner calls after every run, following the flags
 * of the test's own form. With Find Issue it writes the failure report to
 * found-issue/MM-DD-YYYY/, unless the failure repeats the last one; then it
 * notifies when the run's decision says so; then, for a real failure that is
 * not a repeat, Resolve Issue proposes a solution, Commit Solution with Local
 * Commit applies it on a branch, Remote Push pushes that branch, and Make PR
 * opens the pull request. A pass after a failure closes the open report.
 * Simulated runs stop after Find Issue and keep their own memory under
 * state.simulated. Returns what to print, whether anyone was notified, and
 * the state to merge.
 */
export function createPipeline({ assistantName = null, model = null, now = () => new Date(), log = () => {}, deps = {} } = {}) {
  return async function afterRun({ workRoot, slug, dir, check, config, flags = {}, record, resultFile, state, decision, simulated }) {
    const lines = [];
    const memory = simulated ? state.simulated ?? {} : state;
    let open = memory.openResolution ?? null;
    let foundIssue = open?.foundIssue ? path.join(workRoot, open.foundIssue) : null;
    const date = now();

    if (record.outcome === 'fail' && !flags.findIssue) {
      lines.push('Failure report: not written. Set Find Issue to true in context.md to keep one.');
    } else if (record.outcome === 'fail') {
      const reservation = reserve({ testFolder: workRoot, signature: record.signature, date, open });
      if (reservation.existing && foundIssue && existsSync(foundIssue)) {
        lines.push(`Failure report: unchanged, ${slash(path.relative(workRoot, foundIssue))}`);
      } else {
        const attribution = attribute({ check, checkDir: dir, record, state });
        const form = readFormIn(workRoot);
        foundIssue = writeFoundIssue({ reservation, workRoot, slug, dir, check, config, record, resultFile, attribution, context: form?.context ?? null, date });
        open = {
          day: dayFolder(date),
          foundIssue: slash(path.relative(workRoot, foundIssue)),
          proposedSolution: slash(path.relative(workRoot, path.join(reservation.proposedDir, reservation.proposedSolution))),
          resultDir: slash(path.relative(workRoot, path.dirname(resultFile))),
          signature: record.signature,
          at: date.toISOString(),
        };
        lines.push(`Failure report: ${open.foundIssue}`);
      }
    }

    let notified = false;
    if (decision.notify) {
      const message = buildMessage({ workRoot, slug, check, record, resultFile, decision, foundIssue: record.outcome === 'fail' ? foundIssue : null });
      const result = await sendNotifications({
        workRoot,
        notify: check.notify,
        message,
        outDir: path.dirname(resultFile),
        dryRun: Boolean(check.notify?.dryRun),
        deps: deps.notify ?? {},
      });
      notified = result.sent.length > 0 || (result.dryRun && result.channels.length > 0);
      lines.push(describeNotification(result, { workRoot }));
    } else if (decision.repeat) {
      lines.push('Notification: already notified for this failure.');
    }

    if (record.outcome === 'fail' && decision.runFeatures && flags.resolveIssue) {
      if (simulated) {
        lines.push('Proposed solution: not asked for a simulated failure. Run auto-check resolve with --propose to try it.');
      } else {
        let proposed = null;
        try {
          proposed = await (deps.propose ?? proposeSolution)({ testFolder: workRoot, config, open: { ...open, simulated: false }, assistantName, model, log, deps: deps.resolve ?? {} });
          lines.push(`Proposed solution: ${slash(path.relative(workRoot, proposed.proposedSolutionFile))}`);
        } catch (error) {
          lines.push(`Proposed solution: not written: ${firstLine(error.message)}`);
        }
        if (proposed && flags.commitSolution && flags.localCommit) {
          try {
            const applied = await (deps.resolveIssue ?? resolveIssue)({
              testFolder: workRoot,
              config,
              open: { ...open, simulated: false },
              push: Boolean(flags.remotePush),
              assistantName,
              model,
              log,
              deps: deps.resolve ?? {},
            });
            open = applied.open;
            lines.push(`Fix branch: ${applied.branch} at ${applied.commit.slice(0, 7)}, ${applied.pushed ? 'pushed to origin' : 'not pushed'}`);
            if (flags.makePr) {
              const pr = await (deps.resolvePr ?? resolvePr)({ testFolder: workRoot, config, open, makePr: true, assistantName, model, log, deps: deps.resolve ?? {} });
              open = pr.open;
              lines.push(pr.prUrl ? `Pull request: ${pr.prUrl}` : `Pull request: written to ${slash(path.relative(workRoot, pr.pullRequestFile))}`);
            }
          } catch (error) {
            lines.push(`Fix branch: not finished: ${firstLine(error.message)}`);
          }
        }
      }
    }

    let statePatch = null;
    if (record.outcome === 'fail') {
      const at = notified ? date.toISOString() : memory.notifiedAt ?? null;
      statePatch = simulated
        ? { simulated: { ...memory, lastSignature: record.signature, notifiedAt: at, openResolution: open } }
        : { openResolution: open };
    } else if (simulated) {
      statePatch = { simulated: { ...memory, lastErrorSignature: record.outcome === 'error' ? record.signature : memory.lastErrorSignature ?? null } };
    } else if (record.outcome === 'pass' && state.openResolution) {
      statePatch = { openResolution: null };
      lines.push(`Failure report closed: ${state.openResolution.foundIssue}`);
    }
    const shown = lines.filter(Boolean);
    return { notified, lines: shown, message: shown.join('\n  '), statePatch, foundIssue };
  };
}
