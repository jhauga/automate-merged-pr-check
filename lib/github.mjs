import { spawnSync } from 'node:child_process';
import { firstLine, launcherFor, which } from './util/which.mjs';

/** Raised when the GitHub CLI is missing or a gh call fails. */
export class GhError extends Error {
  constructor(message, { status = null, stderr = '' } = {}) {
    super(message);
    this.name = 'GhError';
    this.status = status;
    this.stderr = stderr;
    this.exitCode = 2;
  }
}

/** Fields `gh pr view --json` returns for intake. */
export const PR_FIELDS = Object.freeze([
  'number', 'title', 'body', 'state', 'mergedAt', 'mergeCommit', 'baseRefName', 'headRefName', 'headRefOid',
  'headRepository', 'headRepositoryOwner', 'isCrossRepository', 'files', 'changedFiles', 'comments', 'closedAt',
  'url', 'closingIssuesReferences',
]);

const TIMELINE_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      timelineItems(last: 100, itemTypes: [CLOSED_EVENT, REFERENCED_EVENT]) {
        nodes {
          __typename
          ... on ClosedEvent { createdAt closer { __typename ... on Commit { oid messageHeadline } } }
          ... on ReferencedEvent { createdAt commit { oid messageHeadline } }
        }
      }
    }
  }
}`;

/**
 * Returns a function that runs gh with arguments and resolves to its stdout.
 * Throws GhError when gh is missing or exits with an error.
 */
export function ghRunner({ env = process.env, timeoutMs = 120000 } = {}) {
  return (args) => {
    const file = which('gh', env);
    if (!file) throw new GhError('GitHub CLI (gh) is not on PATH. Install it, then run gh auth login.');
    const launcher = launcherFor(file);
    const result = spawnSync(launcher.file, [...launcher.args, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      windowsHide: true,
      env: { ...env, GH_PROMPT_DISABLED: '1' },
    });
    if (result.error) throw new GhError(`gh could not run: ${result.error.message}`);
    if (result.status !== 0) {
      const reason = firstLine(result.stderr) || `exit code ${result.status}`;
      throw new GhError(`gh ${args.slice(0, 2).join(' ')} failed: ${reason}`, { status: result.status, stderr: result.stderr });
    }
    return result.stdout;
  };
}

const hostArgs = (ref) => (ref.host && ref.host !== 'github.com' ? ['--hostname', ref.host] : []);

const normalizeFile = (file) => ({
  path: file.path ?? file.filename,
  additions: file.additions ?? 0,
  deletions: file.deletions ?? 0,
});

/**
 * GitHub access for intake, built on the gh CLI. Every method takes a parsed
 * pull request reference (host, owner, repo, number, url). Tests replace the
 * whole object with fixture data.
 */
export function createGitHub({ gh = ghRunner() } = {}) {
  return {
    /** `gh pr view --json` for the fields in PR_FIELDS. */
    viewPr(ref) {
      return JSON.parse(gh(['pr', 'view', ref.url, '--json', PR_FIELDS.join(',')]));
    },

    /** Every changed file, paging past the 100 that `gh pr view` returns. */
    prFiles(ref) {
      const out = gh([
        'api', ...hostArgs(ref), '--paginate',
        `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100`,
        '--jq', '.[] | {path: .filename, additions, deletions}',
      ]);
      return out.split(/\r?\n/).filter(Boolean).map((line) => normalizeFile(JSON.parse(line)));
    },

    /** Unified diff of the pull request. */
    prDiff(ref) {
      return gh(['pr', 'diff', ref.url]);
    },

    /**
     * Commits that may have landed a closed pull request: the commit GitHub
     * recorded as closing it, and commits that reference it, newest first.
     */
    landingCandidates(ref) {
      const out = gh([
        'api', 'graphql', ...hostArgs(ref),
        '-f', `query=${TIMELINE_QUERY}`,
        '-F', `owner=${ref.owner}`,
        '-F', `repo=${ref.repo}`,
        '-F', `number=${ref.number}`,
      ]);
      const nodes = JSON.parse(out).data?.repository?.pullRequest?.timelineItems?.nodes ?? [];
      let closer = null;
      const referenced = [];
      for (const node of nodes) {
        if (node.__typename === 'ClosedEvent' && node.closer?.__typename === 'Commit') {
          closer = { sha: node.closer.oid, message: node.closer.messageHeadline ?? '', at: node.createdAt ?? null };
        } else if (node.__typename === 'ReferencedEvent' && node.commit?.oid) {
          referenced.push({ sha: node.commit.oid, message: node.commit.messageHeadline ?? '', at: node.createdAt ?? null });
        }
      }
      return { closer, referenced: referenced.reverse() };
    },

    /**
     * Whether `sha` is on the base branch, through the compare API. A commit
     * the base already contains compares as behind or identical, and the merge
     * base is then the commit itself, which gives its full SHA.
     */
    commitOnBase(ref, base, sha) {
      let out;
      try {
        out = gh([
          'api', ...hostArgs(ref),
          `repos/${ref.owner}/${ref.repo}/compare/${base}...${sha}`,
          '--jq', '{status: .status, sha: .merge_base_commit.sha}',
        ]);
      } catch (error) {
        if (error instanceof GhError && /HTTP 404|HTTP 422|Not Found|No common ancestor|No commit found/i.test(error.stderr || error.message)) {
          return { onBase: false, sha: null };
        }
        throw error;
      }
      const { status, sha: mergeBase } = JSON.parse(out);
      const onBase = status === 'behind' || status === 'identical';
      return { onBase, sha: onBase ? mergeBase : null };
    },
  };
}

export { normalizeFile };
