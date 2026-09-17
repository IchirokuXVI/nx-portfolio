/**
 * The five counters every run reports, in one place (plan 0001), and the
 * timings a provider that measured itself can add beside them (plan 0005).
 *
 * An adapter whose provider counts in its own words maps into these five and
 * does not invent a sixth, because the report and the price arithmetic above it
 * read these names and nothing else.
 *
 * The timings are not a sixth counter. That rule is about tokens, which every
 * provider counts and which the arithmetic above reads by name, and time is not
 * a token count. So it is a block of its own, it is optional, and nothing that
 * reads the five counters has to know it can be there. Only the Ollama adapter
 * fills it today, because only a server on this machine reports how long it
 * spent.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

export function emptyUsage() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

/**
 * Adds one reply's usage to the total, and its server side timings when it
 * carried any.
 *
 * The Messages API answers snake case and the Claude Code envelope answers the
 * same snake case under its own `usage`, so one reader covers both. Neither of
 * them reports a duration, so both pass two arguments and the block below never
 * appears in their totals.
 *
 * `timings` is one call's measurement, in milliseconds and tokens:
 * `{ totalMs, loadMs, promptTokens, promptEvalMs, evalTokens, evalMs }`. The
 * total holds the sums of those six plus a `calls` of its own, so decode
 * throughput is `evalTokens / (evalMs / 1000)` and the prompt share is
 * `promptEvalMs / totalMs`. Neither division is stored, because a division kept
 * beside its operands is a number that can disagree with them.
 *
 * The block is created by the first timed call and is absent otherwise, so a
 * report that carries no timings is saying the provider measured none rather
 * than claiming it measured zero.
 *
 * `timings.calls` counts the timed calls and is deliberately not `total.calls`,
 * which counts every call: a run may mix a provider that reports durations with
 * one that does not, and a rate divided by the wrong denominator is worse than
 * no rate.
 */
export function addUsage(total, usage, timings = null) {
  total.calls += 1;
  total.inputTokens += usage?.input_tokens ?? 0;
  total.outputTokens += usage?.output_tokens ?? 0;
  total.cacheReadInputTokens += usage?.cache_read_input_tokens ?? 0;
  total.cacheCreationInputTokens += usage?.cache_creation_input_tokens ?? 0;
  if (timings) {
    total.timings = addTimings(total.timings, timings);
  }
  return total;
}

/** The six sums and the call count, started from nothing on the first call. */
function addTimings(total, timings) {
  const sums = total ?? {
    calls: 0,
    totalMs: 0,
    loadMs: 0,
    promptTokens: 0,
    promptEvalMs: 0,
    evalTokens: 0,
    evalMs: 0,
  };
  sums.calls += 1;
  sums.totalMs += timings.totalMs ?? 0;
  sums.loadMs += timings.loadMs ?? 0;
  sums.promptTokens += timings.promptTokens ?? 0;
  sums.promptEvalMs += timings.promptEvalMs ?? 0;
  sums.evalTokens += timings.evalTokens ?? 0;
  sums.evalMs += timings.evalMs ?? 0;
  return sums;
}
