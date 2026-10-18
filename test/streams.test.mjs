import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { exitOnBrokenPipe } from '../lib/util/streams.mjs';

test('a closed reader ends the process quietly', () => {
  const stream = new EventEmitter();
  const codes = [];
  exitOnBrokenPipe(stream, (code) => codes.push(code));
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  assert.deepEqual(codes, [process.exitCode ?? 0]);
});

test('other stream errors still surface', () => {
  const stream = new EventEmitter();
  exitOnBrokenPipe(stream, () => assert.fail('must not exit'));
  assert.throws(() => stream.emit('error', Object.assign(new Error('disk full'), { code: 'ENOSPC' })), /disk full/);
});
