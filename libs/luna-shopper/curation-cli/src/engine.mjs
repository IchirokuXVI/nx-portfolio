/**
 * The two ways a model call is made (plan 0001).
 *
 * Both answer the same thing: `{ text, usage }` for one prompt. The
 * orchestrator does not know which one it holds, and neither does the decider.
 * The model sees the prompt and nothing else: no url, no token, no slot number,
 * no remaining count.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The model both engines default to. */
export const DEFAULT_MODEL = 'claude-sonnet-5';

/** One model call has this long to answer before the run gives up on it. */
export const CLAUDE_TIMEOUT_MS = 120000;

/** Backoff between attempts, carried over from the plan 0098 tool. */
const RETRY_DELAYS = [2000, 8000, 30000];

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 8000;

/** The word the operator has to type before an API billed run starts. */
export const API_CONFIRMATION = 'API_KEY';

/**
 * The flags that empty a `claude -p` call of everything except the task.
 *
 * A default call carries Claude Code's tool schemas, its skills, and the
 * `CLAUDE.md` and memory index of whatever directory it runs in. Measured from
 * this repository, a call whose whole reply is the word `ok` costs **45,805**
 * input tokens; with these flags and a scratch cwd it costs **2,546**.
 *
 * Both halves are needed and neither substitutes for the other: the flags do
 * not stop `CLAUDE.md` loading (24,034 tokens from the repo root with them) and
 * a scratch cwd does not strip the tool schemas (23,244 tokens with those). The
 * cwd half is `scratchDir` below.
 *
 * `--safe-mode` is the third piece, and it is about the operator's own machine
 * rather than about this repository: a `SessionStart` hook fires on every
 * `claude -p` call, and a plugin that injects text is then billed once per row.
 * One installed here cost a measured **1,980 input tokens a call**, which is
 * more than the packet. The flag drops hooks, plugins and output styles and
 * leaves session authentication alone, so nothing this engine needs goes with
 * them. It does **not** stop the structured output retry below.
 *
 * `--bare` looks like the one flag for all of this and must not be used: it
 * skips `CLAUDE.md` discovery and auto-memory, but it also refuses OAuth and
 * demands `ANTHROPIC_API_KEY`, which is the billing this engine exists to
 * avoid. A `--bare` call with no key set returns an empty reply and zero usage.
 */
export const MINIMAL_ARGS = [
  '--tools',
  '',
  '--disable-slash-commands',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--safe-mode',
];

/**
 * What `--json-schema` costs when the model gets the call shape wrong.
 *
 * `--json-schema` is not a response format here. The CLI turns it into a
 * synthetic tool named `StructuredOutput` and makes the model call it, so a
 * tool input that fails the schema comes back as an error tool result and the
 * CLI **sends the whole prompt a second time**. That second request is billed
 * and is nearly invisible: `is_error` stays false, `stop_reason` stays
 * `tool_use`, and `usage.iterations[]` lists only the last request, so the one
 * signal is `usage.input_tokens` exceeding `iterations[0].input_tokens` by
 * about a whole prompt.
 *
 * Measured on the suggestions prompt and schema, six calls each: sonnet 5
 * retried **five times out of six** and haiku 4.5 **none**. Over a thirty row
 * run it was 21 of 30, and 39% of the sonnet dollars. What sonnet sends on the
 * failing call is the right decision in the wrong wrapper: the payload
 * stringified under `parameters`, `input` or `StructuredOutput`, or the literal
 * `{"$PARAMETER_NAME":"$PARAMETER_VALUE"}` template. It is a serialization
 * failure and not a judgment one.
 *
 * These four sentences fix it: measured 0 retries in 16 calls afterwards, the
 * same decisions, and $0.0367 a call down to $0.0157 with `--safe-mode`. There
 * is no flag for retry count or for validation strictness, so a sentence is the
 * whole of the fix. It is sent only when a schema is, because without one there
 * is no tool to name.
 */
export const TOOL_SHAPE_HINT = [
  '',
  '## How to send your answer',
  '',
  'You answer by calling the `StructuredOutput` tool exactly once. The object',
  'described above **is** the argument set of that call: pass every field of it',
  'as a top level argument. Never wrap them under a `parameter`, `parameters`,',
  '`input` or `StructuredOutput` key, and never pass the object as a JSON',
  'string. Never emit a placeholder name such as `$PARAMETER_VALUE`, and do not',
  'write the JSON as text before you call the tool.',
].join('\n');

/**
 * A directory with no `CLAUDE.md`, which is what the spawn runs in.
 *
 * One per engine rather than one per call: the flags and the system prompt are
 * identical on every call, so an unchanging prefix is what lets the server side
 * cache serve it. Measured across three separate processes, the 2,546 token
 * prefix came back as `read 2544, write 0` every time, at $0.00055 a call.
 */
export function makeScratchDir() {
  return mkdtempSync(join(tmpdir(), 'curation-claude-'));
}

/**
 * A wait that ends early when the run is stopped.
 *
 * The backoff between two failed attempts is up to thirty seconds, and a
 * Ctrl+C during it would otherwise be answered half a minute later, with the
 * terminal saying nothing in the meantime. The timer is cleared on the way
 * out, so a stopped run leaves nothing pending that would hold the process
 * open after the report is written.
 */
const defaultSleep = (ms, signal = null) =>
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

/** The text block of a Messages API reply, skipping any thinking block. */
export function textOf(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const block = blocks.find((entry) => entry?.type === 'text');
  return typeof block?.text === 'string' ? block.text : null;
}

/**
 * The child environment a `claude -p` call runs in.
 *
 * `ANTHROPIC_API_KEY` is deleted, so the call bills the operator's logged in
 * Claude session even when a key is exported globally. An operator who wants
 * the key billed says so with `--engine api`, and types a word to prove it.
 *
 * **`DISABLE_PROMPT_CACHING` is set, and the cache is a loss here without it.**
 * `claude -p` puts its cache breakpoint at the end of the request, after the
 * packet, and it takes no flag that moves it. Every row is a different packet,
 * so the prefix never matches: measured over four consecutive rows, every call
 * wrote about 3,478 tokens and read **zero**. A write is $4 per MTok against $2
 * for ordinary input, so paying it for an entry nothing ever reads doubles the
 * bill. With the variable set the same four rows sent 3,478 as plain input and
 * wrote nothing.
 *
 * An earlier reading of `read 2544, write 0` came from asking the same question
 * four times, where the whole request matched byte for byte. That is not this
 * workload. The api engine is the one that caches properly, because it can put
 * `cache_control` on the system block alone and leave the packet outside it.
 */
export function claudeChildEnv(env) {
  const copy = { ...env };
  const hadKey =
    typeof copy.ANTHROPIC_API_KEY === 'string' && copy.ANTHROPIC_API_KEY !== '';
  delete copy.ANTHROPIC_API_KEY;
  copy.DISABLE_PROMPT_CACHING = '1';
  return { env: copy, hadKey };
}

/**
 * The reply text of a `claude -p --output-format json` envelope.
 *
 * The shape was read off one live call rather than assumed: the envelope is one
 * JSON object carrying `type: "result"`, `subtype`, `is_error`, a `usage` block
 * in the Messages API's own snake case, and the reply text in `result`.
 */
export function readClaudeEnvelope(stdout) {
  const text = String(stdout ?? '').trim();
  if (text === '') {
    return { ok: false, error: 'the CLI answered nothing on stdout' };
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `the CLI answered something that is not JSON: ${String(error.message ?? error)}`,
    };
  }
  if (envelope?.is_error === true || envelope?.subtype === 'error') {
    return {
      ok: false,
      error: `the CLI reported an error: ${envelope?.result ?? envelope?.subtype ?? 'no detail'}`,
    };
  }
  if (typeof envelope?.result !== 'string') {
    return { ok: false, error: 'the envelope carried no result text' };
  }
  return { ok: true, text: envelope.result, usage: envelope.usage ?? null };
}

/**
 * The default engine: one locally installed Claude Code CLI per call.
 *
 * `spawn` is injected in every test and answers `{ code, stdout, stderr }` for
 * a command, its arguments, its stdin and its environment.
 */
export function makeClaudeEngine({
  spawn,
  env = process.env,
  model = DEFAULT_MODEL,
  timeoutMs = CLAUDE_TIMEOUT_MS,
  stderr = process.stderr,
  usage = null,
  sleep = defaultSleep,
  retryDelays = RETRY_DELAYS,
  scratchDir = null,
  signal = null,
}) {
  const { env: childEnv, hadKey } = claudeChildEnv(env);
  let noticed = false;
  // Made on the first call rather than here, so constructing an engine that is
  // never asked anything leaves no directory behind.
  let cwd = scratchDir;

  return {
    name: 'claude',
    model,
    async ask(prompt, { system = null, schema = null } = {}) {
      if (hadKey && !noticed) {
        noticed = true;
        stderr.write(
          'ANTHROPIC_API_KEY is set and is being ignored: this run bills your Claude session. Use --engine api to bill the key.\n'
        );
      }

      if (cwd === null) {
        cwd = makeScratchDir();
      }

      // `--system-prompt` replaces Claude Code's own system prompt rather than
      // appending to it, which is what makes the decider's rules the whole of
      // the model's standing context. `--append-system-prompt` would keep both.
      //
      // The hint goes on here rather than in a decider's `prompt.md` because it
      // is a fact about this CLI and not about the work: it is wrong for the
      // api engine, which has no such tool, and both deciders need it.
      const withHint =
        system && schema ? `${system}\n${TOOL_SHAPE_HINT}` : system;
      const args = [
        '-p',
        '--output-format',
        'json',
        '--model',
        model,
        ...(withHint ? ['--system-prompt', withHint] : []),
        ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
        ...MINIMAL_ARGS,
      ];

      let lastError = 'the call failed';
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (attempt > 0) {
          await sleep(retryDelays[attempt - 1], signal);
        }
        // A stopped run makes no further attempt. The child of an attempt that
        // was already running is killed through the same signal, below.
        if (signal?.aborted) {
          throw stopReason(signal);
        }
        let answer;
        try {
          answer = await spawn('claude', args, {
            input: prompt,
            env: childEnv,
            cwd,
            timeoutMs,
            signal,
          });
        } catch (error) {
          if (signal?.aborted) {
            throw stopReason(signal);
          }
          lastError = String(error?.message ?? error);
          continue;
        }
        if (answer.code !== 0) {
          // Ctrl+C reaches the whole terminal, so the child of the attempt in
          // flight dies of the same keystroke. That is a stop, not a failure
          // worth retrying.
          if (signal?.aborted) {
            throw stopReason(signal);
          }
          lastError = `exit ${answer.code}: ${(answer.stderr || '').trim().slice(0, 500)}`;
          continue;
        }
        const read = readClaudeEnvelope(answer.stdout);
        if (!read.ok) {
          lastError = read.error;
          continue;
        }
        if (usage) {
          addUsage(usage, read.usage);
        }
        return { text: read.text };
      }
      throw new Error(`The claude engine gave up: ${lastError}.`);
    },
  };
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
 * the orchestrator hands both halves rather than one joined string.
 */
export function makeApiEngine({
  fetchImpl = fetch,
  apiKey,
  model = DEFAULT_MODEL,
  usage = null,
  sleep = defaultSleep,
  retryDelays = RETRY_DELAYS,
  signal = null,
}) {
  return {
    name: 'api',
    model,
    async ask(prompt, { system = null, schema = null } = {}) {
      const body = JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
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

      let lastError = null;
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (attempt > 0) {
          await sleep(retryDelays[attempt - 1], signal);
        }
        if (signal?.aborted) {
          throw stopReason(signal);
        }
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
          lastError = new Error(`the request failed: ${String(error)}`);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (usage) {
          addUsage(usage, payload?.usage);
        }
        const text = textOf(payload);
        if (text === null) {
          lastError = new Error('the reply carried no text block');
          continue;
        }
        return { text };
      }
      throw new Error(
        `The api engine gave up: ${lastError?.message ?? 'unknown'}.`
      );
    },
  };
}
