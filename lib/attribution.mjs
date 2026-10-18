import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { diffFingerprints } from './fingerprint.mjs';
import { listCommits } from './repo.mjs';
import { expandPath } from './util/env.mjs';

const SKIP_FOLDERS = new Set(['node_modules', '.git']);
const MAX_COMMITS = 30;
const MAX_FILES = 20;
const short = (sha) => (sha ? sha.slice(0, 7) : 'unknown');
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
const shown = (value) => (value === null || value === undefined ? 'nothing' : `\`${typeof value === 'object' ? JSON.stringify(value) : value}\``);

/** Every file under `dir`, skipping node_modules and .git, with the SHA-256 of its contents. */
export function fileHashes(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP_FOLDERS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.set(path.relative(dir, full).split(path.sep).join('/'), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(dir);
  return files;
}

/** How an installed copy differs from the copy in the code under test, file by file. */
export function compareCopies(installedDir, repoDir) {
  const installed = fileHashes(installedDir);
  const repo = fileHashes(repoDir);
  const changed = [...repo.keys()].filter((file) => installed.has(file) && installed.get(file) !== repo.get(file)).sort();
  const onlyInRepo = [...repo.keys()].filter((file) => !installed.has(file)).sort();
  const onlyInstalled = [...installed.keys()].filter((file) => !repo.has(file)).sort();
  return { changed, onlyInRepo, onlyInstalled, same: changed.length + onlyInRepo.length + onlyInstalled.length === 0 };
}

/**
 * What changed between the last passing run and this one: upstream commits
 * that touch the watched paths, machine settings that differ, and how the
 * installed copy of the subject differs from the code under test.
 */
export function attribute({ check, checkDir, record, state = {}, listCommitsFn = listCommits, env = process.env }) {
  const lastPass = state.lastPass ?? null;
  const result = {
    lastPass: lastPass ? { at: lastPass.at, upstreamSha: lastPass.upstreamSha } : null,
    upstreamSha: record.upstreamSha ?? null,
    commits: null,
    commitsNote: null,
    machine: null,
    installed: null,
  };
  const repoDir = path.join(checkDir, check.source?.clonePath ?? 'repo');
  if (!lastPass) {
    result.commitsNote = 'The check has not passed since it was written, so there is no earlier run to compare with.';
  } else if (!lastPass.upstreamSha || !record.upstreamSha) {
    result.commitsNote = 'The upstream commit of the last pass or of this run is not on record.';
  } else if (lastPass.upstreamSha === record.upstreamSha) {
    result.commits = [];
  } else {
    try {
      result.commits = listCommitsFn(repoDir, { from: lastPass.upstreamSha, to: record.upstreamSha, paths: check.classification?.watchPaths ?? [] });
    } catch (error) {
      result.commitsNote = `The commits could not be listed: ${firstLine(error.message)}`;
    }
  }
  if (lastPass?.fingerprint) result.machine = diffFingerprints(lastPass.fingerprint, record.fingerprint);
  const expanded = expandPath(check.subject?.installedPath, env);
  const installedPath = expanded ? path.resolve(expanded) : null;
  const repoCopy = path.join(repoDir, check.subject?.path ?? '');
  if (installedPath && existsSync(installedPath) && existsSync(repoCopy)) {
    result.installed = { path: installedPath, repoPath: repoCopy, ...compareCopies(installedPath, repoCopy) };
  }
  return result;
}

const fileList = (label, files) => {
  if (files.length === 0) return [];
  const listed = files.slice(0, MAX_FILES).map((file) => `  - \`${file}\``);
  if (files.length > MAX_FILES) listed.push(`  - and ${files.length - MAX_FILES} more`);
  return [`- ${label}:`, ...listed];
};

/** The attribution as the Markdown of the failure report's "What changed since the last pass" section. */
export function attributionMarkdown(attribution) {
  const lines = ['### Upstream commits in the watched paths', ''];
  if (attribution.commitsNote) {
    lines.push(attribution.commitsNote);
  } else if (attribution.commits.length === 0) {
    lines.push(`No commit touched the watched paths since the last pass on ${attribution.lastPass.at}, at \`${short(attribution.upstreamSha)}\`.`);
  } else {
    lines.push(`From \`${short(attribution.lastPass.upstreamSha)}\`, the last pass on ${attribution.lastPass.at}, to \`${short(attribution.upstreamSha)}\`:`, '');
    for (const commit of attribution.commits.slice(0, MAX_COMMITS)) lines.push(`- \`${short(commit.sha)}\` ${commit.subject}`);
    if (attribution.commits.length > MAX_COMMITS) lines.push(`- and ${attribution.commits.length - MAX_COMMITS} older commits`);
  }
  lines.push('', '### The machine', '');
  if (attribution.machine === null) {
    lines.push('There is no fingerprint of a passing run to compare with.');
  } else if (attribution.machine.length === 0) {
    lines.push('The operating system, Node.js, the browser, the tools, and the host app are the same as at the last pass.');
  } else {
    for (const change of attribution.machine) lines.push(`- \`${change.key}\`: was ${shown(change.before)}, now ${shown(change.after)}`);
  }
  if (attribution.installed) {
    const { path: installedPath, changed, onlyInRepo, onlyInstalled, same } = attribution.installed;
    lines.push('', '### The installed copy', '');
    if (same) {
      lines.push(`The installed copy at \`${installedPath}\` matches the code under test.`);
    } else {
      lines.push(`The host app loads the installed copy at \`${installedPath}\`, which differs from the code under test:`, '');
      lines.push(...fileList('Different contents', changed), ...fileList('Only in the code under test', onlyInRepo), ...fileList('Only in the installed copy', onlyInstalled));
    }
  }
  return lines.join('\n');
}
