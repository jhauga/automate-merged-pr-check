import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assistantFor } from './assistants/index.mjs';
import { CONTEXT_FILE, contextToMarkdown, readContext } from './context.mjs';
import {
  captureBaseline,
  installCheck,
  isSkeleton,
  motionProblems,
  simulateFailure,
  simulationProblems,
  validateCheck,
  writeInitialState,
} from './harness.mjs';
import { codeRoot } from './paths.mjs';
import { intake } from './pr.mjs';
import { renderPrompt } from './prompt.mjs';
import { prepareLocalWorktree, refreshManagedClone } from './repo.mjs';
import { KIT_IMPORT, installAssistantFiles, installKit } from './test-folder.mjs';

/** Raised when a check cannot be generated; carries the exit code to use. */
export class GenerateError extends Error {
  constructor(message, { exitCode = 2, problems = [] } = {}) {
    super(message);
    this.name = 'GenerateError';
    this.exitCode = exitCode;
    this.problems = problems;
  }
}

const SKELETON = ['run.mjs', 'README.md', 'package.json'];
const MAX_LISTED_FILES = 60;
const MAX_BODY = 6000;
const ASSISTANT_MINUTES = 90;
const slash = (value) => value.split(path.sep).join('/');
const lastLine = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';

const RUNGS = {
  'gui-canvas-extension': 'Rung 1 (something rendered in a browser or a webview), with both layers: the page on its own, and the subject inside its desktop host app.',
  'gui-web': 'Rung 1 (something rendered in a browser or a webview), with the page layer.',
  cli: 'Rung 2 (a command line or a library).',
  library: 'Rung 2 (a command line or a library).',
  'install-procedure': 'Rung 3 (an install or build procedure).',
  'reference-docs': 'Rung 4 (reference documentation).',
};

function compareFor(kind) {
  if (kind === 'documentation') return { strategy: 'text', threshold: 0, masks: [], minRunSeconds: 0 };
  return { strategy: 'auto', threshold: null, masks: [], minRunSeconds: 0 };
}

/** Folders a sparse clone needs, or null for a full checkout. Only a self-contained extension folder is sparse. */
export function sparsePathsFor(classification) {
  if (classification.kind !== 'source' || classification.subtype !== 'gui-canvas-extension') return null;
  const folders = classification.watchPaths.filter((entry) => entry.endsWith('/**')).map((entry) => entry.slice(0, -3));
  return folders.length === classification.watchPaths.length && folders.length > 0 ? folders : null;
}

/** The check.config.json auto-check writes before the assistant starts. */
export function plannedConfig(info, { config, context = null, local = null, assistantName = null, model = null, effort = null }) {
  const { classification } = info;
  const gui = ['gui-canvas-extension', 'gui-web'].includes(classification.subtype);
  const focus = classification.watchPaths[0] ?? '.';
  const upstreamUrl = `https://${info.host}/${info.owner}/${info.repo}.git`;
  return {
    slug: info.slug,
    alias: classification.alias,
    pr: {
      url: info.url,
      owner: info.owner,
      repo: info.repo,
      number: info.number,
      title: info.title,
      state: info.state,
      merged: info.merged,
      status: info.status,
      landedBy: info.landedBy,
      landedSha: info.landedSha,
      landedAt: info.landedAt,
      base: info.base,
      head: info.head,
      files: info.files,
      closingIssues: info.closingIssues,
    },
    classification: {
      kind: classification.kind,
      subtype: classification.subtype,
      parts: classification.parts,
      watchPaths: classification.watchPaths,
      reasons: classification.reasons,
    },
    source: local
      ? { mode: 'local', upstreamUrl, baseRef: info.base, localRepo: local.repo, branch: local.branch, clonePath: 'worktree', sparsePaths: null }
      : { mode: 'upstream', upstreamUrl, baseRef: info.base, localRepo: null, branch: null, clonePath: 'repo', sparsePaths: sparsePathsFor(classification) },
    subject: {
      type: classification.subtype,
      path: focus.endsWith('/**') ? focus.slice(0, -3) : focus,
      installedPath: null,
      hostApp: null,
    },
    layers: {
      page: { enabled: true, driver: gui ? 'headless-browser' : 'process' },
      hostApp: { enabled: classification.subtype === 'gui-canvas-extension', driver: 'pending' },
    },
    runMode: 'single',
    timeoutMinutes: classification.parts.some((part) => part.subtype === 'install-procedure') ? 30 : 15,
    compare: compareFor(classification.kind),
    context: context?.prContext ? { prContext: context.prContext } : null,
    assistant: {
      command: assistantName ?? config.assistant,
      model: model || config.models[assistantName ?? config.assistant]?.generate || '',
      effort: effort || config.models[assistantName ?? config.assistant]?.effort || '',
    },
    models: { testDriver: config.models[assistantName ?? config.assistant]?.testDriver || null },
    schedule: 'inherit',
    notify: 'inherit',
  };
}

function stateLine(info) {
  const short = (sha) => (sha ? sha.slice(0, 7) : 'unknown');
  return {
    merged: `merged as ${short(info.landedSha)}`,
    landed: `closed, but landed on the base branch by a ${info.landedBy} as ${short(info.landedSha)}`,
    open: 'open, not merged yet',
    closed: 'closed without landing',
  }[info.status];
}

/** A Markdown fence longer than any run of backticks in `text`. */
export function fenceFor(text) {
  const longest = Math.max(0, ...[...String(text).matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function rungFor(classification) {
  const lines = [...new Set(classification.parts.map((part) => RUNGS[part.subtype]).filter(Boolean))];
  const kind = classification.parts.map((part) => `\`${part.kind} / ${part.subtype}\``).join(' plus ');
  return `This pull request is ${kind}, so start at ${lines.join(' Its other part takes ')}`;
}

/** Values for prompts/generate-check.md. */
export function promptValues(info, { checkDir, sourceDir, planned, context, local }) {
  const listed = info.files.slice(0, MAX_LISTED_FILES).map((file) => `  - \`${file}\``);
  if (info.files.length > MAX_LISTED_FILES) listed.push(`  - and ${info.files.length - MAX_LISTED_FILES} more`);
  const body = info.body.length > MAX_BODY ? `${info.body.slice(0, MAX_BODY)}\n\n(The description continues on the pull request page.)` : info.body;
  return {
    pr: {
      url: info.url,
      title: info.title,
      base: info.base,
      stateLine: stateLine(info),
      fileList: listed,
      body: body.trim(),
      fence: fenceFor(body),
    },
    kind: {
      line: info.classification.parts.map((part) => `${part.kind} / ${part.subtype}`).join(' + '),
      watch: info.classification.watchPaths.join(', '),
      reasons: info.classification.reasons.join('; '),
    },
    rung: rungFor(info.classification),
    alias: planned.alias,
    context: context ? contextToMarkdown(context).trim() : '',
    checkDir,
    toolRoot: codeRoot,
    sourceDir,
    tryDir: path.join(checkDir, 'results', 'generate-try'),
    kitImport: KIT_IMPORT,
    sandboxTemplate: path.join(codeRoot, 'templates', 'check', 'sandbox.wsb'),
    sparse: (planned.source.sparsePaths ?? []).map((folder) => `\`${folder}\``).join(', '),
    hostApp: Boolean(planned.layers.hostApp.enabled),
    local: Boolean(local),
    localRepo: local?.repo ?? '',
    branch: local?.branch ?? '',
    testDriver: planned.models.testDriver ?? 'the lowest-cost model your assistant offers',
  };
}

/** Prepares the code under test: a managed clone at the base tip, or a rebased worktree of an unmerged branch. */
export function prepareSource({ checkDir, planned, local }) {
  if (local) {
    const prepared = prepareLocalWorktree({
      localRepo: local.repo,
      branch: local.branch,
      headRef: local.headRef,
      baseRef: planned.source.baseRef,
      upstreamRemote: local.upstreamRemote,
      originRemote: local.originRemote,
      worktreeDir: path.join(checkDir, 'worktree'),
    });
    if (prepared.conflict) {
      throw new GenerateError(`The branch no longer applies to ${planned.source.baseRef}: rebasing it conflicts. Update the pull request first.`, { exitCode: 1 });
    }
    return { dir: prepared.worktreeDir, sha: prepared.sha };
  }
  const clone = refreshManagedClone({
    dir: path.join(checkDir, 'repo'),
    url: planned.source.upstreamUrl,
    baseRef: planned.source.baseRef,
    sparse: planned.source.sparsePaths,
  });
  return { dir: clone.dir, sha: clone.sha };
}

function copySkeleton(checkDir) {
  for (const file of SKELETON) {
    const target = path.join(checkDir, file);
    if (existsSync(target) && !isSkeleton(target)) continue;
    copyFileSync(path.join(codeRoot, 'templates', 'check', file), target);
  }
}

/**
 * Generates a check for a pull request: reads it and context.md, writes the
 * planned check.config.json and the prompt, and unless `dryRun` prepares the
 * code under test, has the assistant write the check, and validates it: the
 * static rules, a run under --simulate-fail black that must exit 1, and,
 * unless `noBaseline`, a baseline run whose motion pairs must move. Problems
 * with any of these get one repair round. Every step that reaches outside can
 * be replaced through `deps`.
 */
export async function generateCheck({
  url,
  testFolder,
  config,
  dryRun = false,
  assistantName = null,
  model = null,
  effort: askedEffort = null,
  noBaseline = false,
  local = null,
  log = () => {},
  deps = {},
}) {
  const {
    readPr = (prUrl) => intake(prUrl),
    readForm = (file) => (existsSync(file) ? readContext(file) : null),
    prepare = prepareSource,
    assistant = (name) => assistantFor(config, { name: name ?? config.assistant }),
    install = installCheck,
    simulate = simulateFailure,
    baseline = captureBaseline,
  } = deps;

  const workRoot = testFolder;
  const form = readForm(path.join(testFolder, CONTEXT_FILE));
  if (form?.state === 'invalid') {
    throw new GenerateError('context.md has problems. Run auto-check context validate and fix them first.', {
      problems: form.problems.map((problem) => `context.md:${problem.line}: ${problem.message}`),
    });
  }
  const context = form?.context ?? null;
  const command = assistantName ?? (context?.command || null);
  const wantedModel = model ?? (context?.model || null);
  const effort = askedEffort ?? (context?.effort || null);
  const info = readPr(url);
  log(`Pull request: ${info.owner}/${info.repo}#${info.number}, ${info.classification.kind} / ${info.classification.subtype}`);
  if (!local && context?.localRepo) {
    local = {
      repo: path.resolve(context.localRepo),
      branch: null,
      upstreamRemote: config.repos.upstreamRemote,
      originRemote: config.repos.originRemote,
    };
  }
  let localSource = null;
  if (local && info.merged) {
    log(`The pull request is already ${info.status}, so the check tests ${info.base} at its tip instead of the local branch.`);
  } else if (local) {
    localSource = { ...local, branch: local.branch ?? info.head.ref, headRef: info.head.ref };
  }

  const checkDir = testFolder;
  const runFile = path.join(checkDir, 'run.mjs');
  if (existsSync(runFile) && !isSkeleton(runFile)) {
    throw new GenerateError(`${checkDir} already holds a check. Delete its check files to generate it again.`);
  }
  mkdirSync(checkDir, { recursive: true });
  const planned = plannedConfig(info, { config, context, local: localSource, assistantName: command, model: wantedModel, effort });
  const configFile = path.join(checkDir, 'check.config.json');
  writeFileSync(configFile, `${JSON.stringify(planned, null, 2)}\n`);
  const sourceDir = path.join(checkDir, planned.source.clonePath);
  const values = promptValues(info, { checkDir, sourceDir, planned, context, local: localSource });
  const promptFile = path.join(checkDir, 'generate.prompt.md');
  writeFileSync(promptFile, renderPrompt('generate-check', values));
  const runner = assistant(command);
  const request = {
    cwd: workRoot,
    role: 'generate',
    model: wantedModel ?? undefined,
    effort: effort ?? undefined,
    addDirs: [checkDir],
    timeoutMs: ASSISTANT_MINUTES * 60 * 1000,
  };
  if (dryRun) {
    const plan = runner.plan?.({ ...request, promptFile });
    return {
      dryRun: true,
      slug: info.slug,
      checkDir,
      promptFile,
      configFile,
      assistant: runner.label,
      command: plan ? [runner.command, ...plan.args] : null,
      promptOnStdin: plan ? plan.input !== undefined : null,
    };
  }

  if (!runner.available()) throw new GenerateError(`${runner.label} is not available on this machine. Run auto-check doctor.`);
  copySkeleton(checkDir);
  installKit(checkDir);
  installAssistantFiles(checkDir, { assistant: command ?? config.assistant, config });
  writeInitialState(checkDir);
  log(planned.source.mode === 'local' ? `Preparing a worktree of ${localSource.branch} rebased onto ${planned.source.baseRef}` : `Preparing ${planned.source.baseRef} at its tip`);
  const source = prepare({ checkDir, planned, local: localSource });
  log(`Code under test: ${source.sha.slice(0, 7)}`);

  const ask = async (file, output) => {
    const answer = await runner.run({ ...request, promptFile: file, outputFile: path.join(checkDir, `${output}.output.md`) });
    if (answer.stderr?.trim()) writeFileSync(path.join(checkDir, `${output}.stderr.txt`), answer.stderr);
    if (answer.timedOut) throw new GenerateError(`${runner.label} did not finish within ${ASSISTANT_MINUTES} minutes.`);
    if (answer.exitCode !== 0) {
      const reason = lastLine(answer.stdout) || lastLine(answer.stderr) || 'no output';
      const saved = answer.outputPath && existsSync(answer.outputPath) ? ` Its full output is in ${slash(path.relative(workRoot, answer.outputPath))}.` : '';
      throw new GenerateError(`${runner.label} stopped with exit code ${answer.exitCode}: ${reason}${saved}`);
    }
    return answer;
  };
  const timeoutOf = () => {
    try {
      return Number(JSON.parse(readFileSync(configFile, 'utf8')).timeoutMinutes) || planned.timeoutMinutes;
    } catch {
      return planned.timeoutMinutes;
    }
  };
  const examine = async () => {
    const problems = validateCheck(checkDir, { planned });
    if (problems.length > 0) return problems;
    log('Installing the check\'s dependencies');
    await install(checkDir);
    log('Running the check with black captures, which must fail');
    return simulationProblems(await simulate(checkDir, { sourceDir: source.dir, timeoutMinutes: timeoutOf() }));
  };

  const accept = async () => {
    const problems = await examine();
    if (problems.length > 0) return { problems, captured: null };
    writeInitialState(checkDir);
    if (noBaseline) return { problems, captured: null };
    log('Capturing the baseline');
    const captured = await baseline(checkDir, { sourceDir: source.dir, timeoutMinutes: timeoutOf() });
    return { problems: motionProblems(checkDir, captured), captured };
  };

  log(`Asking ${runner.label} to write the check`);
  await ask(promptFile, 'generate');
  let { problems, captured } = await accept();
  let repaired = false;
  if (problems.length > 0) {
    log(`The check breaks ${problems.length} contract rule(s); asking for one repair`);
    const repairFile = path.join(checkDir, 'repair.prompt.md');
    writeFileSync(repairFile, renderPrompt('repair-check', { ...values, problems: problems.map((problem) => `- ${problem}`) }));
    await ask(repairFile, 'repair');
    repaired = true;
    ({ problems, captured } = await accept());
  }
  if (problems.length > 0) throw new GenerateError('The generated check still does not meet the contract.', { problems });
  return { dryRun: false, slug: info.slug, checkDir, promptFile, configFile, repaired, sourceSha: source.sha, assistant: runner.label, baseline: captured };
}
