import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Raised when a git step fails. */
export class RepoError extends Error {
  constructor(message, stderr = '') {
    super(message);
    this.name = 'RepoError';
    this.stderr = stderr;
    this.exitCode = 2;
  }
}

let emptyHooks = null;

/** An empty folder used as core.hooksPath, so no repository hook runs during auto-check's git steps. */
function hooksOff() {
  emptyHooks ??= mkdtempSync(path.join(os.tmpdir(), 'auto-check-no-hooks-'));
  return emptyHooks;
}

/**
 * `file` as the file system spells it, when it exists: long names for 8.3
 * short ones such as RUNNER~1, and links resolved. Git reports paths that
 * way, so a folder given in another spelling still compares equal.
 */
function canonical(file) {
  const resolved = path.resolve(file);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function samePath(a, b) {
  const [left, right] = [canonical(a), canonical(b)];
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** The line of git's error output that says what failed: the first fatal or error line, else the last line. */
export function gitReason(stderr = '') {
  const lines = String(stderr).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /^(fatal|error):/i.test(line)) ?? lines.at(-1) ?? '';
}

/**
 * Line-ending settings that check files out exactly as the repository stores
 * them, whatever the machine's own git settings ask for. Git for Windows turns
 * core.autocrlf on for the whole machine, which would otherwise give the code
 * under test different bytes on Windows than on any other system.
 */
const STORED_LINE_ENDINGS = Object.freeze(['core.autocrlf=false', 'core.eol=lf']);

/** Settings for every git call: no repository hooks, stored line endings, and paths past 260 characters on Windows. */
function baseConfig() {
  const config = ['-c', `core.hooksPath=${hooksOff()}`];
  for (const setting of STORED_LINE_ENDINGS) config.push('-c', setting);
  if (process.platform === 'win32') config.push('-c', 'core.longpaths=true');
  return config;
}

/**
 * Runs git in `cwd` with hooks off and terminal prompts disabled. Returns
 * trimmed stdout. Throws RepoError, or returns null when `allowFail` is set.
 */
export function git(cwd, args, { allowFail = false } = {}) {
  const result = spawnSync('git', [...baseConfig(), ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw new RepoError(`git could not run: ${result.error.message}`);
  if (result.status !== 0) {
    if (allowFail) return null;
    throw new RepoError(`git ${args.find((arg) => !arg.startsWith('-')) ?? ''} failed in ${cwd}: ${gitReason(result.stderr)}`, result.stderr);
  }
  return result.stdout.trim();
}

/** Commit the folder's HEAD points at. */
export function headSha(dir) {
  return git(dir, ['rev-parse', 'HEAD']);
}

/** True when `dir` is the top of a working git clone, such as one whose separate git folder still exists. */
function isCloneAt(dir) {
  if (!existsSync(path.join(dir, '.git'))) return false;
  const top = git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true });
  return top !== null && samePath(top, dir);
}

/** Room for the longest path git writes inside its folder, such as a pack file, with some to spare. */
const GIT_DIR_ROOM = 100;
const WINDOWS_MAX_PATH = 259;

/**
 * Where a managed clone at `dir` keeps its git folder when `dir/.git` would
 * be too deep for git on Windows, which cannot write pack files past 260
 * characters even with long paths enabled: a short per-user folder named
 * after the check and a hash of `dir`. Null when `dir/.git` is short enough.
 */
export function gitDirFor(dir, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return null;
  const win = path.win32;
  const full = win.resolve(dir);
  if (win.join(full, '.git').length + GIT_DIR_ROOM <= WINDOWS_MAX_PATH) return null;
  const base = env.LOCALAPPDATA || win.join(os.homedir(), 'AppData', 'Local');
  const hash = createHash('sha256').update(full.toLowerCase()).digest('hex').slice(0, 12);
  const name = win.basename(win.dirname(full)).slice(0, 40);
  return win.join(base, 'auto-check', 'git', `${name}-${hash}`);
}

/**
 * Keeps a managed clone of the upstream repository at the tip of its base
 * branch: clones it the first time without file contents, or again when the
 * folder no longer holds a working clone or holds one made without the stored
 * line endings, whose converted files a checkout would leave in place. Then
 * on every call it fetches, checks
 * out origin/<base> detached, and removes anything not in the commit. With `sparse`, a list of folders, only those folders and the
 * root files are checked out; without it the whole tree is. `gitDir` keeps
 * the git folder elsewhere, as gitDirFor decides by default. Returns the
 * folder, the commit it now holds, and the sparse folders.
 */
export function refreshManagedClone({ dir, url, baseRef, sparse = null, gitDir = gitDirFor(dir) }) {
  const folders = (sparse ?? []).map((folder) => folder.replace(/\/+$/, '')).filter(Boolean);
  if (folders.some((folder) => folder.startsWith('-'))) throw new RepoError(`Sparse folders cannot start with "-": ${folders.join(', ')}`);
  const current = isCloneAt(dir) && git(dir, ['config', '--local', '--get', 'core.eol'], { allowFail: true }) === 'lf';
  if (!current) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(path.dirname(dir), { recursive: true });
    const args = ['clone', '--filter=blob:none', '--no-checkout', ...STORED_LINE_ENDINGS.flatMap((setting) => ['-c', setting])];
    if (gitDir) {
      rmSync(gitDir, { recursive: true, force: true });
      mkdirSync(path.dirname(gitDir), { recursive: true });
      args.push('--separate-git-dir', gitDir);
    }
    git(path.dirname(dir), [...args, url, dir]);
  }
  if (folders.length > 0) {
    git(dir, ['sparse-checkout', 'set', '--cone', ...folders]);
  } else if (git(dir, ['config', '--bool', 'core.sparseCheckout'], { allowFail: true }) === 'true') {
    git(dir, ['sparse-checkout', 'disable']);
  }
  git(dir, ['fetch', '--prune', '--force', 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`]);
  git(dir, ['checkout', '--force', '--detach', `refs/remotes/origin/${baseRef}`]);
  git(dir, ['clean', '-ffdx']);
  return { dir, baseRef, sha: headSha(dir), sparse: folders.length > 0 ? folders : null };
}

/**
 * Newest commit on origin/<base> whose message names pull request
 * `number`, as in "Closes #123" or "(#123)". Returns { sha, subject } or null.
 */
export function findLandedCommit(dir, baseRef, number) {
  const out = git(dir, ['log', `refs/remotes/origin/${baseRef}`, '-E', `--grep=#${number}([^0-9]|$)`, '--format=%H%x09%s', '-n', '1'], { allowFail: true });
  if (!out) return null;
  const [sha, ...subject] = out.split('\t');
  return { sha, subject: subject.join('\t') };
}

/**
 * Commits in `from..to` that touch `paths`. A path ending in /** matches
 * everything under that folder. Returns [{ sha, subject }], newest first.
 */
export function listCommits(dir, { from = null, to = 'HEAD', paths = [] } = {}) {
  const range = from ? `${from}..${to}` : to;
  const pathspecs = paths.map((entry) => (entry.endsWith('/**') ? `:(glob)${entry}` : entry));
  const out = git(dir, ['log', '--format=%H%x09%s', range, '--', ...pathspecs]);
  if (!out) return [];
  return out.split(/\r?\n/).map((line) => {
    const [sha, ...subject] = line.split('\t');
    return { sha, subject: subject.join('\t') };
  });
}

function registeredWorktrees(repo) {
  return (git(repo, ['worktree', 'list', '--porcelain']) ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

/**
 * Removes a worktree that prepareLocalWorktree created, and its folder. The
 * user's own working tree and branches are not touched.
 */
export function removeLocalWorktree({ localRepo, worktreeDir }) {
  const registered = registeredWorktrees(localRepo).find((entry) => samePath(entry, worktreeDir));
  if (registered) {
    git(localRepo, ['worktree', 'remove', '--force', registered], { allowFail: true });
  }
  if (existsSync(worktreeDir)) rmSync(worktreeDir, { recursive: true, force: true });
}

/**
 * Builds a scratch copy of an unmerged pull request rebased onto the latest
 * upstream base, without changing the user's working tree or branches:
 * fetches the upstream and origin remotes, adds a detached worktree at
 * `worktreeDir` from the pull request branch, and rebases it there. A rebase conflict is aborted and
 * reported as `conflict: true`, leaving the worktree at the branch tip.
 */
export function prepareLocalWorktree({
  localRepo,
  branch = null,
  headRef = null,
  baseRef,
  upstreamRemote = 'upstream',
  originRemote = 'origin',
  worktreeDir,
}) {
  const repo = git(localRepo, ['rev-parse', '--show-toplevel']);
  const remotes = (git(repo, ['remote']) ?? '').split(/\r?\n/).filter(Boolean);
  const upstream = remotes.includes(upstreamRemote) ? upstreamRemote : remotes.includes(originRemote) ? originRemote : null;
  if (!upstream) throw new RepoError(`${repo} has neither a "${upstreamRemote}" nor an "${originRemote}" remote.`);
  git(repo, ['fetch', upstream]);
  if (upstream !== originRemote && remotes.includes(originRemote)) git(repo, ['fetch', originRemote]);

  const wanted = branch ?? headRef;
  const candidates = wanted
    ? [`refs/heads/${wanted}`, `refs/remotes/${originRemote}/${wanted}`, `refs/remotes/${upstream}/${wanted}`]
    : ['HEAD'];
  const ref = candidates.find((candidate) => git(repo, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { allowFail: true }));
  if (!ref) throw new RepoError(`Branch "${wanted}" was not found in ${repo} or its remotes.`);
  const baseName = `refs/remotes/${upstream}/${baseRef}`;
  const baseSha = git(repo, ['rev-parse', '--verify', '--quiet', `${baseName}^{commit}`], { allowFail: true });
  if (!baseSha) throw new RepoError(`Base branch "${baseRef}" was not found on the "${upstream}" remote of ${repo}.`);
  const branchSha = git(repo, ['rev-parse', `${ref}^{commit}`]);

  removeLocalWorktree({ localRepo: repo, worktreeDir });
  mkdirSync(path.dirname(worktreeDir), { recursive: true });
  try {
    git(repo, ['worktree', 'add', '--force', '--detach', worktreeDir, branchSha]);
    const rebased = git(worktreeDir, ['-c', 'user.name=auto-check', '-c', 'user.email=auto-check@example.com', 'rebase', baseSha], { allowFail: true });
    const conflict = rebased === null;
    if (conflict) git(worktreeDir, ['rebase', '--abort'], { allowFail: true });
    return {
      repo,
      upstream,
      ref,
      branchSha,
      baseRef,
      baseSha,
      worktreeDir,
      sha: headSha(worktreeDir),
      conflict,
    };
  } catch (error) {
    removeLocalWorktree({ localRepo: repo, worktreeDir });
    throw error;
  }
}
