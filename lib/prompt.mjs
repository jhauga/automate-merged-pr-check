import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { codeRoot } from './paths.mjs';

/** Raised when a prompt template names a value or fragment that does not exist. */
export class PromptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PromptError';
    this.exitCode = 2;
  }
}

const MAX_DEPTH = 5;

function lookup(values, name) {
  let value = values;
  for (const part of name.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function truthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function show(value) {
  if (Array.isArray(value)) return value.join('\n');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/** Text of prompts/<name>.md next to the code. */
export function readPromptFile(name, root = codeRoot) {
  const file = path.join(root, 'prompts', `${name}.md`);
  if (!existsSync(file)) throw new PromptError(`Prompt fragment "${name}" was not found at ${file}.`);
  return readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}

/**
 * Renders a prompt template.
 *
 * - {{> fragment}} includes prompts/<fragment>.md before anything else is rendered.
 * - {{#if name}} ... {{/if}} keeps the block when the value is non-empty;
 *   {{#unless name}} ... {{/unless}} keeps it when the value is empty.
 * - {{name}} inserts a value; dotted names reach into objects; arrays join with new lines.
 *   Inserted values are never rendered again, so text from a pull request stays as written.
 *
 * A value or fragment that does not exist is an error, never an empty string.
 */
function expandIncludes(text, include, depth) {
  if (depth > MAX_DEPTH) throw new PromptError('Prompt fragments include each other too deeply.');
  return text.replace(/\{\{>\s*([\w.-]+)\s*\}\}/g, (_, name) => expandIncludes(include(name), include, depth + 1));
}

/**
 * One prompt, rendered: fragments included, if and unless blocks resolved,
 * lists joined by line, and every remaining placeholder replaced by its value.
 */
export function renderTemplate(text, values, { include = (name) => readPromptFile(name) } = {}) {
  let output = expandIncludes(text, include, 0);

  const block = /\{\{#(if|unless)\s+([\w.]+)\s*\}\}((?:(?!\{\{#(?:if|unless)\s)[\s\S])*?)\{\{\/\1\}\}/;
  for (let match = block.exec(output); match; match = block.exec(output)) {
    const [whole, kind, name, inner] = match;
    const keep = kind === 'if' ? truthy(lookup(values, name)) : !truthy(lookup(values, name));
    output = output.replace(whole, () => (keep ? inner : ''));
  }

  const missing = new Set();
  output = output.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name) => {
    const value = lookup(values, name);
    if (value === undefined || value === null) {
      missing.add(name);
      return whole;
    }
    return show(value);
  });
  if (missing.size > 0) throw new PromptError(`The prompt needs values it was not given: ${[...missing].join(', ')}.`);
  return `${output.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Renders prompts/<name>.md with `values`. */
export function renderPrompt(name, values, options = {}) {
  const root = options.root ?? codeRoot;
  return renderTemplate(readPromptFile(name, root), values, { include: (fragment) => readPromptFile(fragment, root), ...options });
}
