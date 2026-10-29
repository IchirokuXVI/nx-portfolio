import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AssistantConfig } from '../config/app-config';
import {
  ModelTurnRole,
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type ModelProvider,
  type ModelReply,
  type ModelRequest,
  type ModelToolCall,
  type ModelTurn,
  type ModelUsage,
  type Transcription,
} from './model-provider';

/**
 * The pinned API version. The Messages API changes shape only behind this
 * header, so a request that names it keeps meaning what it meant when written.
 */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Enough for the thinking that precedes a tool call as well as the text. A reply
 * is one or two sentences, so the number is a ceiling and not a budget anybody
 * spends (plan 0224, section 2.1).
 */
export const CLAUDE_MAX_TOKENS = 4096;

/** What {@link toClaudeRequest} needs beyond the neutral request. */
export interface ClaudeRequestOptions {
  model: string;
  effort: AssistantConfig['claudeEffort'];
  thinking: AssistantConfig['claudeThinking'];
}

/**
 * Claude, over the Messages API with Node's global fetch (plan 0224).
 *
 * **No SDK**, for the reason {@link GeminiProvider} gives: the repository's third
 * party clients are fetch and fixtures, and the {@link ModelProvider} interface is
 * where a swap happens. This class is the second implementation that interface
 * was written for, and nothing above it changed to admit it.
 *
 * **It cannot hear.** The Messages API has no audio content block, so
 * {@link transcriptionSupported} is false, and the module wraps this class in a
 * `SplitModelProvider` whose hearing is the deployment's own transcriber (plan
 * 0235).
 */
@Injectable()
export class ClaudeProvider implements ModelProvider {
  private readonly logger = new Logger(ClaudeProvider.name);
  private readonly config: AssistantConfig;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.config = configService.getOrThrow<AssistantConfig>('assistant');
  }

  get configured(): boolean {
    return this.config.anthropicApiKey.length > 0;
  }

  /**
   * A constant false, which is the case plan 0041 section 3.2 wrote the field
   * for: the deployment loses the microphone and keeps the assistant.
   */
  get transcriptionSupported(): boolean {
    return false;
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    return readClaudeReply(
      await this.post(
        toClaudeRequest(request, {
          model: this.config.model,
          effort: this.config.claudeEffort,
          thinking: this.config.claudeThinking,
        })
      )
    );
  }

  /**
   * Never reached: both callers read {@link transcriptionSupported} first
   * (plan 0224, section 2.5). It throws rather than answering an empty string,
   * because empty means "the recording had nothing in it", which would be a lie.
   */
  async transcribe(): Promise<Transcription> {
    throw new ProviderUnavailableError('this provider cannot transcribe');
  }

  /**
   * One request to the Messages API, with the deadline and the error mapping of
   * the Gemini one: a hung socket must not hold a NATS reply open until the
   * client gives up.
   *
   * The key goes in `x-api-key` and nowhere else. It is never in the url, so it
   * cannot reach an access log, and never in an error message.
   */
  private async post(body: Record<string, unknown>): Promise<unknown> {
    const abort = new AbortController();
    const deadline = setTimeout(
      () => abort.abort(),
      this.config.providerTimeoutMs
    );

    let response: Response;
    try {
      response = await fetch(`${this.config.anthropicBaseUrl}/messages`, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'x-api-key': this.config.anthropicApiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ProviderUnavailableError(
        abort.signal.aborted
          ? `the model did not answer within ${this.config.providerTimeoutMs}ms`
          : 'the model could not be reached',
        { cause: error }
      );
    } finally {
      clearTimeout(deadline);
    }

    if (!response.ok) {
      throw await this.readError(response);
    }

    return response.json();
  }

  /**
   * A 429 becomes {@link ProviderRateLimitedError} with the provider's own
   * `retry-after` when it gave one, and the service supplies the number when it
   * did not (rule A5). A 529 (overloaded) and every other status become
   * {@link ProviderUnavailableError}.
   */
  private async readError(response: Response): Promise<Error> {
    const body = await response.text();

    if (response.status === 429) {
      return new ProviderRateLimitedError(
        'the model provider is rate limiting this deployment',
        readRetryAfterSeconds(response.headers.get('retry-after'))
      );
    }

    // The status, the API's error type and the settings that shaped the request
    // go in the log, and never the body: it can echo the prompt, and the prompt
    // carries what a person typed about their groceries. The settings are there
    // because the one 400 an operator can cause is a pairing (thinking `off` on a
    // model that refuses it), and this line has to name it.
    this.logger.warn(
      `claude responded ${response.status} ${readErrorType(body)} ` +
        `(model ${this.config.model}, thinking ${this.config.claudeThinking}, ` +
        `effort ${this.config.claudeEffort})`
    );
    return new ProviderUnavailableError(
      `the model provider answered ${response.status}`
    );
  }
}

/**
 * The wire shape, mapped from the neutral one (plan 0224, section 2.1).
 *
 * No `temperature`, `top_p`, `top_k`, `tool_choice` or prefill: the current
 * models reject every one of them. Exported for its own spec.
 */
export function toClaudeRequest(
  request: ModelRequest,
  options: ClaudeRequestOptions
): Record<string, unknown> {
  const tools = request.tools.map((tool, index) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    // One cache breakpoint, on the last declaration: the prefix up to it is the
    // tool catalog, identical for every turn of a catalog (section 7). The
    // system prompt after it ends with the caller's own zones and lists, so a
    // breakpoint there would write an entry nobody reads.
    ...(index === request.tools.length - 1
      ? { cache_control: { type: 'ephemeral' } }
      : {}),
  }));

  const messages = request.turns
    .map(toClaudeMessage)
    .filter((message): message is Record<string, unknown> => !!message);
  // The API requires the first message to be the user's. The transcript is cut
  // to its newest entries, so the cut can land on an assistant reply, which
  // without its question says nothing the model needs.
  const firstUser = messages.findIndex((message) => message['role'] === 'user');

  return {
    model: options.model,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: [{ type: 'text', text: request.system }],
    ...(tools.length > 0 ? { tools } : {}),
    messages: firstUser === -1 ? [] : messages.slice(firstUser),
    thinking:
      options.thinking === 'off' ? { type: 'disabled' } : { type: 'adaptive' },
    output_config: { effort: options.effort },
  };
}

// `ModelTurn` itself rather than the shape written out again, for the reason the
// Gemini mapping gives: a copy goes stale the day a field is added.
function toClaudeMessage(turn: ModelTurn): Record<string, unknown> | null {
  if (turn.role === ModelTurnRole.TOOL) {
    return {
      role: 'user',
      // Every result of a round in one message. Results split across messages
      // teach the model to stop calling tools in parallel.
      content: (turn.toolResults ?? []).map((entry) => ({
        type: 'tool_result',
        tool_use_id: entry.id,
        content: JSON.stringify(entry.result),
      })),
    };
  }

  if (turn.role === ModelTurnRole.USER) {
    // The API rejects a text block that is empty or only whitespace, and the
    // gateway's transcript DTO does not stop a client from sending one. Kept,
    // it would fail every later turn of the conversation as unavailable.
    return turn.text?.trim()
      ? { role: 'user', content: [{ type: 'text', text: turn.text }] }
      : null;
  }

  // The raw content the model produced, back unchanged (section 2.3). It carries
  // the thinking blocks that precede a tool call, and the API refuses to continue
  // a tool using turn whose replayed assistant message has lost them, exactly as
  // Gemini refuses a call that lost its thought signature.
  const raw = readRawContent(turn.toolCalls?.[0]?.signature);
  if (raw) {
    return { role: 'assistant', content: raw };
  }

  // A turn from the client's transcript: prose and no calls, which the API
  // accepts with no thinking block.
  const content: Record<string, unknown>[] = [];
  if (turn.text?.trim()) {
    content.push({ type: 'text', text: turn.text });
  }
  for (const call of turn.toolCalls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: call.args,
    });
  }
  // An empty or whitespace text block is rejected, and so is an empty content
  // array. A model turn with nothing in it says nothing, so it is left out; the API joins the
  // two user messages on either side of the gap into one turn.
  return content.length > 0 ? { role: 'assistant', content } : null;
}

function readRawContent(signature: string | undefined): unknown[] | null {
  if (signature === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(signature);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads the neutral reply out of a Messages API response (plan 0224, section
 * 2.2).
 *
 * The JSON of the whole `content` array goes into the signature of the **first**
 * tool call and of no other: {@link toClaudeRequest} replays the turn from it, so
 * one copy is the whole message and a second would be sent twice. The loop never
 * reads a signature, and the turn record keeps only a call's name and arguments,
 * so the thinking in it is never logged.
 *
 * A `stop_reason` of `refusal` reads as an empty reply, which the service answers
 * with its "got stuck" sentence. Exported for its own spec.
 */
export function readClaudeReply(payload: unknown): ModelReply {
  const body = (payload ?? {}) as {
    content?: unknown;
    stop_reason?: unknown;
  };
  const usage = readUsage(payload);

  if (body.stop_reason === 'refusal') {
    return { text: '', toolCalls: [], usage };
  }

  const blocks = Array.isArray(body.content)
    ? (body.content as Record<string, unknown>[])
    : [];

  const text = blocks
    .map((block) =>
      block['type'] === 'text' && typeof block['text'] === 'string'
        ? block['text']
        : ''
    )
    .join('')
    .trim();

  const toolCalls: ModelToolCall[] = [];
  for (const block of blocks) {
    if (block['type'] !== 'tool_use' || typeof block['name'] !== 'string') {
      continue;
    }
    const input = block['input'];
    toolCalls.push({
      name: block['name'],
      args:
        input && typeof input === 'object'
          ? (input as Record<string, unknown>)
          : {},
      ...(typeof block['id'] === 'string' ? { id: block['id'] } : {}),
      ...(toolCalls.length === 0 ? { signature: JSON.stringify(blocks) } : {}),
    });
  }

  return { text, toolCalls, usage };
}

function readUsage(payload: unknown): ModelUsage | null {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage;
  if (!usage) {
    return null;
  }
  const read = (key: string): number | null =>
    typeof usage[key] === 'number' ? (usage[key] as number) : null;
  const promptTokens = read('input_tokens');
  const responseTokens = read('output_tokens');
  return {
    promptTokens,
    responseTokens,
    totalTokens:
      promptTokens === null && responseTokens === null
        ? null
        : (promptTokens ?? 0) + (responseTokens ?? 0),
    cachedPromptTokens: read('cache_read_input_tokens'),
  };
}

/**
 * The `retry-after` header as whole seconds, rounded up, or nothing.
 *
 * Only the number of seconds form is read. The HTTP date form is ignored rather
 * than parsed, because a clock skew between us and the provider would turn it
 * into a wrong number, and a missing one is filled in by the service (rule A5).
 * Exported for its own spec.
 */
export function readRetryAfterSeconds(
  raw: string | null | undefined
): number | undefined {
  if (!raw || !/^\s*\d+(\.\d+)?\s*$/.test(raw)) {
    return undefined;
  }
  const seconds = Math.ceil(Number(raw));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** The API's `error.type`, for the log line, or `unknown`. */
function readErrorType(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown } };
    return typeof parsed.error?.type === 'string'
      ? parsed.error.type
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
