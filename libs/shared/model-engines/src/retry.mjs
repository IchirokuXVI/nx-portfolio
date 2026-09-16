/**
 * The one backoff loop every adapter runs its attempts through (plan 0001),
 * and the one way a list of prompts is asked (plan 0003), whether the caller
 * wants the answers together or one at a time (plan 0004).
 *
 * An adapter says what one attempt is and what its failures mean. It does not
 * say how many attempts there are, how long the waits between them last, or
 * what a run that was stopped does, because those three answers must be the
 * same whichever provider answered.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/** Backoff between attempts, carried over from the plan 0098 tool. */
export const RETRY_DELAYS = [2000, 8000, 30000];

/**
 * A wait that ends early when the run is stopped.
 *
 * The backoff between two failed attempts is up to thirty seconds, and a
 * Ctrl+C during it would otherwise be answered half a minute later, with the
 * terminal saying nothing in the meantime. The timer is cleared on the way
 * out, so a stopped run leaves nothing pending that would hold the process
 * open after the report is written.
 */
export const defaultSleep = (ms, signal = null) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });

/**
 * The error a stopped run fails with: the reason the caller aborted with.
 *
 * Nothing here invents an error of its own, so the orchestrator recognizes a
 * stop by asking the signal rather than by reading a message.
 */
export function stopReason(signal) {
  return signal?.reason ?? new Error('the run was stopped');
}

/**
 * Runs one attempt until it answers, and gives up in the words every engine
 * gives up in.
 *
 * `attempt` answers one of three things:
 *
 * - `{ ok: true, value }`, which is the answer;
 * - `{ ok: false, error }`, a failure worth another attempt;
 * - `{ ok: false, error, fatal: true }`, a failure no wait can fix.
 *
 * The third case is not decoration. The Messages API adapter retries a 429 and
 * a 5xx and refuses to retry a 401, and a loop that could not express the
 * difference would spend thirty seconds proving that a key is still wrong.
 *
 * A stop is not a failure and is not answered: an attempt that sees the signal
 * aborted throws `stopReason(signal)`, which travels straight out of here.
 */
export async function withRetries(
  attempt,
  { name, sleep = defaultSleep, retryDelays = RETRY_DELAYS, signal = null }
) {
  let lastError = 'the call failed';
  for (let index = 0; index <= retryDelays.length; index++) {
    if (index > 0) {
      await sleep(retryDelays[index - 1], signal);
    }
    // A stopped run makes no further attempt. The work of an attempt that was
    // already running is stopped through the same signal, by the adapter.
    if (signal?.aborted) {
      throw stopReason(signal);
    }
    const outcome = await attempt();
    if (outcome.ok) {
      return outcome.value;
    }
    lastError = outcome.error;
    if (outcome.fatal) {
      break;
    }
  }
  throw new Error(`The ${name} engine gave up: ${lastError}.`);
}

/**
 * One prompt's entry in a batch: `{ text }` when it answered, `{ error }` when
 * the engine gave up on it (plan 0003).
 *
 * `ask` throws when it gives up, which is the right answer for a caller holding
 * one question and the wrong one for a caller holding two hundred, because a
 * throw discards every answer beside the one that failed. On a batch that is
 * the wrong trade, so the throw is caught here and reported in the slot
 * belonging to the prompt that failed. The rest of the answers survive.
 *
 * A stop is the one thing that is not caught. A stopped run is not a run that
 * failed two hundred times, so the signal is asked before the error is read and
 * the reason the caller aborted with travels straight out.
 */
export async function askEntry(ask, prompt, options = {}, signal = null) {
  try {
    const { text } = await ask(prompt, options);
    return { text };
  } catch (error) {
    if (signal?.aborted) {
      throw stopReason(signal);
    }
    return { error };
  }
}

/**
 * Marks every promise of a batch handled, and hands the same array back.
 *
 * A caller reading `askEach` one promise at a time is allowed to stop reading
 * half way through, on a Ctrl+C or on a row whose own work threw, and that is
 * the point of handing it promises rather than a resolved list. But a promise
 * that rejects with nobody attached to it ends the Node process, so a stop
 * would take the run down through the very promises the caller had decided not
 * to read.
 *
 * An empty catch is the whole of the fix, and it changes nothing a caller sees:
 * a promise that is already handled still rejects for an `await` that arrives
 * later.
 */
export function handleAbandoned(promises) {
  for (const promise of promises) {
    promise.catch(() => undefined);
  }
  return promises;
}

/**
 * The shared `askEach`: one request at a time, one promise per prompt, in input
 * order (plan 0004).
 *
 * Each promise settles when its own prompt has been answered, so a caller can
 * work on the first answer while the rest are still being asked. This one asks
 * serially, so the promises settle in the order they were asked; an adapter
 * that holds several requests in flight settles them in the order its server
 * finished, which is the whole reason a caller wants them one at a time.
 *
 * Batching turns off where it is not supported, and that is this library's job
 * rather than each adapter's. Every adapter is given this and reports
 * `batchSize: 1`; an adapter with a reason to hold more than one request in
 * flight overrides both `askEach` and `askMany` and says how many in
 * `batchSize`. So a fourth engine that never thought about batching still
 * answers the whole contract correctly, and no caller has to ask which adapter
 * it is holding.
 *
 * The signal is asked before each prompt as well as inside it, so a stop that
 * arrives between two answers starts nothing further. The stop travels into
 * every promise behind the one it landed on, because the chain each of them
 * waits on is the one that rejected.
 */
export function askEachInOrder(ask, prompts, options = {}, signal = null) {
  let chain = Promise.resolve(null);
  const answers = prompts.map((prompt) => {
    chain = chain.then(() => {
      if (signal?.aborted) {
        throw stopReason(signal);
      }
      return askEntry(ask, prompt, options, signal);
    });
    return chain;
  });
  return handleAbandoned(answers);
}

/**
 * The shared `askMany`: one request at a time, answers in input order.
 *
 * It is `askEach` read to the end, and there is no second loop behind it: a
 * caller with no use for the answers as they arrive should not have to write
 * one, and two implementations of the same walk would be two places for a stop
 * to be handled differently.
 */
export async function askManyInOrder(
  ask,
  prompts,
  options = {},
  signal = null
) {
  return Promise.all(askEachInOrder(ask, prompts, options, signal));
}
