/**
 * The five counters every run reports, in one place (plan 0001).
 *
 * An adapter whose provider counts in its own words maps into these five and
 * does not invent a sixth, because the report and the price arithmetic above it
 * read these names and nothing else.
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
 * Adds one reply's usage to the total.
 *
 * The Messages API answers snake case and the Claude Code envelope answers the
 * same snake case under its own `usage`, so one reader covers both.
 */
export function addUsage(total, usage) {
  total.calls += 1;
  total.inputTokens += usage?.input_tokens ?? 0;
  total.outputTokens += usage?.output_tokens ?? 0;
  total.cacheReadInputTokens += usage?.cache_read_input_tokens ?? 0;
  total.cacheCreationInputTokens += usage?.cache_creation_input_tokens ?? 0;
  return total;
}
