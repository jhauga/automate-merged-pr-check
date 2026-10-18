import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { attributionMarkdown } from './attribution.mjs';
import { localRepoFor } from './context.mjs';
import { codeRoot } from './paths.mjs';
import { renderPrompt } from './prompt.mjs';
import { dayFolder } from './util/date.mjs';

/** Folder in a test folder that holds the failure reports, one subfolder per day. */
export const FOUND_ISSUE_DIR = 'found-issue';

/** Folder in a test folder that holds the proposed solutions, one subfolder per day. */
export const PROPOSED_SOLUTION_DIR = 'proposed-solution';

const MAX_LISTED = 20;
const slash = (value) => value.split(path.sep).join('/');
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

/** The day folder for `date`, in local time, under `which` of a test folder. */
export function dayDir(testFolder, which, date = new Date()) {
  return path.join(testFolder, which, dayFolder(date));
}

/** The file names a failure uses in its day folders, with `suffix` for a second failure the same day. */
export function namesFor(suffix) {
  return {
    foundIssue: `found-issue${suffix}.md`,
    proposedSolution: `proposed-solution${suffix}.prompt.md`,
    resolveFolder: `resolve${suffix}`,
  };
}

/**
 * Reserves the file names for one failure. The first failure of a day gets
 * plain names, and a later one that day gets `-2`, `-3`, and so on. `open` is
 * the failure report this test already has open, which comes back unchanged
 * while its signature and its day still match, so a failure that repeats keeps
 * one report. A simulated run passes the simulated memory as `open`.
 */
export function reserve({ testFolder, signature, date = new Date(), open = null }) {
  const foundIssueDir = dayDir(testFolder, FOUND_ISSUE_DIR, date);
  const proposedDir = dayDir(testFolder, PROPOSED_SOLUTION_DIR, date);
  const reserved = (suffix, existing) => ({ foundIssueDir, proposedDir, suffix, ...namesFor(suffix), existing });

  if (open?.signature === signature && open.day === dayFolder(date) && existsSync(path.join(testFolder, open.foundIssue))) {
    const suffix = /^found-issue(.*)\.md$/.exec(path.basename(open.foundIssue))?.[1] ?? '';
    return reserved(suffix, true);
  }

  mkdirSync(foundIssueDir, { recursive: true });
  mkdirSync(proposedDir, { recursive: true });
  const taken = (suffix) => existsSync(path.join(foundIssueDir, namesFor(suffix).foundIssue));
  if (!taken('')) return reserved('', false);
  let count = 2;
  while (taken(`-${count}`)) count += 1;
  return reserved(`-${count}`, false);
}

const yamlQuote = (text) => `'${String(text).replace(/'/g, "''")}'`;

function sourceLine(record, check) {
  const sha = record.upstreamSha ? record.upstreamSha.slice(0, 7) : 'an unknown commit';
  if (record.sourceMode === 'local') {
    return `the branch \`${check.source?.branch ?? 'unknown'}\` rebased onto \`${check.source?.baseRef}\` at \`${sha}\`, as \`${(record.sourceSha ?? '').slice(0, 7)}\``;
  }
  return `\`${check.source?.baseRef}\` at \`${sha}\``;
}

function observedMarkdown({ workRoot, dir, record, resultFile }) {
  const rel = (file) => slash(path.relative(workRoot, file));
  const resultDir = path.dirname(resultFile);
  const lines = [];
  const failedAssertions = (record.assertions ?? []).filter((entry) => !entry.ok);
  if (failedAssertions.length > 0) {
    lines.push('Assertions that failed:', '');
    for (const entry of failedAssertions.slice(0, MAX_LISTED)) lines.push(`- ${entry.layer}: ${entry.name}${entry.detail ? `. Detail: ${entry.detail}` : ''}`);
    if (failedAssertions.length > MAX_LISTED) lines.push(`- and ${failedAssertions.length - MAX_LISTED} more`);
    lines.push('');
  }
  const failedComparisons = record.compare?.failures ?? [];
  if (failedComparisons.length > 0) {
    lines.push(`Comparisons with the baseline that failed (strategy ${record.compare.strategy}):`, '');
    for (const entry of failedComparisons.slice(0, MAX_LISTED)) {
      const diff = entry.diffFile ? ` Changed pixels: \`${rel(entry.diffFile)}\`.` : '';
      lines.push(`- \`${entry.artifact}\`, ${entry.method}: ${entry.detail}.${diff}`);
    }
    lines.push('');
  }
  const failingLayers = new Set([...failedAssertions.map((entry) => entry.layer), ...failedComparisons.map((entry) => entry.layer)]);
  const captures = (record.artifacts ?? []).filter((artifact) => failingLayers.size === 0 || failingLayers.has(artifact.layer)).slice(0, MAX_LISTED);
  if (captures.length > 0) {
    lines.push('Captures, this run beside the baseline:', '', '| Capture | This run | Baseline |', '| --- | --- | --- |');
    for (const artifact of captures) {
      const baseline = path.join(dir, 'baseline', artifact.file);
      lines.push(`| ${artifact.name} | \`${rel(path.join(resultDir, artifact.file))}\` | ${existsSync(baseline) ? `\`${rel(baseline)}\`` : 'none yet'} |`);
    }
  }
  return lines.join('\n').trim() || 'The run recorded no failed assertion and no failed comparison.';
}

/** The headline of a failure: its first failed assertion or comparison. */
export function headlineOf(record) {
  const assertion = (record.assertions ?? []).find((entry) => !entry.ok);
  if (assertion) return assertion.name;
  const comparison = record.compare?.failures?.[0];
  if (comparison) return `${comparison.artifact} no longer matches its baseline`;
  return firstLine(record.error) || 'the check failed';
}

/** Values for prompts/found-issue.md. */
export function foundIssueValues({ workRoot, slug, dir, check, config, record, resultFile, attribution, context, names, date = new Date() }) {
  const headline = headlineOf(record);
  const localRepo = localRepoFor({ testFolder: workRoot, config, check });
  return {
    description: yamlQuote(`auto-check found a failure in ${slug}: ${headline}`.slice(0, 200)),
    headline,
    simulated: Boolean(record.simulated),
    slug,
    checkDir: dir,
    toolRoot: codeRoot,
    prUrl: check.pr?.url ?? 'unknown',
    kind: `${check.classification?.kind ?? 'unknown'} / ${check.classification?.subtype ?? 'unknown'}`,
    watch: (check.classification?.watchPaths ?? []).join(', ') || 'none',
    finishedAt: record.runner?.finishedAt ?? record.finishedAt ?? date.toISOString(),
    outcome: record.outcome,
    exitCode: String(record.runner?.exitCode ?? 'none'),
    sourceLine: sourceLine(record, check),
    resultFile: slash(path.relative(workRoot, resultFile)),
    signature: record.signature ?? 'none',
    observed: observedMarkdown({ workRoot, dir, record, resultFile }),
    whatChanged: attributionMarkdown(attribution),
    context: context?.prContext ? context.prContext.trim() : 'The test\'s context.md gives no PR Context, so the pull request page is all there is.',
    sourceDir: slash(path.relative(workRoot, path.join(dir, check.source?.clonePath ?? 'repo'))),
    localRepo,
    proposedSolutionFile: slash(path.relative(workRoot, path.join(names.proposedDir, names.proposedSolution))),
    branch: `${config.repos?.branchPrefix ?? 'resolve-issue-'}${check.alias ?? slug}`,
    today: date.toISOString().slice(0, 10),
  };
}

/** Writes the failure report into its day folder and returns its path. */
export function writeFoundIssue({ reservation, ...options }) {
  const file = path.join(reservation.foundIssueDir, reservation.foundIssue);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderPrompt('found-issue', foundIssueValues({ ...options, names: reservation })));
  return file;
}
