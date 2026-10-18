import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Where repositories keep their contributing guide, in the order GitHub looks. */
export const CONTRIBUTING_FILES = Object.freeze(['.github/CONTRIBUTING.md', 'CONTRIBUTING.md', 'docs/CONTRIBUTING.md']);

/** Where repositories keep their pull request template. */
export const PR_TEMPLATE_FILES = Object.freeze([
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'docs/pull_request_template.md',
]);

const MAX_ITEMS = 15;
const SUBMIT_HEADING = /submit|before (you|submitting|opening)|checklist/i;
const PROCESS_HEADING = /pull request|commit|sign|branch/i;
const COMMIT_RULE = /sign(ed)?[- ]off|\bDCO\b|commit message|conventional commit|branch name/i;
const COMMAND = /^(npm|npx|yarn|pnpm|make|go|cargo|python3?|pip|gh|node|dotnet|mvn|gradle|bundle|rake|composer|tox|pytest)\s+\S/;
const CHECK_WORD = /\b(test|lint|validate|build|check|verify|format|start)\b/;
const SIGN_OFF = /signed-off-by|\bDCO\b|developer certificate of origin|sign[- ]off/i;

const firstExisting = (repo, files) => files.map((file) => path.join(repo, file)).find((file) => existsSync(file)) ?? null;
const clean = (text) => text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim();

function sections(text) {
  const found = [];
  let current = { title: '', level: 0, lines: [] };
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      found.push(current);
      current = { title: heading[2], level: heading[1].length, lines: [] };
    } else {
      current.lines.push({ text: line, fenced });
    }
  }
  found.push(current);
  return found;
}

/**
 * What a repository's contributing guide asks of a change: the list items
 * of its sections about submitting first, then those of the section about
 * the kind of thing the subject is, then those about pull requests, commits,
 * and branches, then commit rules from anywhere; the check commands it names, such as a test or build
 * script; and whether commits need a sign-off. `subjectPath` is the
 * subject's folder in the repository, such as extensions/sample-canvas.
 */
export function readContributing(repo, { subjectPath = '' } = {}) {
  const file = firstExisting(repo, CONTRIBUTING_FILES);
  const template = firstExisting(repo, PR_TEMPLATE_FILES);
  if (!file) return { file: null, template, items: [], commands: [], signOff: false };
  const text = readFileSync(file, 'utf8');
  const words = subjectPath.split('/').filter(Boolean).slice(0, 1).map((part) => part.toLowerCase().replace(/s$/, ''));
  const subjectHeading = words.length > 0 ? new RegExp(`\\b(${words.map((word) => word.replace(/[^a-z0-9-]/g, '')).join('|')})s?\\b`, 'i') : null;
  const groups = { submit: [], subject: [], process: [], rule: [] };
  for (const section of sections(text)) {
    let group = null;
    if (SUBMIT_HEADING.test(section.title)) group = 'submit';
    else if (subjectHeading?.test(section.title)) group = 'subject';
    else if (PROCESS_HEADING.test(section.title)) group = 'process';
    for (const line of section.lines) {
      if (line.fenced) continue;
      const item = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line.text);
      if (!item) continue;
      const kind = group ?? (COMMIT_RULE.test(item[1]) ? 'rule' : null);
      if (kind) groups[kind].push(`${section.title ? `${section.title}: ` : ''}${clean(item[1])}`);
    }
  }
  const items = [...new Set([...groups.submit, ...groups.subject, ...groups.process, ...groups.rule])].slice(0, MAX_ITEMS);
  const commands = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim()).filter((code) => COMMAND.test(code) && CHECK_WORD.test(code) && !code.includes('<')))];
  return { file, template, items, commands, signOff: SIGN_OFF.test(text) };
}
