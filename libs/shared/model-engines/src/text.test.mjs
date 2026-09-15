import assert from 'node:assert/strict';
import test from 'node:test';
import { stripFence } from './text.mjs';

test('a fenced object is still an answer', () => {
  assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFence('  {"a":1} '), '{"a":1}');
  assert.equal(stripFence(null), '');
});
