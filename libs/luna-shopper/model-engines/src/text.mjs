/**
 * The reply text every adapter hands back, tidied the one way (plan 0001).
 *
 * Parsing the answer belongs to whoever wrote the prompt. What belongs here is
 * only the wrapper a model puts around an answer it did give.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/** A model that wrapped its object in a fence is still answering; unwrap it. */
export function stripFence(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  return trimmed
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```$/, '')
    .trim();
}
