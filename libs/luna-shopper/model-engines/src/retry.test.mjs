import assert from 'node:assert/strict';
import test from 'node:test';
import { withRetries } from './retry.mjs';

test('an attempt that answers is the answer, and nothing waits', async () => {
  let waits = 0;
  const value = await withRetries(async () => ({ ok: true, value: 'yes' }), {
    name: 'claude',
    sleep: async () => {
      waits += 1;
    },
    retryDelays: [1, 1],
  });

  assert.equal(value, 'yes');
  assert.equal(waits, 0);
});

test('a failed attempt is tried again, and the last reason is the one reported', async () => {
  const reasons = ['first went wrong', 'second went wrong', 'third went wrong'];
  let calls = 0;
  const waited = [];

  await assert.rejects(
    () =>
      withRetries(async () => ({ ok: false, error: reasons[calls++] }), {
        name: 'claude',
        sleep: async (ms) => waited.push(ms),
        retryDelays: [1, 2],
      }),
    /The claude engine gave up: third went wrong\./
  );

  assert.equal(calls, 3);
  assert.deepEqual(waited, [1, 2]);
});

test('a fatal attempt stops at once and waits for nothing', async () => {
  let calls = 0;
  let waits = 0;

  await assert.rejects(
    () =>
      withRetries(
        async () => {
          calls += 1;
          // The Messages API adapter answers this for a 401: no wait makes a
          // wrong key right, so thirty seconds would only prove it again.
          return { ok: false, error: 'HTTP 401', fatal: true };
        },
        {
          name: 'api',
          sleep: async () => {
            waits += 1;
          },
          retryDelays: [1, 1, 1],
        }
      ),
    /The api engine gave up: HTTP 401\./
  );

  assert.equal(calls, 1);
  assert.equal(waits, 0);
});

test('a stopped run makes no further attempt and fails with the signal reason', async () => {
  const controller = new AbortController();
  let calls = 0;

  await assert.rejects(
    () =>
      withRetries(
        async () => {
          calls += 1;
          controller.abort(new Error('the run was stopped with Ctrl+C'));
          return { ok: false, error: 'never reported' };
        },
        {
          name: 'claude',
          sleep: async () => undefined,
          retryDelays: [1, 1],
          signal: controller.signal,
        }
      ),
    /stopped with Ctrl\+C/
  );

  assert.equal(calls, 1);
});

test('a run stopped before the first attempt asks nothing at all', async () => {
  const controller = new AbortController();
  controller.abort(new Error('the run was stopped with Ctrl+C'));
  let calls = 0;

  await assert.rejects(
    () =>
      withRetries(
        async () => {
          calls += 1;
          return { ok: true, value: 'x' };
        },
        { name: 'claude', retryDelays: [1], signal: controller.signal }
      ),
    /stopped with Ctrl\+C/
  );

  assert.equal(calls, 0);
});
