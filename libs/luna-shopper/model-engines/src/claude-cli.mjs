/**
 * The locally installed Claude Code CLI, one spawn per call (plan 0001).
 *
 * It is the default adapter because it bills the operator's logged in session.
 * The model sees the prompt and the standing half and nothing else: no url, no
 * token, no slot number, no remaining count.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_EFFORT, DEFAULT_MODEL } from './claude-models.mjs';
import {
  RETRY_DELAYS,
  askManyInOrder,
  defaultSleep,
  stopReason,
  withRetries,
} from './retry.mjs';
import { addUsage } from './usage.mjs';

/** One model call has this long to answer before the run gives up on it. */
export const CLAUDE_TIMEOUT_MS = 120000;

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
 * is no tool to name, and it belongs to this adapter rather than to a decider's
 * `prompt.md` because the Messages API adapter has no such tool.
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
  effort = DEFAULT_EFFORT,
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

  async function ask(prompt, { system = null, schema = null } = {}) {
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
    const withHint =
      system && schema ? `${system}\n${TOOL_SHAPE_HINT}` : system;
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      model,
      ...(effort ? ['--effort', effort] : []),
      ...(withHint ? ['--system-prompt', withHint] : []),
      ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
      ...MINIMAL_ARGS,
    ];

    const text = await withRetries(
      async () => {
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
          return { ok: false, error: String(error?.message ?? error) };
        }
        if (answer.code !== 0) {
          // Ctrl+C reaches the whole terminal, so the child of the attempt in
          // flight dies of the same keystroke. That is a stop, not a failure
          // worth retrying.
          if (signal?.aborted) {
            throw stopReason(signal);
          }
          return {
            ok: false,
            error: `exit ${answer.code}: ${(answer.stderr || '').trim().slice(0, 500)}`,
          };
        }
        const read = readClaudeEnvelope(answer.stdout);
        if (!read.ok) {
          return { ok: false, error: read.error };
        }
        if (usage) {
          addUsage(usage, read.usage);
        }
        return { ok: true, value: read.text };
      },
      { name: 'claude', sleep, retryDelays, signal }
    );

    return { text };
  }

  return {
    name: 'claude',
    model,
    effort,
    // One call is one `claude -p` process with a session behind it, and this
    // adapter has no measurement saying that several of them at once answer
    // sooner. One is the honest answer, and `askMany` below is the shared
    // default rather than a pool this adapter invented for itself.
    batchSize: 1,
    ask,
    askMany: (prompts, options = {}) =>
      askManyInOrder(ask, prompts, options, signal),
  };
}
