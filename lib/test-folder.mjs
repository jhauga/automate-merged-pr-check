import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { MARKER_FILE, codeRoot } from './paths.mjs';

/** The folder a test folder keeps its copy of the check kit in. */
export const KIT_DIR = '.auto-check';

/** How a generated run.mjs imports the check kit. */
export const KIT_IMPORT = `./${KIT_DIR}/check-kit.mjs`;

/** Files `auto-check --name <folder>` writes, before any check exists. */
export const SCAFFOLD_FILES = Object.freeze([MARKER_FILE, '.gitignore']);

/** Folder of the skills auto-check copies into each test folder. */
export const TOOL_SKILLS_DIR = path.join(codeRoot, 'skills');

/** Folder-name prefix of auto-check's own skills. */
export const TOOL_SKILL_PREFIX = 'auto-check-';

const TEMPLATE_DIR = path.join(codeRoot, 'templates', 'test-folder');
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Raised for a test folder, a root folder, or a name that cannot be used. */
export class TestFolderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TestFolderError';
    this.exitCode = 4;
  }
}

/** Raised when the folder that should hold the test folders is missing. */
export class RootFolderError extends TestFolderError {
  constructor(message) {
    super(message);
    this.name = 'RootFolderError';
  }
}

/** Names of auto-check's own skills, sorted. */
export function toolSkills(dir = TOOL_SKILLS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(TOOL_SKILL_PREFIX))
    .map((entry) => entry.name)
    .sort();
}

/** Checks a test folder name: one folder name, usable on this platform. */
export function validateFolderName(name) {
  const value = String(name ?? '').trim();
  if (!value) throw new TestFolderError('A test folder name cannot be empty.');
  if (value === '.' || value === '..') throw new TestFolderError(`"${value}" is not a folder name. Give the name of the folder to create.`);
  if (/[/\\]/.test(value)) throw new TestFolderError(`"${value}" is a path, not a name. --name takes one folder name; the root comes from --root or the settings.`);
  if (/[<>:"|?*]/.test(value) || /[\u0000-\u001f]/.test(value)) {
    throw new TestFolderError(`"${value}" holds a character a folder name cannot contain.`);
  }
  if (RESERVED.test(value)) throw new TestFolderError(`"${value}" is a name Windows reserves for a device.`);
  if (/[. ]$/.test(value)) throw new TestFolderError(`"${value}" cannot end in a space or a dot.`);
  return value;
}

/** The test folder name auto-check suggests for a pull request. */
export function suggestedName(alias) {
  const slug = String(alias ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `automate-pr-${slug || 'check'}`;
}

/** What `dir` holds beyond the scaffold: the entries that are neither missing nor part of it. */
export function beyondScaffold(dir) {
  if (!existsSync(dir)) return [];
  const allowed = new Set([...SCAFFOLD_FILES, '.git']);
  return readdirSync(dir).filter((entry) => !allowed.has(entry)).sort();
}

/** True when `dir` does not exist, is empty, or holds only the scaffold. */
export function isFreeForTest(dir) {
  return beyondScaffold(dir).length === 0;
}

/**
 * Writes `values` into the form, each before the comment that explains its
 * field, replacing whatever that field held. A label the form does not have
 * is ignored, so filling the same form twice reads the same as filling it once.
 */
export function prefillContext(text, values = {}) {
  let filled = text;
  for (const [label, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^(\\s*[-*]\\s+\\*{0,2}${escaped}\\*{0,2}:)(.*)$`, 'm');
    if (!pattern.test(filled)) continue;
    filled = filled.replace(pattern, (whole, head, rest) => {
      const comment = rest.indexOf('<!--');
      const tail = comment === -1 ? '' : rest.slice(comment).trim();
      return `${head} ${value}${tail ? ` ${tail}` : ''}`;
    });
  }
  return filled;
}

/** The form a new test folder starts with, prefilled with what auto-check already knows. */
export function newContext(prefill = {}, { template = path.join(codeRoot, 'templates', 'context.md') } = {}) {
  return prefillContext(readFileSync(template, 'utf8'), prefill);
}

/**
 * Creates `<root>/<name>` and writes the scaffold: the prefilled form and the
 * .gitignore for run-time data. An existing form is left as it is. Returns the
 * folder and the files it wrote.
 */
export function createTestFolder({ root, name, prefill = {}, template }) {
  const folder = validateFolderName(name);
  if (!existsSync(root)) {
    throw new RootFolderError(`The test folder root ${root} does not exist. Create it, or pick another with --root or auto-check config set root.`);
  }
  const dir = path.join(root, folder);
  const extra = beyondScaffold(dir);
  if (extra.length > 0) {
    throw new TestFolderError(`${dir} already holds ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ', and more' : ''}. Pick another name with --name.`);
  }
  mkdirSync(dir, { recursive: true });
  const written = [];
  const form = path.join(dir, MARKER_FILE);
  if (!existsSync(form)) {
    writeFileSync(form, newContext(prefill, template ? { template } : {}));
    written.push(MARKER_FILE);
  }
  const ignore = path.join(dir, '.gitignore');
  if (!existsSync(ignore)) {
    copyFileSync(path.join(TEMPLATE_DIR, 'gitignore'), ignore);
    written.push('.gitignore');
  }
  return { dir, written, name: folder };
}

/**
 * Copies the check kit into the test folder, stamped with the version that
 * wrote it. Every generate and every run refreshes it.
 */
export function installKit(dir, { version = packageVersion() } = {}) {
  const target = path.join(dir, KIT_DIR, 'check-kit.mjs');
  mkdirSync(path.dirname(target), { recursive: true });
  const kit = readFileSync(path.join(codeRoot, 'lib', 'check-kit.mjs'), 'utf8');
  const stamp = `// auto-check ${version} check kit. auto-check refreshes this copy on every`
    + ' run, so edits here are lost. The check imports it as ' + KIT_IMPORT + '.\n';
  writeFileSync(target, `${stamp}${kit}`);
  return target;
}

/** The version of the installed tool. */
export function packageVersion() {
  return JSON.parse(readFileSync(path.join(codeRoot, 'package.json'), 'utf8')).version;
}

/**
 * Writes the files an assistant started in the test folder reads: the
 * instructions, and auto-check's skills in the skills folder of `assistant`.
 * Skills the tool no longer ships are removed; other skills are left alone.
 */
export function installAssistantFiles(dir, { assistant = 'claude', config = null, skillsDir = TOOL_SKILLS_DIR } = {}) {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) copyFileSync(path.join(TEMPLATE_DIR, file), path.join(dir, file));
  const relative = config?.assistants?.[assistant]?.skills ?? '.claude/skills';
  const target = path.join(dir, ...relative.split('/'));
  mkdirSync(target, { recursive: true });
  const skills = toolSkills(skillsDir);
  for (const name of readdirSync(target, { withFileTypes: true })) {
    if (name.isDirectory() && name.name.startsWith(TOOL_SKILL_PREFIX) && !skills.includes(name.name)) {
      rmSync(path.join(target, name.name), { recursive: true, force: true });
    }
  }
  for (const name of skills) {
    rmSync(path.join(target, name), { recursive: true, force: true });
    mkdirSync(path.join(target, name), { recursive: true });
    copyTree(path.join(skillsDir, name), path.join(target, name));
  }
  return { instructions: ['AGENTS.md', 'CLAUDE.md'], skillsFolder: relative, skills };
}

function copyTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else if (entry.isFile()) {
      copyFileSync(source, target);
    }
  }
}

/**
 * The test folder a command works in: the folder given on the command line,
 * which may be a path or the name of a test folder under the root, and the
 * current folder when nothing is given.
 */
export function resolveTestFolder({ folder, cwd, root = '' }) {
  if (!folder) return path.resolve(cwd);
  if (path.isAbsolute(folder) || /[/\\]/.test(folder) || folder === '.' || folder === '..') return path.resolve(cwd, folder);
  const underRoot = root ? path.join(root, folder) : null;
  if (underRoot && existsSync(path.join(underRoot, MARKER_FILE))) return underRoot;
  const underCwd = path.resolve(cwd, folder);
  if (existsSync(path.join(underCwd, MARKER_FILE))) return underCwd;
  return underRoot ?? underCwd;
}

/** Asks one question on the terminal and returns the answer, trimmed. */
export function askLine({ io, question, suggestion = null }) {
  const lines = Array.isArray(question) ? question : [question];
  io.stdout.write(`${lines.join('\n')}${suggestion ? ` [${suggestion}]` : ''}\n> `);
  return new Promise((resolve) => {
    const rl = createInterface({ input: io.stdin });
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      rl.close();
      resolve(value.trim());
    };
    rl.once('line', finish);
    rl.once('close', () => finish(''));
  });
}

/** True when questions can be asked: the input is a terminal. */
export function interactive(io) {
  return Boolean(io?.stdin?.isTTY);
}

/**
 * The folder that holds the test folders: --root, then the form's Test folder
 * root, then the `root` setting. With none of those it asks, on a terminal,
 * and saves the answer. The folder must exist.
 */
export async function resolveRoot({
  cliRoot = null,
  formRoot = null,
  settingsRoot = '',
  cwd,
  io,
  save = null,
}) {
  const given = cliRoot ?? formRoot ?? (settingsRoot || null);
  let root = given ? path.resolve(cwd, given) : null;
  let saved = false;
  if (!root) {
    if (!interactive(io)) {
      throw new TestFolderError(
        'No root folder is configured to hold the test folders. Run auto-check config set root <folder>, or pass --root <folder>.',
      );
    }
    const answer = await askLine({
      io,
      question: [
        'No root folder is configured to hold the test folders.',
        'Enter the folder where test folders should be created. To use the current folder, enter ".".',
      ],
    });
    if (!answer) throw new TestFolderError('No folder was entered, so there is nowhere to create the test folder.');
    root = path.resolve(cwd, answer);
    if (save) {
      await save(root);
      saved = true;
    }
  }
  if (!existsSync(root)) {
    throw new RootFolderError(`The test folder root ${root} does not exist. Create it, or pick another with --root or auto-check config set root.`);
  }
  return { root, saved };
}

/**
 * The name of the test folder to create: --name, or the suggestion, asked for
 * on a terminal and accepted without asking with --yes.
 */
export async function resolveName({ cliName = null, suggestion, io, yes = false }) {
  if (cliName) return validateFolderName(cliName);
  if (yes || !interactive(io)) {
    if (!yes) {
      throw new TestFolderError(`No -n, --name was given. Add --name <folder>, or --yes to take the suggestion ${suggestion}.`);
    }
    return validateFolderName(suggestion);
  }
  const answer = await askLine({
    io,
    question: 'No -n, --name was given. What should the test folder be called?',
    suggestion,
  });
  return validateFolderName(answer || suggestion);
}
