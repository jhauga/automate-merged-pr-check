import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandPath } from '../lib/util/env.mjs';
import { escapeXml, fillTemplate } from '../lib/util/template.mjs';

test('templates are filled by name, keep their line endings, and escape values', () => {
  assert.equal(fillTemplate('a {{x}}\r\nb {{ y }}\r\n', { x: 1, y: '<z & w>' }, { escape: escapeXml }), 'a 1\r\nb &lt;z &amp; w&gt;\r\n');
  assert.throws(() => fillTemplate('{{a}} {{b}} {{c}}', { a: 1, c: null }), /needs values it was not given: b, c\.$/);
});

test('paths expand Windows and POSIX variables and a leading ~, leaving unknown names alone', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\demo-user\\AppData\\Local', HOME: '/home/demo-user' };
  assert.equal(expandPath('%localappdata%\\Programs\\SampleApp\\sample-app.exe', env, { platform: 'win32' }), 'C:\\Users\\demo-user\\AppData\\Local\\Programs\\SampleApp\\sample-app.exe');
  assert.equal(expandPath('%localappdata%\\x', env, { platform: 'linux' }), '%localappdata%\\x');
  assert.equal(expandPath('$HOME/.config/${HOME}/$MISSING', env, { platform: 'linux' }), '/home/demo-user/.config//home/demo-user/$MISSING');
  assert.equal(expandPath('~/.sample-app', env, { platform: 'linux', home: '/home/demo-user' }), '/home/demo-user/.sample-app');
  assert.equal(expandPath('~\\.sample-app', env, { platform: 'win32', home: 'C:\\Users\\demo-user' }), 'C:\\Users\\demo-user\\.sample-app');
  assert.equal(expandPath('%UNKNOWN%\\x', env, { platform: 'win32' }), '%UNKNOWN%\\x');
  assert.equal(expandPath(null, env), null);
});
