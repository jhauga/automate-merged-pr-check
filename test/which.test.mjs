import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runProcess } from '../lib/util/process.mjs';
import { launcherFor, shimScript, which } from '../lib/util/which.mjs';

const isWindows = process.platform === 'win32';

test('npm shims name the script that node runs', () => {
  const base = path.join(os.tmpdir(), 'tools');
  const current = '@ECHO off\r\n:start\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@acme\\demo-cli\\bin\\cli.js" %*\r\n';
  assert.equal(shimScript(current, base), path.join(base, 'node_modules\\@acme\\demo-cli\\bin\\cli.js'));
  const older = '@"%~dp0\\node.exe"  "%~dp0\\node_modules\\demo-cli\\cli.mjs" %*\r\n';
  assert.equal(shimScript(older, base), path.join(base, 'node_modules\\demo-cli\\cli.mjs'));
  assert.equal(shimScript('@echo off\r\necho hello\r\n', base), null);
});

test('which finds commands only on the PATH it is given', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-which-'));
  try {
    const name = isWindows ? 'demo-tool.exe' : 'demo-tool';
    writeFileSync(path.join(dir, name), '');
    const found = which('demo-tool', { PATH: dir, PATHEXT: '.EXE;.CMD' });
    const fold = (value) => (isWindows ? value.toLowerCase() : value);
    assert.equal(fold(found), fold(path.join(dir, name)));
    assert.equal(which('demo-tool', { PATH: path.join(dir, 'missing'), PATHEXT: '.EXE' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an npm shim starts through node without cmd.exe', { skip: !isWindows && 'Windows shims only' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-shim-'));
  try {
    const script = path.join(dir, 'node_modules', 'demo-cli', 'cli.js');
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, '');
    const shim = path.join(dir, 'demo-cli.cmd');
    writeFileSync(shim, '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\demo-cli\\cli.js" %*\r\n');
    assert.deepEqual(launcherFor(shim), { file: process.execPath, args: [script] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('arguments cmd.exe would misread never reach it', { skip: !isWindows && 'Windows only' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auto-check-bat-'));
  try {
    const bat = path.join(dir, 'demo.bat');
    writeFileSync(bat, '@echo off\r\necho %*\r\n');
    const launcher = launcherFor(bat);
    assert.equal(launcher.shell, true);
    const refused = await runProcess({ launcher, args: ['one & two'] });
    assert.match(refused.error.message, /cannot pass/);
    const plain = await runProcess({ launcher, args: ['hello'] });
    assert.equal(plain.exitCode, 0);
    assert.match(plain.stdout, /hello/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
