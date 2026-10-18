import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { EFFORT_FALLBACK } from '../lib/models.mjs';
import {
  FLAGS,
  contextToMarkdown,
  formatValidation,
  localRepoFor,
  parseForm,
  readContext,
  templateText,
  validateForm,
} from '../lib/context.mjs';

const FIXTURE = new URL('./fixtures/context-filled.md', import.meta.url);
let base;
let root;
let folder;
let repo;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-form-'));
  root = path.join(base, 'auto-checks');
  folder = path.join(root, 'automate-pr-sample-canvas');
  repo = path.join(base, 'demo-app');
  mkdirSync(folder, { recursive: true });
  mkdirSync(repo, { recursive: true });
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** The session C form, with this machine's temporary folders filled in. */
function filledForm(changes = []) {
  let text = readFileSync(FIXTURE, 'utf8')
    .replace('- **Test folder root**: <!-- filled in by the test -->', `- **Test folder root**: ${root}`)
    .replace('- **Local Repository**: <!-- filled in by the test -->', `- **Local Repository**: ${repo}`);
  for (const [from, to] of changes) {
    assert.ok(text.includes(from), `missing ${JSON.stringify(from)}`);
    text = text.replace(from, to);
  }
  return text;
}

/** A machine where claude is installed and signed in, and the pull request is merged. */
function probe(overrides = {}) {
  return {
    which: (command) => (['claude', 'copilot'].includes(command) ? `/usr/bin/${command}` : null),
    run: (file, args) => ({
      status: 0,
      stdout: args[0] === 'auth' ? '{"loggedIn":true}' : '2.1.261 (Claude Code)\n',
      stderr: '',
    }),
    readPr: () => ({ state: 'MERGED', mergedAt: '2026-08-21T00:00:00Z', baseRefName: 'main' }),
    gitRemotes: () => ['https://github.com/acme/demo-app.git'],
    effortLevels: (assistant) => [...EFFORT_FALLBACK[assistant]],
    resolveModel: ({ model }) => ({ label: model, model: 'opus', accepted: 'alias', refused: ['claude-opus-5-5'], commandLabel: 'claude 2.1.261', candidates: [model] }),
    ...overrides,
  };
}

const check = (text, options = {}) => validateForm(parseForm(text), {
  folder,
  settings: { ...defaults(), root },
  ...options,
  probe: probe(options.probe),
});

test('the shipped form has every field, and no value', () => {
  const parsed = parseForm(templateText());
  assert.equal(parsed.state, 'filled');
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.context.flags, Object.fromEntries(FLAGS.map((flag) => [flag.key, false])));
  for (const key of ['command', 'model', 'effort', 'root', 'name', 'prUrl', 'localRepo', 'prContext']) {
    assert.equal(parsed.context[key], '', key);
  }
});

test('the form is read field by field, with the lines its values came from', () => {
  const parsed = parseForm(filledForm());
  assert.equal(parsed.state, 'filled');
  assert.equal(parsed.context.command, 'claude');
  assert.equal(parsed.context.model, 'Opus 5.5');
  assert.equal(parsed.context.effort, 'xhigh');
  assert.equal(parsed.context.name, 'automate-pr-sample-canvas');
  assert.equal(parsed.context.prUrl, 'https://github.com/acme/demo-app/pull/101');
  assert.deepEqual(parsed.context.flags, {
    findIssue: true,
    resolveIssue: true,
    commitSolution: true,
    localCommit: true,
    remotePush: false,
    makePr: false,
  });
  assert.equal(parsed.fields.command.line, 5);
  assert.equal(parsed.fields.name.line, 12);
});

test('PR Context is the inline value plus the verbose section', () => {
  const parsed = parseForm(filledForm());
  assert.match(parsed.context.prContext, /^Rendered HTML elements created in a desktop app for learning and research\.\n\n/);
  assert.match(parsed.context.prContext, /opens a drawing surface in the side panel of Sample App/);
  assert.match(contextToMarkdown(parsed.context), /^## Context from context\.md\n\nRendered HTML elements/);
  assert.equal(contextToMarkdown({ prContext: '' }), '');

  const inlineOnly = parseForm(filledForm([['### PR Context', '### Notes']]));
  assert.equal(inlineOnly.context.prContext, 'Rendered HTML elements created in a desktop app for learning and research.');
});

test('a flag takes true, false, yes, or no, in any case, and anything else is a problem', () => {
  for (const [written, expected] of [['true', true], ['TRUE', true], ['Yes', true], ['false', false], ['NO', false], ['', false]]) {
    const parsed = parseForm(filledForm([['- **Find Issue**: true', `- **Find Issue**: ${written}`]]));
    assert.equal(parsed.context.flags.findIssue, expected, written);
    assert.deepEqual(parsed.problems.filter((problem) => /^Find Issue takes/.test(problem.message)), []);
  }
  const broken = parseForm(filledForm([['- **Find Issue**: true', '- **Find Issue**: maybe']]));
  assert.equal(broken.state, 'invalid');
  assert.deepEqual(broken.problems, [{ line: 16, message: 'Find Issue takes true or false, not "maybe".' }]);
});

test('a flag whose parent is off names that parent, with its line', () => {
  const parsed = parseForm(filledForm([['- **Find Issue**: true', '- **Find Issue**: false']]));
  assert.equal(parsed.state, 'invalid');
  assert.deepEqual(parsed.problems, [
    { line: 17, message: 'Resolve Issue is true, but Find Issue is not. Turn Find Issue on, or set Resolve Issue to false.' },
  ]);
  const pushed = parseForm(filledForm([['  - **Remote Push**: false', '  - **Remote Push**: false\n  - **Make PR**: true']]));
  assert.deepEqual(pushed.problems, [
    { line: 21, message: 'Make PR is true, but Remote Push is not. Turn Remote Push on, or set Make PR to false.' },
  ]);
});

test('a misspelled field is a warning, and a repeated one is a problem', () => {
  const typo = parseForm(filledForm([['- **Find Issue**: true', '- **Find Isue**: true\n- **Find Issue**: true']]));
  assert.deepEqual(typo.warnings, [
    { line: 16, message: '"Find Isue" is not a field of this form. Check the spelling, or delete the line.' },
  ]);
  const twice = parseForm(filledForm([['- **Find Issue**: true', '- **Find Issue**: true\n- **Find Issue**: false']]));
  assert.deepEqual(twice.problems, [{ line: 17, message: 'Find Issue appears twice. Keep one line for it.' }]);
});

test('something that looks like a secret is a warning', () => {
  const parsed = parseForm(filledForm([['- Model: Opus 5.5', '- Model: Opus 5.5\n- Notes: token: ghp_0123456789abcdefghijklmnopqrst']]));
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0].message, /^This looks like a secret\./);
});

test('every rule passes for a filled form, and the flag chain reads as session C does', () => {
  const result = check(filledForm());
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  const report = formatValidation(result.rows);
  assert.match(report, /^A\.I\. Tool +claude 2\.1\.261 \(Claude Code\), signed in; model Opus 5\.5 \(runs as opus: claude 2\.1\.261 does not accept claude-opus-5-5\); effort xhigh +pass$/m);
  assert.match(report, /^Test folder +automate-pr-sample-canvas is the current folder +pass$/m);
  assert.match(report, /^Merged PR +acme\/demo-app#101, merged +pass$/m);
  assert.match(report, /^PR Context +provided; passed to the assistant +pass$/m);
  assert.match(report, /^Find Issue +true$/m);
  assert.match(report, /^Resolve Issue +true$/m);
  assert.match(report, /^Commit Solution {2}true: Local Commit true, Remote Push false, Make PR false \(Remote Push is false\)$/m);
  assert.equal(result.resolved.assistant, 'claude');
  assert.equal(result.resolved.model, 'opus');
  assert.equal(result.resolved.modelLabel, 'Opus 5.5');
  assert.equal(result.resolved.effort, 'xhigh');
  assert.equal(result.resolved.root, root);
  assert.equal(result.resolved.localRepo, repo);
});

test('an empty A.I. Tool takes the configured assistant, model, and effort', () => {
  const settings = { ...defaults(), root };
  settings.models.claude.effort = 'high';
  const text = filledForm([['- Command: claude', '- Command:'], ['- Model: Opus 5.5', '- Model:'], ['- Thinking Effort: xhigh', '- Thinking Effort:']]);
  const resolveModel = ({ model }) => ({ label: model, model, accepted: 'only', candidates: [model] });
  const result = validateForm(parseForm(text), { folder, settings, probe: probe({ resolveModel }) });
  assert.deepEqual(result.problems, []);
  assert.equal(result.resolved.assistant, 'claude');
  assert.equal(result.resolved.model, 'opus');
  assert.equal(result.resolved.modelLabel, 'opus');
  assert.equal(result.resolved.effort, 'high');
  assert.match(formatValidation(result.rows), /model opus \(configured\); effort high/);
});

test('a command that is unknown, missing, or signed out fails with its line', () => {
  const unknown = check(filledForm([['- Command: claude', '- Command: gemini']]));
  assert.deepEqual(unknown.problems, [{ line: 5, message: 'Command must be one of claude, copilot, codex, not "gemini".' }]);

  const missing = check(filledForm([['- Command: claude', '- Command: codex']]));
  assert.deepEqual(missing.problems, [{ line: 5, message: 'The codex command is not on PATH. Install it, or name another command.' }]);

  const out = check(filledForm(), {
    probe: { run: (file, args) => ({ status: 0, stdout: args[0] === 'auth' ? '{"loggedIn":false}' : 'claude 2.1.261\n', stderr: '' }) },
  });
  assert.deepEqual(out.problems, [{ line: 5, message: 'claude is installed but not signed in. Sign in, then run this again.' }]);
});

test('the thinking effort must be a level the command offers', () => {
  const result = check(filledForm([['- Thinking Effort: xhigh', '- Thinking Effort: deep']]));
  assert.deepEqual(result.problems, [
    { line: 5, message: `Thinking Effort for claude must be one of ${EFFORT_FALLBACK.claude.join(', ')}, not "deep".` },
  ]);
  assert.deepEqual(check(filledForm([['- Thinking Effort: xhigh', '- Thinking Effort: MAX']])).problems, []);
});

test('the name and the root must describe this folder', () => {
  const wrongName = check(filledForm([['- **Test folder name**: automate-pr-sample-canvas', '- **Test folder name**: automate-pr-other']]));
  assert.deepEqual(wrongName.problems, [
    { line: 12, message: 'Test folder name is "automate-pr-other", but this folder is "automate-pr-sample-canvas". Make them match.' },
  ]);

  const noName = check(filledForm([['- **Test folder name**: automate-pr-sample-canvas', '- **Test folder name**:']]));
  assert.deepEqual(noName.problems, [{ line: 12, message: 'Test folder name is required.' }]);

  const missingRoot = check(filledForm([[`- **Test folder root**: ${root}`, `- **Test folder root**: ${path.join(base, 'no-such-root')}`]]));
  assert.match(missingRoot.problems[0].message, /^The test folder root .* does not exist\.$/);

  const elsewhere = check(filledForm([[`- **Test folder root**: ${root}`, `- **Test folder root**: ${base}`]]));
  assert.match(elsewhere.problems[0].message, /is not this folder/);

  const noRoot = validateForm(parseForm(filledForm([[`- **Test folder root**: ${root}`, '- **Test folder root**:']])), {
    folder,
    settings: { ...defaults(), root: '' },
    probe: probe(),
  });
  assert.deepEqual(noRoot.problems, [
    { line: 11, message: 'No test folder root is set. Fill one in, or run auto-check config set root <folder>.' },
  ]);
});

test('the pull request must be one gh can read, and an open one needs a local clone', () => {
  const noUrl = check(filledForm([['- **Merged PR URI**: https://github.com/acme/demo-app/pull/101', '- **Merged PR URI**:']]));
  assert.deepEqual(noUrl.problems, [
    { line: 13, message: 'Merged PR URI is required: the pull request this test watches.' },
  ]);

  const notAPr = check(filledForm([['https://github.com/acme/demo-app/pull/101', 'https://github.com/acme/demo-app/issues/9']]));
  assert.equal(notAPr.problems.length, 1);
  assert.match(notAPr.problems[0].message, /is not a pull request URL/);

  const gone = check(filledForm(), { probe: { readPr: () => { throw new Error('HTTP 404: Not Found'); } } });
  assert.match(gone.problems[0].message, /^the pull request could not be read: HTTP 404/);

  const open = check(filledForm([[`- **Local Repository**: ${repo}`, '- **Local Repository**:']]), {
    probe: { readPr: () => ({ state: 'OPEN', mergedAt: null, baseRefName: 'main' }) },
  });
  assert.ok(open.problems.some((problem) => /still open, so Local Repository is needed/.test(problem.message)));
  assert.match(formatValidation(open.rows), /^Merged PR +acme\/demo-app#101, open and no local repository +fail$/m);
});

test('a local repository must exist, be a work tree, and look like the right clone', () => {
  const missing = check(filledForm([[`- **Local Repository**: ${repo}`, `- **Local Repository**: ${path.join(base, 'no-such-clone')}`]]));
  assert.match(missing.problems[0].message, /was not found\.$/);

  const notGit = check(filledForm(), { probe: { gitRemotes: () => null } });
  assert.match(notGit.problems[0].message, /is not a git work tree\.$/);

  const elsewhere = check(filledForm(), { probe: { gitRemotes: () => ['https://github.com/acme/other-app.git'] } });
  assert.deepEqual(elsewhere.problems, []);
  assert.match(elsewhere.warnings.at(-1).message, /^None of the remotes of .* is acme\/demo-app\./);
});

test('Commit Solution needs a local repository to make the branch in', () => {
  const result = check(filledForm([[`- **Local Repository**: ${repo}`, '- **Local Repository**:']]));
  assert.ok(result.problems.some((problem) => /Commit Solution needs Local Repository/.test(problem.message)));
});

test('reading the form from a file keeps its path', () => {
  const file = path.join(folder, 'context.md');
  writeFileSync(file, filledForm());
  const parsed = readContext(file);
  assert.equal(parsed.file, file);
  assert.equal(parsed.context.name, 'automate-pr-sample-canvas');
});

test('a resolve step takes the local clone from the form first, then the check, then the setting', () => {
  const file = path.join(folder, 'context.md');
  writeFileSync(file, filledForm());
  const config = defaults();
  config.repos.localRepo = path.join(base, 'from-the-setting');
  const check = { source: { localRepo: path.join(base, 'from-the-check') } };
  assert.equal(localRepoFor({ testFolder: folder, config, check }), repo);
  assert.equal(localRepoFor({ testFolder: path.join(base, 'no-form'), config, check }), check.source.localRepo);
  assert.equal(localRepoFor({ testFolder: path.join(base, 'no-form'), config, check: {} }), config.repos.localRepo);
  assert.equal(localRepoFor({ testFolder: path.join(base, 'no-form') }), '');
});
