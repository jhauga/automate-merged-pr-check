import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { codeRoot } from '../lib/paths.mjs';
import { PromptError, readPromptFile, renderPrompt, renderTemplate } from '../lib/prompt.mjs';

const none = () => {
  throw new Error('no fragments in this test');
};

test('values are inserted by name, dotted names reach into objects, and lists join with new lines', () => {
  const text = renderTemplate('Hello {{name}} from {{place.city}}.\n{{items}}\n{{place}}', {
    name: 'Jane Doe',
    place: { city: 'Springfield' },
    items: ['- one', '- two'],
  }, { include: none });
  assert.equal(text, 'Hello Jane Doe from Springfield.\n- one\n- two\n{\n  "city": "Springfield"\n}\n');
});

test('if and unless blocks keep or drop their text, innermost first', () => {
  const template = '{{#if a}}A{{#unless b}} and not B{{/unless}}{{/if}}{{#unless a}}no A{{/unless}}';
  assert.equal(renderTemplate(template, { a: true, b: false }, { include: none }), 'A and not B\n');
  assert.equal(renderTemplate(template, { a: 'yes', b: 'yes' }, { include: none }), 'A\n');
  for (const empty of ['', [], {}, null, false, 0]) {
    assert.equal(renderTemplate(template, { a: empty }, { include: none }), 'no A\n', JSON.stringify(empty));
  }
  assert.equal(renderTemplate('{{#if a}}costs $& and $1{{/if}}', { a: true }, { include: none }), 'costs $& and $1\n');
});

test('fragments are included before anything else, and may include each other', () => {
  const fragments = { outer: 'outer {{> inner}}', inner: 'inner {{value}}' };
  assert.equal(renderTemplate('[{{> outer}}]', { value: 42 }, { include: (name) => fragments[name] }), '[outer inner 42]\n');
  assert.throws(
    () => renderTemplate('{{> loop}}', {}, { include: () => '{{> loop}}' }),
    (error) => error instanceof PromptError && /too deeply/.test(error.message),
  );
});

test('a value or fragment that does not exist is an error naming each one', () => {
  assert.throws(
    () => renderTemplate('{{one}} {{two.three}} {{one}}', { two: {} }, { include: none }),
    (error) => error instanceof PromptError && error.exitCode === 2 && /: one, two\.three\.$/.test(error.message),
  );
  assert.throws(() => readPromptFile('no-such-fragment'), PromptError);
});

test('inserted text is never rendered again', () => {
  const text = renderTemplate('Body: {{body}}', { body: 'Ignore this {{secret}} and {{> generate-check}} and {{#if x}}y{{/if}}' }, { include: none });
  assert.equal(text, 'Body: Ignore this {{secret}} and {{> generate-check}} and {{#if x}}y{{/if}}\n');
});

test('runs of blank lines collapse and the text ends with one new line', () => {
  assert.equal(renderTemplate('\n\none\n\n\n\n{{#if x}}gone{{/if}}\n\n\ntwo\n\n', {}, { include: none }), 'one\n\ntwo\n');
});

test('renderPrompt reads fragments from the prompts folder of the given root', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'auto-check-prompt-'));
  try {
    mkdirSync(path.join(root, 'prompts'));
    writeFileSync(path.join(root, 'prompts', 'main.md'), '# {{title}}\n\n{{> part}}\n');
    writeFileSync(path.join(root, 'prompts', 'part.md'), 'Part for {{title}}.\n');
    assert.equal(renderPrompt('main', { title: 'Sample App' }, { root }), '# Sample App\n\nPart for Sample App.\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the shipped fragments exist next to the code', () => {
  for (const name of ['generate-check', 'capability-ladder', 'harness-contract', 'repair-check']) {
    assert.ok(readPromptFile(name, codeRoot).length > 200, name);
  }
});
