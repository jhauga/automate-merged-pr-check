import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadDotEnv, parseDotEnv } from '../lib/util/env.mjs';

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
