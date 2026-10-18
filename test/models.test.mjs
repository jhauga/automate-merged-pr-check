import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  EFFORT_FALLBACK,
  EFFORT_FLAGS,
  ModelError,
  cacheFile,
  cachedModels,
  commandLabel,
  describeModel,
  effortLevels,
  effortLevelsFrom,
  normalizeModel,
  probeCall,
  refusalReason,
  resolveModel,
} from '../lib/models.mjs';
import { withSettings } from './helpers/shipped.mjs';

const FAKE_CLI = fileURLToPath(new URL('./helpers/fake-assistant-cli.mjs', import.meta.url));

/** Runs the stand-in command, which accepts only the models in `accepted`. */
function fakeRun(accepted, { calls = [], efforts = null } = {}) {
  return (file, args, options = {}) => {
    calls.push({ file, args, input: options.input ?? null });
    const env = {
      ...process.env,
      FAKE_ASSISTANT_MODELS: accepted.join(','),
      ...(efforts ? { FAKE_ASSISTANT_EFFORT: efforts } : {}),
    };
    return spawnSync(process.execPath, [FAKE_CLI, ...args], { encoding: 'utf8', env, input: options.input });
  };
}

test('a Claude model is normalized to an identifier and a family alias', () => {
  assert.deepEqual(normalizeModel('claude', 'Opus 5.5'), {
    label: 'Opus 5.5',
    id: 'claude-opus-5-5',
    alias: 'opus',
    candidates: ['claude-opus-5-5', 'opus'],
  });
  for (const written of ['opus-5.5', 'claude-opus-5-5', 'OPUS 5.5', 'claude-Opus-5.5']) {
    assert.deepEqual(normalizeModel('claude', written).candidates, ['claude-opus-5-5', 'opus'], written);
  }
  assert.deepEqual(normalizeModel('claude', 'Sonnet 5').candidates, ['claude-sonnet-5', 'sonnet']);
  assert.deepEqual(normalizeModel('claude', 'Haiku 4.5').candidates, ['claude-haiku-4-5', 'haiku']);
  assert.deepEqual(normalizeModel('claude', 'Fable 5.1').candidates, ['claude-fable-5-1', 'fable']);
  assert.deepEqual(normalizeModel('claude', 'opus').candidates, ['opus']);
  assert.deepEqual(normalizeModel('claude', 'claude-3-5-sonnet-20241022').candidates, ['claude-3-5-sonnet-20241022']);
  assert.deepEqual(normalizeModel('copilot', 'GPT 5.1 Codex').candidates, ['gpt-5.1-codex']);
  assert.deepEqual(normalizeModel('codex', 'gpt-5-codex').candidates, ['gpt-5-codex']);
  assert.deepEqual(normalizeModel('claude', '  ').candidates, []);
});

test('a model with one name needs no probe, and an empty one means the command default', async () => {
  await withSettings(async ({ env }) => {
    const calls = [];
    const only = resolveModel({ assistant: 'claude', model: 'opus', file: 'claude', env, run: fakeRun(['opus'], { calls }) });
    assert.equal(only.model, 'opus');
    assert.equal(only.accepted, 'only');
    assert.equal(calls.length, 0);
    assert.equal(describeModel(only), 'opus');

    const none = resolveModel({ assistant: 'claude', model: '', file: 'claude', env });
    assert.equal(none.model, '');
    assert.equal(describeModel(none), 'the command default');
  });
});

test('the identifier is probed first, then the alias, and the answer is remembered', async () => {
  await withSettings(async ({ env, dir }) => {
    const calls = [];
    const run = fakeRun(['opus'], { calls });
    const first = resolveModel({
      assistant: 'claude',
      model: 'Opus 5.5',
      file: 'claude',
      version: '2.1.261',
      label: 'Claude Code 2.1.261',
      env,
      run,
    });
    assert.equal(first.model, 'opus');
    assert.equal(first.accepted, 'alias');
    assert.deepEqual(first.refused, ['claude-opus-5-5']);
    assert.equal(first.cached, false);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, ['--print', '--model', 'claude-opus-5-5']);
    assert.equal(calls[0].input, 'Reply with OK and nothing else.');
    assert.equal(
      describeModel(first),
      'Opus 5.5 (runs as opus: Claude Code 2.1.261 does not accept claude-opus-5-5)',
    );

    const cache = JSON.parse(readFileSync(path.join(dir, 'model-cache.json'), 'utf8'));
    assert.deepEqual(cache.claude['2.1.261']['claude-opus-5-5|opus'].model, 'opus');
    assert.equal(JSON.stringify(cache).includes('API Error'), false);

    const again = resolveModel({ assistant: 'claude', model: 'Opus 5.5', file: 'claude', version: '2.1.261', env, run });
    assert.equal(again.model, 'opus');
    assert.equal(again.cached, true);
    assert.equal(calls.length, 2);

    const newer = resolveModel({ assistant: 'claude', model: 'Opus 5.5', file: 'claude', version: '2.1.280', env, run: fakeRun(['claude-opus-5-5', 'opus']) });
    assert.equal(newer.model, 'claude-opus-5-5');
    assert.equal(newer.accepted, 'id');
    assert.equal(describeModel(newer), 'Opus 5.5 (runs as claude-opus-5-5)');
    assert.equal(cacheFile(env), path.join(dir, 'model-cache.json'));
  });
});

test('a model neither name reaches is an argument error that says why', async () => {
  await withSettings(async ({ env, dir }) => {
    assert.throws(
      () => resolveModel({ assistant: 'claude', model: 'Opus 9', file: 'claude', version: '2.1.261', label: 'Claude Code 2.1.261', env, run: fakeRun([]) }),
      (error) => {
        assert.ok(error instanceof ModelError);
        assert.equal(error.exitCode, 4);
        assert.match(error.message, /accepts neither claude-opus-9 nor opus for the model "Opus 9"/);
        assert.match(error.message, /is not a model this version knows/);
        return true;
      },
    );
    assert.equal(existsSync(path.join(dir, 'model-cache.json')), false);
  });
});

test('the refusal reason is the line that names the error, not the first warning', () => {
  const reason = refusalReason({
    stderr: 'warning: this workspace has not been trusted\nAPI Error: 400 "claude-opus-5-5" is not supported.\n',
    stdout: '',
    status: 1,
  });
  assert.equal(reason, 'API Error: 400 "claude-opus-5-5" is not supported.');
  assert.equal(refusalReason({ stdout: 'something\n', status: 2 }), 'something');
  assert.equal(refusalReason({ status: 3 }), 'exit code 3');
});

test('the effort levels come from the command help, in either shape', () => {
  assert.deepEqual(
    effortLevelsFrom('  --effort <level>  Effort level for the current session\n  (low, medium, high, xhigh, max)\n', '--effort'),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  );
  assert.deepEqual(
    effortLevelsFrom('      --reasoning-effort <level>\n          Set it [possible values: none, minimal, low, high]\n', '--reasoning-effort'),
    ['none', 'minimal', 'low', 'high'],
  );
  assert.deepEqual(effortLevelsFrom('no such option', '--effort'), []);
  assert.equal(EFFORT_FLAGS.copilot, '--reasoning-effort');
  assert.deepEqual(effortLevels('claude'), [...EFFORT_FALLBACK.claude]);
  assert.deepEqual(
    effortLevels('claude', { file: 'fake-claude', run: () => ({ stdout: '  --effort <level>\n  (low, max)\n', stderr: '' }) }),
    ['low', 'max'],
  );
});

test('the probe call fits the command, and Codex has none', () => {
  assert.deepEqual(probeCall('claude', 'opus').args, ['--print', '--model', 'opus']);
  assert.ok(probeCall('copilot', 'gpt-5.1').args.includes('--allow-all-tools'));
  assert.equal(probeCall('codex', 'gpt-5-codex'), null);
});

test('the cache reads back as one line per probed model', async () => {
  await withSettings(async ({ env, dir }) => {
    writeFileSync(path.join(dir, 'model-cache.json'), JSON.stringify({
      claude: { '2.1.261': { 'claude-opus-5-5|opus': { model: 'opus', accepted: 'alias', refused: ['claude-opus-5-5'] } } },
    }));
    assert.deepEqual(cachedModels('claude', { env }), [
      { version: '2.1.261', candidates: ['claude-opus-5-5', 'opus'], model: 'opus', accepted: 'alias' },
    ]);
    assert.deepEqual(cachedModels('copilot', { env }), []);
  });
});

test('a command and its version read as a person would write them', () => {
  assert.equal(commandLabel('claude', '2.1.261 (Claude Code)'), 'Claude Code 2.1.261');
  assert.equal(commandLabel('copilot', 'GitHub Copilot CLI 1.0.99-2.'), 'GitHub Copilot CLI 1.0.99-2');
  assert.equal(commandLabel('codex', '0.9.0'), 'codex 0.9.0');
  assert.equal(commandLabel('claude', ''), 'claude');
});
