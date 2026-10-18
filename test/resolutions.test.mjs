import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { headlineOf, reserve, writeFoundIssue } from '../lib/resolutions.mjs';

const DATE = new Date(2026, 0, 2, 3, 15, 0);
let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-resolutions-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test('the first failure of a day gets plain names, a later one a number, and a repeat the same ones', () => {
  const testFolder = path.join(base, 'naming');
  const first = reserve({ testFolder, signature: 's1', date: DATE });
  assert.equal(first.foundIssueDir, path.join(testFolder, 'found-issue', '01-02-2026'));
  assert.equal(first.proposedDir, path.join(testFolder, 'proposed-solution', '01-02-2026'));
  assert.deepEqual(
    [first.foundIssue, first.proposedSolution, first.resolveFolder, first.existing],
    ['found-issue.md', 'proposed-solution.prompt.md', 'resolve', false],
  );
  writeFileSync(path.join(first.foundIssueDir, first.foundIssue), '# the first failure of the day\n');

  const open = { day: '01-02-2026', signature: 's1', foundIssue: 'found-issue/01-02-2026/found-issue.md' };
  const again = reserve({ testFolder, signature: 's1', date: DATE, open });
  assert.equal(again.existing, true);
  assert.equal(again.suffix, '');

  const second = reserve({ testFolder, signature: 's2', date: DATE, open });
  assert.equal(second.foundIssue, 'found-issue-2.md');
  assert.equal(second.proposedSolution, 'proposed-solution-2.prompt.md');
  assert.equal(second.resolveFolder, 'resolve-2');
  writeFileSync(path.join(second.foundIssueDir, second.foundIssue), '# a second failure\n');
  assert.equal(reserve({ testFolder, signature: 's3', date: DATE }).foundIssue, 'found-issue-3.md');

  const nextDay = reserve({ testFolder, signature: 's1', date: new Date(2026, 0, 3, 3), open });
  assert.equal(nextDay.foundIssueDir, path.join(testFolder, 'found-issue', '01-03-2026'));
  assert.equal(nextDay.foundIssue, 'found-issue.md');
});

test('the failure report has every section, with paths from the test folder', () => {
  const root = path.join(base, 'automate-pr-sample-canvas');
  const dir = root;
  const resultFile = path.join(dir, 'results', '2026-01-02T03-15-00', 'result.json');
  mkdirSync(path.join(dir, 'baseline'), { recursive: true });
  writeFileSync(path.join(dir, 'baseline', 'page-initial.png'), 'png');
  const check = {
    alias: 'sample-canvas',
    pr: { url: 'https://github.com/acme/demo-app/pull/123' },
    classification: { kind: 'source', subtype: 'gui-canvas-extension', watchPaths: ['extensions/sample-canvas/**'] },
    source: { mode: 'upstream', baseRef: 'main', clonePath: 'repo' },
  };
  const record = {
    outcome: 'fail',
    simulated: false,
    upstreamSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    sourceMode: 'upstream',
    signature: '0123456789abcdef',
    runner: { finishedAt: '2026-01-02T08:15:00.000Z', exitCode: 1 },
    assertions: [
      { name: 'the drawing surface fills its view', ok: false, detail: 'canvas 1x1 in a 1280x800 view', layer: 'page' },
      { name: 'the page raised no uncaught error', ok: true, layer: 'page' },
    ],
    compare: { strategy: 'composite', failures: [{ artifact: 'page-initial', method: 'color-sample', detail: 'the capture is uniform: 100% of it is near-black', layer: 'page' }] },
    artifacts: [
      { name: 'page-initial', file: 'page-initial.png', kind: 'image', layer: 'page' },
      { name: 'page-facts', file: 'page-facts.json', kind: 'json', layer: 'page' },
      { name: 'host-app-view', file: 'host-app-view.png', kind: 'image', layer: 'hostApp' },
    ],
  };
  assert.equal(headlineOf(record), 'the drawing surface fills its view');
  const attribution = { lastPass: null, upstreamSha: record.upstreamSha, commits: null, commitsNote: 'The check has not passed since it was written, so there is no earlier run to compare with.', machine: null, installed: null };
  const reservation = reserve({ testFolder: root, signature: record.signature, date: DATE });
  const file = writeFoundIssue({ reservation, workRoot: root, slug: 'acme-demo-app-pr-123', dir, check, config: defaults(), record, resultFile, attribution, context: null, date: DATE });
  const text = readFileSync(file, 'utf8');

  assert.match(text, /^---\ndescription: 'auto-check found a failure in acme-demo-app-pr-123: the drawing surface fills its view'\n---\n\n# acme-demo-app-pr-123: the drawing surface fills its view\n/);
  for (const heading of ['## Check', '## Run', '## Observed and expected', '## What changed since the last pass', '## Context', '## Your task', '### The shape of a proposed solution']) {
    assert.match(text, new RegExp(`^${heading}$`, 'm'), heading);
  }
  assert.match(text, /^- Code under test: `main` at `a1b2c3d`$/m);
  assert.match(text, /^- Result: `results\/2026-01-02T03-15-00\/result\.json`$/m);
  assert.match(text, /^- page: the drawing surface fills its view\. Detail: canvas 1x1 in a 1280x800 view$/m);
  assert.match(text, /^- `page-initial`, color-sample: the capture is uniform: 100% of it is near-black\.$/m);
  assert.match(text, /^\| page-initial \| `results\/2026-01-02T03-15-00\/page-initial\.png` \| `baseline\/page-initial\.png` \|$/m);
  assert.match(text, /^\| page-facts \| `[^`]+page-facts\.json` \| none yet \|$/m);
  assert.doesNotMatch(text, /host-app-view/);
  assert.match(text, /context\.md gives no PR Context/);
  assert.match(text, /Find the cause of this failure, then write `proposed-solution\/01-02-2026\/proposed-solution\.prompt\.md`/);
  assert.match(text, /The branch, `resolve-issue-sample-canvas`, made from the newest base branch/);
  assert.match(text, /`auto-check run` in the test folder must exit 0/);
  assert.doesNotMatch(text, /simulated/);
  assert.doesNotMatch(text, /\{\{/);
});
