import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GhError, PR_FIELDS, createGitHub } from '../lib/github.mjs';

const REF = { host: 'github.com', owner: 'acme', repo: 'demo-app', number: 7, url: 'https://github.com/acme/demo-app/pull/7' };

function recorder(reply) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return typeof reply === 'function' ? reply(args) : reply;
  };
  return { calls, github: createGitHub({ gh }) };
}

test('viewPr asks gh pr view for the intake fields', () => {
  const { calls, github } = recorder('{"number":7}');
  assert.deepEqual(github.viewPr(REF), { number: 7 });
  assert.deepEqual(calls[0], ['pr', 'view', REF.url, '--json', PR_FIELDS.join(',')]);
});

test('prFiles pages through the REST API and reads one file per line', () => {
  const { calls, github } = recorder('{"path":"src/a.js","additions":1,"deletions":2}\n{"path":"src/b.js","additions":3,"deletions":0}\n');
  assert.deepEqual(github.prFiles(REF), [
    { path: 'src/a.js', additions: 1, deletions: 2 },
    { path: 'src/b.js', additions: 3, deletions: 0 },
  ]);
  assert.deepEqual(calls[0].slice(0, 3), ['api', '--paginate', 'repos/acme/demo-app/pulls/7/files?per_page=100']);
});

test('landingCandidates reads the closing commit and the referencing commits, newest first', () => {
  const reply = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          timelineItems: {
            nodes: [
              { __typename: 'ReferencedEvent', createdAt: '2026-01-01T00:00:00Z', commit: { oid: 'aaaa', messageHeadline: 'first (#7)' } },
              { __typename: 'ClosedEvent', createdAt: '2026-01-02T00:00:00Z', closer: { __typename: 'Commit', oid: 'bbbb', messageHeadline: 'land (#7)' } },
              { __typename: 'ReferencedEvent', createdAt: '2026-01-03T00:00:00Z', commit: { oid: 'cccc', messageHeadline: 'follow-up (#7)' } },
              { __typename: 'ClosedEvent', createdAt: '2026-01-04T00:00:00Z', closer: { __typename: 'PullRequest' } },
            ],
          },
        },
      },
    },
  });
  const { calls, github } = recorder(reply);
  assert.deepEqual(github.landingCandidates(REF), {
    closer: { sha: 'bbbb', message: 'land (#7)', at: '2026-01-02T00:00:00Z' },
    referenced: [
      { sha: 'cccc', message: 'follow-up (#7)', at: '2026-01-03T00:00:00Z' },
      { sha: 'aaaa', message: 'first (#7)', at: '2026-01-01T00:00:00Z' },
    ],
  });
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'graphql']);
  assert.ok(calls[0].includes('number=7'));
});

test('commitOnBase accepts behind and identical, and treats unknown commits as off the base', () => {
  const reply = (status) => () => JSON.stringify({ status, sha: 'f'.repeat(40) });
  assert.deepEqual(recorder(reply('behind')).github.commitOnBase(REF, 'main', 'fff'), { onBase: true, sha: 'f'.repeat(40) });
  assert.deepEqual(recorder(reply('identical')).github.commitOnBase(REF, 'main', 'fff'), { onBase: true, sha: 'f'.repeat(40) });
  assert.deepEqual(recorder(reply('diverged')).github.commitOnBase(REF, 'main', 'fff'), { onBase: false, sha: null });
  const missing = recorder(() => {
    throw new GhError('gh api failed', { status: 1, stderr: 'gh: Not Found (HTTP 404)' });
  });
  assert.deepEqual(missing.github.commitOnBase(REF, 'main', 'fff'), { onBase: false, sha: null });
  const offline = recorder(() => {
    throw new GhError('gh api failed', { status: 1, stderr: 'error connecting to api.github.com' });
  });
  assert.throws(() => offline.github.commitOnBase(REF, 'main', 'fff'), GhError);
  const { calls } = (() => {
    const run = recorder(reply('behind'));
    run.github.commitOnBase(REF, 'main', 'abc1234');
    return run;
  })();
  assert.deepEqual(calls[0].slice(0, 2), ['api', 'repos/acme/demo-app/compare/main...abc1234']);
});

test('GitHub Enterprise hosts are passed to gh api', () => {
  const enterprise = { ...REF, host: 'github.example.com', url: 'https://github.example.com/acme/demo-app/pull/7' };
  const { calls, github } = recorder('');
  github.prFiles(enterprise);
  assert.deepEqual(calls[0].slice(0, 3), ['api', '--hostname', 'github.example.com']);
});
