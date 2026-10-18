import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ASSISTANTS } from './config.mjs';
import { createGitHub, ghRunner } from './github.mjs';
import { ModelError, commandLabel, describeModel, effortLevels, resolveModel } from './models.mjs';
import { codeRoot } from './paths.mjs';
import { PrError, parsePrUrl } from './pr.mjs';
import { git } from './repo.mjs';
import { assistantState } from './setup.mjs';
import { capture, which } from './util/which.mjs';

/** The form that describes one test, at the root of its test folder. */
export const CONTEXT_FILE = 'context.md';

/** The form as it ships, which a new test folder starts from. */
export const TEMPLATE_FILE = path.join('templates', 'context.md');

/** Every field of the form: its key, its label, and whether it holds a flag. */
export const FORM_FIELDS = Object.freeze([
  { key: 'command', label: 'Command' },
  { key: 'model', label: 'Model' },
  { key: 'effort', label: 'Thinking Effort' },
  { key: 'root', label: 'Test folder root' },
  { key: 'name', label: 'Test folder name' },
  { key: 'prUrl', label: 'Merged PR URI' },
  { key: 'localRepo', label: 'Local Repository' },
  { key: 'prContext', label: 'PR Context' },
  { key: 'findIssue', label: 'Find Issue', flag: true },
  { key: 'resolveIssue', label: 'Resolve Issue', flag: true, needs: 'findIssue' },
  { key: 'commitSolution', label: 'Commit Solution', flag: true, needs: 'resolveIssue' },
  { key: 'localCommit', label: 'Local Commit', flag: true, needs: 'commitSolution' },
  { key: 'remotePush', label: 'Remote Push', flag: true, needs: 'localCommit' },
  { key: 'makePr', label: 'Make PR', flag: true, needs: 'remotePush' },
]);

/** The flags, in the order the chain runs them. */
export const FLAGS = Object.freeze(FORM_FIELDS.filter((field) => field.flag));

const BY_LABEL = new Map(FORM_FIELDS.map((field) => [field.label.toLowerCase(), field]));
const BULLET = /^\s*[-*]\s+(\*{0,2})([^:*]+?)\1:[ \t]*(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const TRUE = /^(true|yes)$/i;
const FALSE = /^(false|no)$/i;
const SECRET = /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|\b(?:password|passwd|secret|token|api[ _-]?key)\s*[:=]\s*\S+/i;

/** Text with Windows line endings and trailing spaces removed. */
export function normalizeText(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '\n');
}

/** Every line with its HTML comments removed; the hints in the form are comments. */
function withoutComments(lines) {
  const out = [];
  let inside = false;
  for (const line of lines) {
    let text = line;
    let clean = '';
    for (;;) {
      if (inside) {
        const end = text.indexOf('-->');
        if (end === -1) {
          text = '';
          break;
        }
        inside = false;
        text = text.slice(end + 3);
        continue;
      }
      const start = text.indexOf('<!--');
      if (start === -1) {
        clean += text;
        break;
      }
      clean += text.slice(0, start);
      text = text.slice(start + 4);
      inside = true;
    }
    out.push(clean);
  }
  return out;
}

const emptyFlags = () => Object.fromEntries(FLAGS.map((flag) => [flag.key, false]));

/**
 * Parses the form. Every value keeps the line it came from, so a problem can
 * name it. Comments are hints and are ignored, an unknown bold label is a
 * warning, and a flag that is neither true nor false is a problem.
 */
export function parseForm(text) {
  const lines = normalizeText(text).split('\n');
  const clean = withoutComments(lines);
  const fields = {};
  const problems = [];
  const warnings = [];
  const sections = new Map();
  let section = null;

  clean.forEach((line, index) => {
    const number = index + 1;
    const heading = HEADING.exec(line);
    if (heading) {
      section = heading[2].trim().toLowerCase();
      sections.set(section, { line: number, body: [] });
      return;
    }
    const bullet = BULLET.exec(line);
    if (!bullet) {
      if (section && line.trim()) sections.get(section).body.push(line);
      return;
    }
    const label = bullet[2].trim();
    const field = BY_LABEL.get(label.toLowerCase());
    if (!field) {
      if (bullet[1] === '**') {
        warnings.push({ line: number, message: `"${label}" is not a field of this form. Check the spelling, or delete the line.` });
      } else if (section && line.trim()) {
        sections.get(section).body.push(line);
      }
      return;
    }
    const value = bullet[3].trim();
    if (fields[field.key]) {
      problems.push({ line: number, message: `${field.label} appears twice. Keep one line for it.` });
      return;
    }
    fields[field.key] = { value, line: number };
  });

  const unreadable = new Set();
  for (const flag of FLAGS) {
    const entry = fields[flag.key];
    if (!entry || entry.value === '') continue;
    if (TRUE.test(entry.value)) entry.flag = true;
    else if (FALSE.test(entry.value)) entry.flag = false;
    else {
      unreadable.add(flag.key);
      problems.push({ line: entry.line, message: `${flag.label} takes true or false, not "${entry.value}".` });
    }
  }

  lines.forEach((line, index) => {
    if (SECRET.test(line)) {
      warnings.push({ line: index + 1, message: 'This looks like a secret. Keep secrets in environment variables or a .env file, never in the form.' });
    }
  });

  const verbose = sections.get('pr context');
  const prContext = [fields.prContext?.value ?? '', (verbose?.body ?? []).join('\n').trim()].filter(Boolean).join('\n\n');
  const context = {
    command: fields.command?.value ?? '',
    model: fields.model?.value ?? '',
    effort: fields.effort?.value ?? '',
    root: fields.root?.value ?? '',
    name: fields.name?.value ?? '',
    prUrl: fields.prUrl?.value ?? '',
    localRepo: fields.localRepo?.value ?? '',
    prContext,
    flags: { ...emptyFlags(), ...Object.fromEntries(FLAGS.map((flag) => [flag.key, fields[flag.key]?.flag === true])) },
  };
  for (const flag of FLAGS) {
    const parent = flag.needs;
    if (!parent || !context.flags[flag.key] || context.flags[parent] || unreadable.has(parent)) continue;
    const parentLabel = FORM_FIELDS.find((field) => field.key === parent).label;
    problems.push({
      line: fields[flag.key].line,
      message: `${flag.label} is true, but ${parentLabel} is not. Turn ${parentLabel} on, or set ${flag.label} to false.`,
    });
  }

  return {
    state: problems.length > 0 ? 'invalid' : 'filled',
    fields,
    context,
    problems: problems.sort((a, b) => a.line - b.line),
    warnings: warnings.sort((a, b) => a.line - b.line),
  };
}

/** Reads and parses the form in `file`. */
export function readContext(file) {
  return { file, ...parseForm(readFileSync(file, 'utf8')) };
}

/** Reads and parses the form of a test folder, or null when it has none. */
export function readFormIn(dir) {
  const file = path.join(dir, CONTEXT_FILE);
  return existsSync(file) ? readContext(file) : null;
}

/**
 * The local clone a resolve step works in: the one the test's own form names,
 * else the one the check recorded, else the user's repos.localRepo setting.
 */
export function localRepoFor({ testFolder, config = {}, check = {} } = {}) {
  const form = testFolder ? readFormIn(testFolder) : null;
  return form?.context?.localRepo || check.source?.localRepo || config.repos?.localRepo || '';
}

/** The form a new test folder starts from. */
export function templateText(root = codeRoot) {
  return readFileSync(path.join(root, TEMPLATE_FILE), 'utf8');
}

/** What the machine can tell about a form: tests replace each of these. */
export function formProbe({ env = process.env, github = null } = {}) {
  const reader = github ?? createGitHub({ gh: ghRunner({ env }) });
  return {
    which: (command) => which(command, env),
    run: (file, args, options) => capture(file, args, options),
    effortLevels: (assistant, file) => effortLevels(assistant, { file }),
    resolveModel: (options) => resolveModel({ ...options, env }),
    readPr: (ref) => reader.viewPr(ref),
    gitRemotes: (dir) => {
      const inside = git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
      if (inside !== 'true') return null;
      const listed = git(dir, ['remote', '-v'], { allowFail: true }) ?? '';
      const urls = listed.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/)[1]).filter(Boolean);
      return [...new Set(urls)];
    },
  };
}

const flagLabel = (key) => FORM_FIELDS.find((field) => field.key === key).label;

function assistantRow(context, settings, probe, problems, line) {
  const command = context.command || settings.assistant;
  if (context.command && !ASSISTANTS.includes(context.command)) {
    problems.push({ line, message: `Command must be one of ${ASSISTANTS.join(', ')}, not "${context.command}".` });
    return { status: 'fail', detail: `${context.command} is not an assistant auto-check drives`, command };
  }
  const state = probe.assistant ? probe.assistant(command, probe) : assistantState(command, probe);
  const parts = [];
  if (!state.file) {
    problems.push({ line, message: `The ${command} command is not on PATH. Install it, or name another command.` });
    parts.push(`${command} is not on PATH`);
  } else if (state.signedIn === false) {
    problems.push({ line, message: `${command} is installed but not signed in. Sign in, then run this again.` });
    parts.push(`${command} ${state.version}, not signed in`);
  } else {
    parts.push(`${command} ${state.version}${state.signedIn ? ', signed in' : ''}`);
  }
  const wanted = context.model || settings.models?.[command]?.generate || '';
  const configured = context.model ? '' : ' (configured)';
  let model = wanted;
  if (wanted && state.file) {
    try {
      const resolution = probe.resolveModel({
        assistant: command,
        model: wanted,
        file: state.file,
        version: state.version ?? '',
        label: commandLabel(command, state.version),
      });
      model = resolution.model;
      parts.push(`model ${describeModel(resolution)}${configured}`);
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      problems.push({ line, message: error.message });
      parts.push(`model ${wanted} is not one ${command} accepts`);
    }
  } else {
    parts.push(`model ${wanted || 'the command default'}${wanted ? configured : ''}`);
  }
  const effort = context.effort || settings.models?.[command]?.effort || '';
  if (effort) {
    const levels = probe.effortLevels(command, state.file);
    if (levels.length > 0 && !levels.includes(effort.toLowerCase())) {
      problems.push({ line, message: `Thinking Effort for ${command} must be one of ${levels.join(', ')}, not "${effort}".` });
    }
    parts.push(`effort ${effort}`);
  } else {
    parts.push('effort the command default');
  }
  const failed = problems.some((problem) => problem.line === line);
  return { status: failed ? 'fail' : 'pass', detail: parts.join('; '), command, model, effort, label: wanted };
}

/**
 * Checks the form rule by rule. Returns one row per rule for the report, the
 * resolved values auto-check runs with, and a problem for every rule that
 * failed, each with the line it came from.
 */
export function validateForm(parsed, { folder = null, settings, probe = formProbe() } = {}) {
  const context = parsed.context;
  const fields = parsed.fields;
  const problems = [...parsed.problems];
  const rows = [];
  const lineOf = (key, fallback = 1) => fields[key]?.line ?? fallback;
  const add = (name, status, detail) => rows.push({ name, status, detail });

  const tool = assistantRow(context, settings, probe, problems, lineOf('command'));
  add('A.I. Tool', tool.status, tool.detail);

  const expected = folder ? path.basename(folder) : null;
  let nameOk = true;
  if (!context.name) {
    nameOk = false;
    problems.push({ line: lineOf('name'), message: 'Test folder name is required.' });
    add('Test folder', 'fail', 'no name is filled in');
  } else if (expected && context.name !== expected) {
    nameOk = false;
    problems.push({ line: lineOf('name'), message: `Test folder name is "${context.name}", but this folder is "${expected}". Make them match.` });
    add('Test folder', 'fail', `${context.name} is not this folder, ${expected}`);
  } else {
    add('Test folder', 'pass', `${context.name}${expected ? ' is the current folder' : ''}`);
  }

  let root = context.root || settings.root || '';
  if (!root) {
    problems.push({ line: lineOf('root'), message: 'No test folder root is set. Fill one in, or run auto-check config set root <folder>.' });
    add('Root', 'fail', 'not set here or in the settings');
  } else {
    root = path.resolve(root);
    if (!existsSync(root)) {
      problems.push({ line: lineOf('root'), message: `The test folder root ${root} does not exist.` });
      add('Root', 'fail', `${root} does not exist`);
    } else if (folder && nameOk && context.name && path.resolve(path.join(root, context.name)) !== path.resolve(folder)) {
      problems.push({ line: lineOf('root'), message: `${path.join(root, context.name)} is not this folder, ${folder}.` });
      add('Root', 'fail', `${root} does not hold this folder`);
    } else {
      add('Root', 'pass', `${root}${context.root ? '' : ', the configured root'}`);
    }
  }

  let pr = null;
  if (!context.prUrl) {
    problems.push({ line: lineOf('prUrl'), message: 'Merged PR URI is required: the pull request this test watches.' });
    add('Merged PR', 'fail', 'no pull request URL is filled in');
  } else {
    try {
      const ref = parsePrUrl(context.prUrl);
      const view = probe.readPr(ref);
      const merged = Boolean(view.mergedAt) || view.state === 'MERGED';
      const open = view.state === 'OPEN';
      pr = { ref, view, merged, open };
      const state = merged ? 'merged' : view.state.toLowerCase();
      add('Merged PR', 'pass', `${ref.owner}/${ref.repo}#${ref.number}, ${state}`);
      if (open && !context.localRepo) {
        problems.push({
          line: lineOf('prUrl'),
          message: 'The pull request is still open, so Local Repository is needed: an open branch is tested from a local clone.',
        });
        rows[rows.length - 1] = { name: 'Merged PR', status: 'fail', detail: `${ref.owner}/${ref.repo}#${ref.number}, open and no local repository` };
      }
    } catch (error) {
      const message = error instanceof PrError ? error.message : `the pull request could not be read: ${error.message}`;
      problems.push({ line: lineOf('prUrl'), message });
      add('Merged PR', 'fail', message);
    }
  }

  if (!context.localRepo) {
    add('Local repo', 'pass', 'none given');
  } else {
    const repo = path.resolve(context.localRepo);
    const remotes = existsSync(repo) ? probe.gitRemotes(repo) : null;
    if (!existsSync(repo)) {
      problems.push({ line: lineOf('localRepo'), message: `The local repository ${repo} was not found.` });
      add('Local repo', 'fail', `${repo} was not found`);
    } else if (!remotes) {
      problems.push({ line: lineOf('localRepo'), message: `${repo} is not a git work tree.` });
      add('Local repo', 'fail', `${repo} is not a git work tree`);
    } else {
      const wanted = pr ? `${pr.ref.owner}/${pr.ref.repo}` : null;
      const matches = wanted && remotes.some((url) => url.toLowerCase().includes(wanted.toLowerCase()));
      if (wanted && !matches) {
        parsed.warnings.push({
          line: lineOf('localRepo'),
          message: `None of the remotes of ${repo} is ${wanted}. auto-check only reads this clone, but check that it is the right one.`,
        });
      }
      add('Local repo', 'pass', `${repo}${matches ? `, a clone of ${wanted}` : ''}`);
    }
  }

  add('PR Context', 'pass', context.prContext ? 'provided; passed to the assistant' : 'none given');

  const flags = context.flags;
  add('Find Issue', '', String(flags.findIssue));
  add('Resolve Issue', '', String(flags.resolveIssue));
  const children = ['localCommit', 'remotePush', 'makePr'];
  if (!flags.commitSolution) {
    add('Commit Solution', '', 'false');
  } else {
    const described = children.map((key) => {
      const parent = FLAGS.find((flag) => flag.key === key).needs;
      const blocked = !flags[key] && !flags[parent];
      return `${flagLabel(key)} ${flags[key]}${blocked ? ` (${flagLabel(parent)} is false)` : ''}`;
    });
    add('Commit Solution', '', `true: ${described.join(', ')}`);
  }
  if (flags.commitSolution && !context.localRepo) {
    problems.push({
      line: lineOf('commitSolution'),
      message: 'Commit Solution needs Local Repository: there is no clone to make the branch in.',
    });
  }

  const resolved = {
    assistant: tool.command,
    model: tool.model,
    modelLabel: tool.label,
    effort: tool.effort,
    root,
    name: context.name,
    dir: folder ?? (root && context.name ? path.join(root, context.name) : null),
    prUrl: context.prUrl,
    pr,
    localRepo: context.localRepo ? path.resolve(context.localRepo) : '',
    prContext: context.prContext,
    flags,
  };
  const ordered = problems.sort((a, b) => a.line - b.line);
  return { ok: ordered.length === 0, rows, problems: ordered, warnings: parsed.warnings, resolved };
}

/** The validation report, one line per rule, names and statuses lined up. */
export function formatValidation(rows) {
  const width = Math.max(...rows.map((row) => row.name.length)) + 2;
  const detail = Math.max(...rows.map((row) => row.detail.length)) + 2;
  return `${rows
    .map((row) => (row.status ? `${row.name.padEnd(width)}${row.detail.padEnd(detail)}${row.status}` : `${row.name.padEnd(width)}${row.detail}`).trimEnd())
    .join('\n')}\n`;
}

/** The PR Context of a form as a Markdown section for assistant prompts. */
export function contextToMarkdown(context) {
  if (!context?.prContext) return '';
  return `## Context from context.md\n\n${context.prContext.trim()}\n`;
}
