import assert from 'node:assert/strict';
import test from 'node:test';
import { askEntry, askManyInOrder, withRetries } from './retry.mjs';

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

/**
 * An `ask` that answers after a delay of the caller's choosing and records how
 * many calls were in flight at once, which is what "one at a time" is asserted
 * against.
 */
function recordingAsk({ delayFor = () => 0, failOn = [] } = {}) {
  const seen = { started: [], finished: [], options: [], peak: 0 };
  let inFlight = 0;
  const ask = async (prompt, options = {}) => {
    seen.started.push(prompt);
    seen.options.push(options);
    inFlight += 1;
    seen.peak = Math.max(seen.peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, delayFor(prompt)));
    inFlight -= 1;
    seen.finished.push(prompt);
    if (failOn.includes(prompt)) {
      throw new Error(`The test engine gave up: ${prompt} went wrong.`);
    }
    return { text: `answer to ${prompt}` };
  };
  return { ask, seen };
}

test('the shared default holds one request in flight and answers in input order', async () => {
  // The first prompt is the slowest, so an implementation that answered in
  // completion order would answer this list backwards.
  const { ask, seen } = recordingAsk({
    delayFor: (prompt) => (prompt === 'a' ? 20 : 1),
  });

  const answers = await askManyInOrder(ask, ['a', 'b', 'c']);

  assert.equal(seen.peak, 1);
  assert.deepEqual(seen.started, ['a', 'b', 'c']);
  assert.deepEqual(answers, [
    { text: 'answer to a' },
    { text: 'answer to b' },
    { text: 'answer to c' },
  ]);
});

test('a prompt the engine gave up on is an entry, and the rest still answer', async () => {
  const { ask } = recordingAsk({ failOn: ['b'] });

  const answers = await askManyInOrder(ask, ['a', 'b', 'c']);

  // `ask` throws when it gives up, and a batch that threw would discard every
  // answer beside the one that failed.
  assert.equal(answers.length, 3);
  assert.equal(answers[0].text, 'answer to a');
  assert.equal(answers[2].text, 'answer to c');
  assert.equal(answers[1].text, undefined);
  assert.match(String(answers[1].error), /b went wrong/);
});

test('the same options reach every prompt, and nothing else does', async () => {
  const { ask, seen } = recordingAsk();
  const options = { system: 'THE RULES', schema: { type: 'object' } };

  await askManyInOrder(ask, ['a', 'b'], options);

  // `askMany` receives a list of prompts and nothing else: no row count, no
  // queue length, nothing about the run.
  assert.deepEqual(seen.options, [options, options]);
});

test('a stop rejects with the signal reason rather than answering entries', async () => {
  const controller = new AbortController();
  const { ask, seen } = recordingAsk();
  const stopping = async (prompt, options) => {
    const answer = await ask(prompt, options);
    if (prompt === 'b') {
      controller.abort(new Error('the run was stopped with Ctrl+C'));
    }
    return answer;
  };

  // A stopped run is not a run that failed three times, so it is an answer
  // about the run rather than an array of answers about prompts.
  await assert.rejects(
    () => askManyInOrder(stopping, ['a', 'b', 'c', 'd'], {}, controller.signal),
    /stopped with Ctrl\+C/
  );
  assert.deepEqual(seen.started, ['a', 'b']);
});

test('a batch stopped before it starts asks nothing at all', async () => {
  const controller = new AbortController();
  controller.abort(new Error('the run was stopped with Ctrl+C'));
  const { ask, seen } = recordingAsk();

  await assert.rejects(
    () => askManyInOrder(ask, ['a', 'b'], {}, controller.signal),
    /stopped with Ctrl\+C/
  );
  assert.deepEqual(seen.started, []);
});

test('an empty list is an empty answer and asks nothing', async () => {
  const { ask, seen } = recordingAsk();
  assert.deepEqual(await askManyInOrder(ask, []), []);
  assert.deepEqual(seen.started, []);
});

test('askEntry reports a failure and lets a stop through', async () => {
  const controller = new AbortController();
  const failing = async () => {
    throw new Error('it went wrong');
  };

  const entry = await askEntry(failing, 'a');
  assert.match(String(entry.error), /it went wrong/);

  controller.abort(new Error('the run was stopped with Ctrl+C'));
  await assert.rejects(
    () => askEntry(failing, 'a', {}, controller.signal),
    /stopped with Ctrl\+C/
  );
});
