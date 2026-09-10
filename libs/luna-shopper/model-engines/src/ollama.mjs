/**
 * A model on the machine that asked (plan 0002).
 *
 * `POST {host}/api/chat` against a local Ollama server, one object per call,
 * `stream: false`, and the reply's `message.content` is the `{ text }` the
 * contract promises. Everything measured for this adapter was measured on a
 * live server: Ollama 0.34.0, `gemma4:12b`, freshly installed with default
 * settings.
 *
 * There is no envelope here, no harness prompt, no hook, no plugin and no
 * session, so the tokens the model reads are the tokens the caller wrote. What
 * this file is built around instead is the one way a local server answers
 * wrongly without saying so, which is the context window below.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import {
  RETRY_DELAYS,
  defaultSleep,
  stopReason,
  withRetries,
} from './retry.mjs';
import { stripFence } from './text.mjs';
import { addUsage } from './usage.mjs';

/** The model this plan was measured on, and the one the registry defaults to. */
export const OLLAMA_DEFAULT_MODEL = 'gemma4:12b';

/** Where Ollama listens when the operator has not moved it. */
export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';

/**
 * How long the server is asked to keep the model resident between rows.
 *
 * A cold load was measured at 4.8 to 6.9 seconds against 2.5 seconds for a
 * decision, and a model left alone unloads itself, so a run that let it go
 * would pay the load again a few rows later.
 */
export const KEEP_ALIVE = '30m';

/**
 * The largest context window this adapter asks for, in tokens.
 *
 * The model's own context length is 262,144 on the measured model, which on a
 * 12B model asks for more memory than the machine has. This ceiling is five
 * times the largest real prompt measured here, and `OLLAMA_NUM_CTX` raises or
 * lowers it for an operator with a longer packet or a smaller machine.
 */
export const NUM_CTX_CEILING = 16384;

/**
 * The most generous characters per token this workload could honestly run at.
 *
 * Text here was measured between 2.6 and 3.3 characters per token at both ends
 * of the range (127,651 characters to 48,426 tokens, and 10,163 characters to
 * 3,080 tokens), so six is roughly double the loosest measurement. The margin
 * is deliberate: see `truncationFloor`.
 */
export const CHARACTERS_PER_TOKEN = 6;

/**
 * The fewest prompt tokens a prompt of `characters` could honestly evaluate to.
 *
 * Ollama publishes no tokenizer endpoint and reports no truncation flag, so
 * there is no exact check to make. This is the sound one sided one, and a
 * guess that is wrong in the safe direction is the point. The cost of a floor
 * set too low is a truncation that slips through, which is the behaviour there
 * would be with no check at all; the cost of one set too high is a refusal on
 * a good reply, which is worse. It caught the measured truncation by an order
 * of magnitude all the same: 2,051 evaluated against a floor of 21,275.
 */
export function truncationFloor(characters) {
  return Math.floor(characters / CHARACTERS_PER_TOKEN);
}

/**
 * The address `OLLAMA_HOST` names, with a scheme.
 *
 * `OLLAMA_HOST` is Ollama's own variable and its value is written both as a
 * URL and bare as `host:port`, so the adapter adds the scheme when there is
 * none rather than failing on a value the operator copied out of Ollama's own
 * documentation.
 */
export function ollamaHost(env = {}) {
  const raw = String(env?.OLLAMA_HOST ?? '').trim();
  if (raw === '') {
    return OLLAMA_DEFAULT_HOST;
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

/** A positive whole number in an environment variable, or null. */
function positiveInteger(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The model's own context length, out of `/api/show`.
 *
 * The field is named for the model family (`gemma3.context_length` on the
 * measured model), so the family is read off the key rather than guessed from
 * anything else the reply carries.
 */
export function modelContextLength(shown) {
  const info = shown?.model_info;
  if (!info || typeof info !== 'object') {
    return null;
  }
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith('.context_length') && Number.isInteger(value)) {
      return value;
    }
  }
  return null;
}

/**
 * The local Ollama path.
 *
 * `fetchImpl` is the injected test seam the whole suite runs on, so none of
 * this needs a server. `env` reaches `create` already, which is how the two
 * knobs this adapter has (`OLLAMA_HOST` and `OLLAMA_NUM_CTX`) get here without
 * a new flag.
 */
export function makeOllamaEngine({
  fetchImpl = fetch,
  env = {},
  model = OLLAMA_DEFAULT_MODEL,
  usage = null,
  sleep = defaultSleep,
  retryDelays = RETRY_DELAYS,
  signal = null,
}) {
  const host = ollamaHost(env);
  const ceiling = positiveInteger(env?.OLLAMA_NUM_CTX) ?? NUM_CTX_CEILING;

  /**
   * The answer to `/api/show`, asked once and held for the life of the engine.
   *
   * One request answers both questions this adapter has about the model: what
   * it can do, and how wide its window is. It runs on the first `ask` and
   * never in `create`, because `create` is synchronous for the two adapters
   * that already exist and making it async to suit a third would be exactly
   * the reaching back into the contract that plan 0001 said must not happen.
   *
   * The promise rather than the value is what is held, so two `ask` calls in
   * flight at once still ask the server once.
   */
  let profile = null;

  async function describeModel() {
    let shown = null;
    try {
      const response = await fetchImpl(`${host}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model }),
        signal,
      });
      if (response.ok) {
        shown = await response.json();
      }
    } catch {
      // The probe is the adapter asking a question it can answer without, and
      // a server that cannot be reached is about to say so much more clearly
      // through `/api/chat`, where a refused connection is fatal and names
      // `ollama serve`. Reporting it from here would name the wrong endpoint.
      shown = null;
    }

    const capabilities = Array.isArray(shown?.capabilities)
      ? shown.capabilities
      : [];
    const contextLength = modelContextLength(shown);
    return {
      // Ollama refuses `think` on a model that does not support it, and the
      // operator's model is their choice, so the flag travels only when the
      // model declared it can think.
      thinks: capabilities.includes('thinking'),
      // A window this adapter could not read is the ceiling: it is the value
      // that was chosen to be safe on this machine, and inheriting the server
      // default is the one thing this adapter never does.
      numCtx:
        contextLength === null ? ceiling : Math.min(contextLength, ceiling),
    };
  }

  return {
    name: 'ollama',
    model,
    // Effort is a Claude idea. The run reports null, which is true: nothing was
    // asked of a knob this provider does not have.
    effort: null,
    async ask(prompt, { system = null, schema = null } = {}) {
      if (!profile) {
        profile = describeModel();
      }
      const { thinks, numCtx } = await profile;

      const messages = [
        // The two halves stay two messages, which is the split the contract
        // already requires. It pays for itself here for a reason of its own:
        // Ollama caches the prompt prefix by itself, with no request field and
        // no `cache_control`, and the system prompt is the prefix. Measured
        // over eight rows, the first call read nothing from cache and every
        // later one read the whole 2,900 token system prompt. Joining the two
        // halves into one string would put the packet inside the prefix and
        // lose the cache on every row.
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ];
      const body = JSON.stringify({
        model,
        stream: false,
        ...(thinks ? { think: false } : {}),
        // The schema goes in `format`, as the JSON schema itself, and the reply
        // comes back as a bare JSON object. `TOOL_SHAPE_HINT` is not sent, for
        // the same reason the Messages API adapter does not send it: there is
        // no synthetic tool here to mis-serialize a call to, so telling the
        // model to pass fields as top level arguments of a tool call would be
        // describing a mechanism it is not using.
        ...(schema ? { format: schema } : {}),
        keep_alive: KEEP_ALIVE,
        // `num_ctx` is always sent and the server default is never inherited:
        // Ollama's default window is small, it drops the front of an oversized
        // prompt, and the reply that comes back is a confident wrong answer
        // that is indistinguishable from a right one. Applied to curation, the
        // front of the prompt is the rules. The value is the same on every call
        // of one engine, because a changed `num_ctx` reloads the model: 1 ms of
        // load for a repeated value against 4,495 ms the moment it changed.
        //
        // `temperature: 0` because a curation row has one right answer and a
        // rerun of it gives the same one.
        options: { num_ctx: numCtx, temperature: 0 },
        messages,
      });

      // What the floor is measured against is everything that was sent to be
      // read, which is both halves.
      const characters =
        (system ? system.length : 0) + String(prompt ?? '').length;
      const floor = truncationFloor(characters);

      const text = await withRetries(
        async () => {
          let response;
          try {
            response = await fetchImpl(`${host}/api/chat`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body,
              signal,
            });
          } catch (error) {
            // The signal is asked first and the error is never read, which
            // matters more here than anywhere else in this library: an aborted
            // `fetch` and a refused connection both arrive as a `TypeError`,
            // and a stop misread as a connection failure would ask somebody who
            // pressed Ctrl+C whether Ollama is running.
            if (signal?.aborted) {
              throw stopReason(signal);
            }
            if (error?.cause?.code === 'ECONNREFUSED') {
              return {
                ok: false,
                error: `nothing is listening at ${host}, so the connection was refused. Start the server with \`ollama serve\`, or point OLLAMA_HOST at the one that is running`,
                fatal: true,
              };
            }
            return { ok: false, error: `the request failed: ${String(error)}` };
          }
          if (response.status >= 500) {
            return { ok: false, error: `HTTP ${response.status}` };
          }
          // A model that is not pulled is the same answer forty seconds later,
          // so a loop that could not say so would spend the backoff proving it.
          if (response.status === 404) {
            return {
              ok: false,
              error: `HTTP 404, so the server does not have ${model}. Pull it with \`ollama pull ${model}\``,
              fatal: true,
            };
          }
          if (!response.ok) {
            return { ok: false, error: `HTTP ${response.status}`, fatal: true };
          }

          const payload = await response.json();
          const promptTokens = payload?.prompt_eval_count;
          const cached = payload?.prompt_eval_cached_count ?? 0;
          if (typeof promptTokens === 'number' && promptTokens < floor) {
            // The same request truncates the same way, so this is fatal and no
            // wait is spent on it. What was dropped is the front of the prompt,
            // which is where the rules are.
            return {
              ok: false,
              error: `the server evaluated ${promptTokens} prompt tokens, and ${characters} characters cannot honestly be fewer than ${floor}, so the prompt was truncated at num_ctx ${numCtx} and the front of it, where the rules are, was dropped. Raise OLLAMA_NUM_CTX above ${numCtx}`,
              fatal: true,
            };
          }

          if (usage) {
            // The mapping is not a rename. `prompt_eval_count` includes the
            // cached tokens and Anthropic's `input_tokens` excludes them, so
            // adding the raw field would count the system prompt twice on every
            // row after the first. `cache_creation_input_tokens` is zero rather
            // than absent because Ollama neither charges for filling its cache
            // nor reports a number for it.
            addUsage(usage, {
              input_tokens: Math.max(0, (promptTokens ?? 0) - cached),
              output_tokens: payload?.eval_count ?? 0,
              cache_read_input_tokens: cached,
              cache_creation_input_tokens: 0,
            });
          }

          const answer = payload?.message?.content;
          if (typeof answer !== 'string' || answer === '') {
            return { ok: false, error: 'the reply carried no message content' };
          }
          // A model that fenced its object is still answering. The measured
          // model never did, and unwrapping costs nothing.
          return { ok: true, value: stripFence(answer) };
        },
        { name: 'ollama', sleep, retryDelays, signal }
      );

      return { text };
    },
  };
}
