/**
 * A model on the machine that asked (plan 0002), asked more than one question
 * at a time (plan 0003).
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
  askEntry,
  defaultSleep,
  handleAbandoned,
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
 * The most tokens one answer may generate, unless `OLLAMA_NUM_PREDICT` says
 * otherwise.
 *
 * Ollama's own default is unlimited, and unlimited is not a safe setting for a
 * pool. A request that loops holds one server slot for as long as the model
 * keeps writing, and on a server with four slots that is a quarter of the
 * machine spent on an answer nobody will be able to parse. A curation decision
 * is a few hundred tokens of JSON, so this ceiling is several times the largest
 * honest answer and is only ever reached by a reply that has gone wrong.
 *
 * A truncated answer is not silently accepted: it is not one JSON object, so
 * `decideRow` asks again and then records a REVIEW.
 */
export const NUM_PREDICT_CEILING = 1024;

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
 * How many requests the pool holds in flight when the operator names none.
 *
 * Measured on the machine plan 0002 was measured on, eight real rows against a
 * server started with `OLLAMA_NUM_PARALLEL=4`: one at a time 18,950 ms, two in
 * flight 11,321 ms, four 8,418 ms, six 8,740 ms, eight 9,112 ms. Four is the
 * fastest and it is the slot count, which is the shape of the whole table.
 *
 * On a default server, which runs one request at a time, six rows took 13,507
 * ms one by one and 13,958 ms fired together, so 0.97x. That is inside the
 * noise, which is what makes four a safe default: it costs an operator who has
 * not tuned their server nothing and rewards one who has, without asking them
 * to configure a second thing.
 */
export const OLLAMA_DEFAULT_BATCH = 4;

/**
 * The widest batch that was measured, and above which a value is questioned.
 *
 * Six and eight in flight were both slower than four on a four slot server, so
 * a number above this one is a number nobody has evidence for. It is not
 * clamped, because the operator's machine is theirs to experiment on.
 */
export const OLLAMA_WIDEST_MEASURED_BATCH = 8;

/**
 * The widest batch this adapter will send at all.
 *
 * Ollama's own request queue is 512 deep by default, and a batch that overruns
 * it answers 503 to work the server had already accepted, which reads as a
 * server failure and is really the client asking for too much at once.
 */
export const OLLAMA_MAX_BATCH = 256;

/**
 * The one line stderr gets when the width is above what was measured.
 *
 * `OLLAMA_NUM_PARALLEL` is named because it is the number this one should
 * match, and the two knobs are independent: that one belongs to the server,
 * which may be on another machine, and nothing in Ollama's API reports it.
 */
export function wideBatchNotice(width) {
  return `OLLAMA_BATCH is ${width}, and ${OLLAMA_WIDEST_MEASURED_BATCH} is the widest batch measured: the optimum is the server's own OLLAMA_NUM_PARALLEL, and more requests in flight than that measured slower rather than faster (four in flight ran 2.25x against one at a time, eight ran 2.08x).\n`;
}

/**
 * The one line stderr gets when the server answered the first round one by one.
 *
 * `OLLAMA_BATCH` only pays when the server it talks to runs
 * `OLLAMA_NUM_PARALLEL` at least that high. The two knobs belong to two
 * machines and nothing in Ollama's API reports the server's value, so the only
 * way to learn it is to send a round and watch how it comes back. A server
 * running one request at a time turned a measured 2.2x into 6% and said
 * nothing, which is the whole reason this line exists.
 */
export function serializedNotice(width) {
  return `OLLAMA_BATCH is ${width}, and the server answered the first round one request at a time, so batching is buying nothing. Set OLLAMA_NUM_PARALLEL to ${width} or more on the machine running Ollama and restart it. On Windows that is a user environment variable, then the Ollama tray app restarted; the server writes OLLAMA_NUM_PARALLEL:<n> into %LOCALAPPDATA%\\Ollama\\server.log when it starts.\n`;
}

/**
 * Whether a round of requests came back as a staircase rather than together.
 *
 * Every request of the first round is sent at once, so a server with enough
 * slots answers them in about the same time and finishes them together, while a
 * server with one slot runs them end to end: the first takes `d`, the second
 * `2d`, the Nth `Nd`, and the finish times are `d` apart all the way up.
 *
 * Both halves are asked, and neither on its own would do. A ratio alone is met
 * by one genuinely long row among short ones. A spread of finish times alone is
 * met by a parallel server whose rows differ in length. Together they describe
 * the one shape a serialized server has and a parallel server cannot.
 *
 * It is deliberately a reading of the timings and never a claim about the
 * server's configuration, which this adapter cannot see. A false positive costs
 * one line on stderr.
 */
export function looksSerialized(timings) {
  const width = timings.length;
  if (width < 2 || timings.some((entry) => !entry)) {
    return false;
  }
  const durations = timings.map((entry) => entry.finishedAt - entry.startedAt);
  const fastest = Math.min(...durations);
  const slowest = Math.max(...durations);
  // A round that took no measurable time says nothing, and dividing by it would
  // report every fast server as serialized.
  if (!(fastest > 0)) {
    return false;
  }
  if (slowest < (width - 0.5) * fastest) {
    return false;
  }
  const finishes = timings
    .map((entry) => entry.finishedAt)
    .sort((first, second) => first - second);
  for (let index = 1; index < finishes.length; index++) {
    if (finishes[index] - finishes[index - 1] < fastest / 2) {
      return false;
    }
  }
  return true;
}

/**
 * How many requests `OLLAMA_BATCH` asks for, or the default when it says
 * nothing.
 *
 * A value this cannot read is refused here, while the engine is being built,
 * rather than when the first batch is asked for. A misconfigured knob should
 * stop a run before a slot is taken or a model is loaded, the way a misspelled
 * engine name does. The notice for a value above the measured optimum is the
 * other way round and is written when the first batch is actually sent, because
 * an engine that only ever answers `ask` has nothing to be warned about.
 */
export function ollamaBatchSize(env = {}) {
  const raw = String(env?.OLLAMA_BATCH ?? '').trim();
  if (raw === '') {
    return OLLAMA_DEFAULT_BATCH;
  }
  const width = positiveInteger(raw);
  if (width === null) {
    throw new Error(
      `OLLAMA_BATCH is ${raw}, and it has to be a whole number of requests, one or more. OLLAMA_BATCH=1 is how batching is turned off.`
    );
  }
  if (width > OLLAMA_MAX_BATCH) {
    throw new Error(
      `OLLAMA_BATCH is ${width}, and ${OLLAMA_MAX_BATCH} is the most this adapter holds in flight. Ollama's own queue is 512 deep by default, so a wider batch answers 503 to work the server had already accepted.`
    );
  }
  return width;
}

/**
 * How many rows a round covers, as a multiple of the in flight width, when the
 * operator names none (plan 0004).
 *
 * The two numbers answer two questions and this is the whole reason they are
 * two: `OLLAMA_BATCH` is how many requests the server is asked at once, which
 * is bounded by the server's own slot count, and the round is how many rows the
 * caller fetches and works through as one unit, which is bounded by nothing on
 * the server at all.
 *
 * A round only as wide as the pool pays a tail every round: the last request of
 * it is answered with every other slot already idle, and the caller then goes
 * away to fetch the next round before anything is sent again. A round three
 * times the width refills the slots eight more times before it pays that tail
 * once, and it costs the server nothing, because the pool still holds
 * `OLLAMA_BATCH` in flight and queues the rest here rather than there.
 *
 * Three is not a measured optimum and is not offered as one. It is the smallest
 * multiple that pays the tail a third as often, and `OLLAMA_ROUND` moves it.
 */
export const OLLAMA_DEFAULT_ROUND_MULTIPLIER = 3;

/**
 * How many rows `OLLAMA_ROUND` asks a round to cover, or the default when it
 * says nothing.
 *
 * Refused here, while the engine is being built, for the same reason
 * `OLLAMA_BATCH` is: a misconfigured knob should stop a run before a slot is
 * taken or a model is loaded.
 *
 * A round narrower than the width is not refused. It is not what anybody wants,
 * because it leaves slots with nothing to do, but the operator's machine is
 * theirs to experiment on and the caller clamps the round to what it can hand
 * out anyway.
 */
export function ollamaRoundSize(env = {}, width = OLLAMA_DEFAULT_BATCH) {
  const raw = String(env?.OLLAMA_ROUND ?? '').trim();
  if (raw === '') {
    return width * OLLAMA_DEFAULT_ROUND_MULTIPLIER;
  }
  const rows = positiveInteger(raw);
  if (rows === null) {
    throw new Error(
      `OLLAMA_ROUND is ${raw}, and it has to be a whole number of rows, one or more. It is how many rows the caller works through as one round, and OLLAMA_BATCH is how many requests are held in flight inside it.`
    );
  }
  return rows;
}

/**
 * The model's own context length, out of `/api/show`.
 *
 * The field is named for the model family and not for the tag the operator
 * typed (`gemma4.context_length` on the measured model, which was pulled as
 * `gemma4:12b`), so the family is read off the key rather than composed from
 * the model name.
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
 * this needs a server. `env` reaches `create` already, which is how the five
 * knobs this adapter has get here without a new flag:
 *
 * - `OLLAMA_HOST`: where the server listens, default `http://localhost:11434`.
 * - `OLLAMA_NUM_CTX`: the widest context window to ask for, default 16384.
 * - `OLLAMA_NUM_PREDICT`: the most tokens one answer may generate, default
 *   1024.
 * - `OLLAMA_BATCH`: how many requests the pool holds in flight, default 4.
 * - `OLLAMA_ROUND`: how many rows the caller is advised to work through as one
 *   round, default three times `OLLAMA_BATCH`, which is 12.
 *
 * **The two batching knobs are not the same knob, and only one of them is
 * worth raising on a single card.** `OLLAMA_BATCH` is bounded by the server's
 * own slot count: on the 4080 class card everything here was measured on, four
 * in flight ran 2.25x against one at a time, six and eight both ran slower than
 * four, so a value above 4 buys nothing and the reward for raising it is the
 * server's `OLLAMA_NUM_PARALLEL` rather than this. `OLLAMA_ROUND` is the lever
 * for what is left: a round only as wide as the pool pays a tail, where the
 * last request of it answers with every other slot already idle and the caller
 * then goes away to fetch the next round, and a wider round pays that tail and
 * that trip a third as often. It asks nothing more of the server, because the
 * pool still holds `OLLAMA_BATCH` in flight and queues the remainder here.
 *
 * **`OLLAMA_BATCH` is a client knob and it only pays against a server
 * configured to match.** Ollama answers `OLLAMA_NUM_PARALLEL` requests at a
 * time and queues the rest, so a batch of four against a server running one
 * slot is four requests run end to end and roughly the time of walking the rows
 * one by one. Set `OLLAMA_NUM_PARALLEL` on the machine running Ollama, to the
 * same number as `OLLAMA_BATCH` or higher. On Windows that is a user
 * environment variable and then the Ollama tray app restarted, and the server
 * writes `OLLAMA_NUM_PARALLEL:<n>` into `%LOCALAPPDATA%\Ollama\server.log`
 * when it starts, which is the one place the running value can be read. The
 * adapter cannot read it over the API, so it watches the first round instead
 * and writes `serializedNotice` to stderr when the answers came back one at a
 * time.
 *
 * `now` is the clock the first round is timed on, injected so the notice can be
 * tested without a slow server.
 */
export function makeOllamaEngine({
  fetchImpl = fetch,
  env = {},
  model = OLLAMA_DEFAULT_MODEL,
  usage = null,
  sleep = defaultSleep,
  retryDelays = RETRY_DELAYS,
  stderr = process.stderr,
  signal = null,
  now = () => Date.now(),
}) {
  const host = ollamaHost(env);
  const ceiling = positiveInteger(env?.OLLAMA_NUM_CTX) ?? NUM_CTX_CEILING;
  const predictCeiling =
    positiveInteger(env?.OLLAMA_NUM_PREDICT) ?? NUM_PREDICT_CEILING;
  const width = ollamaBatchSize(env);
  const rows = ollamaRoundSize(env, width);
  let noticed = false;
  let serialized = false;

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

  async function ask(prompt, { system = null, schema = null } = {}) {
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
      //
      // `num_predict` is always sent too, and for the pool rather than for the
      // row: Ollama generates without a limit by default, and one reply that
      // loops holds a server slot for minutes and blocks the requests beside
      // it. See `NUM_PREDICT_CEILING`.
      options: {
        num_ctx: numCtx,
        num_predict: predictCeiling,
        temperature: 0,
      },
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
  }

  /**
   * The pool: `batchSize` requests in flight, refilled as each one finishes.
   *
   * It is a fixed number of workers pulling from one queue rather than chunks
   * of `batchSize` run through `Promise.all`, and the difference is not
   * cosmetic. A chunk waits for its slowest member before the next chunk
   * starts, so one long row idles the other three slots for as long as it
   * takes; a worker that finishes takes the next prompt immediately. A curation
   * row measured between 1.0 and 2.4 seconds on the same model, so the spread a
   * chunk would wait on is real.
   *
   * Nor does it send the whole queue at once. Six and eight in flight were both
   * slower than four on a four slot server, so there is no reward for sending
   * everything and there is a small penalty.
   *
   * Every request it sends is the request above, unchanged: the same one
   * `num_ctx` for the whole engine, the truncation floor measured per reply,
   * `think`, `format`, `keep_alive` and `temperature: 0`. The pool decides when
   * a request is sent and nothing about what is in it.
   *
   * **The first round is timed, and a serialized server is named.** The width
   * this pool holds in flight only pays against a server whose own
   * `OLLAMA_NUM_PARALLEL` is at least as high, and nothing in Ollama's API
   * reports that number. So the first round, which is the one round every
   * request of starts at the same moment, is measured, and a staircase gets one
   * line on stderr. See `looksSerialized` and `serializedNotice`.
   *
   * It answers `{ answers, done }`: one promise per prompt, settled as each
   * reply arrives, and one promise for the workers themselves. `askEach` hands
   * back the first and `askMany` waits on the second, which is the only thing
   * the two of them do differently.
   */
  function runPool(prompts, options = {}) {
    if (width > OLLAMA_WIDEST_MEASURED_BATCH && !noticed) {
      noticed = true;
      stderr.write(wideBatchNotice(width));
    }

    // One promise per prompt, settled by the worker that answers it, so a
    // caller reading them in order works on the first answer while the rest are
    // still in flight (plan 0004). The array is in input order and the
    // settlements are in the order the server finished, which is exactly the
    // difference this buys.
    const settle = new Array(prompts.length);
    const answers = handleAbandoned(
      prompts.map(
        (unused, index) =>
          new Promise((resolve, reject) => {
            settle[index] = { resolve, reject };
          })
      )
    );
    let next = 0;

    // The first round is the prompts the workers take before any of them has
    // answered, which is one prompt per worker. Only those are timed: every
    // later request starts when a slot came free rather than at the same moment
    // as its neighbours, so their durations say nothing about the server.
    const roundWidth = Math.max(1, Math.min(width, prompts.length));
    const timings = new Array(roundWidth).fill(null);
    let timed = 0;

    const worker = async () => {
      for (;;) {
        // The signal is asked before a prompt is taken rather than after one is
        // answered, so a stop starts nothing further. What is already in flight
        // is aborted through the same signal, inside `ask`.
        if (signal?.aborted) {
          throw stopReason(signal);
        }
        const index = next;
        if (index >= prompts.length) {
          return;
        }
        next += 1;
        const startedAt = index < roundWidth ? now() : 0;
        // The answer settles the promise the prompt came with, so the order the
        // answers are read in is the order they were asked in and not the order
        // they finished in.
        settle[index].resolve(
          await askEntry(ask, prompts[index], options, signal)
        );
        if (index < roundWidth) {
          timings[index] = { startedAt, finishedAt: now() };
          timed += 1;
          // Read once the whole round is in, and at most once for the life of
          // the engine: the operator is told what to change, and repeating it
          // every batch would bury the run's own output.
          if (
            timed === roundWidth &&
            !serialized &&
            roundWidth > 1 &&
            looksSerialized(timings)
          ) {
            serialized = true;
            stderr.write(serializedNotice(width));
          }
        }
      }
    };

    // A width of one is one worker, which is plan 0002's behaviour exactly, and
    // there is no second code path for it. More workers than prompts would be
    // workers that find the queue empty and return, so the count is trimmed
    // rather than left to be discovered.
    const workers = [];
    for (
      let count = 0;
      count < Math.max(1, Math.min(width, prompts.length));
      count++
    ) {
      workers.push(worker());
    }
    // A stop reaches every prompt that has not answered yet, with the signal's
    // own reason, which is what a caller that pressed Ctrl+C is owed: an answer
    // about the run rather than an entry reporting the same stop as a failure.
    // Rejecting a promise that already settled does nothing, so the answers
    // that were in before the keystroke stay answers.
    const done = Promise.all(workers);
    done.catch((error) => {
      for (const slot of settle) {
        slot.reject(error);
      }
    });
    return { answers, done };
  }

  /**
   * One promise per prompt, settled as each reply arrives (plan 0004).
   *
   * The pool above, read one answer at a time. Nothing about what is sent
   * changes and nothing about the order the array is in changes: what the
   * caller gains is the right to act on the first answer before the last one
   * has been written, which for the curation walk is the decider running while
   * the card is still busy.
   */
  function askEach(prompts, options = {}) {
    return runPool(prompts, options).answers;
  }

  /**
   * The pool read to the end, in input order.
   *
   * The workers are awaited rather than only the answers, because a stop is not
   * an array of entries: it rejects this call with the signal's own reason,
   * including the stop that arrives after the last prompt of the batch was
   * answered.
   */
  async function askMany(prompts, options = {}) {
    const { answers, done } = runPool(prompts, options);
    await done;
    return Promise.all(answers);
  }

  return {
    name: 'ollama',
    model,
    // Effort is a Claude idea. The run reports null, which is true: nothing was
    // asked of a knob this provider does not have.
    effort: null,
    // The one adapter that overrides the shared default, and the number it
    // reports is the number it holds in flight. A caller reads this rather than
    // asking which adapter it is holding.
    batchSize: width,
    // How many rows a caller is advised to work through as one round, which is
    // a different question from how many requests are in flight inside it: this
    // one costs the server nothing and is what stops a round tail being paid
    // every few rows. See `ollamaRoundSize`.
    roundSize: rows,
    ask,
    askEach,
    askMany,
  };
}
