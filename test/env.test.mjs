import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadDotEnv, parseDotEnv, withoutVariables } from '../lib/util/env.mjs';

test('.env text parses plain, quoted, exported, and commented lines', () => {
  const text = [
    '# comment',
    'PLAIN=value',
    'export EXPORTED=yes',
    'SPACED = padded value # trailing comment',
    'DOUBLE="two\\nlines"',
    "SINGLE='kept # as is'",
    'EMPTY=',
    'not a line',
  ].join('\r\n');
  assert.deepEqual(parseDotEnv(text), {
    PLAIN: 'value',
    EXPORTED: 'yes',
    SPACED: 'padded value',
    DOUBLE: 'two\nlines',
    SINGLE: 'kept # as is',
    EMPTY: '',
  });
});

test('a child environment leaves out the named variables, without regard to case on Windows', () => {
  const env = { PATH: 'bin', AUTO_CHECK_EMAIL_PASSWORD: 'placeholder-secret', Auto_Check_Smtp_Password: 'other-secret', KEEP: '1' };
  const names = ['AUTO_CHECK_EMAIL_PASSWORD', 'AUTO_CHECK_SMTP_PASSWORD', null];
  assert.deepEqual(withoutVariables(env, names, { platform: 'win32' }), { PATH: 'bin', KEEP: '1' });
  assert.deepEqual(withoutVariables(env, names, { platform: 'linux' }), { PATH: 'bin', Auto_Check_Smtp_Password: 'other-secret', KEEP: '1' });
  assert.equal(withoutVariables(env, []), env);
  assert.equal(env.AUTO_CHECK_EMAIL_PASSWORD, 'placeholder-secret');
});

test('loading .env never overrides a variable that is already set', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-env-'));
  try {
    writeFileSync(path.join(dir, '.env'), 'FROM_FILE=file\nALREADY_SET=file\n');
    const env = { ALREADY_SET: 'shell' };
    assert.deepEqual(loadDotEnv(dir, env), ['FROM_FILE']);
    assert.deepEqual(env, { ALREADY_SET: 'shell', FROM_FILE: 'file' });
    assert.deepEqual(loadDotEnv(path.join(dir, 'missing'), env), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
