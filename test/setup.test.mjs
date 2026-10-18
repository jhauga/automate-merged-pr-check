import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SkillsError, assistantState, setupAssistant } from '../lib/setup.mjs';
import { loadUserConfig } from '../lib/user-config.mjs';
import { withSettings } from './helpers/shipped.mjs';

/** A machine where every assistant is installed, and claude is signed in. */
function fakeProbe(overrides = {}) {
  return {
    which: (command) => (['claude', 'copilot', 'codex'].includes(command) ? `/usr/bin/${command}` : null),
    run: (file, args) => ({
      status: 0,
      stdout: args[0] === 'auth' ? JSON.stringify({ loggedIn: true }) : `${path.basename(file)} 1.0.0\n`,
      stderr: '',
    }),
    ...overrides,
  };
}

const signedOut = () => fakeProbe({
  run: (file, args) => ({ status: 0, stdout: args[0] === 'auth' ? '{"loggedIn":false}' : 'claude 1.0.0\n', stderr: '' }),
});

test('the assistant state reads the command version and whether Claude Code is signed in', () => {
  assert.deepEqual(assistantState('codex', fakeProbe({ which: () => null })), {
    name: 'codex',
    file: null,
    version: null,
    signedIn: null,
  });
  const copilot = assistantState('copilot', fakeProbe());
  assert.equal(copilot.version, 'copilot 1.0.0');
  assert.equal(copilot.signedIn, null);
  assert.equal(assistantState('claude', fakeProbe()).signedIn, true);
  assert.equal(assistantState('claude', signedOut()).signedIn, false);
  const noJson = fakeProbe({ run: () => ({ status: 0, stdout: 'claude 1.0.0\n', stderr: '' }) });
  assert.equal(assistantState('claude', noJson).signedIn, null);
});

test('setup saves the assistant in the per-user settings', async () => {
  await withSettings(async ({ env }) => {
    const result = await setupAssistant({ assistant: 'copilot', env, probe: fakeProbe() });
    assert.equal(result.assistant, 'copilot');
    assert.equal(result.state.version, 'copilot 1.0.0');
    assert.equal((await loadUserConfig({ env })).assistant, 'copilot');
    assert.equal(JSON.parse(readFileSync(result.file, 'utf8')).assistant, 'copilot');
  });
});

test('setup refuses an unknown, missing, or signed-out assistant and writes nothing', async () => {
  await withSettings(async ({ env }) => {
    await assert.rejects(setupAssistant({ assistant: 'other', env, probe: fakeProbe() }), SkillsError);
    await assert.rejects(
      setupAssistant({ assistant: 'codex', env, probe: fakeProbe({ which: () => null }) }),
      (error) => error instanceof SkillsError && /is not on PATH/.test(error.message),
    );
    await assert.rejects(
      setupAssistant({ assistant: 'claude', env, probe: signedOut() }),
      (error) => error instanceof SkillsError && /not signed in/.test(error.message),
    );
    assert.equal((await loadUserConfig({ env })).assistant, 'claude');
  });
});
