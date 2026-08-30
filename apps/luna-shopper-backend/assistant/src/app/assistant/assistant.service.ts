import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistantRole,
  ListResolutionBranch,
  type AssistantMessage,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
} from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_LOCALE,
  getRequestContext,
  NotConfiguredException,
  RateLimitedException,
  RETRY_AFTER_SECONDS_DETAIL,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import type { AssistantConfig } from '../config/app-config';
import {
  MODEL_PROVIDER,
  ModelTurnRole,
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type ModelProvider,
  type ModelToolCall,
  type ModelTurn,
  type ModelUsage,
} from '../provider/model-provider';
import { ConcurrencyGate, TurnLimiter } from '../provider/turn-limiter';
import { GatewayApiClient } from './gateway-api.client';
import { buildSystemPrompt } from './prompt';
import { ReferenceCollector } from './references';
import { findTool, TOOL_DECLARATIONS, type ToolRuntime } from './tools';
import { TurnContextFactory } from './turn-context';

/**
 * One conversation turn (plan 0039).
 *
 * The shape of the thing is a hand written tool loop: fetch what the caller can
 * see, ask the model, run whatever it asked for, ask again with the results, stop
 * when it answers in words. Backlog 0005 put that loop inside an SDK's tool
 * runner; this is a different SDK and the loop is here instead, but the gate is
 * the same and it lives in the service (section 13).
 *
 * The service **stores nothing between turns** (rule A2). Everything below is
 * built from the request, used once, and dropped: the context, the references,
 * the limiter's decision. What outlives the request is one structured log record,
 * which is the whole point of the test (section 10).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly config: AssistantConfig;
  private readonly limiter: TurnLimiter;
  private readonly gate: ConcurrencyGate;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(MODEL_PROVIDER) private readonly provider: ModelProvider,
    private readonly contexts: TurnContextFactory,
    private readonly api: GatewayApiClient
  ) {
    this.config = configService.getOrThrow<AssistantConfig>('assistant');
    this.limiter = new TurnLimiter(this.config.turnsPerMinute);
    this.gate = new ConcurrencyGate(this.config.concurrency);
  }

  async turn(request: AssistantTurnRequest): Promise<AssistantTurnResponse> {
    // Plan 0026's rule, applied in section 11: a deployment with no key is a
    // supported deployment, not a broken one. The pod boots, the health probes
    // pass, and this one route says plainly that it is not implemented here.
    if (!this.provider.configured) {
      throw new NotConfiguredException(
        'the assistant has no model provider configured on this deployment'
      );
    }

    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    const startedAtMs = Date.now();

    const allowed = this.limiter.take(request.userId);
    if (!allowed.allowed) {
      throw this.rateLimited(
        allowed.retryAfterSeconds,
        request.userId,
        'local'
      );
    }

    // The transcript is client supplied and therefore untrusted (rule A2). It is
    // capped here, on arrival, rather than trusted to have been capped, and every
    // entry is treated as what a person typed whatever it claims to be.
    const transcript = capTranscript(
      request.transcript,
      this.config.maxTurns,
      this.config.maxChars
    );

    const context = await this.contexts.open({
      authorization: request.authorization,
      locale,
    });
    const contextReadyAtMs = Date.now();

    const references = new ReferenceCollector();
    let listResolution: ListResolutionBranch | undefined;

    const runtime: ToolRuntime = {
      context,
      api: this.api,
      references,
      transcript: [
        ...transcript.map((entry) => entry.content),
        request.message,
      ],
      recordListResolution: (branch) => {
        listResolution = branch;
      },
    };

    const turns: ModelTurn[] = [
      ...transcript.map(toModelTurn),
      { role: ModelTurnRole.USER, text: request.message },
    ];

    const system = buildSystemPrompt({ context, locale });
    const calledTools: ToolCallRecord[] = [];
    let usage: ModelUsage | null = null;
    let providerMs = 0;

    for (let round = 0; ; round += 1) {
      const askedAtMs = Date.now();
      const reply = await this.ask(
        { system, turns, tools: TOOL_DECLARATIONS, locale },
        request.userId
      );
      providerMs += Date.now() - askedAtMs;
      usage = reply.usage ?? usage;

      if (reply.toolCalls.length === 0 || round >= this.config.maxToolCalls) {
        // Out of rounds with no answer is a real, if rare, outcome. Saying
        // nothing would be worse than saying so, and there is no useful sentence
        // to invent here that would not be a guess about what happened.
        const text =
          reply.text ||
          (reply.toolCalls.length > 0
            ? 'Sorry, I got stuck on that one. Could you say it a different way?'
            : '');

        this.record({
          userId: request.userId,
          locale,
          said: request.message,
          replied: text,
          calledTools,
          listResolution,
          usage,
          providerMs,
          gatewayMs: contextReadyAtMs - startedAtMs,
          totalMs: Date.now() - startedAtMs,
          outcome: calledTools.length === 0 ? 'talked' : 'acted',
        });

        return {
          reply: text,
          references: references.all(),
          ...(listResolution ? { listResolution } : {}),
        };
      }

      turns.push({
        role: ModelTurnRole.MODEL,
        text: reply.text,
        toolCalls: reply.toolCalls,
      });
      turns.push({
        role: ModelTurnRole.TOOL,
        toolResults: await this.runTools(reply.toolCalls, runtime, calledTools),
      });
    }
  }

  /**
   * Runs what the model asked for.
   *
   * A call to a tool that does not exist is answered rather than thrown: the
   * catalog is the boundary (section 7), so a model that invents a fourth tool
   * simply gets told there is no such thing and carries on, which is a much
   * better outcome than a 500 for the person who asked for milk.
   */
  private async runTools(
    calls: ModelToolCall[],
    runtime: ToolRuntime,
    calledTools: ToolCallRecord[]
  ): Promise<{ id?: string; name: string; result: unknown }[]> {
    const results: { id?: string; name: string; result: unknown }[] = [];

    // The provider's handle for the call, when it gave one, so a result goes back
    // against the call it answers. A turn can ask for one tool twice, and by the
    // time the results are a list of names there is nothing left to tell them
    // apart by.
    const against = (call: ModelToolCall) =>
      call.id !== undefined ? { id: call.id } : {};

    for (const call of calls) {
      const tool = findTool(call.name);
      if (!tool) {
        calledTools.push(record(call, false));
        results.push({
          ...against(call),
          name: call.name,
          result: { ok: false, problem: 'there is no such tool' },
        });
        continue;
      }

      try {
        const result = await tool.execute(call.args, runtime);
        calledTools.push(
          record(call, (result as { ok?: unknown })?.ok === true)
        );
        results.push({ ...against(call), name: call.name, result });
      } catch (error) {
        // A tool that threw is a bug here, not a refusal from the API, which the
        // tools already convert. Log it with the context to reproduce it and let
        // the model apologize in the caller's language rather than the filter
        // rendering a 500 over a conversation that was otherwise fine.
        this.logger.error(
          `assistant tool ${call.name} threw`,
          error instanceof Error ? error.stack : String(error)
        );
        calledTools.push(record(call, false));
        results.push({
          ...against(call),
          name: call.name,
          result: { ok: false, problem: 'that did not work' },
        });
      }
    }

    return results;
  }

  /** The provider call, behind the concurrency gate, with 429 mapped to rule A5. */
  private async ask(
    request: Parameters<ModelProvider['generate']>[0],
    userId: string
  ) {
    try {
      // Queuing is preferable to failing: waiting two seconds is invisible,
      // being told to come back is not (section 9).
      return await this.gate.run(() => this.provider.generate(request));
    } catch (error) {
      if (error instanceof ProviderRateLimitedError) {
        throw this.rateLimited(
          // In order: the provider's own hint, then the time until the local
          // window rolls, then the fixed fallback. Whichever it came from it is
          // a number in a field, and nothing downstream parses prose to find it.
          error.retryAfterSeconds ??
            this.limiter.secondsUntilWindowRolls(userId) ??
            this.config.retryAfterFallbackSeconds,
          userId,
          'provider'
        );
      }
      if (error instanceof ProviderUnavailableError) {
        this.logger.warn(`assistant provider unavailable: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Rule A5, as an exception.
   *
   * The seconds travel **in the problem body**, which is rule C3 from plan 0009
   * rather than a preference: `main.ts` calls `enableCors` with no
   * `exposedHeaders`, so a browser cannot read a `Retry-After` header cross
   * origin, and `velista.app` calling `api.velista.app` is cross origin. A header
   * alone would leave the panel with nothing to count.
   */
  private rateLimited(
    retryAfterSeconds: number,
    userId: string,
    source: 'local' | 'provider'
  ): RateLimitedException {
    this.logger.log(
      JSON.stringify({
        event: 'assistant.turn.rateLimited',
        userId,
        source,
        retryAfterSeconds,
      })
    );
    return new RateLimitedException('the assistant is rate limited', {
      details: { [RETRY_AFTER_SECONDS_DETAIL]: retryAfterSeconds },
    });
  }

  /**
   * The one structured record per turn (section 10), and the only part of this
   * service where anything a user wrote outlives the request.
   *
   * It exists because rule A2 stores nothing and the point of the whole plan is
   * to be the ground for a better one written from real usage; those two do not
   * reconcile by themselves. It goes to the structured logs through plan 0016's
   * tracing and metrics, which this service already gets for free.
   *
   * Two constraints, both here rather than in prose: **the caller is identified
   * by their user id and never by anything else**, and the retention on these
   * logs is short and stated, because a transcript is what a person typed about
   * groceries and that is ordinary personal data.
   */
  private record(entry: {
    userId: string;
    locale: SupportedLocale;
    said: string;
    replied: string;
    calledTools: ToolCallRecord[];
    listResolution: ListResolutionBranch | undefined;
    usage: ModelUsage | null;
    providerMs: number;
    gatewayMs: number;
    totalMs: number;
    outcome: 'talked' | 'acted';
  }): void {
    this.logger.log(
      JSON.stringify({
        event: 'assistant.turn',
        userId: entry.userId,
        locale: entry.locale,
        said: entry.said,
        replied: entry.replied,
        tools: entry.calledTools,
        // The single most valuable field here: how often the app can infer the
        // list, which is the question the accessibility work turns on.
        listResolution: entry.listResolution ?? null,
        outcome: entry.outcome,
        tokens: entry.usage,
        latencyMs: {
          total: entry.totalMs,
          gateway: entry.gatewayMs,
          provider: entry.providerMs,
        },
      })
    );
  }
}

/**
 * One tool call as the turn record keeps it (plan 0039, section 10).
 *
 * `items` is plan 0040, section 7.4: the arguments of a write are now an array,
 * and the count rides as a field of its own rather than being left to be counted
 * out of a serialized argument blob later. The question it answers is whether
 * people ask for one thing or for a basket, which is the question that decides
 * whether that plan was worth building.
 */
interface ToolCallRecord {
  name: string;
  args: unknown;
  ok: boolean;
  items?: number;
}

/**
 * The record for one call, with the item count lifted out of its arguments.
 *
 * Read off the argument shape rather than from a name, because "how many things
 * were asked for in one call" is a property of a batched argument and not of one
 * particular tool. A call with no `items` array carries no count, rather than a
 * one that would then be counted as a basket of one.
 */
function record(call: ModelToolCall, ok: boolean): ToolCallRecord {
  const items = (call.args as { items?: unknown } | undefined)?.items;
  return {
    name: call.name,
    args: call.args,
    ok,
    ...(Array.isArray(items) ? { items: items.length } : {}),
  };
}

/**
 * Caps the client supplied transcript (rule A2).
 *
 * Newest first, because the end of a conversation is what the next turn is about;
 * an old message dropped costs nothing, and the message immediately before this
 * one is often the entire context. Both caps apply: whichever bites first.
 */
export function capTranscript(
  transcript: AssistantMessage[],
  maxTurns: number,
  maxChars: number
): AssistantMessage[] {
  const kept: AssistantMessage[] = [];
  let chars = 0;

  for (
    let i = transcript.length - 1;
    i >= 0 && kept.length < maxTurns;
    i -= 1
  ) {
    const entry = transcript[i];
    const content = typeof entry?.content === 'string' ? entry.content : '';
    if (chars + content.length > maxChars) {
      break;
    }
    chars += content.length;
    kept.unshift({ role: entry.role, content });
  }

  return kept;
}

function toModelTurn(message: AssistantMessage): ModelTurn {
  return {
    role:
      message.role === AssistantRole.ASSISTANT
        ? ModelTurnRole.MODEL
        : ModelTurnRole.USER,
    text: message.content,
  };
}
