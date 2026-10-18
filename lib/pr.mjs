import { addedLinesByFile, classify } from './classify.mjs';
import { createGitHub, normalizeFile } from './github.mjs';
import { findLandedCommit } from './repo.mjs';

/** Raised for a pull request reference that cannot be read. */
export class PrError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrError';
    this.exitCode = 2;
  }
}

/** A comment that names the commit a pull request landed as, such as "Merged as 0a1b2c3". */
const LANDED_COMMENT = /\b(?:merged|landed|pushed|applied|committed|cherry-picked)\b[^\n]{0,40}?\b(?:as|in|with|via)\s+(?:commit\s+)?`?([0-9a-f]{7,40})\b/i;

/**
 * Parses a pull request URL such as https://github.com/acme/demo-app/pull/123,
 * also accepting /pulls/ and trailing paths like /files. Throws PrError.
 */
export function parsePrUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw new PrError(`"${input}" is not a pull request URL.`);
  }
  const match = /^\/([^/]+)\/([^/]+)\/pulls?\/(\d+)(?:\/.*)?$/.exec(url.pathname);
  if (!/^https?:$/.test(url.protocol) || !match) {
    throw new PrError(`"${input}" is not a pull request URL like https://github.com/<owner>/<repo>/pull/<number>.`);
  }
  const host = url.hostname.toLowerCase();
  const [, owner, rawRepo, number] = match;
  const repo = rawRepo.replace(/\.git$/i, '');
  return { host, owner, repo, number: Number(number), url: `https://${host}/${owner}/${repo}/pull/${Number(number)}` };
}

/** Folder name for a check: <owner>-<repo>-pr-<number>, lowercase. */
export function slugFor({ owner, repo, number }) {
  return `${owner}-${repo}-pr-${number}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

const landed = (landedBy, landedSha, landedAt, landedMessage = null) => ({
  merged: true,
  status: landedBy === 'merge' ? 'merged' : 'landed',
  landedBy,
  landedSha,
  landedAt,
  landedMessage,
});

const notLanded = (status) => ({ merged: false, status, landedBy: null, landedSha: null, landedAt: null, landedMessage: null });

/**
 * Works out whether a pull request's change reached its base branch.
 * MERGED pull requests landed by their merge commit. A CLOSED pull request
 * landed when one of these commits is confirmed on the base branch, tried in
 * order: the commit GitHub recorded as closing it, commits that reference it,
 * a commit in `cloneDir` whose message names it, and a commit named in a
 * comment such as "Merged as 0a1b2c3".
 */
export function resolveLanding(view, ref, { github, cloneDir = null, findInClone = findLandedCommit } = {}) {
  if (view.state === 'MERGED') return landed('merge', view.mergeCommit?.oid ?? null, view.mergedAt ?? null);
  if (view.state !== 'CLOSED') return notLanded('open');

  const base = view.baseRefName;
  const confirm = (sha) => github.commitOnBase(ref, base, sha);
  const { closer, referenced } = github.landingCandidates(ref);
  if (closer) {
    const check = confirm(closer.sha);
    if (check.onBase) return landed('commit', check.sha, view.closedAt ?? closer.at, closer.message);
  }
  for (const commit of referenced) {
    if (commit.sha === closer?.sha) continue;
    const check = confirm(commit.sha);
    if (check.onBase) return landed('commit', check.sha, commit.at, commit.message);
  }
  if (cloneDir) {
    const found = findInClone(cloneDir, base, ref.number);
    if (found) return landed('commit', found.sha, null, found.subject);
  }
  for (const comment of [...(view.comments ?? [])].reverse()) {
    const match = LANDED_COMMENT.exec(comment.body ?? '');
    if (!match) continue;
    const check = confirm(match[1]);
    if (check.onBase) return landed('comment', check.sha, comment.createdAt ?? null);
  }
  return notLanded('closed');
}

/**
 * Reads a pull request through GitHub and returns everything the rest of
 * auto-check needs: identity, landing state, base and head, changed files,
 * and the classification. Fetches the diff only when documentation is part
 * of the change.
 */
export function intake(url, { github = createGitHub(), cloneDir = null } = {}) {
  const ref = parsePrUrl(url);
  const view = github.viewPr(ref);
  let files = (view.files ?? []).map(normalizeFile);
  if (files.length < (view.changedFiles ?? 0)) files = github.prFiles(ref);
  const landing = resolveLanding(view, ref, { github, cloneDir });
  let classification = classify({ files, repo: ref.repo });
  if (classification.kind !== 'source') {
    classification = classify({ files, repo: ref.repo, addedLines: addedLinesByFile(github.prDiff(ref)) });
  }
  return {
    url: ref.url,
    host: ref.host,
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    slug: slugFor(ref),
    title: view.title ?? '',
    body: view.body ?? '',
    state: view.state,
    ...landing,
    base: view.baseRefName,
    head: {
      owner: view.headRepositoryOwner?.login ?? null,
      repo: view.headRepository?.name ?? null,
      ref: view.headRefName ?? null,
      sha: view.headRefOid ?? null,
    },
    isCrossRepository: Boolean(view.isCrossRepository),
    closedAt: view.closedAt ?? null,
    closingIssues: (view.closingIssuesReferences ?? []).map((issue) => issue.number),
    changedFiles: view.changedFiles ?? files.length,
    files: files.map((file) => file.path),
    classification,
  };
}

/** Plain-text summary of an intake result. */
export function formatIntake(info) {
  const short = (sha) => (sha ? sha.slice(0, 7) : 'unknown');
  const landing = {
    merged: `merged as ${short(info.landedSha)}`,
    landed: `landed by a ${info.landedBy} as ${short(info.landedSha)}, without a merge`,
    open: 'open, not merged yet',
    closed: 'closed without landing',
  }[info.status];
  const head = [[info.head.owner, info.head.repo].filter(Boolean).join('/'), info.head.ref].filter(Boolean).join(':');
  const { classification: kind } = info;
  const rows = [
    ['state', `${info.state}, ${landing}`],
    ['base', info.base],
    ['head', `${head}${info.head.sha ? ` @ ${short(info.head.sha)}` : ''}`],
    ['kind', kind.parts.map((part) => `${part.kind} / ${part.subtype}`).join(' + ')],
    ['watch', kind.watchPaths.join(', ')],
    ['alias', kind.alias],
    ['slug', info.slug],
    ['files', `${info.changedFiles} changed`],
    ['because', kind.reasons.join('; ')],
  ];
  return `${info.owner}/${info.repo}#${info.number}  ${info.title}\n${rows.map(([name, value]) => `  ${name.padEnd(9)}${value}`).join('\n')}\n`;
}
