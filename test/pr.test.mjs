import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrError, formatIntake, intake, parsePrUrl, resolveLanding, slugFor } from '../lib/pr.mjs';
import { FIXTURES, fakeGitHub } from './helpers/fake-github.mjs';

const URL_FOR = (number) => `https://github.com/acme/demo-app/pull/${number}`;

const inspect = (number, options = {}) => {
  const github = fakeGitHub();
  return { info: intake(URL_FOR(number), { github, ...options }), github };
};

test('pull request URLs parse with /pull/, /pulls/, trailing paths, and .git', () => {
  const expected = { host: 'github.com', owner: 'acme', repo: 'demo-app', number: 123, url: 'https://github.com/acme/demo-app/pull/123' };
  assert.deepEqual(parsePrUrl('https://github.com/acme/demo-app/pull/123'), expected);
  assert.deepEqual(parsePrUrl('https://github.com/acme/demo-app/pulls/123'), expected);
  assert.deepEqual(parsePrUrl('https://GitHub.com/acme/demo-app.git/pull/123/files?w=1#diff'), expected);
  for (const bad of ['acme/demo-app#123', 'https://github.com/acme/demo-app/issues/123', 'ftp://github.com/acme/demo-app/pull/1', 'not a url']) {
    assert.throws(() => parsePrUrl(bad), PrError, bad);
  }
});

test('slugs are lowercase owner, repo, and number', () => {
  assert.equal(slugFor({ owner: 'Acme', repo: 'Demo.App', number: 7 }), 'acme-demo.app-pr-7');
});

test('a merged pull request landed by its merge commit', () => {
  const { info, github } = inspect(101);
  assert.equal(info.state, 'MERGED');
  assert.equal(info.merged, true);
  assert.equal(info.status, 'merged');
  assert.equal(info.landedBy, 'merge');
  assert.equal(info.landedSha, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
  assert.equal(info.base, 'main');
  assert.deepEqual(info.head, { owner: 'jane-doe', repo: 'demo-app', ref: 'sample-canvas', sha: 'b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1' });
  assert.deepEqual(info.closingIssues, [12]);
  assert.equal(info.slug, 'acme-demo-app-pr-101');
  assert.equal(info.classification.kind, 'source');
  assert.equal(info.classification.subtype, 'gui-canvas-extension');
  assert.equal(info.classification.alias, 'sample-canvas');
  assert.deepEqual(info.classification.watchPaths, ['extensions/sample-canvas/**']);
  assert.ok(!github.calls.includes('landingCandidates'));
  assert.ok(!github.calls.includes('prDiff'));
});

test('a closed pull request landed by the commit GitHub recorded as closing it', () => {
  const { info, github } = inspect(102);
  assert.equal(info.state, 'CLOSED');
  assert.equal(info.merged, true);
  assert.equal(info.status, 'landed');
  assert.equal(info.landedBy, 'commit');
  assert.equal(info.landedSha, 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1');
  assert.equal(info.landedMessage, 'INSTALL.md: add build steps');
  assert.equal(info.classification.kind, 'documentation');
  assert.equal(info.classification.subtype, 'install-procedure');
  assert.deepEqual(info.classification.watchPaths, ['docs/INSTALL.md']);
  assert.equal(info.classification.alias, 'demo-app-install');
  assert.ok(github.calls.includes('commitOnBase main d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1'));
  assert.ok(github.calls.includes('prDiff'));
});

test('an open pull request has not landed and needs no landing lookups', () => {
  const { info, github } = inspect(103);
  assert.equal(info.status, 'open');
  assert.equal(info.merged, false);
  assert.equal(info.landedSha, null);
  assert.ok(!github.calls.includes('landingCandidates'));
  assert.equal(info.classification.subtype, 'cli');
  assert.deepEqual(info.classification.watchPaths, ['bin/**', 'src/**', 'test/**']);
  assert.equal(info.classification.alias, 'demo-app');
});

test('a closed pull request whose only commit lives off the base branch did not land', () => {
  const { info } = inspect(104);
  assert.equal(info.status, 'closed');
  assert.equal(info.merged, false);
  assert.equal(info.landedBy, null);
});

test('a commit named in a comment counts once it is confirmed on the base branch', () => {
  const { info } = inspect(105);
  assert.equal(info.landedBy, 'comment');
  assert.equal(info.landedSha, 'c0ffee1234567890abcdef1234567890abcdef12');
  assert.equal(info.landedAt, '2026-06-02T10:00:00Z');
});

test('a referencing commit on the base branch counts when there is no closing commit', () => {
  const { info, github } = inspect(108);
  assert.equal(info.landedBy, 'commit');
  assert.equal(info.landedSha, 'e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8');
  assert.ok(!github.calls.some((call) => call.includes('0480480')));
});

test('a managed clone is the last commit source before comments', () => {
  const github = fakeGitHub();
  const view = structuredClone(FIXTURES['acme/demo-app#104'].view);
  const ref = parsePrUrl(URL_FOR(104));
  const seen = [];
  const result = resolveLanding(view, ref, {
    github,
    cloneDir: 'clone',
    findInClone: (dir, base, number) => {
      seen.push([dir, base, number]);
      return { sha: '1234567890123456789012345678901234567890', subject: 'Try a different cache (#104)' };
    },
  });
  assert.deepEqual(seen, [['clone', 'main', 104]]);
  assert.equal(result.landedBy, 'commit');
  assert.equal(result.landedMessage, 'Try a different cache (#104)');
});

test('documentation and mixed pull requests read the diff for their subtype', () => {
  assert.equal(inspect(106).info.classification.subtype, 'reference-docs');
  assert.equal(inspect(110).info.classification.subtype, 'install-procedure');
  const mixed = inspect(107).info.classification;
  assert.equal(mixed.kind, 'mixed');
  assert.deepEqual(mixed.parts.map((part) => `${part.kind}/${part.subtype}`), ['source/library', 'documentation/reference-docs']);
  assert.deepEqual(mixed.watchPaths, ['docs/**', 'src/**']);
});

test('intake pages through every changed file when gh pr view lists fewer', () => {
  const { info, github } = inspect(109);
  assert.ok(github.calls.includes('prFiles'));
  assert.deepEqual(info.files, ['src/parser/index.js', 'src/parser/tokens.js', 'src/parser/tree.js']);
  assert.deepEqual(info.classification.watchPaths, ['src/parser/**']);
  assert.equal(info.classification.alias, 'parser');
});

test('the text summary names the state, kind, watch paths, and reasons', () => {
  const text = formatIntake(inspect(102).info);
  assert.match(text, /^acme\/demo-app#102 {2}INSTALL\.md: add build steps\n/);
  assert.match(text, / {2}state {4}CLOSED, landed by a commit as d1d1d1d, without a merge\n/);
  assert.match(text, / {2}kind {5}documentation \/ install-procedure\n/);
  assert.match(text, / {2}watch {4}docs\/INSTALL\.md\n/);
  assert.match(text, / {2}because {2}docs\/INSTALL\.md is an install or build guide\n/);
});
