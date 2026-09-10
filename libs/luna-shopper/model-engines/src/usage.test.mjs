import assert from 'node:assert/strict';
import test from 'node:test';
import { addUsage, emptyUsage } from './usage.mjs';

test('a reply that carried no usage at all still counts as a call', () => {
  assert.deepEqual(addUsage(emptyUsage(), undefined), {
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
});

test('the five counters add up across calls', () => {
  const total = emptyUsage();
  addUsage(total, {
    input_tokens: 10,
    output_tokens: 3,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 7,
  });
  addUsage(total, { input_tokens: 5, output_tokens: 1 });

  assert.deepEqual(total, {
    calls: 2,
    inputTokens: 15,
    outputTokens: 4,
    cacheReadInputTokens: 100,
    cacheCreationInputTokens: 7,
  });
});
