import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  ConfigError,
  defaults,
  loadSchema,
  resolveInherit,
  validate,
} from '../lib/config.mjs';
import {
  SETTINGS_FILE,
  SettingError,
  getSetting,
  listSettings,
  loadConfig,
  loadUserConfig,
  parseSetting,
  setSetting,
  settingKeys,
  settingsPath,
  unsetSetting,
  userDefaults,
} from '../lib/user-config.mjs';
import { withSettings } from './helpers/shipped.mjs';

const write = (dir, content) => {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  writeFileSync(path.join(dir, SETTINGS_FILE), text);
};

async function problemsFor(content) {
  return withSettings(async ({ dir, env }) => {
    write(dir, content);
    try {
      await loadUserConfig({ env });
    } catch (error) {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${error}`);
      return error.problems;
    }
    assert.fail('expected the settings to be rejected');
  });
}

test('the settings a new installation starts with pass their schema', async () => {
  assert.deepEqual(validate(await loadSchema(), userDefaults()), []);
});

test('the follow-up flags are not settings; each test turns them on in its own form', () => {
  assert.equal(Object.hasOwn(userDefaults(), 'features'), false);
  assert.equal(Object.hasOwn(defaults(), 'features'), false);
  assert.equal(settingKeys().some((key) => key.startsWith('features')), false);
  assert.ok(settingKeys().includes('root'));
  assert.ok(settingKeys().includes('models.claude.effort'));
});

test('no settings file loads as the defaults', async () => {
  await withSettings(async ({ dir, env }) => {
    assert.equal(existsSync(path.join(dir, SETTINGS_FILE)), false);
    assert.deepEqual(await loadUserConfig({ env }), userDefaults());
    assert.deepEqual(await loadConfig({ env }), defaults());
  });
});

test('settings left out keep their defaults', async () => {
  await withSettings(async ({ dir, env }) => {
    write(dir, { notify: { email: { to: ['admin@example.org'] } } });
    const settings = await loadUserConfig({ env });
    assert.deepEqual(settings.notify.email.to, ['admin@example.org']);
    assert.equal(settings.notify.email.smtp.port, 587);
    assert.equal(settings.assistant, 'claude');
    assert.equal(settings.root, '');
  });
});

test('the settings file sits in the folder AUTO_CHECK_CONFIG_DIR names', async () => {
  await withSettings(({ dir, env }) => {
    assert.equal(settingsPath(env), path.join(dir, SETTINGS_FILE));
  });
  assert.equal(
    settingsPath({ APPDATA: 'C:\\Users\\demo-user\\AppData\\Roaming' }, { platform: 'win32' }),
    path.join('C:\\Users\\demo-user\\AppData\\Roaming', 'auto-check', SETTINGS_FILE),
  );
  assert.equal(
    settingsPath({ XDG_CONFIG_HOME: '/home/demo-user/.config' }, { platform: 'linux' }),
    path.join('/home/demo-user/.config', 'auto-check', SETTINGS_FILE),
  );
  assert.equal(
    settingsPath({}, { platform: 'linux', home: '/home/demo-user' }),
    path.join('/home/demo-user', '.config', 'auto-check', SETTINGS_FILE),
  );
});

test('a wrong type is reported with its location', async () => {
  const problems = await problemsFor({ notify: { email: { smtp: { port: '587' } } } });
  assert.deepEqual(problems, ['/notify/email/smtp/port: expected integer, got string']);
});

test('an unknown setting is reported', async () => {
  assert.deepEqual(await problemsFor({ assistnt: 'claude' }), ['/assistnt: is not a known setting']);
  assert.deepEqual(await problemsFor({ skills: { canonical: '.claude/skills' } }), ['/skills: is not a known setting']);
  assert.deepEqual(await problemsFor({ features: { 'resolve-issue': true } }), ['/features: is not a known setting']);
});

test('an unknown assistant, effort, or secret name is rejected', async () => {
  assert.match((await problemsFor({ assistant: 'other' }))[0], /^\/assistant: must be one of "claude", "copilot", "codex"/);
  assert.match((await problemsFor({ models: { claude: { effort: 'deep' } } }))[0], /^\/models\/claude\/effort: "deep" does not match/);
  assert.match(
    (await problemsFor({ notify: { email: { smtp: { passwordEnv: 'not a name' } } } }))[0],
    /^\/notify\/email\/smtp\/passwordEnv: "not a name" does not match/,
  );
});

test('invalid JSON is a settings error', async () => {
  await withSettings(async ({ dir, env }) => {
    write(dir, '{ "assistant": ');
    await assert.rejects(loadUserConfig({ env }), (error) => error instanceof ConfigError && /not valid JSON/.test(error.message));
    write(dir, '"claude"');
    await assert.rejects(loadUserConfig({ env }), (error) => error instanceof ConfigError && /must contain a JSON object/.test(error.message));
  });
});

test('set, get, unset, and list read and write one setting at a time', async () => {
  await withSettings(async ({ dir, env }) => {
    const file = path.join(dir, SETTINGS_FILE);
    const saved = await setSetting('root', 'C:\\Users\\demo-user\\Documents\\auto-checks', { env });
    assert.equal(saved.file, file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { root: 'C:\\Users\\demo-user\\Documents\\auto-checks' });
    assert.deepEqual(await getSetting('root', { env }), {
      key: 'root',
      value: 'C:\\Users\\demo-user\\Documents\\auto-checks',
      set: true,
    });

    await setSetting('models.claude.effort', 'xhigh', { env });
    assert.equal((await loadConfig({ env })).models.claude.effort, 'xhigh');

    const removed = await unsetSetting('models.claude.effort', { env });
    assert.equal(removed.removed, true);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { root: 'C:\\Users\\demo-user\\Documents\\auto-checks' });
    assert.equal((await unsetSetting('models.claude.effort', { env })).removed, false);

    const list = await listSettings({ env });
    assert.equal(list.exists, true);
    assert.deepEqual(list.entries.find((entry) => entry.key === 'root'), {
      key: 'root',
      value: 'C:\\Users\\demo-user\\Documents\\auto-checks',
      set: true,
    });
    assert.equal(list.entries.find((entry) => entry.key === 'assistant').set, false);
  });
});

test('a setting that does not exist, or a value of the wrong kind, is refused', async () => {
  await withSettings(async ({ env }) => {
    await assert.rejects(setSetting('rout', 'x', { env }), SettingError);
    await assert.rejects(getSetting('models.claude', { env }), SettingError);
    assert.throws(() => parseSetting('notify.onPass', 'maybe'), SettingError);
    assert.throws(() => parseSetting('results.keep', 'seven'), SettingError);
    await assert.rejects(setSetting('assistant', 'other', { env }), ConfigError);
  });
});

test('values typed on the command line take the type of the setting', () => {
  assert.equal(parseSetting('notify.onPass', 'YES'), true);
  assert.equal(parseSetting('notify.onPass', 'off'), false);
  assert.equal(parseSetting('results.keep', '7'), 7);
  assert.deepEqual(parseSetting('notify.email.to', 'jane.doe@example.com, admin@example.org'), [
    'jane.doe@example.com',
    'admin@example.org',
  ]);
  assert.deepEqual(parseSetting('notify.email.to', '["jane.doe@example.com"]'), ['jane.doe@example.com']);
  assert.equal(parseSetting('root', 'C:\\Users\\demo-user\\Documents\\auto-checks'), 'C:\\Users\\demo-user\\Documents\\auto-checks');
});

test('a rejected write leaves the settings file as it was', async () => {
  await withSettings(async ({ dir, env }) => {
    await setSetting('assistant', 'copilot', { env });
    const before = readFileSync(path.join(dir, SETTINGS_FILE), 'utf8');
    await assert.rejects(setSetting('notify.email.from', 'not an address', { env }), ConfigError);
    assert.equal(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8'), before);
  });
});

test('"inherit" takes the user settings and objects override single values', () => {
  const config = defaults();
  const inherited = resolveInherit({ slug: 'demo', notify: 'inherit', schedule: 'inherit' }, config);
  assert.deepEqual(inherited.notify, config.notify);
  assert.deepEqual(inherited.schedule, config.schedule);

  const overridden = resolveInherit({ notify: { onPass: true } }, config);
  assert.equal(overridden.notify.onPass, true);
  assert.equal(overridden.notify.onFail, config.notify.onFail);

  assert.throws(() => resolveInherit({ notify: 'everything' }, config), ConfigError);
});
