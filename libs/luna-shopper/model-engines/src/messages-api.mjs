/**
 * The raw Anthropic Messages API, and the gate in front of it (plan 0001).
 *
 * This is the adapter that caches properly, because `cache_control` goes on the
 * system block with the packet outside it. It is not the default, because it
 * bills a key rather than the operator's logged in session, and that is what
 * the gate exists to say out loud.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { DEFAULT_EFFORT, DEFAULT_MODEL } from './claude-models.mjs';
import {
  RETRY_DELAYS,
  defaultSleep,
  stopReason,
  withRetries,
} from './retry.mjs';
import { addUsage } from './usage.mjs';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 8000;

/** The word the operator has to type before an API billed run starts. */
export const API_CONFIRMATION = 'API_KEY';

/** The text block of a Messages API reply, skipping any thinking block. */
export function textOf(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const block = blocks.find((entry) => entry?.type === 'text');
  return typeof block?.text === 'string' ? block.text : null;
}

/**
 * The gate in front of the API engine.
 *
 * API billing never happens unnoticed. A key that is set is announced and the
 * operator types one exact word to continue; anything else, or a terminal that
 * cannot be asked, ends the run before a request is made.
 */
export async function confirmApiBilling({
  env,
  isTty,
  askLine,
  stdout = process.stdout,
}) {
  const key = env?.ANTHROPIC_API_KEY;
  if (typeof key !== 'string' || key === '') {
    throw new Error(
      '--engine api needs ANTHROPIC_API_KEY, and it is not set. The default engine bills your Claude session instead.'
    );
  }
  if (!isTty) {
    throw new Error(
      `--engine api bills the Anthropic API with ANTHROPIC_API_KEY, and that has to be confirmed by typing ${API_CONFIRMATION}. There is no terminal to ask, so the run stops here.`
    );
  }
  stdout.write(
    `This run bills the Anthropic API with the ANTHROPIC_API_KEY in your environment.\nType ${API_CONFIRMATION} to continue, anything else to stop: `
  );
  const answer = await askLine();
  if (String(answer ?? '').trim() !== API_CONFIRMATION) {
    throw new Error(
      'Not confirmed, so nothing was billed. The run stops here.'
    );
  }
  return key;
}

/**
 * The raw Messages API path, carried over from the plan 0098 tool unchanged.
 *
 * The prompt is split back into a cached system block and a user message,
 * because the system block is stable across a whole run and is worth caching;
 * the caller hands both halves rather than one joined string.
 */
export function makeApiEngine({
  fetchImpl = fetch,
  apiKey,
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  usage = null,
  sleep = defaultSleep,
  retryDelays = RETRY_DELAYS,
  signal = null,
}) {
  return {
    name: 'api',
    model,
    effort,
    async ask(prompt, { system = null, schema = null } = {}) {
      const body = JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: {
          effort,
          // The same schema the claude engine passes as `--json-schema`, in the
          // shape the Messages API takes it. Both engines are held to the
          // decider's shape, so a run cannot depend on which one drove it.
          ...(schema ? { format: { type: 'json_schema', schema } } : {}),
        },
        ...(system
          ? {
              system: [
                {
                  type: 'text',
                  text: system,
                  cache_control: { type: 'ephemeral' },
                },
              ],
            }
          : {}),
        messages: [{ role: 'user', content: prompt }],
      });

      const text = await withRetries(
        async () => {
          let response;
          try {
            response = await fetchImpl(MESSAGES_URL, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
              },
              body,
              signal,
            });
          } catch (error) {
            if (signal?.aborted) {
              throw stopReason(signal);
            }
            return { ok: false, error: `the request failed: ${String(error)}` };
          }
          if (response.status === 429 || response.status >= 500) {
            return { ok: false, error: `HTTP ${response.status}` };
          }
          // A 401 or a 400 is the same answer however long the wait, so waiting
          // thirty seconds would only prove the key is still wrong.
          if (!response.ok) {
            return { ok: false, error: `HTTP ${response.status}`, fatal: true };
          }
          const payload = await response.json();
          if (usage) {
            addUsage(usage, payload?.usage);
          }
          const answer = textOf(payload);
          if (answer === null) {
            return { ok: false, error: 'the reply carried no text block' };
          }
          return { ok: true, value: answer };
        },
        { name: 'api', sleep, retryDelays, signal }
      );

      return { text };
    },
  };
}
