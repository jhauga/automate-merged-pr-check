import path from 'node:path';

const DOC_EXT = /\.(md|mdx|markdown|rst|txt|adoc|asciidoc)$/i;
const DOC_NAMES = /^(readme|changelog|changes|history|license|copying|authors|contributing|code_of_conduct|security|notice)(\..*)?$/i;
const DOC_FOLDERS = new Set(['docs', 'doc', 'documentation']);
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|gemfile\.lock|composer\.lock|go\.sum)$/i;
const INSTALL_GUIDE = /^(install|installation|installing|build|building|setup|getting[-_ ]?started|quick[-_ ]?start|compil)/i;
const WEB_FILES = /\.(html?|css|scss|sass|less|vue|svelte|jsx|tsx)$/i;
const CLI_FOLDERS = new Set(['bin', 'cli', 'cmd']);
const CLI_FILES = new Set(['__main__.py', 'main.go', 'main.rs']);
const GENERIC_FOLDERS = new Set([
  'src', 'lib', 'docs', 'doc', 'documentation', 'test', 'tests', 'app', 'apps', 'packages', 'extensions',
  'plugins', 'scripts', 'bin', 'cmd', 'internal', 'pkg', 'source', 'sources', 'examples',
]);
const SHELL_LANGUAGES = new Set([
  '', 'sh', 'bash', 'shell', 'console', 'shellsession', 'zsh', 'bat', 'batch', 'cmd', 'dos', 'powershell', 'ps',
  'ps1', 'pwsh', 'text', 'none',
]);
const INSTALL_WORDS = /\b(install|configure|make|cmake|ninja|build|setup|compile)\b/i;
const INSTALL_COMMAND = /^\s*(?:\$\s+|>\s+)?(?:sudo\s+)?(?:npm|pnpm|yarn|pip3?|apt(?:-get)?|brew|winget|choco|scoop|cargo|go|mvn|gradle|meson|dnf|yum|pacman|curl|wget|tar|\.\/configure|sh\s+configure|make|cmake|ninja)\b/i;

/** Share of the changed files a folder must hold to stand in for all of them. */
export const FOCUS_SHARE = 0.8;

const parts = (file) => file.split('/');
const changed = (file) => (file.additions ?? 0) + (file.deletions ?? 0);
const sum = (files) => files.reduce((total, file) => total + changed(file), 0);
const clean = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Documentation by extension, by a well-known name, or by sitting under a docs folder. */
export function isDocPath(file) {
  const name = path.posix.basename(file);
  return DOC_EXT.test(name) || DOC_NAMES.test(name) || parts(file).slice(0, -1).some((part) => DOC_FOLDERS.has(part.toLowerCase()));
}

/** Lock files, root dotfiles, and root .github metadata, which travel with most changes. */
export function isIncidental(file) {
  const segments = parts(file);
  if (LOCKFILE.test(file)) return true;
  if (segments.length === 1 && file.startsWith('.')) return true;
  return segments[0] === '.github' || segments[0] === '.gitlab';
}

/** Lines each file gains in a unified diff, keyed by the file's new path. */
export function addedLinesByFile(diff) {
  const files = new Map();
  let current = null;
  for (const line of String(diff ?? '').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (current) files.set(current, []);
    } else if (current && line.startsWith('+')) {
      files.get(current).push(line.slice(1));
    }
  }
  return files;
}

/**
 * Whether added documentation lines hold install or build steps: a fenced
 * shell block with install, configure, build, or package-manager commands, or
 * at least two such command lines outside a fence.
 */
export function hasInstallSteps(lines) {
  let fence = null;
  let block = [];
  let commands = 0;
  const installBlock = () => SHELL_LANGUAGES.has(fence) && block.some((line) => INSTALL_WORDS.test(line) || INSTALL_COMMAND.test(line));
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})\s*([\w+.-]*)/.exec(line);
    if (marker) {
      if (fence === null) {
        fence = marker[2].toLowerCase();
        block = [];
      } else {
        if (installBlock()) return true;
        fence = null;
      }
    } else if (fence !== null) {
      block.push(line);
    } else if (INSTALL_COMMAND.test(line)) {
      commands += 1;
    }
  }
  return (fence !== null && installBlock()) || commands >= 2;
}

function commonFolder(files) {
  const folders = files.map((file) => parts(file).slice(0, -1));
  let depth = 0;
  while (depth < folders[0].length && folders.every((folder) => folder[depth] === folders[0][depth])) depth += 1;
  return depth > 0 ? folders[0].slice(0, depth).join('/') : null;
}

/**
 * Where the pull request's changes sit: the file itself when there is one,
 * the deepest folder that holds every file, or else the deepest folder that
 * holds at least FOCUS_SHARE of them. Returns null when nothing qualifies.
 */
export function focusOf(files) {
  if (files.length === 0) return null;
  if (files.length === 1) return { path: files[0], isFile: true };
  const common = commonFolder(files);
  if (common) return { path: common, isFile: false };
  const counts = new Map();
  for (const file of files) {
    const segments = parts(file);
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  let best = null;
  for (const [folder, count] of counts) {
    if (count / files.length < FOCUS_SHARE) continue;
    if (!best || parts(folder).length > parts(best).length) best = folder;
  }
  return best ? { path: best, isFile: false } : null;
}

function watchPathsFor(focus, files) {
  if (focus) return [focus.isFile ? focus.path : `${focus.path}/**`];
  return [...new Set(files.map((file) => (parts(file).length > 1 ? `${parts(file)[0]}/**` : file)))].sort();
}

/**
 * Short name for branches and file names: the focus folder's name, or the
 * repository name joined with the focus file's stem or a generic folder name.
 */
export function aliasFor(focus, repo) {
  if (!focus) return clean(repo);
  const name = path.posix.basename(focus.path);
  if (focus.isFile) return clean(`${repo}-${name.replace(/\.[^.]+$/, '')}`);
  return GENERIC_FOLDERS.has(name.toLowerCase()) ? clean(`${repo}-${name}`) : clean(name);
}

function sourceSubtype(sourceFiles, allFiles) {
  const names = allFiles.map((file) => path.posix.basename(file).toLowerCase());
  if (names.includes('copilot-extension.json')) return ['gui-canvas-extension', 'copilot-extension.json is among the changed files'];
  if (names.includes('extension.mjs') && names.includes('index.html')) {
    return ['gui-canvas-extension', 'extension.mjs and index.html are among the changed files'];
  }
  const page = sourceFiles.find((file) => WEB_FILES.test(file));
  if (page) return ['gui-web', `${page} renders in a browser`];
  const entry = sourceFiles.find((file) => parts(file).slice(0, -1).some((part) => CLI_FOLDERS.has(part.toLowerCase()))
    || CLI_FILES.has(path.posix.basename(file).toLowerCase()));
  if (entry) return ['cli', `${entry} is a command-line entry point`];
  return ['library', 'no page, extension, or command-line entry point among the changed files'];
}

function docsSubtype(docFiles, addedLines) {
  const guide = docFiles.find((file) => INSTALL_GUIDE.test(path.posix.basename(file)));
  if (guide) return ['install-procedure', `${guide} is an install or build guide`];
  const steps = docFiles.find((file) => hasInstallSteps(addedLines?.get(file) ?? []));
  if (steps) return ['install-procedure', `${steps} adds install or build commands`];
  return ['reference-docs', 'the documentation holds no install or build steps'];
}

/**
 * Classifies a pull request from its changed files, each { path, additions,
 * deletions }. `addedLines`, from addedLinesByFile, sharpens the documentation
 * subtype. Returns kind (source, documentation, or mixed), subtype, parts,
 * watchPaths, alias, and the reasons behind each choice.
 */
export function classify({ files, repo, addedLines = null }) {
  const substantive = files.filter((file) => !isIncidental(file.path));
  const pool = substantive.length > 0 ? substantive : files;
  const docs = pool.filter((file) => isDocPath(file.path));
  const source = pool.filter((file) => !isDocPath(file.path));
  const docLines = sum(docs);
  const sourceLines = sum(source);
  const total = docLines + sourceLines;

  let kind;
  if (source.length === 0) kind = 'documentation';
  else if (docs.length === 0) kind = 'source';
  else if (docLines >= 20 && docLines >= 0.25 * total && sourceLines >= 0.25 * total) kind = 'mixed';
  else kind = sourceLines >= docLines ? 'source' : 'documentation';

  const reasons = [];
  const result = [];
  if (kind !== 'documentation') {
    const [subtype, why] = sourceSubtype(source.map((file) => file.path), files.map((file) => file.path));
    result.push({ kind: 'source', subtype, files: source.length });
    reasons.push(why);
  }
  if (kind !== 'source') {
    const [subtype, why] = docsSubtype(docs.map((file) => file.path), addedLines);
    result.push({ kind: 'documentation', subtype, files: docs.length });
    reasons.push(why);
  }
  const focusPool = kind === 'source' ? source : kind === 'documentation' ? docs : pool;
  const focus = focusOf(focusPool.map((file) => file.path));
  return {
    kind,
    subtype: result[0].subtype,
    parts: result,
    watchPaths: watchPathsFor(focus, focusPool.map((file) => file.path)),
    alias: aliasFor(focus, repo),
    reasons,
  };
}
