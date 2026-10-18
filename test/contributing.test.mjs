import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { readContributing } from '../lib/contributing.mjs';
import { describeProblems, localNames, outboundProblems } from '../lib/outbound.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-contributing-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const GUIDE = [
  '# Contributing to Demo App',
  '',
  '## What We Accept',
  '',
  '- Fixes with tests',
  '- Clear documentation',
  '',
  '## Adding Extensions',
  '',
  '1. Put the extension under `extensions/<name>/`.',
  '2. **Bump the version** in `copilot-extension.json` for every change.',
  '',
  '## Adding Themes',
  '',
  '- Themes go under `themes/`.',
  '',
  '## Submitting Your Contribution',
  '',
  '1. Create a branch from `main`.',
  '2. Run `npm run build` and `npm test` before you push.',
  '3. Sign off every commit (DCO): `git commit -s`.',
  '',
  '```sh',
  '- not an item, inside a fence',
  'npm run not-a-command-either',
  '```',
  '',
].join('\n');

test('the contributing guide yields its submit and subject items, the commands it names, and the sign-off rule', () => {
  const repo = path.join(base, 'demo-app');
  mkdirSync(path.join(repo, '.github'), { recursive: true });
  writeFileSync(path.join(repo, 'CONTRIBUTING.md'), GUIDE);
  writeFileSync(path.join(repo, '.github', 'pull_request_template.md'), '## What changed\n');
  const guide = readContributing(repo, { subjectPath: 'extensions/sample-canvas' });
  assert.equal(guide.file, path.join(repo, 'CONTRIBUTING.md'));
  assert.equal(guide.template, path.join(repo, '.github', 'pull_request_template.md'));
  assert.deepEqual(guide.items, [
    'Submitting Your Contribution: Create a branch from `main`.',
    'Submitting Your Contribution: Run `npm run build` and `npm test` before you push.',
    'Submitting Your Contribution: Sign off every commit (DCO): `git commit -s`.',
    'Adding Extensions: Put the extension under `extensions/<name>/`.',
    'Adding Extensions: Bump the version in `copilot-extension.json` for every change.',
  ]);
  assert.deepEqual(guide.commands, ['npm run build', 'npm test']);
  assert.equal(guide.signOff, true);

  const bare = path.join(base, 'no-guide');
  mkdirSync(bare);
  assert.deepEqual(readContributing(bare), { file: null, template: null, items: [], commands: [], signOff: false });
});

test('outbound text may hold placeholders, never local paths, local names, or real email addresses', () => {
  const names = localNames({ home: 'C:\\Users\\demo-user', username: 'demo-user', hostname: 'DEMO-PC', extra: ['Jane Doe', 'jane.doe@corp.test', ''] });
  assert.deepEqual(names, ['C:\\Users\\demo-user', 'demo-user', 'DEMO-PC', 'Jane Doe', 'jane.doe@corp.test']);
  const clean = [
    'Fix the canvas sizing when the view loads hidden',
    '',
    'Paths such as C:\\Users\\<user>\\AppData and ~/.config stay generic.',
    'Contact jane.doe@example.com or 12345+bot@users.noreply.github.com.',
  ].join('\n');
  assert.deepEqual(outboundProblems(clean, { names }), []);

  const leaky = [
    'Tested on DEMO-PC by demo-user.',
    'Logs are in C:\\Users\\demo-user\\AppData\\Local\\Temp\\run.log and /home/someone/run.log.',
    'Questions to jane.doe@corp.test.',
  ].join('\n');
  const problems = outboundProblems(leaky, { names });
  assert.deepEqual(problems.map((problem) => `${problem.line} ${problem.kind}`).sort(), [
    '1 local name',
    '1 local name',
    '2 local name',
    '2 local name',
    '2 local path',
    '2 local path',
    '3 email address',
    '3 local name',
  ]);
  assert.match(describeProblems('pr-body.md', problems)[0], /^pr-body\.md:\d: /);
});
