import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LAYERS, readImage } from './check-kit.mjs';
import { MOTION_THRESHOLD, checkMotion } from './compare/liveness.mjs';
import { percent } from './compare/shared.mjs';
import { fileTimestamp } from './util/date.mjs';
import { KIT_IMPORT } from './test-folder.mjs';
import { runProcess } from './util/process.mjs';
import { resolveCommand } from './util/which.mjs';

/** Files every generated check must have. */
export const REQUIRED_FILES = Object.freeze(['check.config.json', 'run.mjs', 'README.md', 'package.json']);

/** Text the shipped skeletons carry until the assistant replaces them. */
export const SKELETON_MARK = 'auto-check: skeleton';

const REQUIRED_SETTINGS = ['slug', 'alias', 'pr', 'classification', 'source', 'subject', 'layers', 'runMode', 'timeoutMinutes', 'compare', 'models'];
const DRIVERS = ['headless-browser', 'process', 'cdp', 'cli', 'desktop-automation', 'manual', 'pending'];
const STRATEGIES = ['pixel', 'color-sample', 'liveness', 'text', 'composite'];
const PROTECTED = [
  ['slug', (config) => config.slug],
  ['pr.url', (config) => config.pr?.url],
  ['source.mode', (config) => config.source?.mode],
  ['source.upstreamUrl', (config) => config.source?.upstreamUrl],
  ['source.baseRef', (config) => config.source?.baseRef],
  ['source.clonePath', (config) => config.source?.clonePath],
];

const read = (file) => readFileSync(file, 'utf8');
const isPairList = (value) => Array.isArray(value)
  && value.every((pair) => Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1] && pair.every((name) => typeof name === 'string' && name !== ''));

/** True when `file` is still one of the shipped skeletons. */
export function isSkeleton(file) {
  return existsSync(file) && read(file).includes(SKELETON_MARK);
}

function configProblems(config, planned) {
  const problems = [];
  for (const key of REQUIRED_SETTINGS) {
    if (config[key] === undefined) problems.push(`check.config.json has no "${key}".`);
  }
  if (planned) {
    for (const [name, get] of PROTECTED) {
      if (get(config) !== get(planned)) {
        problems.push(`check.config.json changed ${name} from ${JSON.stringify(get(planned))}; the check must test the base branch auto-check planned.`);
      }
    }
  }
  const layers = config.layers ?? {};
  if (!LAYERS.some((layer) => layers[layer]?.enabled)) problems.push('check.config.json enables no layer.');
  for (const layer of LAYERS) {
    const entry = layers[layer];
    if (!entry) continue;
    if (!DRIVERS.includes(entry.driver)) problems.push(`layers.${layer}.driver must be one of ${DRIVERS.join(', ')}.`);
    if (entry.enabled && entry.driver === 'pending') {
      problems.push(`layers.${layer} is enabled, but its driver is still "pending". Set the driver that works, use "manual", or disable the layer.`);
    }
  }
  if (!['single', 'two-step'].includes(config.runMode)) problems.push('runMode must be "single" or "two-step".');
  if (!(Number(config.timeoutMinutes) > 0)) problems.push('timeoutMinutes must be a positive number.');
  const strategy = config.compare?.strategy;
  if (strategy === 'auto') problems.push('compare.strategy is still "auto". Choose the strategy the check needs.');
  else if (!STRATEGIES.includes(strategy)) problems.push(`compare.strategy must be one of ${STRATEGIES.join(', ')}.`);
  if (config.compare?.masks !== undefined && !Array.isArray(config.compare.masks)) problems.push('compare.masks must be a list of rectangles.');
  if (config.compare?.motion !== undefined && !isPairList(config.compare.motion)) {
    problems.push('compare.motion must be a list of pairs of two different capture names, such as [["page-start", "page-after-turn"]].');
  }
  return problems;
}

function runProblems(code, planned) {
  const problems = [];
  if (code.includes(SKELETON_MARK)) problems.push('run.mjs is still the skeleton auto-check copied.');
  if (!code.includes(KIT_IMPORT) || !/\brunCheck\s*\(/.test(code)) {
    problems.push(`run.mjs must import runCheck from the check kit as ${KIT_IMPORT} and call it.`);
  }
  const head = planned?.pr?.head?.sha;
  if ((head && code.includes(head)) || /refs\/pull\/|pull\/\d+\/(?:head|merge)/.test(code)) {
    problems.push('run.mjs refers to the pull request\'s own commit. The check must test the base branch tip.');
  }
  return problems;
}

function readmeProblems(text) {
  const problems = [];
  if (text.includes(SKELETON_MARK)) problems.push('README.md is still the skeleton auto-check copied.');
  else if (/\{\{[^}]*\}\}/.test(text)) problems.push('README.md still has {{...}} placeholders.');
  if (text.trim().length < 400 || !/run\.mjs/.test(text)) problems.push('README.md must say what the check proves and how to run run.mjs by hand.');
  return problems;
}

/**
 * Problems that keep a check folder from meeting the contract; empty when it
 * does. With `planned`, the check.config.json auto-check wrote first, it also
 * reports changes to the settings that pick the code under test.
 */
export function validateCheck(dir, { planned = null } = {}) {
  const problems = [];
  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(dir, file))) problems.push(`${file} is missing.`);
  }
  const configFile = path.join(dir, 'check.config.json');
  if (existsSync(configFile)) {
    try {
      problems.push(...configProblems(JSON.parse(read(configFile)), planned));
    } catch (error) {
      problems.push(`check.config.json is not valid JSON: ${error.message}`);
    }
  }
  const runFile = path.join(dir, 'run.mjs');
  if (existsSync(runFile)) problems.push(...runProblems(read(runFile), planned));
  const readmeFile = path.join(dir, 'README.md');
  if (existsSync(readmeFile)) problems.push(...readmeProblems(read(readmeFile)));
  const packageFile = path.join(dir, 'package.json');
  if (existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(read(packageFile));
      if (pkg.type !== 'module') problems.push('package.json must set "type": "module".');
      if (!pkg.dependencies?.pngjs) problems.push('package.json must keep pngjs in dependencies: the check kit reads and writes PNG files with it.');
    } catch (error) {
      problems.push(`package.json is not valid JSON: ${error.message}`);
    }
  }
  return problems;
}

/** How to start npm without a shell: node plus npm-cli.js where it can be found. */
export function npmLauncher(env = process.env) {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    env.npm_execpath,
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = candidates.find((candidate) => candidate && /npm-cli\.js$/.test(candidate) && existsSync(candidate));
  return cli ? { file: process.execPath, args: [cli] } : resolveCommand('npm', env);
}

/** Installs the check's own dependencies when its package.json lists any. */
export async function installCheck(dir, { timeoutMs = 15 * 60 * 1000, env = process.env } = {}) {
  const pkg = JSON.parse(read(path.join(dir, 'package.json')));
  if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length === 0) return { installed: false };
  const launcher = npmLauncher();
  if (!launcher) throw new Error('npm was not found, so the check\'s dependencies cannot be installed.');
  const result = await runProcess({
    launcher,
    args: ['install', '--no-audit', '--no-fund', '--loglevel=error'],
    cwd: dir,
    timeoutMs,
    env: { ...env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });
  if (result.error) throw new Error(`npm could not start: ${result.error.message}`);
  if (result.exitCode !== 0) {
    const tail = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-3).join(' ');
    throw new Error(`npm install failed in ${dir}: ${tail}`);
  }
  return { installed: true };
}

/**
 * Runs the check's run.mjs once in a new folder under its results/ and
 * returns the exit code, the output folder, stderr, and result.json.
 */
export async function runCheckOnce(dir, { label, args = [], sourceDir = null, timeoutMinutes = 15, layers = null, now = new Date(), env = process.env } = {}) {
  const out = path.join(dir, 'results', `${fileTimestamp(now)}-${label}`);
  mkdirSync(out, { recursive: true });
  const all = [path.join(dir, 'run.mjs'), '--out', out, ...args];
  if (sourceDir) all.push('--source', sourceDir);
  if (layers) all.push('--layers', layers.join(','));
  const run = await runProcess({ launcher: { file: process.execPath, args: [] }, args: all, cwd: dir, timeoutMs: timeoutMinutes * 60 * 1000, env });
  const resultFile = path.join(out, 'result.json');
  return {
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    out,
    stderr: run.stderr,
    result: existsSync(resultFile) ? JSON.parse(read(resultFile)) : null,
  };
}

/** Runs the check with every capture replaced by a black image or empty text. */
export function simulateFailure(dir, options = {}) {
  return runCheckOnce(dir, { label: 'simulated-failure', ...options, args: ['--simulate-fail', 'black'] });
}

/** Contract problems shown by a simulated-failure run, which must fail with exit 1. */
export function simulationProblems(run) {
  if (run.timedOut) return ['run.mjs did not finish within timeoutMinutes under --simulate-fail black.'];
  if (run.exitCode === 1) return [];
  if (run.exitCode === 0) {
    return ['run.mjs passes under --simulate-fail black, so an assertion ignores what was captured. Base every assertion on a value from ctx.image, ctx.text, or ctx.json.'];
  }
  const reason = run.result?.error ?? run.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
  return [`run.mjs stops with an error under --simulate-fail black instead of failing an assertion: ${reason || `exit code ${run.exitCode}`}`];
}

/**
 * Runs the check once with --capture-baseline. The kit copies the artifacts
 * of each layer whose assertions all pass into baseline/.
 */
export function captureBaseline(dir, options = {}) {
  return runCheckOnce(dir, { label: 'baseline', ...options, args: ['--capture-baseline'] });
}

/**
 * Share of its pixels each motion pair must change in the baseline run before
 * auto-check accepts a check: four times what a scheduled run needs, so film
 * grain, a cursor, or a clock never decides a run.
 */
export const ACCEPTED_MOTION = MOTION_THRESHOLD * 4;

/**
 * Contract problems shown by the motion pairs of a baseline run. Each pair in
 * compare.motion whose frames belong to a layer the baseline captured must
 * change more than `minimum` of its pixels. A layer the baseline did not
 * capture is reported by the run's own result instead.
 */
export function motionProblems(dir, run, { minimum = ACCEPTED_MOTION } = {}) {
  let pairs;
  try {
    pairs = JSON.parse(read(path.join(dir, 'check.config.json'))).compare?.motion ?? [];
  } catch {
    return [];
  }
  if (!isPairList(pairs)) return [];
  const artifacts = run?.result?.artifacts ?? [];
  const captured = run?.result?.baseline ?? {};
  const problems = [];
  for (const pair of pairs) {
    const names = pair.join(' and ');
    const frames = pair.map((name) => artifacts.find((artifact) => artifact.name === name && artifact.kind === 'image'));
    const made = frames.filter(Boolean);
    if (made.length === 0 || captured[made[0].layer] !== 'captured') continue;
    if (made.length === 1) {
      problems.push(`compare.motion pairs ${names}, but the baseline run made only ${made[0].name}.`);
      continue;
    }
    let images;
    try {
      images = frames.map((frame) => readImage(path.join(run.out, frame.file)));
    } catch (error) {
      problems.push(`compare.motion pair ${names} could not be read: ${error.message.split('\n')[0]}`);
      continue;
    }
    const [first, second] = images;
    if (first.width !== second.width || first.height !== second.height) {
      problems.push(`compare.motion pair ${names} compares a ${first.width}x${first.height} frame with a ${second.width}x${second.height} frame. Capture both frames of a pair at the same size.`);
      continue;
    }
    const motion = checkMotion(first, second, { minimum });
    if (motion.ok) continue;
    problems.push(
      `compare.motion pair ${names} changed ${percent(motion.ratio)} of its pixels in the baseline run. `
        + `A scheduled run fails a pair that changes ${percent(MOTION_THRESHOLD)} or less, so auto-check accepts a pair only above ${percent(minimum)}. `
        + 'Pair two frames only when the subject itself moves between them in every run: film grain, a cursor, a clock, or a counter is not motion. '
        + 'When the view can rest on a still scene, take the second frame after an input that always changes it, such as a turn, or remove the pair.',
    );
  }
  return problems;
}

/** Fields of a check's state.json that auto-check keeps, with their starting values. */
const INITIAL_STATE = Object.freeze({
  storedConversation: null,
  lastPass: null,
  lastRun: null,
  consecutiveFailures: 0,
  lastFailureSignature: null,
  lastNotifiedAt: null,
  openResolution: null,
});

/**
 * Gives the check's state.json every field auto-check keeps, adding only the
 * missing ones, so state a check run already saved is kept. Returns true when
 * it wrote the file.
 */
export function writeInitialState(dir, now = new Date()) {
  const file = path.join(dir, 'state.json');
  let state = {};
  if (existsSync(file)) {
    try {
      state = JSON.parse(read(file));
    } catch {
      state = {};
    }
  }
  const starting = { createdAt: now.toISOString(), ...INITIAL_STATE };
  const missing = Object.keys(starting).filter((key) => !Object.hasOwn(state, key));
  if (missing.length === 0) return false;
  const added = Object.fromEntries(missing.map((key) => [key, starting[key]]));
  writeFileSync(file, `${JSON.stringify({ ...added, ...state }, null, 2)}\n`);
  return true;
}
