import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { ResolveError, openResolution, proposalProblems, proposeSolution, resolveIssue } from '../lib/resolve.mjs';
import { SLUG, makeTestFolder } from './helpers/run-check.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-resolve-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const GOOD_PROPOSAL = `---
description: 'Resolve sample-canvas: the canvas collapses to one pixel when the host loads the page hidden'
---

# sample-canvas: the canvas collapses to one pixel (resolve plan)

Carry out this plan one phase per response. End each response with \`CONTINUE? Y or N\` while phases remain, and \`TASK COMPLETE!\` after the last phase. Never use em dashes or en dashes in a changed file. Do not stage, commit, or push.

Branch: \`resolve-issue-sample-canvas\`, made from the newest \`main\`.

## Evaluation (done 2026-01-02)

### Report

The check reports "the drawing surface fills its view" failed.

### What the artifacts show

The capture is uniform and near-black.

### Root cause

\`game/app.js\` line 12 sizes the canvas while the view is hidden.

### Reproduction

Run the check with the host app loading the page hidden.

### Ruled out

A host app update: its version did not change.

## Decisions

The recommended option is already ticked for each decision. Change a tick before running if you disagree.

### D1: Where the fix lands (phase 1 waits on it)

- [x] In the repository (Recommended): the next install picks it up.
- [ ] In the installed copy only: quicker, but the repository stays broken.
- [ ] Other:

## Phases

### Phase 1: Fix the canvas sizing

Size the drawing buffer only.

Checks:

1. \`node bin/auto-check.mjs run ${SLUG}\` exits 0.
`;

test('a proposed solution must have every part of the shape', () => {
  assert.deepEqual(proposalProblems(GOOD_PROPOSAL), []);
  const bare = proposalProblems('# Fix it\n\nJust fix it.\n');
  assert.ok(bare.includes('It must open with frontmatter that holds a single description line.'));
  assert.ok(bare.includes('The evaluation needs a "### Root cause" subsection.'));
  assert.ok(bare.includes('It needs a "## Phases" section.'));
  assert.ok(proposalProblems(GOOD_PROPOSAL.replace('- [x] In the repository', '- [ ] In the repository')).some((problem) => /recommended option ticked/.test(problem)));
  assert.ok(proposalProblems(GOOD_PROPOSAL.replace('Size the drawing buffer only.', 'Size the drawing buffer only \u2014 nothing else.')).some((problem) => /em dashes/.test(problem)));
  assert.deepEqual(proposalProblems(GOOD_PROPOSAL.replace(/### D1[\s\S]*?- \[ \] Other:\n/, 'There are no decisions to make.\n')), []);
});

/** A test folder whose check has an open failure report. */
async function withOpenFailure(name) {
  const { root, dir } = await makeTestFolder(base, name);
  const issueDay = path.join(root, 'found-issue', '01-02-2026');
  const day = path.join(root, 'proposed-solution', '01-02-2026');
  const resultDir = path.join(dir, 'results', '2026-01-02T03-15-00');
  mkdirSync(issueDay, { recursive: true });
  mkdirSync(day, { recursive: true });
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(path.join(issueDay, 'found-issue.md'), '# acme-demo-app-pr-123: the drawing surface fills its view\n');
  writeFileSync(path.join(resultDir, 'page-initial.png'), 'png');
  const open = {
    day: '01-02-2026',
    foundIssue: 'found-issue/01-02-2026/found-issue.md',
    proposedSolution: 'proposed-solution/01-02-2026/proposed-solution.prompt.md',
    resultDir: 'results/2026-01-02T03-15-00',
    signature: '0123456789abcdef',
  };
  const stateFile = path.join(dir, 'state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...state, openResolution: open }));
  return { root, dir, day, issueDay, resultDir, proposal: path.join(day, 'proposed-solution.prompt.md') };
}

function fakeAssistant(steps) {
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

test('the assistant writes the proposed solution beside the report, from the report, the captures, and the code', async () => {
  const { root, dir, day, issueDay, resultDir, proposal } = await withOpenFailure('propose');
  const assistant = fakeAssistant([() => writeFileSync(proposal, GOOD_PROPOSAL)]);
  const result = await proposeSolution({ testFolder: root, config: defaults(), deps: { assistant: assistant.factory } });
  assert.equal(result.proposedSolutionFile, proposal);
  assert.equal(result.repaired, false);
  assert.equal(result.headline, "'Resolve sample-canvas: the canvas collapses to one pixel when the host loads the page hidden'");
  const [request] = assistant.calls;
  assert.equal(request.role, 'analyze');
  assert.equal(request.cwd, root);
  assert.deepEqual(request.addDirs, [day, dir]);
  assert.deepEqual(request.attachments, [path.join(resultDir, 'page-initial.png')]);
  const prompt = readFileSync(request.promptFile, 'utf8');
  assert.equal(request.promptFile, path.join(resultDir, 'propose-solution.prompt.md'));
  assert.ok(prompt.includes(path.join(issueDay, 'found-issue.md')));
  assert.ok(prompt.includes(path.join(resultDir, 'page-initial.png')));
  assert.ok(prompt.includes(path.join(dir, 'repo')));
  assert.match(prompt, /Never push, and never open an issue or a pull request\./);
  assert.match(prompt, /`auto-check run` in the test folder must exit 0/);
  assert.doesNotMatch(prompt, /\{\{/);
});

test('a proposal missing parts gets one repair round, and one still missing them is rejected', async () => {
  const repaired = await withOpenFailure('propose-repair');
  const fixer = fakeAssistant([() => writeFileSync(repaired.proposal, '# Fix it\n'), () => writeFileSync(repaired.proposal, GOOD_PROPOSAL)]);
  const result = await proposeSolution({ testFolder: repaired.root, config: defaults(), deps: { assistant: fixer.factory } });
  assert.equal(result.repaired, true);
  assert.equal(fixer.calls.length, 2);
  assert.match(readFileSync(fixer.calls[1].promptFile, 'utf8'), /^- It needs a "## Evaluation" section\.$/m);

  const stuck = await withOpenFailure('propose-stuck');
  const lazy = fakeAssistant([() => writeFileSync(stuck.proposal, '# Fix it\n'), () => {}]);
  await assert.rejects(
    proposeSolution({ testFolder: stuck.root, config: defaults(), deps: { assistant: lazy.factory } }),
    (error) => error instanceof ResolveError && error.problems.length > 3,
  );
});

test('a dry run writes the prompt only, and a check with no open failure is refused', async () => {
  const { root, proposal } = await withOpenFailure('propose-dry');
  const assistant = fakeAssistant([]);
  const result = await proposeSolution({ testFolder: root, config: defaults(), dryRun: true, deps: { assistant: assistant.factory } });
  assert.equal(result.dryRun, true);
  assert.ok(existsSync(result.promptFile));
  assert.equal(assistant.calls.length, 0);
  assert.equal(existsSync(proposal), false);

  const clean = await makeTestFolder(base, 'propose-none');
  await assert.rejects(proposeSolution({ testFolder: clean.root, config: defaults() }), /has no open failure/);
  assert.equal(openResolution({ simulated: { openResolution: { foundIssue: 'x' } } }).simulated, true);
  assert.equal(openResolution({}), null);
});

test('the propose prompt carries the PR Context of the test', async () => {
  const { root, proposal } = await withOpenFailure('propose-context');
  writeFileSync(path.join(root, 'context.md'), [
    '# `automate-merged-pr-check`',
    '',
    '## Test Context',
    '',
    '- **PR Context**: The drawing surface fills its view and keeps moving.',
    '',
  ].join('\n'));
  const assistant = fakeAssistant([() => writeFileSync(proposal, GOOD_PROPOSAL)]);
  const result = await proposeSolution({ testFolder: root, config: defaults(), dryRun: true, deps: { assistant: assistant.factory } });
  const prompt = readFileSync(result.promptFile, 'utf8');
  assert.match(prompt, /^## Context from context\.md$/m);
  assert.match(prompt, /The drawing surface fills its view and keeps moving\./);
});

test('a simulated failure can be proposed for by hand, but never applied to the clone', async () => {
  const { root } = await withOpenFailure('simulated');
  const state = JSON.parse(readFileSync(path.join(root, 'state.json'), 'utf8'));
  writeFileSync(path.join(root, 'state.json'), JSON.stringify({ simulated: { openResolution: { ...state.openResolution } } }));
  await assert.rejects(
    resolveIssue({ testFolder: root, config: defaults(), deps: { assistant: fakeAssistant([]).factory } }),
    /comes from a simulated run, so there is nothing to fix/,
  );
});
