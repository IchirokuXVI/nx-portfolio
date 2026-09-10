/**
 * The one backoff loop every adapter runs its attempts through (plan 0001).
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
