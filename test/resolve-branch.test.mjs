import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { outboundProblems } from '../lib/outbound.mjs';
import { RESOLVE_WORKTREE, ResolveError, prPaths, repoSlugOf, resolveIssue, resolvePr } from '../lib/resolve.mjs';
import { execCommand } from '../lib/util/command.mjs';
import { makeTestFolder } from './helpers/run-check.mjs';

const BRANCH = 'resolve-issue-demo-app';
const DAY = '01-02-2026';
let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-resolve-branch-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=Jane Doe', '-c', 'user.email=jane.doe@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(repo, file, content, message) {
  const full = path.join(repo, ...file.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

const GUIDE = '# Contributing\n\n## Submitting Your Contribution\n\n1. Create a branch from `main`.\n2. Run `npm test` before you push.\n3. Sign off every commit (DCO).\n';
const MESSAGE = 'Fit the canvas to its view\n\nSize the drawing buffer only, so a view that loads hidden still fills its panel once shown.\n';
const TITLE = 'Fit the sample canvas to its view';
const BODY = '## What changed\n\nThe canvas sized its drawing buffer while the view was hidden, so it stayed one pixel square.\n\n## Testing\n\nRan `npm test`.\n';

/**
 * An upstream repository and a fork as local bare repositories, a clone of the
 * fork with both remotes, and a test folder whose check has an open failure
 * with a proposed solution. Upstream gains a commit after the fork.
 */
async function setup(name, { originIsUpstream = false } = {}) {
  const dir = path.join(base, name);
  const work = path.join(dir, 'upstream-work');
  mkdirSync(work, { recursive: true });
  git(work, 'init', '-q');
  commit(work, 'CONTRIBUTING.md', GUIDE, 'Add the contributing guide');
  commit(work, 'src/app.js', 'resize(width, height);\n', 'Add the app');
  const upstream = path.join(dir, 'remotes', 'acme', 'demo-app.git');
  const fork = path.join(dir, 'remotes', 'jane-doe', 'demo-app.git');
  git(dir, 'clone', '-q', '--bare', work, upstream);
  git(dir, 'clone', '-q', '--bare', upstream, fork);
  const clone = path.join(dir, 'clone');
  git(dir, 'clone', '-q', originIsUpstream ? upstream : fork, clone);
  if (!originIsUpstream) git(clone, 'remote', 'add', 'upstream', upstream);
  git(clone, 'config', 'user.name', 'Jane Doe');
  git(clone, 'config', 'user.email', 'jane.doe@example.com');
  commit(work, 'docs/guide.md', 'Guide\n', 'Document the app');
  git(work, 'push', '-q', upstream, 'main');

  const { root } = await makeTestFolder(dir, 'automate-pr-sample-canvas');
  const config = defaults();
  config.repos.localRepo = clone;
  const foundIssueDir = path.join(root, 'found-issue', DAY);
  const proposedDir = path.join(root, 'proposed-solution', DAY);
  mkdirSync(foundIssueDir, { recursive: true });
  mkdirSync(proposedDir, { recursive: true });
  writeFileSync(path.join(foundIssueDir, 'found-issue.md'), '# sample-canvas: the drawing surface fills its view\n');
  writeFileSync(path.join(proposedDir, 'proposed-solution.prompt.md'), '# demo-app: fit the canvas (resolve plan)\n');
  const open = {
    day: DAY,
    foundIssue: `found-issue/${DAY}/found-issue.md`,
    proposedSolution: `proposed-solution/${DAY}/proposed-solution.prompt.md`,
    resultDir: 'results/2026-01-02T03-15-00',
    signature: '0123456789abcdef',
    simulated: false,
  };
  const { simulated, ...saved } = open;
  writeFileSync(path.join(root, 'state.json'), JSON.stringify({ openResolution: saved }));
  return {
    root,
    config,
    clone,
    upstream,
    fork,
    open,
    paths: prPaths(root, open),
    worktree: path.join(root, RESOLVE_WORKTREE),
    upstreamTip: git(upstream, 'rev-parse', 'main'),
  };
}

/** An assistant stand-in that runs one step per call. */
function assistant(steps) {
  const calls = [];
  return {
    calls,
    factory: () => ({
      label: 'Fake Assistant',
      available: () => true,
      async run(request) {
        calls.push(request);
        await steps[calls.length - 1]?.(request);
        return { exitCode: 0, stdout: 'done', stderr: '', timedOut: false };
      },
    }),
  };
}

/** The change an assistant would make, in the worktree auto-check gave it. */
const applyFix = (env, message = MESSAGE) => (request) => {
  writeFileSync(path.join(request.cwd, 'src', 'app.js'), 'resize(width, height, false);\n');
  writeFileSync(env.paths.commitMessage, message);
  writeFileSync(env.paths.summary, 'Changed src/app.js. Ran npm test: passed.\n');
};

const writePr = (env, { body = BODY, issue = false } = {}) => () => {
  writeFileSync(env.paths.title, `${TITLE}\n`);
  writeFileSync(env.paths.body, body);
  if (issue) {
    writeFileSync(env.paths.issueTitle, 'The sample canvas draws a black view when it loads hidden\n');
    writeFileSync(env.paths.issueBody, 'Open the canvas in a hidden panel, then show it: the view stays black.\n');
  }
};

function fakeGh() {
  const calls = [];
  const exec = (command) => {
    if (command.file !== 'gh') return execCommand(command);
    calls.push(command.args);
    if (command.args[0] === 'issue') return { status: 0, stdout: 'https://github.com/acme/demo-app/issues/42\n', stderr: '' };
    return { status: 0, stdout: 'https://github.com/acme/demo-app/pull/7\n', stderr: '' };
  };
  return { calls, exec };
}

/** What the user would see in their own checkout: its branch, its files, and its refs. */
const snapshot = (repo) => ({
  branch: git(repo, 'branch', '--show-current'),
  status: git(repo, 'status', '--short'),
  refs: git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
});

test('remote URLs and paths name their owner and repository', () => {
  assert.equal(repoSlugOf('https://github.com/Acme/Demo-App.git'), 'acme/demo-app');
  assert.equal(repoSlugOf('git@github.com:acme/demo-app.git'), 'acme/demo-app');
  assert.equal(repoSlugOf('https://github.com/acme/demo-app'), 'acme/demo-app');
  assert.equal(repoSlugOf('C:\\Users\\<user>\\remotes\\acme\\demo-app.git'), 'acme/demo-app');
  assert.equal(repoSlugOf(''), null);
});

test('a dry run reads the clone and its guide, plans the worktree and the branch, and changes nothing', async () => {
  const env = await setup('dry-run');
  const before = snapshot(env.clone);
  const helper = assistant([]);
  const report = await resolveIssue({ testFolder: env.root, config: env.config, dryRun: true, deps: { assistant: helper.factory } });
  assert.deepEqual(snapshot(env.clone), before);
  assert.equal(helper.calls.length, 0);
  assert.equal(report.branch, BRANCH);
  assert.equal(report.upstreamRef, 'upstream/main');
  assert.equal(report.worktree, env.worktree);
  assert.deepEqual(report.contributing.items, [
    'Submitting Your Contribution: Create a branch from `main`.',
    'Submitting Your Contribution: Run `npm test` before you push.',
    'Submitting Your Contribution: Sign off every commit (DCO).',
  ]);
  assert.deepEqual(report.commands, [
    `git -C ${env.clone} fetch upstream +refs/heads/main:refs/remotes/upstream/main`,
    `git -C ${env.clone} worktree add -b ${BRANCH} ${env.worktree} upstream/main`,
    `Fake Assistant applies proposed-solution/${DAY}/proposed-solution.prompt.md in ${env.worktree} (prompt: ${path.relative(env.root, env.paths.resolvePrompt).split(path.sep).join('/')})`,
    `git -C ${env.worktree} add -A`,
    `git -C ${env.worktree} commit -F ${env.paths.commitMessage} -s`,
    `git -C ${env.clone} worktree remove --force ${env.worktree}`,
  ]);
  assert.match(report.notes[0], /^Nothing is pushed without --push\. To push the branch later: git -C .+ push origin refs\/heads\/resolve-issue-demo-app:refs\/heads\/resolve-issue-demo-app$/);
  assert.match(report.notes[1], /^The worktree in .+ is removed afterwards/);
  assert.ok(existsSync(env.paths.resolvePrompt));
  assert.equal(existsSync(env.worktree), false);
});

test('a dry run of a simulated failure lists the same commands, names what would stop a real run, and writes nothing', async () => {
  const env = await setup('dry-run-simulated');
  const before = snapshot(env.clone);
  rmSync(path.join(env.root, 'proposed-solution'), { recursive: true, force: true });
  writeFileSync(path.join(env.root, 'state.json'), JSON.stringify({ simulated: { openResolution: { ...env.open, simulated: undefined } } }));
  const helper = assistant([]);
  const report = await resolveIssue({ testFolder: env.root, config: env.config, dryRun: true, deps: { assistant: helper.factory } });

  assert.deepEqual(snapshot(env.clone), before);
  assert.equal(helper.calls.length, 0);
  assert.equal(report.commands.length, 6);
  assert.match(report.commands[1], new RegExp(`worktree add -b ${BRANCH} `));
  assert.match(report.commands[4], /commit -F .+ -s$/);
  assert.deepEqual(report.blockers, [
    'The open failure report comes from a simulated run, so there is nothing to fix. A real failure is needed.',
    'There is no proposed solution for the open failure yet. Run auto-check resolve automate-pr-sample-canvas --propose first.',
  ]);
  assert.equal(existsSync(path.join(env.root, 'proposed-solution')), false);
});

test('a real run refuses a simulated failure, and refuses one with no proposed solution', async () => {
  const env = await setup('simulated-refused');
  writeFileSync(path.join(env.root, 'state.json'), JSON.stringify({ simulated: { openResolution: { ...env.open, simulated: undefined } } }));
  await assert.rejects(resolveIssue({ testFolder: env.root, config: env.config, deps: { assistant: assistant([]).factory } }), (error) => {
    assert.ok(error instanceof ResolveError);
    assert.match(error.message, /comes from a simulated run/);
    return true;
  });
  writeFileSync(path.join(env.root, 'state.json'), JSON.stringify({ openResolution: { ...env.open, simulated: undefined } }));
  rmSync(path.join(env.root, 'proposed-solution'), { recursive: true, force: true });
  await assert.rejects(resolveIssue({ testFolder: env.root, config: env.config, deps: { assistant: assistant([]).factory } }), /--propose first/);
});

test('the fix goes on a new branch from the newest upstream base, committed with a sign-off, and the checkout is untouched', async () => {
  const env = await setup('apply');
  const before = snapshot(env.clone);
  const helper = assistant([applyFix(env)]);
  const report = await resolveIssue({ testFolder: env.root, config: env.config, deps: { assistant: helper.factory } });

  assert.equal(git(env.clone, 'branch', '--show-current'), before.branch);
  assert.equal(git(env.clone, 'status', '--short'), before.status);
  assert.equal(existsSync(env.worktree), false);
  assert.deepEqual(git(env.clone, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);

  assert.equal(git(env.clone, 'rev-parse', BRANCH), report.commit);
  assert.equal(git(env.clone, 'rev-parse', `${BRANCH}~1`), env.upstreamTip);
  assert.equal(report.pushed, false);
  assert.deepEqual(report.open, { ...env.open, repo: env.clone, branch: BRANCH, commit: report.commit, pushed: false });
  const message = git(env.clone, 'log', '-1', '--format=%B', BRANCH);
  assert.match(message, /^Fit the canvas to its view\n\nSize the drawing buffer only/);
  assert.match(message, /\nSigned-off-by: Jane Doe <jane\.doe@example\.com>$/);
  assert.equal(git(env.clone, 'ls-remote', '--heads', 'origin', BRANCH), '');
  assert.equal(git(env.clone, 'ls-remote', '--heads', 'upstream', BRANCH), '');
  const prompt = readFileSync(env.paths.resolvePrompt, 'utf8');
  assert.match(prompt, /auto-check has created the branch `resolve-issue-demo-app` there from the newest `upstream\/main`/);
  assert.match(prompt, /Leave out the sign-off line: auto-check adds it with `git commit -s`/);
  assert.match(prompt, /### Text that leaves this machine/);
  assert.equal(helper.calls[0].cwd, env.worktree);
  assert.deepEqual(outboundProblems(readFileSync(env.paths.commitMessage, 'utf8')), []);
});

test('a branch name that is taken gets a number, and the clone keeps its own branches', async () => {
  const env = await setup('taken');
  git(env.clone, 'branch', BRANCH);
  const report = await resolveIssue({ testFolder: env.root, config: env.config, deps: { assistant: assistant([applyFix(env)]).factory } });
  assert.equal(report.branch, `${BRANCH}-2`);
  assert.equal(git(env.clone, 'rev-parse', `${BRANCH}-2`), report.commit);
  assert.notEqual(git(env.clone, 'rev-parse', BRANCH), report.commit);
  assert.equal(existsSync(env.worktree), false);
});

test('a commit that would carry local data is refused, and the worktree stays for review', async () => {
  const leaky = await setup('leaky');
  const message = `Fit the canvas\n\nTested in ${path.join(os.homedir(), 'demo')} by jane.doe@corp.test.\n`;
  await assert.rejects(
    resolveIssue({ testFolder: leaky.root, config: leaky.config, deps: { assistant: assistant([applyFix(leaky, message)]).factory } }),
    (error) => {
      assert.ok(error instanceof ResolveError);
      assert.match(error.message, /stopped before committing/);
      assert.ok(error.problems.some((problem) => /email address "jane\.doe@corp\.test"/.test(problem)));
      return true;
    },
  );
  assert.equal(git(leaky.clone, 'branch', '--show-current'), 'main');
  assert.equal(git(leaky.clone, 'status', '--short'), '');
  assert.match(git(leaky.worktree, 'status', '--short'), /^M {2}src\/app\.js$/);
});

test('an assistant that changes nothing, or commits itself, is refused', async () => {
  const quiet = await setup('quiet');
  await assert.rejects(
    resolveIssue({ testFolder: quiet.root, config: quiet.config, deps: { assistant: assistant([]).factory } }),
    /changed no file in the worktree/,
  );

  const eager = await setup('eager');
  const commits = (request) => {
    applyFix(eager)(request);
    git(request.cwd, 'add', '-A');
    git(request.cwd, 'commit', '-q', '-m', 'Fit the canvas');
  };
  await assert.rejects(
    resolveIssue({ testFolder: eager.root, config: eager.config, deps: { assistant: assistant([commits]).factory } }),
    /committed on resolve-issue-demo-app itself/,
  );
});

test('pushing goes only to the fork, without force, and only when asked', async () => {
  const env = await setup('push');
  const report = await resolveIssue({ testFolder: env.root, config: env.config, push: true, deps: { assistant: assistant([applyFix(env)]).factory } });
  assert.equal(report.pushed, true);
  assert.equal(git(env.fork, 'rev-parse', `refs/heads/${BRANCH}`), report.commit);
  assert.equal(spawnSync('git', ['-C', env.upstream, 'rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`]).status, 1);
  assert.ok(report.commands.some((command) => command.includes(`push origin refs/heads/${BRANCH}:refs/heads/${BRANCH}`)));
  const pushes = report.commands.filter((command) => command.includes(' push '));
  assert.doesNotMatch(pushes.join('\n'), /--force|\+refs\/heads\/resolve/);

  const noFork = await setup('no-fork', { originIsUpstream: true });
  await assert.rejects(
    resolveIssue({ testFolder: noFork.root, config: noFork.config, push: true, deps: { assistant: assistant([]).factory } }),
    /is not a fork of acme\/demo-app\. auto-check pushes only to your fork/,
  );
});

test('without Make PR, the pull request is written to pull-request.md and patch.diff, naming an issue only when one is known', async () => {
  const env = await setup('pr-off');
  const applied = await resolveIssue({ testFolder: env.root, config: env.config, deps: { assistant: assistant([applyFix(env)]).factory } });
  const report = await resolvePr({ testFolder: env.root, config: env.config, open: applied.open, deps: { assistant: assistant([writePr(env)]).factory } });
  assert.equal(report.prUrl, null);
  assert.equal(report.pullRequestFile, env.paths.pullRequest);
  const document = readFileSync(env.paths.pullRequest, 'utf8');
  assert.match(document, /^# Pull request: Fit the sample canvas to its view\n/);
  assert.match(document, /- Branch: `jane-doe:resolve-issue-demo-app`\n- Base: `acme\/demo-app` `main`\n- Compare: https:\/\/github\.com\/acme\/demo-app\/compare\/main\.\.\.jane-doe:demo-app:resolve-issue-demo-app\n/);
  assert.match(document, /gh pr create --repo acme\/demo-app --base main --head jane-doe:resolve-issue-demo-app --title "Fit the sample canvas to its view" --body-file /);
  assert.match(document, /## Checklist from the contributing guide\n\n- \[ \] Submitting Your Contribution: Create a branch from `main`\./);
  assert.doesNotMatch(readFileSync(env.paths.body, 'utf8'), /Resolves #/);
  assert.match(readFileSync(env.paths.patch, 'utf8'), /^\+resize\(width, height, false\);$/m);

  const known = await resolvePr({ testFolder: env.root, config: env.config, open: { ...applied.open, issue: 42 }, deps: { assistant: assistant([writePr(env)]).factory } });
  assert.equal(known.issue, 42);
  assert.match(readFileSync(env.paths.body, 'utf8'), /\n\nResolves #42\n$/);
  for (const text of [readFileSync(env.paths.body, 'utf8'), readFileSync(env.paths.title, 'utf8'), git(env.clone, 'log', '-1', '--format=%B', BRANCH).replace(/\nSigned-off-by: .*$/, '')]) {
    assert.deepEqual(outboundProblems(text), []);
    assert.doesNotMatch(text, /[A-Z]:\\Users\\[a-z]|\/home\/|@(?!example\.com)/);
  }
});

test('with Make PR and a pushed branch, gh opens the issue and then the pull request against the upstream base', async () => {
  const env = await setup('pr-on');
  const gh = fakeGh();
  const applied = await resolveIssue({ testFolder: env.root, config: env.config, push: true, deps: { assistant: assistant([applyFix(env)]).factory, exec: gh.exec } });

  const dry = await resolvePr({ testFolder: env.root, config: env.config, open: applied.open, makePr: true, dryRun: true, deps: { exec: gh.exec } });
  assert.ok(dry.commands.some((command) => command.startsWith('gh pr create --repo acme/demo-app --base main --head jane-doe:resolve-issue-demo-app ')), JSON.stringify(dry.notes));
  assert.equal(gh.calls.length, 0);

  const report = await resolvePr({
    testFolder: env.root,
    config: env.config,
    open: applied.open,
    makePr: true,
    openIssue: true,
    deps: { assistant: assistant([writePr(env, { issue: true })]).factory, exec: gh.exec, ghAvailable: () => true },
  });
  assert.equal(report.prUrl, 'https://github.com/acme/demo-app/pull/7');
  assert.equal(report.issue, 42);
  assert.deepEqual(gh.calls[0].slice(0, 5), ['issue', 'create', '--repo', 'acme/demo-app', '--title']);
  assert.deepEqual(gh.calls[1], ['pr', 'create', '--repo', 'acme/demo-app', '--base', 'main', '--head', 'jane-doe:resolve-issue-demo-app', '--title', TITLE, '--body-file', env.paths.body]);
  assert.match(readFileSync(env.paths.body, 'utf8'), /\n\nResolves #42\n$/);
  assert.equal(existsSync(env.paths.pullRequest), false);
  assert.deepEqual(report.open, { ...applied.open, pushed: true, issue: 42, prUrl: 'https://github.com/acme/demo-app/pull/7' });
});

test('pull request text with local data is refused before anything is sent, and the pull request needs the branch', async () => {
  const env = await setup('pr-leaky');
  const gh = fakeGh();
  await assert.rejects(
    resolvePr({ testFolder: env.root, config: env.config, makePr: true, deps: { exec: gh.exec } }),
    /does not exist in .+ Run auto-check resolve automate-pr-sample-canvas --issue first/,
  );
  const applied = await resolveIssue({ testFolder: env.root, config: env.config, push: true, deps: { assistant: assistant([applyFix(env)]).factory, exec: gh.exec } });
  const body = `${BODY}\nLogs: ${path.join(os.homedir(), 'run.log')}\n`;
  await assert.rejects(
    resolvePr({
      testFolder: env.root,
      config: env.config,
      open: applied.open,
      makePr: true,
      deps: { assistant: assistant([writePr(env, { body })]).factory, exec: gh.exec, ghAvailable: () => true },
    }),
    (error) => error instanceof ResolveError && /stopped before sending anything/.test(error.message) && error.problems.some((problem) => problem.startsWith('pr-body.md:')),
  );
  assert.equal(gh.calls.length, 0);
});

test('a dry run reports what would stop a real run instead of stopping', async () => {
  const env = await setup('dry-blocked', { originIsUpstream: true });
  const before = snapshot(env.clone);
  const report = await resolveIssue({ testFolder: env.root, config: env.config, push: true, dryRun: true, deps: { assistant: assistant([]).factory } });
  assert.deepEqual(snapshot(env.clone), before);
  assert.equal(report.blockers.length, 1);
  assert.match(report.blockers[0], /is not a fork of acme\/demo-app/);
  assert.equal(report.commands.length, 6);
});
