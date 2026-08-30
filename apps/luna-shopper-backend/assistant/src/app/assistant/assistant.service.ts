import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistantRole,
  ListResolutionBranch,
  type AssistantMessage,
  type AssistantTranscribeRequest,
  type AssistantTranscribeResponse,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
  type AssistantVoiceRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_LOCALE,
  ForbiddenException,
  getRequestContext,
  NotConfiguredException,
  RateLimitedException,
  RETRY_AFTER_SECONDS_DETAIL,
  ValidationException,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import { normalizeMimeType, type AssistantConfig } from '../config/app-config';
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
import {
  findTool,
  SCOPED_TOOL_DECLARATIONS,
  TOOL_DECLARATIONS,
  type ToolRuntime,
} from './tools';
import { ScopeUnavailableError, TurnContextFactory } from './turn-context';

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
/**
 * What a recording with nothing in it is answered with (plan 0041, section 9).
 *
 * A sentence rather than an error, because nothing went wrong: the microphone was
 * open and heard nothing it could make words out of, which for this audience is
 * an ordinary event and not a failure to report. In English like the loop's own
 * "I got stuck" fallback beside it — both are the service speaking rather than
 * the model, and the service has no translator (section 9 of plan 0039).
 */
export const NOTHING_HEARD = 'I did not catch that. Could you say it again?';

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

  /**
   * Words out of a recording, and nothing else (plan 0041, section 3).
   *
   * It shares the concurrency gate with {@link turn} and shares nothing else. In
   * particular it does **not** take a turn from {@link TurnLimiter}: the two
   * callers of this are a spoken assistant turn, which takes its own turn from
   * that bucket a moment later, and a voice comment, which is not a turn at all
   * and would otherwise spend somebody's conversation quota on leaving a message.
   * The upload has its own rate limit at the gateway, which is where a limit on
   * uploading belongs.
   *
   * Nothing about the recording is logged, at any level, not even its length
   * (plan 0041, section 6). The transcription is what the structured turn record
   * carries when a turn follows; the audio is held for the length of this call and
   * dropped.
   */
  async transcribe(
    request: AssistantTranscribeRequest
  ): Promise<AssistantTranscribeResponse> {
    if (!this.provider.configured || !this.provider.transcriptionSupported) {
      throw new NotConfiguredException(
        'this deployment cannot turn a recording into words'
      );
    }

    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;

    try {
      const text = await this.gate.run(() =>
        this.provider.transcribe({
          audio: Buffer.from(request.audio, 'base64'),
          mimeType: request.mimeType,
          locale: request.locale || locale,
        })
      );
      return { text: text.trim() };
    } catch (error) {
      if (error instanceof ProviderRateLimitedError) {
        // Rule A5's answer, unchanged: a number of seconds in the problem body.
        // The caller of a voice comment does not count it down (the comment is
        // already saved and playable), but a spoken assistant turn does, and the
        // two must not get different shapes from the same failure.
        throw this.rateLimited(
          error.retryAfterSeconds ?? this.config.retryAfterFallbackSeconds,
          'transcription',
          'provider'
        );
      }
      if (error instanceof ProviderUnavailableError) {
        this.logger.warn(`assistant provider unavailable: ${error.message}`);
      }
      throw error;
    }
  }

  async turn(request: AssistantTurnRequest): Promise<AssistantTurnResponse> {
    const startedAtMs = Date.now();

    // Plan 0026's rule, applied in section 11: a deployment with no key is a
    // supported deployment, not a broken one. The pod boots, the health probes
    // pass, and this one route says plainly that it is not implemented here.
    this.requireConfigured();

    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    this.takeTurn(request.userId);

    return this.answer(request, locale, startedAtMs);
  }

  /**
   * A spoken turn (plan 0041).
   *
   * Transcribe, then answer, and **the second half is the typed path byte for
   * byte**: `answer` below is the same method a typed turn runs, called with the
   * transcription as the message. That is the design rather than an
   * implementation detail — the tools, the loop, the references, the context
   * fetch and rule A1 are all untouched, and every existing test on that path
   * goes on testing the thing it tested.
   *
   * The order here is load bearing. The caps and the whitelist are checked before
   * anything is decoded or sent, the limiter is taken **before** the
   * transcription rather than inside `answer`, so a caller who is over their
   * limit is told so without a provider call being spent on them, and the
   * transcription and the turn together count as **one** turn because a turn is a
   * turn from the caller's point of view.
   */
  async voice(request: AssistantVoiceRequest): Promise<AssistantTurnResponse> {
    const startedAtMs = Date.now();

    this.requireConfigured();

    // A field rather than a thrown error, so a deployment pointed at a provider
    // with no audio support loses the microphone and keeps the assistant: this
    // answers 501 while `turn` above goes on working (section 9).
    if (!this.provider.transcriptionSupported) {
      throw new NotConfiguredException(
        'the model provider on this deployment cannot transcribe audio'
      );
    }

    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    const audio = this.readRecording(request);

    this.takeTurn(request.userId);

    const heardAtMs = Date.now();
    const heard = await this.viaProvider(
      () =>
        this.provider.transcribe({ audio, mimeType: request.mimeType, locale }),
      request.userId
    );
    const transcriptionMs = Date.now() - heardAtMs;

    // Nothing recognisable in the recording. Saying so is the whole answer, and
    // running a turn against an empty message would spend a provider call to be
    // told the same thing less clearly.
    if (heard.length === 0) {
      this.record({
        userId: request.userId,
        locale,
        said: '',
        replied: NOTHING_HEARD,
        calledTools: [],
        listResolution: undefined,
        usage: null,
        providerMs: transcriptionMs,
        gatewayMs: 0,
        totalMs: Date.now() - startedAtMs,
        outcome: 'unheard',
      });

      return { reply: NOTHING_HEARD, references: [], heard };
    }

    const answer = await this.answer(
      {
        userId: request.userId,
        authorization: request.authorization,
        transcript: request.transcript,
        message: heard,
      },
      locale,
      startedAtMs,
      transcriptionMs
    );

    // The words the caller can check the answer against (section 3.1). It is the
    // transcription, never anything the model wrote in its reply.
    return { ...answer, heard };
  }

  /**
   * Everything a turn does once there is a message: the shared half.
   *
   * A typed turn reaches this straight from `turn`; a spoken one reaches it with
   * the transcription in `message` and nothing else different. **From here down
   * there is no such thing as a spoken turn**, which is the property the plan
   * rests on and the one the spec asserts by comparing the two provider requests.
   */
  private async answer(
    request: AssistantTurnRequest,
    locale: SupportedLocale,
    startedAtMs: number,
    providerMsBefore = 0
  ): Promise<AssistantTurnResponse> {
    // The transcript is client supplied and therefore untrusted (rule A2). It is
    // capped here, on arrival, rather than trusted to have been capped, and every
    // entry is treated as what a person typed whatever it claims to be.
    const transcript = capTranscript(
      request.transcript,
      this.config.maxTurns,
      this.config.maxChars
    );

    const caller = { authorization: request.authorization, locale };

    // A scope collapses the context fetch: one read of the scoped list rather
    // than the zone index and every list in it (plan 0044, section 2.3). That
    // read is also what authorizes the turn, so it is never skipped.
    const scope = request.scope;
    let context;
    try {
      context =
        scope === undefined
          ? await this.contexts.open(caller)
          : await this.contexts.openScoped(caller, scope);
    } catch (error) {
      // A scope that does not hold is the gateway's own refusal, relayed rather
      // than translated into anything cleverer (plan 0044, section 3). It costs
      // no provider request, which is the point of doing the fetch first.
      if (error instanceof ScopeUnavailableError) {
        throw new ForbiddenException(
          'that list is not one you can use from here'
        );
      }
      throw error;
    }
    const contextReadyAtMs = Date.now();
    const scoped = context.scopedListId !== null;

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
    // The catalog is assembled from the scope rather than filtered inside a
    // tool, because an absent capability is a much harder boundary than an
    // instruction (plan 0044, section 2.2).
    const tools = scoped ? SCOPED_TOOL_DECLARATIONS : TOOL_DECLARATIONS;
    const calledTools: ToolCallRecord[] = [];
    let usage: ModelUsage | null = null;
    // Seeded with the transcription's own time on a spoken turn, so the record's
    // `provider` latency is what was actually spent at the provider rather than
    // the loop's share of it.
    let providerMs = providerMsBefore;

    for (let round = 0; ; round += 1) {
      const askedAtMs = Date.now();
      const reply = await this.ask(
        { system, turns, tools, locale },
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
        toolResults: await this.runTools(
          reply.toolCalls,
          runtime,
          calledTools,
          scoped
        ),
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
    calledTools: ToolCallRecord[],
    /** Which catalog this turn was given, so a name is looked up in that one. */
    scoped: boolean
  ): Promise<{ id?: string; name: string; result: unknown }[]> {
    const results: { id?: string; name: string; result: unknown }[] = [];

    // The provider's handle for the call, when it gave one, so a result goes back
    // against the call it answers. A turn can ask for one tool twice, and by the
    // time the results are a list of names there is nothing left to tell them
    // apart by.
    const against = (call: ModelToolCall) =>
      call.id !== undefined ? { id: call.id } : {};

    for (const call of calls) {
      const tool = findTool(call.name, scoped);
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

  /** Plan 0026's rule, in one place because two entry points now apply it. */
  private requireConfigured(): void {
    if (!this.provider.configured) {
      throw new NotConfiguredException(
        'the assistant has no model provider configured on this deployment'
      );
    }
  }

  /**
   * The local limiter, taken once per turn.
   *
   * Once, including for a spoken turn, which spends two provider requests and is
   * still one turn: the budget this protects is the caller's patience and the
   * deployment's quota, and a person who speaks has asked one question (plan
   * 0041, section 7).
   */
  private takeTurn(userId: string): void {
    const allowed = this.limiter.take(userId);
    if (!allowed.allowed) {
      throw this.rateLimited(allowed.retryAfterSeconds, userId, 'local');
    }
  }

  /**
   * The recording, checked and decoded (plan 0041, sections 5 and 9).
   *
   * Both refusals happen **before the provider is called**, which is the point of
   * doing them here rather than letting Gemini answer 400: a recording this
   * service will not forward costs nothing, and the caller gets a sentence
   * instead of a stack trace.
   *
   * The unsupported container is named **in the log and not in the reply**. It is
   * a fact for whoever has to add that browser's format to the whitelist, and it
   * is nothing at all to the person holding the phone, who needs to know that
   * their recording could not be read and not what MIME type their browser
   * chose.
   */
  private readRecording(request: AssistantVoiceRequest): Uint8Array {
    const mimeType = normalizeMimeType(request.mimeType);

    if (!this.config.audioMimeTypes.includes(mimeType)) {
      this.logger.warn(
        JSON.stringify({
          event: 'assistant.voice.unsupportedType',
          userId: request.userId,
          mimeType,
        })
      );
      throw new ValidationException(
        'that recording is in a format this service cannot read'
      );
    }

    // Base64 is four characters per three bytes, so the encoded length bounds the
    // decoded one. Checked first so an oversized payload is refused without
    // allocating a buffer the size of it.
    const maxEncoded = Math.ceil(this.config.audioMaxBytes / 3) * 4 + 4;
    if (request.audio.length > maxEncoded) {
      throw this.tooLarge();
    }

    const audio = Buffer.from(request.audio, 'base64');

    if (audio.byteLength === 0) {
      throw new ValidationException('that recording arrived empty');
    }
    if (audio.byteLength > this.config.audioMaxBytes) {
      throw this.tooLarge();
    }

    return audio;
  }

  /**
   * The cap, said in words with the number in it (section 5).
   *
   * The number is in `messageArgs` rather than only in the sentence, so the
   * localized message the caller reads carries the limit in whatever language
   * they are reading — the same reason rule A5 puts the seconds in a field.
   */
  private tooLarge(): ValidationException {
    const megabytes = Math.round(this.config.audioMaxBytes / (1024 * 1024));
    return new ValidationException(
      `that recording is larger than the ${megabytes} MB this service accepts`,
      { messageArgs: { limit: `${megabytes} MB` } }
    );
  }

  /** The provider call, behind the concurrency gate, with 429 mapped to rule A5. */
  private async ask(
    request: Parameters<ModelProvider['generate']>[0],
    userId: string
  ) {
    return this.viaProvider(() => this.provider.generate(request), userId);
  }

  /**
   * Whatever the provider was asked for, behind the gate, with 429 mapped once.
   *
   * Generic over the call rather than duplicated per method, because rule A5's
   * answer must be identical whether the 429 arrived during a transcription or
   * during the turn: the caller gets one problem body with one number in it, and
   * which of the two provider requests hit the wall is not something they can act
   * on (plan 0041, section 7).
   */
  private async viaProvider<T>(
    call: () => Promise<T>,
    userId: string
  ): Promise<T> {
    try {
      // Queuing is preferable to failing: waiting two seconds is invisible,
      // being told to come back is not (section 9).
      return await this.gate.run(call);
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
    outcome: 'talked' | 'acted' | 'unheard';
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
