import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiTextProvider,
  AllowanceLimit,
  AllowancePeriod,
  AllowancePurpose,
  AllowanceReserveOutcome,
  AllowanceScope,
  AssistantRole,
  ListResolutionBranch,
  UserKind,
  type AllowanceLimits,
  type AllowanceRefusal,
  type AssistantAllowanceRequest,
  type AssistantAllowanceView,
  type AssistantCapabilities,
  type AssistantMessage,
  type AssistantTranscribeRequest,
  type AssistantTranscribeResponse,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
  type AssistantVoiceRequest,
} from '@portfolio/luna-shopper/contracts';
import {
  AllowanceReachedException,
  DEFAULT_LOCALE,
  ForbiddenException,
  getRequestContext,
  NotConfiguredException,
  RateLimitedException,
  RETRY_AFTER_SECONDS_DETAIL,
  ValidationException,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import {
  AllowanceClient,
  AllowanceUnavailableError,
} from '../allowance/allowance.client';
import {
  worstOutputAtTypicalInput,
  type TypicalWorstTurn,
} from '../allowance/reserve-amount';
import { TurnMeter } from '../allowance/turn-meter';
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
import { distressSentence } from './child-safety';
import { GatewayApiClient } from './gateway-api.client';
import { ChoiceCollector, ListLinkCollector } from './link-and-choices';
import {
  checkReply,
  namesEmergencyNumber,
  replacementFor,
  type ModerationVerdict,
} from './moderation';
import { plainText } from './plain-text';
import { buildSystemPrompt, namesZones } from './prompt';
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
 * built from the request, used once, and dropped: the context, the collectors,
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

/**
 * What a turn that ran past its budget is answered with.
 *
 * It names the list rather than only apologising, and that is the whole point of
 * the sentence. A turn can write in one round and run out of time in the next, so
 * some of what was asked for may be on the list already; the honest instruction is
 * to look before saying it again, which is what stops the duplicate.
 *
 * English, for `NOTHING_HEARD`'s reason: the service speaks here, and the service
 * has no translator.
 */
export const RAN_OUT_OF_TIME =
  'That took me too long, so I stopped partway. Have a look at the list before asking again, in case some of it went on.';

/**
 * What a turn that ran its tools and then replied with nothing is answered with
 * (plan 0224, section 2.2).
 *
 * The "got stuck" sentence asks the person to say it again, and here that would
 * write a second time what the tools already wrote. So the sentence says the
 * work happened and points at the list, for `RAN_OUT_OF_TIME`'s reason.
 *
 * English, for `NOTHING_HEARD`'s reason: the service speaks here, and the service
 * has no translator.
 */
export const ANSWERED_WITHOUT_WORDS =
  'I did that, but lost the words for it. Have a look at the list to see what changed.';

/**
 * What a turn that ran no tools and has no words to show is answered with: an
 * empty reply, a refusal, or a reply whose moderation could not run (plan 0236,
 * section 4.2).
 *
 * English, for `NOTHING_HEARD`'s reason.
 */
export const GOT_STUCK =
  'Sorry, I got stuck on that one. Could you say it a different way?';

/**
 * How long a person waits when a turn of theirs is already in flight (plan
 * 0234, section 5.1). A person has one conversation, so the answer is the
 * ordinary `rate_limited`, because waiting does fix it.
 */
export const TURN_IN_FLIGHT_RETRY_SECONDS = 5;

/**
 * How long a failed settle waits before its one retry (plan 0234, section
 * 15, item 19): long enough for a core pod to come back from a blip, short
 * enough that the person's answer is not held much longer.
 */
export const SETTLE_RETRY_MS = 1000;

/**
 * The length of a recording, estimated from its bytes as the length at 16
 * kbit/s, rounded up (plan 0234, section 2.1). A browser records Opus at a
 * higher rate than that, so the estimate counts more seconds than were spoken,
 * which is the safe direction. Every reservation uses it, because it runs
 * before anything is decoded; a settle uses the transcriber's own measure.
 */
export function estimateAudioSeconds(bytes: number): number {
  return Math.ceil(bytes / 2000);
}

/** A reservation the assistant holds while it runs a call sequence. */
interface Held {
  id: string;
  userId: string;
  purpose: AllowancePurpose;
  microUsd: number;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly config: AssistantConfig;
  private readonly limiter: TurnLimiter;
  private readonly gate: ConcurrencyGate;
  /**
   * The worst output at the typical input, call by call (plan 0234, section
   * 5.2): what a call that failed after it may have run is charged.
   */
  private readonly worst: TypicalWorstTurn;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    @Inject(MODEL_PROVIDER) private readonly provider: ModelProvider,
    private readonly contexts: TurnContextFactory,
    private readonly api: GatewayApiClient,
    // Each person's allowance, kept in core (plan 0234).
    private readonly allowance: AllowanceClient
  ) {
    this.config = configService.getOrThrow<AssistantConfig>('assistant');
    this.limiter = new TurnLimiter(this.config.turnsPerMinute);
    this.gate = new ConcurrencyGate(this.config.concurrency);
    this.worst = worstOutputAtTypicalInput(this.config);
  }

  /**
   * The caller's allowance (plan 0234, section 8.2), with the limits that
   * apply to them and core's counts. It needs no provider key: a deployment
   * with no key still has an allowance to show.
   */
  allowanceOf(
    request: AssistantAllowanceRequest
  ): Promise<AssistantAllowanceView> {
    return this.allowance.read({
      userId: request.userId,
      limits: this.limitsFor(request.kind),
      timezone: this.config.allowance.timezone,
      turnReserveMicroUsd: this.config.allowance.turnReserveMicroUsd,
    });
  }

  /**
   * What this deployment's assistant can do (plan 0231, section 3), for the
   * privacy policy the gateway publishes.
   *
   * Computed with exactly the checks that decide the 501s below, so the policy
   * never describes an assistant that answers 501, nor hides one that answers:
   * `answers` is {@link requireConfigured}'s test, and `hears` is the test
   * {@link transcribe} applies. Since plan 0235 the hearing is the deployment's
   * own transcriber, so `hears` is true exactly when `TRANSCRIBER_URL` is set and
   * a turn can be answered.
   */
  capabilities(): AssistantCapabilities {
    const answers = this.provider.configured;
    return {
      answers,
      hears: answers && this.provider.transcriptionSupported,
      // Anthropic is the only text provider since plan 0236.
      textProvider: answers ? AiTextProvider.ANTHROPIC : null,
    };
  }

  /**
   * Words out of a recording, and nothing else (plan 0041, section 3).
   *
   * It does **not** pass through the provider concurrency gate (plan 0235,
   * section 4): the transcriber is the queue, and holding a provider slot while
   * waiting on a different machine would make a voice comment delay a typed
   * turn. Nor does it take a turn from {@link TurnLimiter}: the two
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

    // The allowance fails closed (plan 0234, section 6): a recording with no
    // author to count it against is refused, which the gateway settles FAILED
    // and the comment stays playable.
    if (!request.userId) {
      throw new ValidationException(
        'a transcription needs the userId of the comment author'
      );
    }

    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    const audio = Buffer.from(request.audio, 'base64');
    // Optional on the wire, so a gateway one release behind still works: it
    // never sent a purpose and its only caller was a voice comment's, which
    // a turn's model transcribes well enough until it catches up.
    const purpose = request.purpose ?? 'turn';

    // A voice comment's seconds, counted on its author (plan 0234, section
    // 5.5). A transcription costs no money since plan 0235.
    const estimate = estimateAudioSeconds(audio.byteLength);
    const held = await this.reserve({
      userId: request.userId,
      kind: request.kind,
      purpose: AllowancePurpose.TRANSCRIPTION,
      audioSeconds: estimate,
      microUsd: 0,
      holdSeconds:
        Math.ceil(
          (purpose === 'comment'
            ? this.config.transcriberCommentTimeoutMs
            : this.config.transcriberTurnTimeoutMs) / 1000
        ) + 60,
    });
    // The estimate until the transcriber measures the recording: a call that
    // failed may still have used the transcriber's time.
    let audioSeconds = estimate;

    try {
      const heard = await this.provider.transcribe({
        audio,
        mimeType: request.mimeType,
        locale: request.locale || locale,
        purpose,
      });
      audioSeconds = measuredOr(estimate, heard.audioSeconds);
      return { text: heard.text.trim() };
    } catch (error) {
      if (error instanceof ProviderRateLimitedError) {
        // A full queue refused the clip before it ran.
        audioSeconds = 0;
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
    } finally {
      await this.settle(held, { turns: 0, audioSeconds }, new TurnMeter());
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

    // The allowance, before the first provider call (plan 0234, section 5.5),
    // and settled in a `finally` around the whole call sequence.
    const held = await this.reserve({
      userId: request.userId,
      kind: request.kind,
      purpose: AllowancePurpose.TURN,
      audioSeconds: 0,
      microUsd: this.config.allowance.turnReserveMicroUsd,
      holdSeconds: this.turnHoldSeconds(),
    });
    const meter = new TurnMeter();
    try {
      return await this.answer(request, locale, startedAtMs, meter);
    } finally {
      await this.settle(
        held,
        { turns: meter.billed ? 1 : 0, audioSeconds: 0 },
        meter
      );
    }
  }

  /**
   * A spoken turn (plan 0041).
   *
   * Transcribe, then answer, and **the second half is the typed path byte for
   * byte**: `answer` below is the same method a typed turn runs, called with the
   * transcription as the message. That is the design rather than an
   * implementation detail: the tools, the loop, the link, the context
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

    // One turn and the recording's seconds, held before the transcription
    // (plan 0234, section 5.5). The estimate stands until the transcriber
    // measures the recording.
    const estimate = estimateAudioSeconds(audio.byteLength);
    const held = await this.reserve({
      userId: request.userId,
      kind: request.kind,
      purpose: AllowancePurpose.VOICE_TURN,
      audioSeconds: estimate,
      microUsd: this.config.allowance.turnReserveMicroUsd,
      holdSeconds: this.turnHoldSeconds(),
    });
    const meter = new TurnMeter();
    const spent = { audioSeconds: estimate };
    try {
      return await this.spoken(
        request,
        locale,
        startedAtMs,
        audio,
        meter,
        spent
      );
    } finally {
      await this.settle(
        held,
        { turns: meter.billed ? 1 : 0, audioSeconds: spent.audioSeconds },
        meter
      );
    }
  }

  /** The spoken turn once it holds its reservation: transcribe, then answer. */
  private async spoken(
    request: AssistantVoiceRequest,
    locale: SupportedLocale,
    startedAtMs: number,
    audio: Uint8Array,
    meter: TurnMeter,
    spent: { audioSeconds: number }
  ): Promise<AssistantTurnResponse> {
    const heardAtMs = Date.now();
    let heard: string;
    try {
      const transcription = await this.viaProvider(
        () =>
          this.provider.transcribe({
            audio,
            mimeType: request.mimeType,
            locale,
            purpose: 'turn',
          }),
        request.userId,
        // The transcriber queues on its own side (plan 0235, section 4).
        { gated: false }
      );
      heard = transcription.text;
      spent.audioSeconds = measuredOr(
        spent.audioSeconds,
        transcription.audioSeconds
      );
    } catch (error) {
      // A full queue refused the clip before it ran. Anything else keeps the
      // estimate, since the transcriber may have spent its time on it.
      if (isRateLimited(error)) {
        spent.audioSeconds = 0;
      }
      throw error;
    }
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
        // One of the service's own sentences, plain by construction.
        moderation: 'skipped',
      });

      return { reply: NOTHING_HEARD, link: null, choices: [], heard };
    }

    const answer = await this.answer(
      {
        userId: request.userId,
        authorization: request.authorization,
        transcript: request.transcript,
        message: heard,
        // The scope rides along (plan 0044). The list page's microphone is the
        // one caller that sends a scope at all, and it sends it here, on the
        // spoken route, never on the typed one. Building this request by hand
        // and leaving the field out turned every recording on a list into an
        // open turn: the model was handed the whole index and asked which list,
        // on a screen that shows exactly one. It went unnoticed while every
        // tester had one list, because the resolver's third branch then picks
        // the only list there is and the answer looks scoped.
        scope: request.scope,
      },
      locale,
      startedAtMs,
      meter,
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
    /** What the turn spends, for the settle (plan 0234, section 5.3). */
    meter: TurnMeter,
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

    // One fact, read once, and it decides two things (plan 0046, section 3.1):
    // whether the prompt tells the model to name a list's zone, and whether the
    // link and the chips carry it.
    const withZones = namesZones(context);
    const link = new ListLinkCollector(withZones);
    const choices = new ChoiceCollector(withZones);
    let listResolution: ListResolutionBranch | undefined;

    // What the tool running right now wants the record to say (plan 0043,
    // section 6). One slot rather than a list, reset by `runTools` before each
    // call and read straight after it, because the two facts it carries belong
    // to one call and there is never a second one in flight: the loop runs the
    // model's calls one at a time.
    const note: { current: ToolNote } = { current: {} };

    const runtime: ToolRuntime = {
      context,
      api: this.api,
      link,
      choices,
      transcript: [
        ...transcript.map((entry) => entry.content),
        request.message,
      ],
      // The roles `transcript` drops, reduced to the one fact a confirming tool
      // needs: whether the assistant has asked anything yet (plan 0225,
      // section 3). The roles come from the client's transcript, so this check
      // aims at the model skipping its question, not at a hostile client; the
      // tools' own checks (ids from this turn, the gateway's permissions)
      // remain the boundary.
      priorAssistantTurns: transcript.filter(
        (entry) => entry.role === AssistantRole.ASSISTANT
      ).length,
      recordListResolution: (branch) => {
        listResolution = branch;
      },
      noteForRecord: (fields) => {
        note.current = { ...note.current, ...fields };
      },
    };

    const turns: ModelTurn[] = [
      ...transcript.map(toModelTurn),
      { role: ModelTurnRole.USER, text: request.message },
    ];

    const system = buildSystemPrompt({
      context,
      locale,
      emergencyNumber: this.config.emergencyNumber,
    });
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

    /**
     * When this turn stops starting new work.
     *
     * Measured from `startedAtMs`, which is the moment the request arrived, so a
     * spoken turn's transcription is inside the budget: what is bounded is how
     * long the person has been waiting, not how long this loop has been running.
     */
    const deadlineAtMs = startedAtMs + this.config.turnTimeoutMs;
    const withinDeadline = () => Date.now() < deadlineAtMs;

    /**
     * The turn ends here, with a sentence nobody asked for.
     *
     * It is English, like the "got stuck" line below: both are statements about
     * this service rather than translated parts of the product.
     *
     * The sentence names the list on purpose. Some of the work may already have
     * happened — a write in an earlier round is written — and this is the answer
     * that stops somebody repeating themselves into a duplicate.
     */
    const outOfTime = (): AssistantTurnResponse => {
      const text = RAN_OUT_OF_TIME;

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
        // Its own outcome rather than folded into `acted`, because it is the one
        // a dashboard has to be able to count: it says either the budget is too
        // small or the provider is too slow, and both are worth knowing before
        // somebody reports a duplicated shopping list.
        outcome: 'timedout',
        moderation: 'skipped',
      });

      return {
        reply: text,
        link: link.link(),
        choices: choices.all(),
        ...(listResolution ? { listResolution } : {}),
      };
    };

    for (let round = 0; ; round += 1) {
      // Never on the first round: a turn still owes an answer however long the
      // context read took, and the model is the only thing that can write one.
      // From the second round on, asking again would spend a whole provider
      // timeout discovering what the clock already says.
      if (round > 0 && !withinDeadline()) {
        return outOfTime();
      }

      const askedAtMs = Date.now();
      const reply = await this.ask(
        { system, turns, tools, locale },
        request.userId,
        meter
      );
      providerMs += Date.now() - askedAtMs;
      usage = reply.usage ?? usage;

      const wantsTools =
        reply.toolCalls.length > 0 && round < this.config.maxToolCalls;

      // **The deadline is checked between the model answering and its tool calls
      // being run, because the tool calls are what write.** A turn whose caller
      // has given up must not go on adding lines behind them: they were told the
      // recording had not arrived, rows appear a few seconds later, and saying it
      // again gets them two of everything.
      //
      // A reply with nothing left to do is returned whatever the clock says. It
      // is a finished answer, and replacing it with an apology because it arrived
      // late would throw away the work that was paid for.
      if (wantsTools && !withinDeadline()) {
        return outOfTime();
      }

      if (!wantsTools) {
        // Out of rounds with no answer is a real, if rare, outcome. Saying
        // nothing would be worse than saying so, and there is no useful sentence
        // to invent here that would not be a guess about what happened.
        //
        // A reply with no text and no calls gets the same sentence (plan 0224,
        // section 2.2). A refusal from Claude reads that way, and an empty
        // bubble is worse than an apology. When tools already ran this turn,
        // asking again would repeat their writes, so the sentence says so.
        //
        // The text is made plain before the record and the response, so both
        // carry what the person reads (plan 0225, section 2).
        const toolsRan = calledTools.length > 0;
        const { text, stripped } = plainText(
          reply.text || (toolsRan ? ANSWERED_WITHOUT_WORDS : GOT_STUCK)
        );

        // Words the model wrote are checked before they leave (plan 0236,
        // section 4). The service's own sentences are not: they are plain by
        // construction, as `plainText` already treats them.
        const checked = reply.text
          ? await this.moderate(request.message, text, locale, toolsRan, meter)
          : { verdict: 'skipped' as const, ms: 0 };
        const shown = checked.replacement ?? text;

        this.record({
          userId: request.userId,
          locale,
          said: request.message,
          replied: shown,
          calledTools,
          listResolution,
          usage,
          providerMs,
          gatewayMs: contextReadyAtMs - startedAtMs,
          totalMs: Date.now() - startedAtMs,
          outcome: toolsRan ? 'acted' : 'talked',
          strippedMarkdown: stripped,
          moderation: checked.verdict,
          moderationMs: checked.ms,
          moderationUsage: checked.usage ?? null,
          ...(checked.replacement !== undefined ? { withheld: text } : {}),
        });

        return {
          reply: shown,
          // A flagged reply loses its link and its choices (section 4.2). A
          // reply whose check could not run keeps the link, because the work it
          // points at was done, and loses the choices, which answered a
          // question nobody will now read.
          link: checked.keepLink === false ? null : link.link(),
          choices: checked.keepChoices === false ? [] : choices.all(),
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
          scoped,
          note
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
    scoped: boolean,
    /** What the tool just run wants the record to say (plan 0043, section 6). */
    note: { current: ToolNote }
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
        calledTools.push(record(call, false, {}));
        results.push({
          ...against(call),
          name: call.name,
          result: { ok: false, problem: 'there is no such tool' },
        });
        continue;
      }

      try {
        note.current = {};
        const result = await tool.execute(call.args, runtime);
        calledTools.push(
          record(call, (result as { ok?: unknown })?.ok === true, note.current)
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
        calledTools.push(record(call, false, {}));
        results.push({
          ...against(call),
          name: call.name,
          result: { ok: false, problem: 'that did not work' },
        });
      }
    }

    return results;
  }

  /**
   * The moderation pass over one reply the model wrote (plan 0236, section 4).
   *
   * `replacement` is absent when the reply goes out as written. A category
   * replaces it with a fixed sentence in the reply language and drops the link
   * and the choices. A check that could not run fails closed: the model's words
   * are dropped for the sentence the service already says when it has none.
   *
   * **A failed check over words that hold the emergency number answers with the
   * distress sentence**, not with "got stuck". The model writes that number only
   * when the person said they are in danger, and asking such a person to say it
   * a different way is the one replacement that is not safe. The sentence is the
   * service's own, so nothing unchecked leaves.
   *
   * **Not behind the concurrency gate**, unlike a turn's call. The check is one
   * word long with an eight second deadline, and queuing it behind other
   * people's whole turns would turn ordinary load into dropped replies.
   */
  private async moderate(
    said: string,
    replied: string,
    locale: SupportedLocale,
    toolsRan: boolean,
    meter: TurnMeter
  ): Promise<{
    verdict: ModerationVerdict;
    ms: number;
    replacement?: string;
    keepLink?: boolean;
    keepChoices?: boolean;
    usage?: ModelUsage | null;
  }> {
    if (!this.config.moderation) {
      return { verdict: 'skipped', ms: 0 };
    }

    const startedAtMs = Date.now();
    const { verdict, failure, usage } = await checkReply(this.provider, {
      said,
      replied,
      locale,
    });
    const ms = Date.now() - startedAtMs;

    // The check is a provider call and is counted inside the turn (plan 0234,
    // section 12). A check that threw reports no usage, and may still have
    // been billed, so it is charged its own worst case.
    if (usage === undefined) {
      meter.addWorstCase(this.worst.moderationMicroUsd);
    } else {
      meter.add(this.config.moderationModel, usage);
    }

    if (verdict === 'ok') {
      return { verdict, ms, usage };
    }
    if (verdict === 'error') {
      // The reason, and never the classifier's prompt or the texts it read.
      this.logger.warn(`assistant moderation failed closed: ${failure}`);
      if (namesEmergencyNumber(replied, this.config.emergencyNumber)) {
        return {
          verdict,
          ms,
          usage,
          replacement: distressSentence(locale, this.config.emergencyNumber),
          keepLink: false,
          keepChoices: false,
        };
      }
      return {
        verdict,
        ms,
        usage,
        replacement: toolsRan ? ANSWERED_WITHOUT_WORDS : GOT_STUCK,
        keepLink: true,
        keepChoices: false,
      };
    }
    return {
      verdict,
      ms,
      usage,
      replacement: replacementFor(verdict, locale, this.config.emergencyNumber),
      keepLink: false,
      keepChoices: false,
    };
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
   * doing them here rather than letting the transcriber answer 400: a recording this
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

  /**
   * The provider call, behind the concurrency gate, with 429 mapped to rule A5,
   * and its usage on the meter (plan 0234, section 5.5). A call that failed is
   * charged one call's worst case, and counts the turn, unless it is one of
   * the two failures known to carry no bill: a status the provider answered
   * and a 429. Any other failure may have run at the provider: a deadline, a
   * dropped connection, or a 200 whose body could not be read. Counting too
   * much is the safe error.
   */
  private async ask(
    request: Parameters<ModelProvider['generate']>[0],
    userId: string,
    meter: TurnMeter
  ) {
    try {
      const reply = await this.viaProvider(
        () => this.provider.generate(request),
        userId
      );
      meter.add(this.config.model, reply.usage);
      return reply;
    } catch (error) {
      if (!answeredUnbilled(error)) {
        meter.addWorstCase(this.worst.perCallMicroUsd);
      }
      throw error;
    }
  }

  /**
   * How long a turn's reservation holds before it expires (plan 0234, section
   * 5.4): the turn's own deadline plus a minute.
   */
  private turnHoldSeconds(): number {
    return Math.ceil(this.config.turnTimeoutMs / 1000) + 60;
  }

  /**
   * The limits of a person: a guest's for `TEMPORARY`, and for a request that
   * names no kind, which only a gateway one release behind sends. Counting a
   * registered person as a guest is the strict error.
   */
  private limitsFor(kind: UserKind | undefined): AllowanceLimits {
    return kind === UserKind.REGISTERED
      ? this.config.allowance.registered
      : this.config.allowance.guest;
  }

  /**
   * Holds the worst case in core before any provider call (plan 0234, section
   * 5.1), or refuses: the allowance code when a limit does not fit, the
   * ordinary `rate_limited` when a turn of this person is already in flight,
   * and an error when core does not answer within two seconds, because the
   * allowance fails closed.
   */
  private async reserve(input: {
    userId: string;
    kind: UserKind | undefined;
    purpose: AllowancePurpose;
    audioSeconds: number;
    microUsd: number;
    holdSeconds: number;
  }): Promise<Held> {
    let answer;
    try {
      answer = await this.allowance.reserve({
        userId: input.userId,
        purpose: input.purpose,
        audioSeconds: input.audioSeconds,
        microUsd: input.microUsd,
        limits: this.limitsFor(input.kind),
        timezone: this.config.allowance.timezone,
        holdSeconds: input.holdSeconds,
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'assistant.allowance.unavailable',
          userId: input.userId,
          purpose: input.purpose,
          reason: error instanceof Error ? error.message : String(error),
        })
      );
      throw error instanceof AllowanceUnavailableError
        ? error
        : new AllowanceUnavailableError('the allowance could not be reserved', {
            cause: error,
          });
    }

    if (answer.outcome === AllowanceReserveOutcome.TURN_IN_FLIGHT) {
      throw this.rateLimited(
        TURN_IN_FLIGHT_RETRY_SECONDS,
        input.userId,
        'inFlight'
      );
    }
    if (
      answer.outcome !== AllowanceReserveOutcome.RESERVED ||
      !answer.reservationId
    ) {
      throw this.allowanceReached(input.userId, input.purpose, answer.refused);
    }
    return {
      id: answer.reservationId,
      userId: input.userId,
      purpose: input.purpose,
      microUsd: input.microUsd,
    };
  }

  /**
   * Releases a reservation and counts what happened (plan 0234, section 5.3).
   * Never throws: it runs in a `finally`, and a settle that failed must not
   * replace the answer the person was about to get.
   *
   * A settle that failed is tried once more after {@link SETTLE_RETRY_MS}. A
   * first attempt that core committed but whose answer was lost then counts
   * twice, which is the safe error. A second failure leaves the reservation to
   * expire, which charges nothing, and this line is how that gap is counted.
   */
  private async settle(
    held: Held,
    counted: { turns: number; audioSeconds: number },
    meter: TurnMeter
  ): Promise<void> {
    const microUsd = meter.microUsd(held.microUsd);
    const request = {
      reservationId: held.id,
      userId: held.userId,
      purpose: held.purpose,
      timezone: this.config.allowance.timezone,
      turns: counted.turns,
      audioSeconds: counted.audioSeconds,
      microUsd,
      ...meter.tokens(),
    };
    try {
      await this.allowance.settle(request);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_RETRY_MS));
    }
    try {
      await this.allowance.settle(request);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'assistant.allowance.settleFailed',
          userId: held.userId,
          purpose: held.purpose,
          microUsd,
          audioSeconds: counted.audioSeconds,
          reason: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  /**
   * The allowance code (plan 0234, section 8.1), with `scope`, `period`,
   * `limit` and `resetsAt` in its details and the time it is back in the
   * person's language. A deployment that reached its own ceiling is logged as
   * `assistant.allowance.deploymentReached`, which is how the owner learns of
   * it.
   */
  private allowanceReached(
    userId: string,
    purpose: AllowancePurpose,
    refused: AllowanceRefusal | null
  ): AllowanceReachedException {
    const refusal: AllowanceRefusal = refused ?? {
      // Core said neither yes nor why. Not a state core answers, and still a
      // refusal: the allowance fails closed.
      scope: AllowanceScope.USER,
      period: AllowancePeriod.DAY,
      limit:
        purpose === AllowancePurpose.TRANSCRIPTION
          ? AllowanceLimit.COMMENT_AUDIO
          : AllowanceLimit.TURNS,
      resetsAt: new Date().toISOString(),
    };
    this.logger.log(
      JSON.stringify({
        event:
          refusal.scope === AllowanceScope.DEPLOYMENT
            ? 'assistant.allowance.deploymentReached'
            : 'assistant.allowance.refused',
        userId,
        purpose,
        ...refusal,
      })
    );
    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;
    return new AllowanceReachedException(
      `the assistant allowance is reached: ${refusal.scope} ${refusal.limit} per ${refusal.period}`,
      {
        details: {
          scope: refusal.scope,
          period: refusal.period,
          limit: refusal.limit,
          resetsAt: refusal.resetsAt,
        },
        messageArgs: {
          variant: `${refusal.scope}.${refusal.period}`,
          time: backAt(
            refusal.resetsAt,
            refusal.period,
            locale,
            this.config.allowance.timezone
          ),
        },
      }
    );
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
    userId: string,
    options: { gated: boolean } = { gated: true }
  ): Promise<T> {
    try {
      // Queuing is preferable to failing: waiting two seconds is invisible,
      // being told to come back is not (section 9). A transcription skips the
      // gate, because the transcriber holds its own queue (plan 0235).
      return await (options.gated ? this.gate.run(call) : call());
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
    source: 'local' | 'provider' | 'inFlight'
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
   *
   * The words themselves are logged only when `ASSISTANT_LOG_TURN_TEXT` is on
   * (k8s plan 0018, D3). Off, which is the default, each text field becomes
   * its length (`saidChars`, `repliedChars`, `withheldChars`) and every other
   * field stays, so the record still answers the questions of section 10. The
   * host keeps this container's lines for 7 days; a record with no text keeps
   * that promise even on a host that trims nothing.
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
    outcome: 'talked' | 'acted' | 'unheard' | 'timedout';
    /**
     * How many markdown markers `plainText` took out of the reply (plan 0225,
     * section 2). Absent on the turns whose reply is one of this service's own
     * sentences, which are plain by construction, and logged as zero there.
     */
    strippedMarkdown?: number;
    /** The verdict on the reply (plan 0236, section 4.3). */
    moderation: ModerationVerdict;
    /** How long the check took, zero when it did not run. */
    moderationMs?: number;
    /**
     * What the check spent, logged as `tokens.moderation`: `null` when it did
     * not run or its provider reported nothing. Plan 0234 counts the cost of a
     * turn, and the check is part of it.
     */
    moderationUsage?: ModelUsage | null;
    /**
     * The model's words that a verdict kept from the person, so the owner can
     * read what was flagged (section 4.4). Absent when the reply went out.
     */
    withheld?: string;
  }): void {
    this.logger.log(
      JSON.stringify({
        event: 'assistant.turn',
        userId: entry.userId,
        locale: entry.locale,
        ...(this.config.logTurnText
          ? { said: entry.said, replied: entry.replied }
          : {
              saidChars: entry.said.length,
              repliedChars: entry.replied.length,
            }),
        tools: entry.calledTools,
        // The single most valuable field here: how often the app can infer the
        // list, which is the question the accessibility work turns on.
        listResolution: entry.listResolution ?? null,
        outcome: entry.outcome,
        // How often the prompt's plain text rule still loses, so the rule can be
        // judged from the logs rather than from a hunch.
        strippedMarkdown: entry.strippedMarkdown ?? 0,
        // Anything but `ok` and `skipped` is a line the owner counts (plan
        // 0236, section 4.4). The classifier's prompt is never here.
        moderation: entry.moderation,
        ...(entry.withheld === undefined
          ? {}
          : this.config.logTurnText
            ? { withheld: entry.withheld }
            : { withheldChars: entry.withheld.length }),
        // The turn's own usage as before, with the check's beside it under
        // `moderation`, so one read of the record has the whole cost.
        tokens:
          entry.usage === null && !entry.moderationUsage
            ? null
            : { ...entry.usage, moderation: entry.moderationUsage ?? null },
        latencyMs: {
          total: entry.totalMs,
          gateway: entry.gatewayMs,
          provider: entry.providerMs,
          moderation: entry.moderationMs ?? 0,
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
  /**
   * The list a call touched, when it named one by its lines (plan 0043, section
   * 6). A deletion is recorded with the number of lines and the list, and the
   * count is `items`; neither carries what was on them, because the text of a
   * deleted shopping list line is not part of the question this record exists to
   * answer.
   */
  list?: string;
  /**
   * The service refused the call, rather than the gateway refusing the request.
   *
   * Two different facts about the prompt (plan 0043, section 6): "the model
   * tried to delete lines it had not read" is the number to watch, and "the
   * gateway said no" is an ordinary permission answer the bot relays in words.
   * A call with neither this nor `ok` is one that reached the gateway and failed.
   */
  refused?: true;
}

/** What a tool asked the record to carry, beside what its arguments already say. */
export interface ToolNote {
  list?: string;
  refused?: true;
}

/**
 * The record for one call, with the item count lifted out of its arguments.
 *
 * Read off the argument shape rather than from a name, because "how many things
 * were asked for in one call" is a property of a batched argument and not of one
 * particular tool. A call with neither array carries no count, rather than a one
 * that would then be counted as a basket of one.
 *
 * `lineIds` counts the same way `items` does (plan 0043, section 6). It is the
 * shape the two tools that name lines take, and reading it here is what lets a
 * deletion be recorded with the number of lines without the record ever going
 * near the result, which is where the contents are.
 */
function record(
  call: ModelToolCall,
  ok: boolean,
  note: ToolNote
): ToolCallRecord {
  const args = call.args as { items?: unknown; lineIds?: unknown } | undefined;
  const batch = Array.isArray(args?.items)
    ? args.items
    : Array.isArray(args?.lineIds)
      ? args.lineIds
      : undefined;

  return {
    name: call.name,
    args: call.args,
    ok,
    ...(batch !== undefined ? { items: batch.length } : {}),
    ...note,
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

/** Whether an error is the rate limit of rule A5, before or after mapping. */
function isRateLimited(error: unknown): boolean {
  return (
    error instanceof ProviderRateLimitedError ||
    error instanceof RateLimitedException
  );
}

/**
 * The seconds a settle counts for a recording (plan 0234, section 2.1): the
 * transcriber's measure, rounded up, when it is a positive finite number, and
 * otherwise the byte estimate. The transcriber client reads a missing
 * `audioSeconds` as zero, and zero would count a heard recording as free.
 */
function measuredOr(estimate: number, measured: number): number {
  return Number.isFinite(measured) && measured > 0
    ? Math.ceil(measured)
    : estimate;
}

/**
 * Whether a failed provider call is known to carry no bill (plan 0234,
 * section 15, item 4): a 429, or a status the provider answered, which is a
 * {@link ProviderUnavailableError} with no cause. Every other failure may have
 * been billed.
 */
function answeredUnbilled(error: unknown): boolean {
  return (
    isRateLimited(error) ||
    (error instanceof ProviderUnavailableError &&
      (error as { cause?: unknown }).cause === undefined)
  );
}

/**
 * When the assistant is back, in the person's language and the allowance
 * timezone (plan 0234, section 8.1): a time of day when a day turns over, a
 * date when a month does.
 */
export function backAt(
  resetsAt: string,
  period: AllowancePeriod,
  locale: SupportedLocale,
  timezone: string
): string {
  const instant = new Date(resetsAt);
  return period === AllowancePeriod.MONTH
    ? new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        day: 'numeric',
        month: 'long',
      }).format(instant)
    : new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(instant);
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
