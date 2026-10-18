import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assistantFor } from './assistants/index.mjs';
import { contextToMarkdown, localRepoFor, readFormIn } from './context.mjs';
import { readContributing } from './contributing.mjs';
import { describeProblems, localNames, outboundProblems } from './outbound.mjs';
import { renderPrompt } from './prompt.mjs';
import { loadCheck } from './runner.mjs';
import { display, execCommand } from './util/command.mjs';
import { which } from './util/which.mjs';

/** Raised when a resolve step cannot run; carries the exit code to use. */
export class ResolveError extends Error {
  constructor(message, { exitCode = 2, problems = [] } = {}) {
    super(message);
    this.name = 'ResolveError';
    this.exitCode = exitCode;
    this.problems = problems;
  }
}

const ASSISTANT_MINUTES = 60;
const IMAGE = /\.png$/i;
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
const lastLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';

const REQUIRED = [
  [/^---\r?\ndescription: .+\r?\n---/, 'It must open with frontmatter that holds a single description line.'],
  [/^# .+/m, 'It needs a title line that starts with "# ".'],
  [/CONTINUE\? Y or N/, 'The opening paragraph must name the CONTINUE? Y or N marker.'],
  [/TASK COMPLETE!/, 'The opening paragraph must name the TASK COMPLETE! marker.'],
  [/^## Evaluation\b/m, 'It needs a "## Evaluation" section.'],
  [/^### Root cause\b/m, 'The evaluation needs a "### Root cause" subsection.'],
  [/^### Ruled out\b/m, 'The evaluation needs a "### Ruled out" subsection.'],
  [/^## Decisions\b/m, 'It needs a "## Decisions" section.'],
  [/^## Phases\b/m, 'It needs a "## Phases" section.'],
  [/^### Phase 1\b/m, 'The phases start with "### Phase 1".'],
  [/^Checks:/m, 'Each phase ends with "Checks:" and a list of checks.'],
];

/** Problems that keep a proposed solution from the required shape; empty when it has it. */
export function proposalProblems(text) {
  const problems = REQUIRED.filter(([pattern]) => !pattern.test(text)).map(([, problem]) => problem);
  const decisions = /^## Decisions\b([\s\S]*?)(?=^## )/m.exec(text)?.[1] ?? '';
  if (decisions && !/^- \[x\] /m.test(decisions) && !/There are no decisions to make/.test(decisions)) {
    problems.push('Each decision needs its recommended option ticked with "- [x]", or the section must say "There are no decisions to make."');
  }
  if (/[\u2013\u2014]/.test(text)) problems.push('It uses em dashes or en dashes; use commas, colons, or new sentences instead.');
  return problems;
}

/**
 * The failure report a resolve step works from: the open one in state.json,
 * or, with none, the open simulated one.
 */
export function openResolution(state) {
  if (state.openResolution?.foundIssue) return { ...state.openResolution, simulated: false };
  if (state.simulated?.openResolution?.foundIssue) return { ...state.simulated.openResolution, simulated: true };
  return null;
}

function readState(dir) {
  const file = path.join(dir, 'state.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Has the assistant write proposed-solution<suffix>.prompt.md beside the open
 * failure report: renders prompts/propose-solution.md into the failing run's
 * result folder, runs the assistant with the report, the captures, the code
 * under test, and the local clone, and checks the shape of what it wrote,
 * with one repair round. `open` names the failure report when the caller
 * already knows it. With `dryRun` it writes the prompt and stops.
 */
export async function proposeSolution({ testFolder, config, open: given = null, assistantName = null, model = null, dryRun = false, log = () => {}, deps = {} }) {
  const workRoot = path.resolve(testFolder);
  const slug = path.basename(workRoot);
  const { assistant = (name) => assistantFor(config, { name: name ?? config.assistant }) } = deps;
  const { dir, check } = loadCheck(workRoot, config);
  const tool = check.assistant ?? {};
  const open = given ?? openResolution(readState(dir));
  if (!open) throw new ResolveError(`${slug} has no open failure. A failing run of auto-check run ${slug} writes the failure report this step needs.`);
  const foundIssueFile = path.join(workRoot, open.foundIssue);
  if (!existsSync(foundIssueFile)) throw new ResolveError(`The failure report ${open.foundIssue} is missing. Run auto-check run ${slug} again.`);
  const proposedSolutionFile = path.join(workRoot, open.proposedSolution);
  const resultDir = path.join(workRoot, open.resultDir);
  const images = existsSync(resultDir) ? readdirSync(resultDir).filter((name) => IMAGE.test(name)).map((name) => path.join(resultDir, name)) : [];
  const sourceDir = path.join(dir, check.source?.clonePath ?? 'repo');
  const localRepo = localRepoFor({ testFolder: workRoot, config, check });
  const form = readFormIn(workRoot);
  const values = {
    slug,
    context: form?.context?.prContext ? contextToMarkdown(form.context).trim() : '',
    foundIssueFile,
    proposedSolutionFile,
    resultDir,
    images: images.map((file) => `  - \`${file}\``),
    sourceDir,
    localRepo,
    branch: `${config.repos?.branchPrefix ?? 'resolve-issue-'}${check.alias ?? slug}`,
    today: new Date().toISOString().slice(0, 10),
  };
  const promptFile = path.join(resultDir, 'propose-solution.prompt.md');
  writeFileSync(promptFile, renderPrompt('propose-solution', values));
  if (dryRun) return { dryRun: true, promptFile, proposedSolutionFile, simulated: open.simulated };

  const runner = assistant(assistantName ?? tool.command ?? null);
  if (!runner.available()) throw new ResolveError(`${runner.label} is not available on this machine. Run auto-check doctor.`);
  const addDirs = [path.dirname(proposedSolutionFile), dir, ...(localRepo && existsSync(localRepo) ? [localRepo] : [])];
  const ask = async (file, output) => {
    const answer = await runner.run({
      promptFile: file,
      cwd: workRoot,
      role: 'analyze',
      model: model ?? tool.model ?? undefined,
      effort: tool.effort || undefined,
      addDirs,
      attachments: images,
      outputFile: path.join(resultDir, output),
      timeoutMs: ASSISTANT_MINUTES * 60 * 1000,
    });
    if (answer.timedOut) throw new ResolveError(`${runner.label} did not finish within ${ASSISTANT_MINUTES} minutes.`);
    if (answer.exitCode !== 0) {
      throw new ResolveError(`${runner.label} stopped with exit code ${answer.exitCode}: ${lastLine(answer.stdout) || lastLine(answer.stderr) || 'no output'}`);
    }
    return answer;
  };

  log(`Asking ${runner.label} for a proposed solution`);
  await ask(promptFile, 'propose-solution.output.md');
  const check1 = () => (existsSync(proposedSolutionFile) ? proposalProblems(readFileSync(proposedSolutionFile, 'utf8')) : [`${path.basename(proposedSolutionFile)} was not written.`]);
  let problems = check1();
  let repaired = false;
  if (problems.length > 0) {
    log(`The proposed solution misses ${problems.length} part(s) of the required shape; asking for one repair`);
    const repairFile = path.join(resultDir, 'repair-proposal.prompt.md');
    writeFileSync(repairFile, renderPrompt('repair-proposal', { ...values, problems: problems.map((problem) => `- ${problem}`) }));
    await ask(repairFile, 'repair-proposal.output.md');
    repaired = true;
    problems = check1();
  }
  if (problems.length > 0) throw new ResolveError('The proposed solution still does not have the required shape.', { problems });
  const headline = firstLine(/^description: (.+)$/m.exec(readFileSync(proposedSolutionFile, 'utf8'))?.[1] ?? '');
  return { dryRun: false, proposedSolutionFile, promptFile, repaired, simulated: open.simulated, assistant: runner.label, headline };
}

const OWNER_REPO = /([^/\\:]+)[/\\:]+([^/\\:]+?)(?:\.git)?[/\\]*$/;
const slash = (value) => value.split(path.sep).join('/');
const git = (repo, ...args) => ({ file: 'git', args: ['-C', repo, ...args] });

/** owner/repo of a remote's URL or path, lowercase, such as acme/demo-app. */
export function repoSlugOf(url) {
  const match = OWNER_REPO.exec(String(url ?? '').trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function commandRunner(exec) {
  return (command, { allowFail = false } = {}) => {
    const result = exec(command);
    if (result.status !== 0 && !allowFail) {
      throw new ResolveError(`${display(command)} failed: ${firstLine(result.stderr || result.stdout) || `exit code ${result.status}`}`);
    }
    return result;
  };
}

function remotesOf(run, repo) {
  const remotes = new Map();
  for (const line of run(git(repo, 'remote', '-v')).stdout.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match) remotes.set(match[1], match[2]);
  }
  return remotes;
}

/**
 * The local clone a fix goes into, and its remotes: the one that points at
 * the pull request's repository, which the branch starts from, and the
 * user's fork, the only place auto-check pushes to.
 */
function locateRepo({ workRoot, config, check, run }) {
  const repo = localRepoFor({ testFolder: workRoot, config, check });
  const target = `${check.pr?.owner}/${check.pr?.repo}`.toLowerCase();
  if (!repo) throw new ResolveError(`No local clone of ${target} is known. Name one on the Local Repository line of context.md, or run auto-check config set repos.localRepo <path>.`);
  if (!existsSync(repo)) throw new ResolveError(`The local clone ${repo} was not found.`);
  const remotes = remotesOf(run, repo);
  const names = [config.repos?.upstreamRemote, ...remotes.keys()].filter((name, index, all) => name && remotes.has(name) && all.indexOf(name) === index);
  const upstream = names.find((name) => repoSlugOf(remotes.get(name)) === target);
  if (!upstream) throw new ResolveError(`No remote of ${repo} points at ${target}. Add one with: git remote add upstream https://github.com/${target}.git`);
  const originName = config.repos?.originRemote ?? 'origin';
  const forkSlug = remotes.has(originName) ? repoSlugOf(remotes.get(originName)) : null;
  const fork = forkSlug && forkSlug !== target ? { remote: originName, slug: forkSlug, owner: forkSlug.split('/')[0], name: forkSlug.split('/')[1] } : null;
  return { repo, upstream, upstreamSlug: target, fork };
}

/** Files in proposed-solution/<day>/resolve<suffix>/ for the open failure report. */
export function prPaths(workRoot, open) {
  const proposed = path.join(workRoot, open.proposedSolution);
  const suffix = /^proposed-solution(.*)\.prompt\.md$/.exec(path.basename(proposed))?.[1] ?? '';
  const dir = path.join(path.dirname(proposed), `resolve${suffix}`);
  const at = (name) => path.join(dir, name);
  return {
    dir,
    resolvePrompt: at('resolve-issue.prompt.md'),
    commitMessage: at('commit-message.txt'),
    summary: at('resolve-issue.summary.md'),
    prPrompt: at('pull-request.prompt.md'),
    title: at('pr-title.txt'),
    body: at('pr-body.md'),
    issueTitle: at('issue-title.txt'),
    issueBody: at('issue-body.md'),
    pullRequest: at('pull-request.md'),
    patch: at('patch.diff'),
  };
}

function prepare({ workRoot, config, slug, open: given, run, dryRun = false }) {
  const { dir, check } = loadCheck(workRoot, config);
  const open = given ?? openResolution(readState(dir));
  if (!open) throw new ResolveError(`${slug} has no open failure. A failing run of auto-check run ${slug} writes the failure report this step needs.`);
  const blockers = [];
  const refuse = (message) => {
    if (!dryRun) throw new ResolveError(message);
    blockers.push(message);
  };
  if (open.simulated) refuse('The open failure report comes from a simulated run, so there is nothing to fix. A real failure is needed.');
  if (!existsSync(path.join(workRoot, open.proposedSolution))) {
    refuse(`There is no proposed solution for the open failure yet. Run auto-check resolve ${slug} --propose first.`);
  }
  const located = locateRepo({ workRoot, config, check, run });
  const base = check.source?.baseRef ?? check.pr?.base ?? 'main';
  const host = /^https?:\/\/([^/]+)/.exec(check.pr?.url ?? '')?.[1] ?? 'github.com';
  return {
    dir,
    check,
    blockers,
    tool: check.assistant ?? {},
    open,
    ...located,
    base,
    host,
    upstreamRef: `${located.upstream}/${base}`,
    branch: freeBranch({
      repo: located.repo,
      wanted: `${config.repos?.branchPrefix ?? 'resolve-issue-'}${check.alias ?? slug}`,
      keep: open.branch ?? null,
      run,
    }),
    worktreeDir: path.join(workRoot, RESOLVE_WORKTREE),
    contributing: readContributing(located.repo, { subjectPath: check.subject?.path ?? '' }),
    paths: prPaths(workRoot, open),
    rel: (file) => slash(path.relative(workRoot, file)),
  };
}

/** Removes the resolve worktree, and the folder git may leave behind. */
function removeWorktreeIfAny({ repo, worktreeDir, exec }) {
  exec(git(repo, 'worktree', 'remove', '--force', worktreeDir));
  exec(git(repo, 'worktree', 'prune'));
  if (existsSync(worktreeDir)) rmSync(worktreeDir, { recursive: true, force: true });
}

/** Folder a resolve run builds its worktree in, inside the test folder. */
export const RESOLVE_WORKTREE = 'resolve-worktree';

/**
 * The branch name to make: the one the open failure already uses, else the
 * wanted name, else that name with -2, -3, and so on until one is free.
 */
export function freeBranch({ repo, wanted, keep = null, run }) {
  const exists = (name) => run(git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`), { allowFail: true }).status === 0;
  if (keep) return keep;
  if (!exists(wanted)) return wanted;
  for (let count = 2; count < 100; count += 1) {
    if (!exists(`${wanted}-${count}`)) return `${wanted}-${count}`;
  }
  throw new ResolveError(`${repo} already holds ${wanted} and 98 numbered branches beside it. Delete some before resolving again.`);
}

function gitIdentity(exec, repo) {
  return ['user.name', 'user.email'].map((key) => exec(git(repo, 'config', key))).filter((result) => result.status === 0).map((result) => result.stdout.trim());
}

function addedText(diff) {
  return diff.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n');
}

const pushCommandFor = (repo, fork, branch) => (fork ? git(repo, 'push', fork.remote, `refs/heads/${branch}:refs/heads/${branch}`) : null);

function checkAnswer(runner, answer) {
  if (answer.timedOut) throw new ResolveError(`${runner.label} did not finish within ${ASSISTANT_MINUTES} minutes.`);
  if (answer.exitCode !== 0) {
    throw new ResolveError(`${runner.label} stopped with exit code ${answer.exitCode}: ${lastLine(answer.stdout) || lastLine(answer.stderr) || 'no output'}`);
  }
}

/**
 * Applies the proposed solution in a git worktree of the local clone, so the
 * user's own checkout, branches, and files are never touched: fetches the
 * newest upstream base, adds a worktree with a new resolve-issue-<alias>
 * branch from it, has the assistant make the change and write the commit
 * message there, checks the message and the added lines for local data,
 * commits in the repository's style (with a sign-off when its contributing
 * guide asks for one), then removes the worktree and leaves the branch. It
 * pushes only with `push`, only to the user's fork, and never with force.
 * With `dryRun` it changes nothing, returns the commands it would run, and
 * reports what would stop a real run, such as a failure that was simulated or
 * a proposed solution that is still missing. Returns the report and the
 * updated open failure.
 */
export async function resolveIssue({ testFolder, config, open: given = null, push = false, dryRun = false, assistantName = null, model = null, log = () => {}, deps = {} }) {
  const workRoot = path.resolve(testFolder);
  const slug = path.basename(workRoot);
  const exec = deps.exec ?? execCommand;
  const run = commandRunner(exec);
  const ctx = prepare({ workRoot, config, slug, open: given, run, dryRun });
  const { repo, branch, upstream, upstreamRef, base, fork, contributing, paths, rel, tool, worktreeDir } = ctx;
  let { open } = ctx;
  const pushCommand = pushCommandFor(repo, fork, branch);
  const report = { repo, branch, upstreamRef, worktree: worktreeDir, contributing, commands: [], notes: [], blockers: [...ctx.blockers] };
  const stop = (message, problems = []) => {
    if (!dryRun) throw new ResolveError(message, { problems });
    report.blockers.push(message);
  };
  if (push && !pushCommand) {
    stop(`The ${config.repos?.originRemote ?? 'origin'} remote of ${repo} is not a fork of ${ctx.upstreamSlug}. auto-check pushes only to your fork; point that remote at it first.`);
  }

  const held = exec(git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`));
  if (held.status === 0) {
    const head = held.stdout.trim();
    report.notes.push(`${branch} already holds the fix, ${head.slice(0, 7)}.`);
    if (push && !open.pushed) {
      report.commands.push(display(pushCommand));
      if (!dryRun) {
        run(pushCommand);
        open = { ...open, pushed: true };
      }
    }
    return { ...report, dryRun, existing: true, commit: head, pushed: Boolean(open.pushed), open };
  }

  const fetch = git(repo, 'fetch', upstream, `+refs/heads/${base}:refs/remotes/${upstream}/${base}`);
  const addWorktree = git(repo, 'worktree', 'add', '-b', branch, worktreeDir, upstreamRef);
  const add = git(worktreeDir, 'add', '-A');
  const commit = git(worktreeDir, 'commit', '-F', paths.commitMessage, ...(contributing.signOff ? ['-s'] : []));
  const removeWorktree = git(repo, 'worktree', 'remove', '--force', worktreeDir);
  const assistant = (deps.assistant ?? ((name) => assistantFor(config, { name: name ?? config.assistant })))(assistantName ?? tool.command ?? null);
  if (report.blockers.length === 0) {
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.resolvePrompt, renderPrompt('resolve-issue', {
      repo: worktreeDir,
      branch,
      upstreamRef,
      proposedSolutionFile: path.join(workRoot, open.proposedSolution),
      foundIssueFile: path.join(workRoot, open.foundIssue),
      contributingFile: contributing.file ?? '',
      contributingItems: contributing.items.map((item) => `   - ${item}`),
      checkCommands: contributing.commands.slice(0, 6).map((command) => `\`${command}\``).join(', '),
      commitMessageFile: paths.commitMessage,
      summaryFile: paths.summary,
      signOff: contributing.signOff,
    }));
  }
  report.commands = [
    display(fetch),
    display(addWorktree),
    `${assistant.label} applies ${rel(path.join(workRoot, open.proposedSolution))} in ${worktreeDir} (prompt: ${rel(paths.resolvePrompt)})`,
    display(add),
    display(commit),
    ...(push && pushCommand ? [display(pushCommand)] : []),
    display(removeWorktree),
  ];
  if (!push) {
    report.notes.push(pushCommand ? `Nothing is pushed without --push. To push the branch later: ${display(pushCommand)}` : `The ${config.repos?.originRemote ?? 'origin'} remote is not a fork, so the branch stays local.`);
  }
  report.notes.push(`The worktree in ${worktreeDir} is removed afterwards, so ${repo} keeps the branch it is on.`);
  if (dryRun) return { ...report, dryRun: true, open };

  removeWorktreeIfAny({ repo, worktreeDir, exec });
  run(fetch);
  mkdirSync(path.dirname(worktreeDir), { recursive: true });
  run(addWorktree);
  let commitSha;
  try {
    const baseSha = run(git(worktreeDir, 'rev-parse', 'HEAD')).stdout.trim();
    if (!assistant.available()) throw new ResolveError(`${assistant.label} is not available on this machine. Run auto-check doctor.`);
    log(`Asking ${assistant.label} to apply the proposed solution on ${branch}`);
    checkAnswer(assistant, await assistant.run({
      promptFile: paths.resolvePrompt,
      cwd: worktreeDir,
      role: 'analyze',
      model: model ?? tool.model ?? undefined,
      effort: tool.effort || undefined,
      addDirs: [worktreeDir, paths.dir],
      outputFile: path.join(paths.dir, 'resolve-issue.output.md'),
      timeoutMs: ASSISTANT_MINUTES * 60 * 1000,
    }));

    const current = run(git(worktreeDir, 'branch', '--show-current')).stdout.trim();
    if (current !== branch) throw new ResolveError(`The assistant left the worktree on ${current || 'a detached HEAD'} instead of ${branch}. Review ${worktreeDir} by hand.`);
    if (run(git(worktreeDir, 'rev-parse', 'HEAD')).stdout.trim() !== baseSha) throw new ResolveError(`The assistant committed on ${branch} itself. Review the branch by hand.`);
    if (!run(git(worktreeDir, 'status', '--porcelain')).stdout.trim()) throw new ResolveError('The assistant changed no file in the worktree.');
    const message = existsSync(paths.commitMessage) ? readFileSync(paths.commitMessage, 'utf8') : '';
    if (!message.trim()) throw new ResolveError(`The assistant wrote no commit message to ${rel(paths.commitMessage)}.`);

    run(add);
    const names = localNames({ extra: gitIdentity(exec, repo) });
    const problems = [
      ...describeProblems(path.basename(paths.commitMessage), outboundProblems(message, { names })),
      ...describeProblems('added lines', outboundProblems(addedText(run(git(worktreeDir, 'diff', '--cached')).stdout), { names })),
    ];
    if (problems.length > 0) {
      throw new ResolveError(`The commit would carry local data, so auto-check stopped before committing. The changes stay staged in ${worktreeDir} for review.`, { problems });
    }
    run(commit);
    commitSha = run(git(worktreeDir, 'rev-parse', 'HEAD')).stdout.trim();
  } finally {
    if (commitSha) removeWorktreeIfAny({ repo, worktreeDir, exec });
  }
  if (push) run(pushCommand);
  open = { ...open, repo, branch, commit: commitSha, pushed: push };
  return { ...report, dryRun: false, existing: false, commit: commitSha, pushed: push, summaryFile: paths.summary, open };
}

function pullRequestDocument({ title, body, branch, base, fork, upstreamSlug, host, paths, commands, contributing }) {
  const head = fork ? `${fork.owner}:${branch}` : branch;
  const compare = fork ? `https://${host}/${upstreamSlug}/compare/${base}...${fork.owner}:${fork.name}:${branch}` : null;
  const lines = [
    `# Pull request: ${title}`,
    '',
    'auto-check did not open this pull request. Open it by hand with the commands below, or set Make PR to true in context.md and run auto-check resolve --pr --push.',
    '',
    `- Branch: \`${head}\``,
    `- Base: \`${upstreamSlug}\` \`${base}\``,
    ...(compare ? [`- Compare: ${compare}`] : []),
    `- Changes: \`${path.basename(paths.patch)}\` in this folder`,
    '',
    '```sh',
    ...commands,
    '```',
    '',
    '## Title',
    '',
    title,
    '',
    '## Body',
    '',
    body.trim(),
  ];
  if (contributing.items.length > 0) lines.push('', '## Checklist from the contributing guide', '', ...contributing.items.map((item) => `- [ ] ${item}`));
  return `${lines.join('\n')}\n`;
}

/**
 * Prepares the pull request for the fix branch: writes patch.diff, has the
 * assistant write the title and body (and an issue, with `openIssue`), and
 * checks them for local data. With `makePr`, a fork, a pushed branch, and the
 * GitHub CLI, it opens the pull request against the upstream base, adding
 * "Resolves #<n>" when an issue number is known. Otherwise it writes
 * pull-request.md with everything needed to open it by hand. With `dryRun` it
 * changes nothing and returns the commands it would run.
 */
export async function resolvePr({
  testFolder,
  config,
  open: given = null,
  push = false,
  makePr = false,
  openIssue = false,
  dryRun = false,
  assistantName = null,
  model = null,
  log = () => {},
  deps = {},
}) {
  const workRoot = path.resolve(testFolder);
  const slug = path.basename(workRoot);
  const exec = deps.exec ?? execCommand;
  const run = commandRunner(exec);
  const ghAvailable = deps.ghAvailable ?? (() => which('gh') !== null);
  const ctx = prepare({ workRoot, config, slug, open: given, run, dryRun });
  const { repo, branch, base, fork, upstreamSlug, upstreamRef, contributing, paths, check, rel, tool } = ctx;
  let { open } = ctx;
  const wantPr = Boolean(makePr);
  const wantIssue = wantPr && Boolean(openIssue);
  const pushCommand = pushCommandFor(repo, fork, branch);
  const branchExists = exec(git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)).status === 0;
  if (!branchExists && !dryRun) throw new ResolveError(`The branch ${branch} does not exist in ${repo}. Run auto-check resolve ${slug} --issue first.`);
  const readText = (file, fallback) => (existsSync(file) ? readFileSync(file, 'utf8').trim() : fallback);
  const prCommand = (title) => (fork ? { file: 'gh', args: ['pr', 'create', '--repo', upstreamSlug, '--base', base, '--head', `${fork.owner}:${branch}`, '--title', title, '--body-file', paths.body] } : null);
  const issueCommand = (title) => ({ file: 'gh', args: ['issue', 'create', '--repo', upstreamSlug, '--title', title, '--body-file', paths.issueBody] });

  const report = { repo, branch, upstreamRef, contributing, commands: [], notes: [], blockers: [...ctx.blockers] };
  if (push && !open.pushed && pushCommand) report.commands.push(display(pushCommand));
  if (wantIssue && !open.issue) report.commands.push(display(issueCommand('<the title in issue-title.txt>')));
  if (wantPr && fork) report.commands.push(display(prCommand('<the title in pr-title.txt>')));
  if (!branchExists) report.notes.push(`The branch ${branch} does not exist yet; auto-check resolve ${slug} --issue makes it.`);
  if (!fork) report.notes.push(`The ${config.repos?.originRemote ?? 'origin'} remote is not a fork of ${upstreamSlug}, so no pull request can come from it.`);
  if (!wantPr) report.notes.push(`Make PR is off, so auto-check writes ${rel(paths.pullRequest)} and ${rel(paths.patch)} to open the pull request by hand.`);
  if (dryRun) return { ...report, dryRun: true, open };

  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.patch, run(git(repo, 'diff', `${upstreamRef}...${branch}`)).stdout);
  writeFileSync(paths.prPrompt, renderPrompt('pull-request', {
    repo,
    branch,
    upstreamRef,
    foundIssueFile: path.join(workRoot, open.foundIssue),
    proposedSolutionFile: path.join(workRoot, open.proposedSolution),
    patchFile: paths.patch,
    titleFile: paths.title,
    bodyFile: paths.body,
    templateFile: contributing.template ?? '',
    contributingFile: contributing.file ?? '',
    issueWanted: wantIssue && !open.issue,
    issueTitleFile: paths.issueTitle,
    issueBodyFile: paths.issueBody,
  }));
  const assistant = (deps.assistant ?? ((name) => assistantFor(config, { name: name ?? config.assistant })))(assistantName ?? tool.command ?? null);
  if (!assistant.available()) throw new ResolveError(`${assistant.label} is not available on this machine. Run auto-check doctor.`);
  log(`Asking ${assistant.label} for the pull request text`);
  checkAnswer(assistant, await assistant.run({
    promptFile: paths.prPrompt,
    cwd: workRoot,
    role: 'analyze',
    model: model ?? tool.model ?? undefined,
    effort: tool.effort || undefined,
    addDirs: [paths.dir, repo],
    outputFile: path.join(paths.dir, 'pull-request.output.md'),
    timeoutMs: ASSISTANT_MINUTES * 60 * 1000,
  }));

  const title = readText(paths.title, '').split(/\r?\n/)[0].trim();
  let body = readText(paths.body, '');
  if (!title || !body) throw new ResolveError(`The assistant did not write both ${rel(paths.title)} and ${rel(paths.body)}.`);
  const names = localNames({ extra: gitIdentity(exec, repo) });
  const outbound = [[paths.title, title], [paths.body, body]];
  if (wantIssue && !open.issue) outbound.push([paths.issueTitle, readText(paths.issueTitle, '')], [paths.issueBody, readText(paths.issueBody, '')]);
  const problems = outbound.flatMap(([file, text]) => describeProblems(path.basename(file), outboundProblems(text, { names })));
  if (problems.length > 0) throw new ResolveError('The pull request text carries local data, so auto-check stopped before sending anything.', { problems });

  let issue = open.issue ?? null;
  let prUrl = null;
  let pushed = Boolean(open.pushed);
  if (wantPr && fork) {
    if (!pushed && push) {
      run(pushCommand);
      pushed = true;
    }
    if (!pushed) pushed = exec(git(repo, 'ls-remote', '--exit-code', '--heads', fork.remote, branch)).status === 0;
    if (!pushed) {
      report.notes.push(`The branch is not on your fork yet, so no pull request was opened. Push it with --push, or run: ${display(pushCommand)}`);
    } else if (!ghAvailable()) {
      report.notes.push('The GitHub CLI (gh) is not available, so no pull request was opened.');
    } else {
      if (wantIssue && !issue) {
        const issueTitle = readText(paths.issueTitle, '').split(/\r?\n/)[0].trim();
        if (issueTitle) {
          const created = run(issueCommand(issueTitle));
          issue = Number(/\/issues\/(\d+)/.exec(created.stdout)?.[1]) || null;
        }
      }
      if (issue && !new RegExp(`#${issue}\\b`).test(body)) body = `${body}\n\nResolves #${issue}`;
      writeFileSync(paths.body, `${body}\n`);
      const created = run(prCommand(title));
      prUrl = /https?:\/\/\S+\/pull\/\d+/.exec(created.stdout)?.[0] ?? firstLine(created.stdout);
    }
  }
  if (!prUrl) {
    if (issue && !new RegExp(`#${issue}\\b`).test(body)) body = `${body}\n\nResolves #${issue}`;
    writeFileSync(paths.body, `${body}\n`);
    const commands = [...(pushed || !pushCommand ? [] : [display(pushCommand)]), ...(fork ? [display(prCommand(title))] : [])];
    writeFileSync(paths.pullRequest, pullRequestDocument({ title, body, branch, base, fork, upstreamSlug, host: ctx.host, paths, commands, contributing }));
  }
  open = { ...open, pushed, issue, prUrl };
  return { ...report, dryRun: false, title, issue, prUrl, pullRequestFile: prUrl ? null : paths.pullRequest, patchFile: paths.patch, open };
}

/** Saves the open failure report's progress, such as its branch and pull request, to state.json. */
export function saveOpen(dir, open) {
  const { simulated, ...rest } = open;
  const state = readState(dir);
  writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(simulated ? { ...state, simulated: { ...state.simulated, openResolution: rest } } : { ...state, openResolution: rest }, null, 2)}\n`);
}
