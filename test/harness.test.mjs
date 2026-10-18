import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { writeImage } from '../lib/check-kit.mjs';
import { MOTION_THRESHOLD } from '../lib/compare/liveness.mjs';
import { percent } from '../lib/compare/shared.mjs';
import { defaults } from '../lib/config.mjs';
import { plannedConfig } from '../lib/generate.mjs';
import {
  ACCEPTED_MOTION,
  captureBaseline,
  installCheck,
  isSkeleton,
  motionProblems,
  npmLauncher,
  simulateFailure,
  simulationProblems,
  validateCheck,
  writeInitialState,
} from '../lib/harness.mjs';
import { codeRoot } from '../lib/paths.mjs';
import { intake } from '../lib/pr.mjs';
import { readPromptFile } from '../lib/prompt.mjs';
import { fakeGitHub } from './helpers/fake-github.mjs';
import { KIT_IMPORT, installKit } from '../lib/test-folder.mjs';
import { installKitDependencies } from './helpers/kit-deps.mjs';
import { writeSampleCheck } from './helpers/sample-check.mjs';

let base;
const info = intake('https://github.com/acme/demo-app/pull/103', { github: fakeGitHub() });
const planned = plannedConfig(info, { config: defaults() });

before(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'auto-check-harness-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

function plannedFolder(name) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'check.config.json'), `${JSON.stringify(planned, null, 2)}\n`);
  return dir;
}

function sampleFolder(name, options) {
  const dir = plannedFolder(name);
  writeSampleCheck(dir, options);
  installKit(dir);
  installKitDependencies(dir);
  return dir;
}

const editConfig = (dir, change) => {
  const file = path.join(dir, 'check.config.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  change(config);
  writeFileSync(file, JSON.stringify(config));
};

test('a complete check meets the contract', () => {
  assert.deepEqual(validateCheck(sampleFolder('complete'), { planned }), []);
});

test('the skeletons and the planned settings alone do not', () => {
  const dir = plannedFolder('skeleton');
  for (const file of ['run.mjs', 'README.md', 'package.json']) copyFileSync(path.join(codeRoot, 'templates', 'check', file), path.join(dir, file));
  assert.equal(isSkeleton(path.join(dir, 'run.mjs')), true);
  const problems = validateCheck(dir, { planned });
  assert.ok(problems.includes('run.mjs is still the skeleton auto-check copied.'), problems.join('\n'));
  assert.ok(problems.includes('README.md is still the skeleton auto-check copied.'));
  assert.ok(problems.some((problem) => /compare\.strategy is still "auto"/.test(problem)));
});

test('missing files, bad JSON, and unfinished settings are each reported', () => {
  const empty = path.join(base, 'empty');
  mkdirSync(empty);
  assert.deepEqual(validateCheck(empty), [
    'check.config.json is missing.',
    'run.mjs is missing.',
    'README.md is missing.',
    'package.json is missing.',
  ]);

  const broken = sampleFolder('broken');
  writeFileSync(path.join(broken, 'package.json'), '{ "name": ');
  assert.ok(validateCheck(broken).some((problem) => problem.startsWith('package.json is not valid JSON')));

  const pending = sampleFolder('pending');
  editConfig(pending, (config) => {
    config.layers.hostApp = { enabled: true, driver: 'pending' };
    config.runMode = 'sometimes';
    config.timeoutMinutes = 0;
    delete config.models;
  });
  const problems = validateCheck(pending);
  assert.ok(problems.includes('check.config.json has no "models".'));
  assert.ok(problems.some((problem) => /layers\.hostApp is enabled, but its driver is still "pending"/.test(problem)));
  assert.ok(problems.includes('runMode must be "single" or "two-step".'));
  assert.ok(problems.includes('timeoutMinutes must be a positive number.'));
});

test('a check may not move off the base branch auto-check planned, or reach for the pull request commit', () => {
  const moved = sampleFolder('moved');
  editConfig(moved, (config) => {
    config.source.baseRef = info.head.ref;
  });
  assert.ok(validateCheck(moved, { planned }).some((problem) => /changed source\.baseRef from "main"/.test(problem)));

  const head = sampleFolder('head');
  writeFileSync(path.join(head, 'run.mjs'), `${readFileSync(path.join(head, 'run.mjs'), 'utf8')}// git fetch origin refs/pull/103/head\n`);
  assert.ok(validateCheck(head, { planned }).some((problem) => /refers to the pull request's own commit/.test(problem)));

  const noKit = sampleFolder('no-kit', { run: 'noKit' });
  assert.ok(validateCheck(noKit).includes(`run.mjs must import runCheck from the check kit as ${KIT_IMPORT} and call it.`));
});

test('a simulated failure must exit 1', () => {
  assert.deepEqual(simulationProblems({ exitCode: 1, stderr: '' }), []);
  assert.match(simulationProblems({ exitCode: 0, stderr: '' })[0], /passes under --simulate-fail black/);
  assert.match(simulationProblems({ exitCode: 2, stderr: '', result: { error: 'TypeError: x is null' } })[0], /TypeError: x is null/);
  assert.match(simulationProblems({ exitCode: null, timedOut: true, stderr: '' })[0], /did not finish/);
});

test('a real check run: the simulated failure exits 1 and the baseline is captured', async () => {
  const dir = sampleFolder('real');
  assert.equal((await installCheck(dir)).installed, true);
  const simulated = await simulateFailure(dir, { timeoutMinutes: 2 });
  assert.equal(simulated.exitCode, 1, simulated.stderr);
  assert.equal(simulated.result.outcome, 'fail');
  assert.match(path.basename(simulated.out), /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-simulated-failure$/);
  assert.deepEqual(simulationProblems(simulated), []);

  const captured = await captureBaseline(dir, { timeoutMinutes: 2 });
  assert.equal(captured.exitCode, 0, captured.stderr);
  assert.deepEqual(captured.result.baseline, { page: 'captured' });
  assert.equal(readFileSync(path.join(dir, 'baseline', 'greeting.txt'), 'utf8'), 'hello from the base tip');

  const blind = sampleFolder('blind', { run: 'blind' });
  const passes = await simulateFailure(blind, { timeoutMinutes: 2 });
  assert.equal(passes.exitCode, 0);
  assert.equal(simulationProblems(passes).length, 1);
});

test('motion pairs must name two different captures', () => {
  [[['scene']], [['scene', 'scene']], 'scene', [['scene', 3]]].forEach((motion, index) => {
    const dir = sampleFolder(`motion-shape-${index}`);
    editConfig(dir, (config) => {
      config.compare.motion = motion;
    });
    assert.ok(validateCheck(dir).includes('compare.motion must be a list of pairs of two different capture names, such as [["page-start", "page-after-turn"]].'), JSON.stringify(motion));
  });
  const named = sampleFolder('motion-shape-named');
  editConfig(named, (config) => {
    config.compare.motion = [['scene', 'scene-later']];
  });
  assert.deepEqual(validateCheck(named, { planned }), []);
});

/** A striped square frame, 40 pixels wide unless `size` says otherwise, with its first `changed` pixels inverted. */
function frame(changed, size = 40) {
  const data = Buffer.alloc(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const light = (index % size < size / 2) !== (index < changed);
    data.set(light ? [240, 220, 120, 255] : [60, 50, 30, 255], index * 4);
  }
  return { width: size, height: size, data };
}

test('every motion pair of a captured layer must move well beyond noise in the baseline run', () => {
  const dir = sampleFolder('motion');
  editConfig(dir, (config) => {
    config.compare.motion = [['moving', 'moving-later'], ['grain', 'grain-later'], ['host', 'host-later'], ['alone', 'alone-later'], ['sized', 'sized-later'], ['absent', 'absent-later']];
  });
  const out = path.join(dir, 'results', 'baseline-run');
  mkdirSync(out, { recursive: true });
  const frames = { moving: frame(0), 'moving-later': frame(400), grain: frame(0), 'grain-later': frame(16), host: frame(0), 'host-later': frame(0), alone: frame(0), sized: frame(0), 'sized-later': frame(0, 20) };
  for (const [name, image] of Object.entries(frames)) writeImage(path.join(out, `${name}.png`), image);
  const artifacts = Object.keys(frames).map((name) => ({ name, file: `${name}.png`, kind: 'image', layer: name.startsWith('host') ? 'hostApp' : 'page' }));
  const run = { out, result: { artifacts, baseline: { page: 'captured', hostApp: 'not captured: the app opens the subject failed' } } };

  const problems = motionProblems(dir, run);
  assert.equal(problems.length, 3, problems.join(' | '));
  assert.match(problems[0], /^compare\.motion pair grain and grain-later changed 1% of its pixels in the baseline run\. A scheduled run fails a pair that changes 0\.5% or less, so auto-check accepts a pair only above 2%\./);
  assert.match(problems[0], /take the second frame after an input that always changes it, such as a turn, or remove the pair\.$/);
  assert.equal(problems[1], 'compare.motion pairs alone and alone-later, but the baseline run made only alone.');
  assert.equal(problems[2], 'compare.motion pair sized and sized-later compares a 40x40 frame with a 20x20 frame. Capture both frames of a pair at the same size.');

  assert.equal(ACCEPTED_MOTION, MOTION_THRESHOLD * 4);
  assert.equal(motionProblems(dir, run, { minimum: MOTION_THRESHOLD }).length, 2);
  assert.deepEqual(motionProblems(dir, { out, result: { artifacts, baseline: { page: 'not captured: the scene is not blank failed' } } }), []);
});

test('the contract states the motion minimums the harness applies', () => {
  const contract = readPromptFile('harness-contract');
  assert.ok(contract.includes(`a pair that changes ${percent(MOTION_THRESHOLD)} of its pixels or less`));
  assert.ok(contract.includes(`every pair changes more than ${percent(ACCEPTED_MOTION)} in the baseline run`));
});

test('state.json gains its starting fields once, keeping what a check run saved', () => {
  const dir = plannedFolder('state');
  assert.equal(writeInitialState(dir, new Date('2026-01-01T03:00:00Z')), true);
  const state = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(state.createdAt, '2026-01-01T03:00:00.000Z');
  assert.equal(state.storedConversation, null);
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(writeInitialState(dir), false);

  const saved = plannedFolder('state-saved');
  const stored = { name: 'auto-check sample-canvas', id: 'demo-id' };
  writeFileSync(path.join(saved, 'state.json'), JSON.stringify({ storedConversation: stored }));
  assert.equal(writeInitialState(saved), true);
  const merged = JSON.parse(readFileSync(path.join(saved, 'state.json'), 'utf8'));
  assert.deepEqual(merged.storedConversation, stored);
  assert.equal(merged.lastPass, null);
  assert.equal(merged.consecutiveFailures, 0);
});

test('npm starts without a shell when its script can be found', () => {
  const launcher = npmLauncher();
  assert.ok(launcher, 'npm was not found');
  if (launcher.args.length > 0) {
    assert.equal(launcher.file, process.execPath);
    assert.match(launcher.args[0], /npm-cli\.js$/);
    assert.ok(existsSync(launcher.args[0]));
  }
});
