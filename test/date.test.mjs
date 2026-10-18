import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayFolder, fileTimestamp } from '../lib/util/date.mjs';

test('day folders read month first, padded to two digits and four', () => {
  assert.equal(dayFolder(new Date(2026, 0, 5)), '01-05-2026');
  assert.equal(dayFolder(new Date(2026, 11, 31)), '12-31-2026');
  assert.equal(dayFolder(new Date(987, 6, 9)), '07-09-0987');
});

test('file timestamps sort by time and hold no colons', () => {
  assert.equal(fileTimestamp(new Date(2026, 2, 4, 5, 6, 7)), '2026-03-04T05-06-07');
  assert.equal(fileTimestamp(new Date(2026, 9, 16, 23, 59, 59)), '2026-10-16T23-59-59');
  assert.ok(fileTimestamp(new Date(2026, 0, 1, 9)) < fileTimestamp(new Date(2026, 0, 1, 10)));
});
