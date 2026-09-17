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

test('a total with no timings is exactly what it was before there were any', () => {
  const total = addUsage(emptyUsage(), { input_tokens: 10, output_tokens: 3 });

  // The claude and Messages API adapters pass two arguments, and this is the
  // assertion that keeps their totals the shape the reports already read.
  assert.deepEqual(Object.keys(total), [
    'calls',
    'inputTokens',
    'outputTokens',
    'cacheReadInputTokens',
    'cacheCreationInputTokens',
  ]);
  assert.equal(total.timings, undefined);
});

test('the first timed call creates the block and the second adds to it', () => {
  const total = emptyUsage();
  addUsage(
    total,
    { input_tokens: 93, output_tokens: 42 },
    {
      totalMs: 2400,
      loadMs: 6900,
      promptTokens: 2993,
      promptEvalMs: 300,
      evalTokens: 42,
      evalMs: 2000,
    }
  );
  addUsage(
    total,
    { input_tokens: 90, output_tokens: 40 },
    {
      totalMs: 2200,
      loadMs: 0,
      promptTokens: 2980,
      promptEvalMs: 200,
      evalTokens: 40,
      evalMs: 1900,
    }
  );

  assert.deepEqual(total.timings, {
    calls: 2,
    totalMs: 4600,
    loadMs: 6900,
    promptTokens: 5973,
    promptEvalMs: 500,
    evalTokens: 82,
    evalMs: 3900,
  });
  // The five counters are unaffected by the block beside them.
  assert.equal(total.calls, 2);
  assert.equal(total.inputTokens, 183);
});

test('a call with no timings does not count against the ones that had them', () => {
  const total = emptyUsage();
  addUsage(
    total,
    { input_tokens: 1, output_tokens: 1 },
    {
      totalMs: 1000,
      loadMs: 0,
      promptTokens: 10,
      promptEvalMs: 100,
      evalTokens: 5,
      evalMs: 500,
    }
  );
  addUsage(total, { input_tokens: 1, output_tokens: 1 });

  // A rate divided by the wrong denominator is worse than no rate, so the
  // timed calls are counted here and never read off `calls`.
  assert.equal(total.calls, 2);
  assert.equal(total.timings.calls, 1);
  assert.equal(total.timings.evalTokens, 5);
});

test('a timings block missing a field adds it as nothing rather than as NaN', () => {
  const total = addUsage(emptyUsage(), undefined, {
    evalTokens: 7,
    evalMs: 700,
  });

  assert.deepEqual(total.timings, {
    calls: 1,
    totalMs: 0,
    loadMs: 0,
    promptTokens: 0,
    promptEvalMs: 0,
    evalTokens: 7,
    evalMs: 700,
  });
});
