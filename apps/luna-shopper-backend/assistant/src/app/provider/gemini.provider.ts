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
  type ModelUsage,
} from './model-provider';

/**
 * Google Gemini, free tier, reached over its REST API with Node's global fetch
 * (plan 0039, section 9).
 *
 * **No SDK, and that is a departure from the plan's own wording** ("through the
 * official SDK"), taken for the same reason `@portfolio/luna-shopper/mercadona`
 * and `/osm-places` are framework free: this repository's third party clients are
 * fetch and fixtures, adding `@google/genai` buys nothing rule A4 does not
 * already forbid exercising, and the interface above is where a swap would
 * happen anyway. Reinstating the SDK is a new implementation of
 * {@link ModelProvider} and changes nothing else.
 *
 * Everything unusual in here is about the free tier's one visible behaviour: it
 * returns 429 in ordinary use, and rule A5 says the answer to that has to be a
 * number of seconds rather than "try again later". Google's error payload carries
 * a `RetryInfo` with a `retryDelay` like `"27s"`; when it is there it is
 * authoritative and is used as it is. When it is not, this class throws with no
 * number and the layer above supplies one, because only that layer knows when its
 * own window rolls.
 */
@Injectable()
export class GeminiProvider implements ModelProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly config: AssistantConfig;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.config = configService.getOrThrow<AssistantConfig>('assistant');
  }

  get configured(): boolean {
    return this.config.geminiApiKey.length > 0;
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    const url = `${this.config.geminiBaseUrl}/models/${encodeURIComponent(
      this.config.model
    )}:generateContent`;

    // A turn is one request to a third party over which we have no promise of
    // latency, so it gets a deadline of its own rather than inheriting whatever
    // the broker's is. Without it a hung socket holds a NATS reply open until the
    // client gives up, and the caller sees nothing at all.
    const abort = new AbortController();
    const deadline = setTimeout(
      () => abort.abort(),
      this.config.providerTimeoutMs
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.geminiApiKey,
        },
        body: JSON.stringify(toGeminiRequest(request)),
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

    return readReply(await response.json());
  }

  /**
   * Turns a non 2xx into the right exception, and in the 429 case into the one
   * carrying the provider's own retry hint when it gave one.
   */
  private async readError(response: Response): Promise<Error> {
    const body = await response.text();

    if (response.status === 429) {
      return new ProviderRateLimitedError(
        'the model provider is rate limiting this deployment',
        readRetryDelaySeconds(body) ?? readRetryAfterHeader(response)
      );
    }

    // Deliberately logged rather than surfaced: the body can echo the prompt,
    // and the prompt carries what a person typed about their groceries.
    this.logger.warn(
      `gemini responded ${response.status} ${response.statusText}`
    );
    return new ProviderUnavailableError(
      `the model provider answered ${response.status}`
    );
  }
}

/** The wire shape, mapped from the neutral one. Exported for its own spec. */
export function toGeminiRequest(
  request: ModelRequest
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.turns.map(toGeminiContent),
    // One catalog, three declarations, and nothing else is callable because
    // nothing else is declared. An absent capability is a much harder boundary
    // than an instruction (section 7).
    ...(request.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ],
        }
      : {}),
  };
}

function toGeminiContent(turn: {
  role: ModelTurnRole;
  text?: string;
  toolCalls?: ModelToolCall[];
  toolResults?: { name: string; result: unknown }[];
}): Record<string, unknown> {
  if (turn.role === ModelTurnRole.TOOL) {
    return {
      // Gemini calls the side that carries a function result `user`; there is no
      // separate tool role on the wire. The distinction is kept above this line
      // because the loop needs it and the wire does not have it.
      role: 'user',
      parts: (turn.toolResults ?? []).map((entry) => ({
        functionResponse: {
          name: entry.name,
          // Always an object: the API rejects a bare array or scalar here, and a
          // tool that returns a list is the ordinary case.
          response: { result: entry.result },
        },
      })),
    };
  }

  const parts: Record<string, unknown>[] = [];
  if (turn.text) {
    parts.push({ text: turn.text });
  }
  for (const call of turn.toolCalls ?? []) {
    parts.push({ functionCall: { name: call.name, args: call.args } });
  }
  // A content with no parts is rejected, and an empty model turn is reachable
  // (a reply that was only tool calls, replayed with its calls stripped).
  if (parts.length === 0) {
    parts.push({ text: '' });
  }

  return {
    role: turn.role === ModelTurnRole.MODEL ? 'model' : 'user',
    parts,
  };
}

/** Reads the neutral reply out of a `generateContent` response. */
export function readReply(payload: unknown): ModelReply {
  const candidate = firstCandidate(payload);
  const parts = Array.isArray(candidate?.['content']?.['parts'])
    ? (candidate['content']['parts'] as Record<string, unknown>[])
    : [];

  const text = parts
    .map((part) => (typeof part['text'] === 'string' ? part['text'] : ''))
    .join('')
    .trim();

  const toolCalls: ModelToolCall[] = [];
  for (const part of parts) {
    const call = part['functionCall'] as
      | { name?: unknown; args?: unknown }
      | undefined;
    if (call && typeof call.name === 'string') {
      toolCalls.push({
        name: call.name,
        args:
          call.args && typeof call.args === 'object'
            ? (call.args as Record<string, unknown>)
            : {},
      });
    }
  }

  return { text, toolCalls, usage: readUsage(payload) };
}

function firstCandidate(
  payload: unknown
): Record<string, Record<string, never>> | undefined {
  const candidates = (payload as { candidates?: unknown })?.candidates;
  return Array.isArray(candidates) && candidates.length > 0
    ? (candidates[0] as Record<string, Record<string, never>>)
    : undefined;
}

function readUsage(payload: unknown): ModelUsage | null {
  const usage = (payload as { usageMetadata?: Record<string, unknown> })
    ?.usageMetadata;
  if (!usage) {
    return null;
  }
  const read = (key: string): number | null =>
    typeof usage[key] === 'number' ? (usage[key] as number) : null;
  return {
    promptTokens: read('promptTokenCount'),
    responseTokens: read('candidatesTokenCount'),
    totalTokens: read('totalTokenCount'),
  };
}

/**
 * Google's `RetryInfo.retryDelay`, which arrives as a protobuf duration string
 * (`"27s"`, occasionally `"27.5s"`) inside `error.details`.
 *
 * Read out of the raw body rather than a parsed shape because the details array
 * is a heterogeneous bag of `@type` tagged objects, and the only thing wanted
 * from it is one field on one of them. Rounded **up**: answering a second early
 * spends the next slot and extends the outage, which is the failure rule A5 is
 * written to prevent.
 */
export function readRetryDelaySeconds(body: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (!match) {
    return undefined;
  }
  const seconds = Math.ceil(Number(match[1]));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * The `Retry-After` header, as a fallback behind the body's own hint.
 *
 * Reading it here is fine and does not contradict rule C3: that rule is about
 * what a **browser** can read off our own response cross origin, and this is a
 * server to server response we are parsing ourselves.
 */
function readRetryAfterHeader(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined;
}
