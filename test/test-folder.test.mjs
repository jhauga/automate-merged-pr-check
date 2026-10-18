import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, test } from 'node:test';
import { defaults } from '../lib/config.mjs';
import { MARKER_FILE, codeRoot } from '../lib/paths.mjs';
import {
  KIT_DIR,
  KIT_IMPORT,
  RootFolderError,
  TestFolderError,
  askLine,
  beyondScaffold,
  createTestFolder,
  installAssistantFiles,
  installKit,
  newContext,
  packageVersion,
  prefillContext,
  resolveName,
  resolveRoot,
  resolveTestFolder,
  suggestedName,
  toolSkills,
  validateFolderName,
} from '../lib/test-folder.mjs';

let base;

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-test-folder-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A terminal that answers with `lines`, one answer per question. */
function fakeTerminal(lines = []) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  let written = '';
  const io = {
    stdin,
    stdout: { write: (text) => { written += text; } },
    stderr: { write: (text) => { written += text; } },
  };
  for (const line of lines) stdin.write(`${line}\n`);
  return { io, output: () => written };
}

function root(name) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('a test folder name is one folder name, usable on this platform', () => {
  assert.equal(validateFolderName('  automate-pr-sample-canvas  '), 'automate-pr-sample-canvas');
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'con', 'PRN.txt', 'name:1', 'name?']) {
    assert.throws(() => validateFolderName(bad), TestFolderError, bad);
  }
});

test('the suggested name comes from the pull request alias', () => {
  assert.equal(suggestedName('sample-canvas'), 'automate-pr-sample-canvas');
  assert.equal(suggestedName('Sample Canvas!'), 'automate-pr-sample-canvas');
  assert.equal(suggestedName(''), 'automate-pr-check');
});

test('the form is prefilled before each field\'s comment, and unknown labels are left out', () => {
  const filled = prefillContext(newContext(), {
    'Test folder root': 'C:\\Users\\<user>\\Documents\\auto-checks',
    'Test folder name': 'automate-pr-sample-canvas',
    'Merged PR URI': 'https://github.com/acme/demo-app/pull/123',
    'Find Issue': 'true',
    'No Such Field': 'ignored',
  });
  assert.match(filled, /^- \*\*Test folder root\*\*: C:\\Users\\<user>\\Documents\\auto-checks <!-- The absolute path/m);
  assert.match(filled, /^- \*\*Test folder name\*\*: automate-pr-sample-canvas <!-- The folder name/m);
  assert.match(filled, /^- \*\*Merged PR URI\*\*: https:\/\/github\.com\/acme\/demo-app\/pull\/123 <!--/m);
  assert.match(filled, /^- \*\*Find Issue\*\*: true <!--/m);
  assert.doesNotMatch(filled, /ignored/);
});

test('creating a test folder writes only the form and the ignore file', () => {
  const holder = root('create');
  const created = createTestFolder({ root: holder, name: 'automate-pr-sample-canvas', prefill: { 'Find Issue': 'true' } });
  assert.equal(created.dir, path.join(holder, 'automate-pr-sample-canvas'));
  assert.deepEqual(created.written, [MARKER_FILE, '.gitignore']);
  assert.deepEqual(readdirSync(created.dir).sort(), ['.gitignore', MARKER_FILE]);
  assert.match(readFileSync(path.join(created.dir, MARKER_FILE), 'utf8'), /^- \*\*Find Issue\*\*: true/m);
  assert.match(readFileSync(path.join(created.dir, '.gitignore'), 'utf8'), /^results\/$/m);

  const again = createTestFolder({ root: holder, name: 'automate-pr-sample-canvas' });
  assert.deepEqual(again.written, []);
  assert.throws(() => createTestFolder({ root: path.join(base, 'no-such-root'), name: 'demo' }), RootFolderError);
});

test('a folder that holds more than the scaffold is refused', () => {
  const holder = root('busy');
  const dir = path.join(holder, 'automate-pr-sample-canvas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'notes.txt'), 'something of mine\n');
  assert.deepEqual(beyondScaffold(dir), ['notes.txt']);
  assert.throws(() => createTestFolder({ root: holder, name: 'automate-pr-sample-canvas' }), TestFolderError);
});

test('the kit copy carries the version that wrote it and is refreshed in place', () => {
  const dir = root('kit');
  const file = installKit(dir);
  assert.equal(file, path.join(dir, KIT_DIR, 'check-kit.mjs'));
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith(`// auto-check ${packageVersion()} check kit.`));
  assert.ok(text.includes(KIT_IMPORT));
  assert.ok(text.includes('export async function runCheck'));
  writeFileSync(file, 'edited by hand\n');
  installKit(dir);
  assert.ok(readFileSync(file, 'utf8').includes('export async function runCheck'));
});

test('the tool ships its skills once, and a test folder gets a copy in its assistant\'s folder', () => {
  const skills = toolSkills();
  assert.ok(skills.includes('auto-check-context'), skills.join(', '));
  assert.ok(skills.every((name) => existsSync(path.join(codeRoot, 'skills', name, 'SKILL.md'))));

  const dir = root('skills');
  const copied = installAssistantFiles(dir, { assistant: 'copilot', config: defaults() });
  assert.equal(copied.skillsFolder, '.github/skills');
  assert.deepEqual(copied.skills, skills);
  for (const name of skills) {
    assert.ok(existsSync(path.join(dir, '.github', 'skills', name, 'SKILL.md')));
  }
  assert.ok(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').includes('@AGENTS.md'));
  assert.match(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /^## When auto-check starts you$/m);
});

test('a skill the tool no longer ships is removed, and other skills are left alone', () => {
  const dir = root('skills-clean');
  const folder = path.join(dir, '.claude', 'skills');
  mkdirSync(path.join(folder, 'auto-check-retired'), { recursive: true });
  writeFileSync(path.join(folder, 'auto-check-retired', 'SKILL.md'), 'no longer shipped\n');
  mkdirSync(path.join(folder, 'my-notes'), { recursive: true });
  writeFileSync(path.join(folder, 'my-notes', 'SKILL.md'), 'a skill of my own\n');
  installAssistantFiles(dir, { assistant: 'claude', config: defaults() });
  assert.equal(existsSync(path.join(folder, 'auto-check-retired')), false);
  assert.equal(readFileSync(path.join(folder, 'my-notes', 'SKILL.md'), 'utf8'), 'a skill of my own\n');
});

test('a folder argument is a path, a name under the root, or the current folder', () => {
  const holder = root('resolve');
  const named = createTestFolder({ root: holder, name: 'automate-pr-sample-canvas' }).dir;
  assert.equal(resolveTestFolder({ folder: undefined, cwd: named }), named);
  assert.equal(resolveTestFolder({ folder: 'automate-pr-sample-canvas', cwd: base, root: holder }), named);
  assert.equal(resolveTestFolder({ folder: named, cwd: base, root: holder }), named);
  assert.equal(resolveTestFolder({ folder: '.', cwd: named, root: holder }), named);
  assert.equal(
    resolveTestFolder({ folder: 'automate-pr-missing', cwd: base, root: holder }),
    path.join(holder, 'automate-pr-missing'),
  );
});

test('the root comes from the command line, the form, or the settings, in that order', async () => {
  const holder = root('roots');
  const other = root('roots-other');
  const { io } = fakeTerminal();
  assert.deepEqual(await resolveRoot({ cliRoot: holder, formRoot: other, settingsRoot: other, cwd: base, io }), { root: holder, saved: false });
  assert.deepEqual(await resolveRoot({ formRoot: holder, settingsRoot: other, cwd: base, io }), { root: holder, saved: false });
  assert.deepEqual(await resolveRoot({ settingsRoot: holder, cwd: base, io }), { root: holder, saved: false });
  await assert.rejects(resolveRoot({ settingsRoot: path.join(base, 'no-such-root'), cwd: base, io }), RootFolderError);
});

test('without a root the first run asks, and the answer is saved', async () => {
  const holder = root('ask');
  const typed = fakeTerminal([holder]);
  const saved = [];
  const answered = await resolveRoot({ cwd: base, io: typed.io, save: (folder) => saved.push(folder) });
  assert.deepEqual(answered, { root: holder, saved: true });
  assert.deepEqual(saved, [holder]);
  assert.match(typed.output(), /^No root folder is configured to hold the test folders\.\n/);
  assert.match(typed.output(), /To use the current folder, enter "\."\.\n> $/);

  const dot = fakeTerminal(['.']);
  const here = await resolveRoot({ cwd: holder, io: dot.io, save: () => {} });
  assert.equal(here.root, holder);
});

test('without a terminal a missing root and a missing name are argument errors', async () => {
  const quiet = { stdin: new PassThrough(), stdout: { write: () => {} }, stderr: { write: () => {} } };
  await assert.rejects(resolveRoot({ cwd: base, io: quiet }), (error) => {
    assert.ok(error instanceof TestFolderError);
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /auto-check config set root <folder>/);
    return true;
  });
  await assert.rejects(resolveName({ suggestion: 'automate-pr-sample-canvas', io: quiet }), TestFolderError);
  assert.equal(await resolveName({ suggestion: 'automate-pr-sample-canvas', io: quiet, yes: true }), 'automate-pr-sample-canvas');
});

test('the name is asked for with the suggestion, which an empty answer accepts', async () => {
  const typed = fakeTerminal(['automate-pr-mine']);
  assert.equal(await resolveName({ suggestion: 'automate-pr-sample-canvas', io: typed.io }), 'automate-pr-mine');
  assert.match(typed.output(), /What should the test folder be called\? \[automate-pr-sample-canvas\]\n> $/);

  const empty = fakeTerminal(['']);
  assert.equal(await resolveName({ suggestion: 'automate-pr-sample-canvas', io: empty.io }), 'automate-pr-sample-canvas');
  assert.equal(await resolveName({ cliName: 'automate-pr-given', suggestion: 'automate-pr-sample-canvas', io: empty.io }), 'automate-pr-given');
});

test('a question with no answer at all comes back empty', async () => {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.end();
  const answer = await askLine({ io: { stdin, stdout: { write: () => {} } }, question: 'Anything?' });
  assert.equal(answer, '');
});
