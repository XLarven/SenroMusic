import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRange } from '../src/range.js';

test('no header returns none', () => {
  assert.deepEqual(parseRange(undefined, 100), { kind: 'none' });
});

test('parses a normal range', () => {
  assert.deepEqual(parseRange('bytes=10-19', 100), { kind: 'range', range: { start: 10, end: 19 } });
});

test('open-ended range ends at file size', () => {
  assert.deepEqual(parseRange('bytes=90-', 100), { kind: 'range', range: { start: 90, end: 99 } });
});

test('suffix range keeps the tail', () => {
  assert.deepEqual(parseRange('bytes=-20', 100), { kind: 'range', range: { start: 80, end: 99 } });
});

test('clamps an oversized end', () => {
  assert.deepEqual(parseRange('bytes=95-200', 100), { kind: 'range', range: { start: 95, end: 99 } });
});

test('rejects invalid ranges', () => {
  assert.deepEqual(parseRange('bytes=100-', 100), { kind: 'invalid' });
  assert.deepEqual(parseRange('bytes=20-10', 100), { kind: 'invalid' });
  assert.deepEqual(parseRange('items=0-1', 100), { kind: 'invalid' });
  assert.deepEqual(parseRange('bytes=-0', 100), { kind: 'invalid' });
  assert.deepEqual(parseRange('bytes=0-1', 0), { kind: 'invalid' });
});
