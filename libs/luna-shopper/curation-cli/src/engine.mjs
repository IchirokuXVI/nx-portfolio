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

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 */
export function claudeChildEnv(env) {
  const copy = { ...env };
  const hadKey =
    typeof copy.ANTHROPIC_API_KEY === 'string' && copy.ANTHROPIC_API_KEY !== '';
  delete copy.ANTHROPIC_API_KEY;
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
}) {
  const { env: childEnv, hadKey } = claudeChildEnv(env);
  let noticed = false;

  return {
    name: 'claude',
    model,
    async ask(prompt) {
      if (hadKey && !noticed) {
        noticed = true;
        stderr.write(
          'ANTHROPIC_API_KEY is set and is being ignored: this run bills your Claude session. Use --engine api to bill the key.\n'
        );
      }

      let lastError = 'the call failed';
      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (attempt > 0) {
          await sleep(retryDelays[attempt - 1]);
        }
        let answer;
        try {
          answer = await spawn(
            'claude',
            ['-p', '--output-format', 'json', '--model', model],
            { input: prompt, env: childEnv, timeoutMs }
          );
        } catch (error) {
          lastError = String(error?.message ?? error);
          continue;
        }
        if (answer.code !== 0) {
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
}) {
  return {
    name: 'api',
    model,
    async ask(prompt, { system = null } = {}) {
      const body = JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
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
          await sleep(retryDelays[attempt - 1]);
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
          });
        } catch (error) {
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
