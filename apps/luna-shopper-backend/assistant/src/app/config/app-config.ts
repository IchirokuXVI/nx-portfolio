import { registerAs } from '@nestjs/config';
import type { AllowanceLimits } from '@portfolio/luna-shopper/contracts';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';

/**
 * Assistant configuration (plan 0039, section 11).
 *
 * Two things about this file are load bearing.
 *
 * **`ANTHROPIC_API_KEY` may be empty**, and the schema says so rather than requiring
 * it. That follows plan 0026: an operator with no key gets a service that boots
 * and answers 501 on its one route, not a pod stuck in
 * `CreateContainerConfigError` and a cluster that never comes up. It is also what
 * lets `provision-release.sh --check` keep passing on a cluster where the
 * assistant is simply not configured.
 *
 * **There is no database url here and there is not meant to be one.** Rule A1
 * does not forbid this service owning storage, but section 4 declines it for this
 * test, and the absence of a `*_DB_URL` is the cheapest place for that decision
 * to be visible.
 */
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

/**
 * Claude answers every turn (plan 0236). There is no provider switch any more:
 * the only other provider this service had does not allow a service that minors
 * use, and Velista is for every age. A stale `ASSISTANT_PROVIDER` or old
 * provider key in an environment is ignored, because the schema allows unknown
 * keys and nothing reads them (section 1).
 */

/** `output_config.effort` on a Claude request (plan 0224, section 10). */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high'] as const;

/**
 * Whether a Claude request thinks before it answers (plan 0224, section 10).
 *
 * `off` is here for the operator who measures it again, not as a setting anybody
 * should run: with thinking off the evaluation lost twelve points of pass rate.
 * It sends `{ type: 'disabled' }`, which Haiku accepts and Sonnet answers with a
 * 400.
 */
export const CLAUDE_THINKING_MODES = ['adaptive', 'off'] as const;

/**
 * The Claude model, effort and thinking that the evaluation of 2026-10-22 chose
 * (plan 0224, section 10): Sonnet scored one point more for seventeen times the
 * cost, and effort `medium` scored the same as `low` and was slower. The model
 * is a config value rather than a literal, so changing it is an env edit and a
 * restart.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';
export const DEFAULT_CLAUDE_EFFORT: (typeof CLAUDE_EFFORTS)[number] = 'low';
export const DEFAULT_CLAUDE_THINKING: (typeof CLAUDE_THINKING_MODES)[number] =
  'adaptive';

/**
 * The model that checks each reply before it leaves (plan 0236, section 4.1).
 * One word of output with thinking off, so the smallest model is the right one.
 */
export const DEFAULT_MODERATION_MODEL = 'claude-haiku-5-5';

/**
 * Whether each reply is checked (plan 0236, section 4.3). `off` is for a self
 * hoster whose deployment no minor uses; Velista runs it `on`.
 */
export const MODERATION_SWITCH = ['on', 'off'] as const;

/**
 * The number the distress sentence names (plan 0236, section 3.2): the
 * emergency number of Spain and the whole EU. A self hoster elsewhere sets
 * their own.
 */
export const DEFAULT_EMERGENCY_NUMBER = '112';

/** Anthropic's public endpoint. Overridable so a fake can be pointed at in dev. */
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

/**
 * What a recording may weigh, in bytes (plan 0041, sections 4.2 and 5).
 *
 * 2 MB, and the number is one decision rather than three guesses: base64 inflates
 * it to about 2.7 MB on the broker leg, the transcript and envelope take it under
 * 3 MB, and `max_payload` is 16 MB. The headroom is deliberate — setting the
 * broker just above the cap would mean the next change to either number has to
 * move both.
 *
 * The client records at a speech grade bitrate so five minutes fits inside this
 * with room to spare. That is the client's job; this is the server's, because a
 * duration cannot be trusted and a byte count can be counted.
 */
export const DEFAULT_AUDIO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The containers this service will forward to the transcriber.
 *
 * The transcriber decodes with ffmpeg, which reads every one of these (plan
 * 0235, section 3), so there is no container rewrite in this codebase and there
 * does not need to be one.
 *
 * The first three are what browsers actually produce: Chrome gives
 * `audio/webm;codecs=opus`, Firefox `audio/ogg;codecs=opus`, Safari
 * `audio/mp4`. The rest are here so a fixture or a hand made request is not
 * refused for being a wav.
 *
 * Parameters are stripped before the check, because `audio/webm;codecs=opus` and
 * `audio/webm` are the same container and only one of them is a browser's idea
 * of how to say so.
 */
export const DEFAULT_AUDIO_MIME_TYPES =
  'audio/webm,audio/ogg,audio/mp4,audio/wav,audio/mpeg,audio/aac,audio/flac';

/**
 * Each person's allowance (plan 0234, section 7): the key, its registered
 * default and its guest default, which is the same key with `_GUEST`
 * appended. Written once here; the chart, compose and the slot script state
 * the same numbers.
 *
 * The two deployment keys and the turn reserve have no guest form: they are
 * about the deployment, not about a person.
 */
export const ALLOWANCE_LIMIT_KEYS: readonly {
  key: string;
  field: keyof AllowanceLimits;
  registered: number;
  guest: number | null;
}[] = [
  {
    key: 'ASSISTANT_TURNS_PER_DAY',
    field: 'turnsPerDay',
    registered: 60,
    guest: 20,
  },
  {
    key: 'ASSISTANT_TURNS_PER_MONTH',
    field: 'turnsPerMonth',
    registered: 600,
    guest: 100,
  },
  {
    key: 'ASSISTANT_AUDIO_SECONDS_PER_DAY',
    field: 'assistantAudioSecondsPerDay',
    registered: 900,
    guest: 300,
  },
  {
    key: 'ASSISTANT_AUDIO_SECONDS_PER_MONTH',
    field: 'assistantAudioSecondsPerMonth',
    registered: 9000,
    guest: 1500,
  },
  {
    key: 'COMMENT_AUDIO_SECONDS_PER_DAY',
    field: 'commentAudioSecondsPerDay',
    registered: 1800,
    guest: 600,
  },
  {
    key: 'COMMENT_AUDIO_SECONDS_PER_MONTH',
    field: 'commentAudioSecondsPerMonth',
    registered: 18000,
    guest: 3000,
  },
  {
    key: 'ASSISTANT_COST_PER_DAY_MICRO_USD',
    field: 'costPerDayMicroUsd',
    registered: 100_000,
    guest: 40_000,
  },
  {
    key: 'ASSISTANT_COST_PER_MONTH_MICRO_USD',
    field: 'costPerMonthMicroUsd',
    registered: 1_000_000,
    guest: 200_000,
  },
  {
    key: 'ASSISTANT_DEPLOYMENT_COST_PER_DAY_MICRO_USD',
    field: 'deploymentCostPerDayMicroUsd',
    registered: 3_000_000,
    guest: null,
  },
  {
    key: 'ASSISTANT_DEPLOYMENT_COST_PER_MONTH_MICRO_USD',
    field: 'deploymentCostPerMonthMicroUsd',
    registered: 30_000_000,
    guest: null,
  },
];

/** What a turn reserves before its first provider call (section 5.2). */
export const DEFAULT_TURN_RESERVE_MICRO_USD = 20_000;

/** Where the day and the month turn over (section 7). An IANA name. */
export const DEFAULT_ALLOWANCE_TIMEZONE = 'UTC';

/** True when `timezone` is an IANA name this runtime knows (section 11). */
export function isTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function allowanceValidationSchema(): Record<string, Joi.Schema> {
  const keys: Record<string, Joi.Schema> = {
    ASSISTANT_TURN_RESERVE_MICRO_USD: Joi.number()
      .integer()
      .min(1)
      .default(DEFAULT_TURN_RESERVE_MICRO_USD),
    ASSISTANT_ALLOWANCE_TIMEZONE: Joi.string()
      .custom((value: string, helpers) =>
        isTimeZone(value) ? value : helpers.error('any.invalid')
      )
      .default(DEFAULT_ALLOWANCE_TIMEZONE),
  };
  for (const entry of ALLOWANCE_LIMIT_KEYS) {
    keys[entry.key] = Joi.number().integer().min(1).default(entry.registered);
    if (entry.guest !== null) {
      keys[`${entry.key}_GUEST`] = Joi.number()
        .integer()
        .min(1)
        .default(entry.guest);
    }
  }
  return keys;
}

export const assistantValidationSchema = Joi.object({
  PORT: Joi.number().port().default(3006),
  NATS_URL: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default('info'),

  /**
   * Where the assistant calls the app's own API, carrying the caller's token
   * (rule A1). The cluster's internal service name, never a public hostname:
   * going out and back in would pay for TLS and the ingress for a call that
   * never leaves the cluster.
   */
  GATEWAY_INTERNAL_URL: Joi.string().required(),

  /**
   * The Claude keys (plan 0224, section 5).
   *
   * Every one of them allows `''`, and empty means the shipped default. The
   * chart writes the effort and the thinking empty, and the slot script writes
   * all of them empty, so a `valid()` without `allow('')` would kill the service
   * at boot on the ordinary configuration, the trap `TRANSCRIBER_URL`'s comment
   * below describes.
   *
   * An empty `ANTHROPIC_API_KEY` is a supported deployment, not a
   * misconfiguration: every turn answers 501 not_configured. See the file
   * comment, and `OPTIONAL_EMPTY_KEYS` in provision-release.sh.
   */
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  ANTHROPIC_BASE_URL: Joi.string().allow('').default(''),
  ASSISTANT_CLAUDE_EFFORT: Joi.string()
    .valid(...CLAUDE_EFFORTS)
    .allow('')
    .default(DEFAULT_CLAUDE_EFFORT),
  ASSISTANT_CLAUDE_THINKING: Joi.string()
    .valid(...CLAUDE_THINKING_MODES)
    .allow('')
    .default(DEFAULT_CLAUDE_THINKING),

  /** The model that answers a turn. Empty means {@link DEFAULT_CLAUDE_MODEL}. */
  ASSISTANT_MODEL: Joi.string().allow('').default(''),

  /**
   * The moderation pass after each turn (plan 0236, section 4). All three allow
   * `''`, which means the shipped default, because the chart writes them empty.
   */
  ASSISTANT_MODERATION: Joi.string()
    .valid(...MODERATION_SWITCH)
    .allow('')
    .default('on'),
  ASSISTANT_MODERATION_MODEL: Joi.string().allow('').default(''),
  ASSISTANT_EMERGENCY_NUMBER: Joi.string().allow('').default(''),

  /**
   * Whether the turn record carries what the person said and what was replied
   * (k8s plan 0018, D3). Off by default, so a deployment logs no transcript
   * unless its operator asks for one; the record then holds the lengths.
   */
  ASSISTANT_LOG_TURN_TEXT: Joi.boolean().default(false),

  /**
   * Where the deployment's own transcriber listens (plan 0235, section 7).
   *
   * Empty is a supported deployment, like an empty key: the assistant answers
   * typed turns and cannot hear, so the voice route answers 501 and a voice
   * comment settles `UNAVAILABLE`. The chart writes it exactly when it runs the
   * transcriber, so this one value is the switch for voice, and `hears` in the
   * capabilities follows it (plan 0231, section 3).
   *
   * **`allow('')` is load bearing**: empty is what the chart writes in every
   * cluster without a transcriber, and what compose and a slot without `--voice`
   * write. Without it the service dies at boot on an ordinary configuration.
   */
  TRANSCRIBER_URL: Joi.string().allow('').default(''),
  /**
   * How long a transcription may take, waiting in the transcriber's queue
   * included (section 6.2). A spoken turn allows one running comment ahead of it
   * plus its own clip on the fast model; a voice comment allows a full queue of
   * turns and then ninety seconds on the large one.
   */
  TRANSCRIBER_TURN_TIMEOUT_MS: Joi.number().integer().min(1000).default(45000),
  TRANSCRIBER_COMMENT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(110000),
  /** Section 5's byte cap, applied on arrival and again by the gateway. */
  ASSISTANT_AUDIO_MAX_BYTES: Joi.number()
    .integer()
    .min(1024)
    .default(DEFAULT_AUDIO_MAX_BYTES),
  /** Comma separated. A container outside this list is refused with a sentence. */
  ASSISTANT_AUDIO_MIME_TYPES: Joi.string().default(DEFAULT_AUDIO_MIME_TYPES),

  /**
   * The caps the service applies to the client supplied transcript (rule A2).
   * They are applied on arrival rather than trusted from the client, because the
   * transcript is untrusted input that happens to arrive in a well formed shape.
   */
  ASSISTANT_MAX_TURNS: Joi.number().integer().min(1).max(200).default(20),
  ASSISTANT_MAX_CHARS: Joi.number()
    .integer()
    .min(200)
    .max(200000)
    .default(8000),
  /** How many tool calls one turn may make before the loop gives up and answers. */
  ASSISTANT_MAX_TOOL_CALLS: Joi.number().integer().min(1).max(20).default(6),

  /**
   * The per instance limiter (section 9). Neither survives a restart and neither
   * is shared across replicas; that weakness is written down in the plan rather
   * than discovered later, and fixing it properly needs storage this plan
   * declines.
   */
  ASSISTANT_TURNS_PER_MINUTE: Joi.number().integer().min(1).default(8),
  /** How many provider calls one instance may have in flight. A burst queues. */
  ASSISTANT_CONCURRENCY: Joi.number().integer().min(1).max(32).default(2),
  /** The floor for `retryAfterSeconds` when nothing better is known (rule A5). */
  ASSISTANT_RETRY_AFTER_FALLBACK: Joi.number().integer().min(1).default(30),
  /** How long the service waits on the provider before giving up on a turn. */
  ASSISTANT_PROVIDER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(30000),
  /**
   * How long one whole turn may run before the loop stops rather than doing more.
   *
   * The provider timeout above bounds one call. It bounds nothing about a turn: six
   * tool calls means seven provider requests, so a turn's own ceiling was seven times
   * this number plus whatever the tools took, and no caller waits that long. The
   * client had given up long before, and the loop went on calling tools, which is how
   * lines appeared on a list seconds after the person who asked for them was told
   * nothing had happened and said it again.
   *
   * The deadline is checked before each provider call and, more importantly, before
   * each round of tools, because the tools are what write. It is not an abort of work
   * in flight: a call already running finishes, which is why anything routing to this
   * service must allow this plus one provider timeout plus slack before it gives up.
   */
  ASSISTANT_TURN_TIMEOUT_MS: Joi.number().integer().min(5000).default(60000),

  /**
   * Each person's allowance (plan 0234, section 7): positive integers, no
   * "off". A self hoster who wants no practical limit sets a large number.
   * Core receives none of them; each reserve carries the limits that apply.
   */
  ...allowanceValidationSchema(),

  ...telemetryValidationSchema,
});

/** The allowance, resolved from the keys of {@link ALLOWANCE_LIMIT_KEYS}. */
export interface AllowanceConfig {
  registered: AllowanceLimits;
  /** The limits of a `TEMPORARY` person, a guest. */
  guest: AllowanceLimits;
  /** Integer micro dollars a turn reserves (section 5.2). */
  turnReserveMicroUsd: number;
  /** An IANA name. The day and the month turn over at midnight there. */
  timezone: string;
}

/**
 * The allowance from an environment. Exported for its spec; an absent key is
 * its default, as Joi has already filled in at boot.
 */
export function resolveAllowance(
  env: Record<string, string | undefined>
): AllowanceConfig {
  const registered = {} as AllowanceLimits;
  const guest = {} as AllowanceLimits;
  for (const entry of ALLOWANCE_LIMIT_KEYS) {
    const value = Number(env[entry.key] ?? entry.registered);
    registered[entry.field] = value;
    guest[entry.field] =
      entry.guest === null
        ? value
        : Number(env[`${entry.key}_GUEST`] ?? entry.guest);
  }
  return {
    registered,
    guest,
    turnReserveMicroUsd: Number(
      env['ASSISTANT_TURN_RESERVE_MICRO_USD'] ?? DEFAULT_TURN_RESERVE_MICRO_USD
    ),
    timezone: trimmed(
      env['ASSISTANT_ALLOWANCE_TIMEZONE'],
      DEFAULT_ALLOWANCE_TIMEZONE
    ),
  };
}

/** The shipped defaults, for specs that build a config by hand. */
export const DEFAULT_ALLOWANCE: AllowanceConfig = resolveAllowance({});

export interface AssistantConfig {
  port: number;
  natsUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  gatewayInternalUrl: string;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  claudeEffort: (typeof CLAUDE_EFFORTS)[number];
  claudeThinking: (typeof CLAUDE_THINKING_MODES)[number];
  /** The model that answers a turn, already resolved to the default. */
  model: string;
  /** Whether each reply is checked before it leaves (plan 0236, section 4). */
  moderation: boolean;
  /** The model that checks it, already resolved to the default. */
  moderationModel: string;
  /** The number the distress sentence names (plan 0236, section 3.2). */
  emergencyNumber: string;
  /** Whether the turn record logs the words of a turn (k8s plan 0018, D3). */
  logTurnText: boolean;
  /** The transcriber's base url, or empty where none runs (plan 0235). */
  transcriberUrl: string;
  transcriberTurnTimeoutMs: number;
  transcriberCommentTimeoutMs: number;
  /** The byte cap on a recording, before base64 (plan 0041). */
  audioMaxBytes: number;
  /** The containers this service accepts, already split and lowercased. */
  audioMimeTypes: readonly string[];
  maxTurns: number;
  maxChars: number;
  maxToolCalls: number;
  turnsPerMinute: number;
  concurrency: number;
  retryAfterFallbackSeconds: number;
  providerTimeoutMs: number;
  /** The ceiling on one whole turn, after which the loop stops rather than doing more. */
  turnTimeoutMs: number;
  /** Each person's allowance (plan 0234). */
  allowance: AllowanceConfig;
}

function trimmed(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim();
  return value.length > 0 ? value : fallback;
}

/**
 * The model names, from the raw keys (plan 0224, section 5; plan 0236).
 *
 * An empty `ASSISTANT_MODEL` is {@link DEFAULT_CLAUDE_MODEL}, and an empty
 * `ASSISTANT_MODERATION_MODEL` is {@link DEFAULT_MODERATION_MODEL}. There is no
 * name for transcription: no model provider hears since plan 0235, and the
 * transcriber names its own models.
 *
 * Exported for its own spec.
 */
export function resolveAssistantModels(env: {
  model?: string;
  moderationModel?: string;
}): { model: string; moderationModel: string } {
  return {
    model: trimmed(env.model, DEFAULT_CLAUDE_MODEL),
    moderationModel: trimmed(env.moderationModel, DEFAULT_MODERATION_MODEL),
  };
}

/**
 * The whitelist, split once here rather than at every check.
 *
 * Lowercased and stripped of empties, so a list written with a trailing comma or
 * a stray space is the list the author meant. {@link normalizeMimeType} does the
 * matching half of this job on the value that arrives from the browser.
 */
function parseMimeTypes(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * A browser's content type, as the container it names.
 *
 * `audio/webm;codecs=opus` and `audio/webm` are the same container, and only one
 * of them is a browser's idea of how to say so. Everything after the first
 * semicolon is a parameter and none of them changes what the file is.
 */
export function normalizeMimeType(raw: string): string {
  return raw.split(';')[0].trim().toLowerCase();
}

export const assistantConfiguration = registerAs(
  'assistant',
  (): AssistantConfig => {
    return {
      port: Number(process.env.PORT ?? 3006),
      natsUrl: process.env.NATS_URL as string,
      logLevel: process.env.LOG_LEVEL as AssistantConfig['logLevel'],
      // Trailing slashes are stripped once here rather than at every call site,
      // because a doubled slash in a path is the kind of thing that works against
      // one router and 404s against the next.
      gatewayInternalUrl: (process.env.GATEWAY_INTERNAL_URL as string)?.replace(
        /\/+$/,
        ''
      ),
      anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
      anthropicBaseUrl: trimmed(
        process.env.ANTHROPIC_BASE_URL,
        DEFAULT_ANTHROPIC_BASE_URL
      ).replace(/\/+$/, ''),
      claudeEffort: trimmed(
        process.env.ASSISTANT_CLAUDE_EFFORT,
        DEFAULT_CLAUDE_EFFORT
      ) as AssistantConfig['claudeEffort'],
      claudeThinking: trimmed(
        process.env.ASSISTANT_CLAUDE_THINKING,
        DEFAULT_CLAUDE_THINKING
      ) as AssistantConfig['claudeThinking'],
      ...resolveAssistantModels({
        model: process.env.ASSISTANT_MODEL,
        moderationModel: process.env.ASSISTANT_MODERATION_MODEL,
      }),
      moderation: trimmed(process.env.ASSISTANT_MODERATION, 'on') !== 'off',
      emergencyNumber: trimmed(
        process.env.ASSISTANT_EMERGENCY_NUMBER,
        DEFAULT_EMERGENCY_NUMBER
      ),
      logTurnText:
        trimmed(process.env.ASSISTANT_LOG_TURN_TEXT, 'false').toLowerCase() ===
        'true',
      transcriberUrl: (process.env.TRANSCRIBER_URL ?? '')
        .trim()
        .replace(/\/+$/, ''),
      transcriberTurnTimeoutMs: Number(
        process.env.TRANSCRIBER_TURN_TIMEOUT_MS ?? 45000
      ),
      transcriberCommentTimeoutMs: Number(
        process.env.TRANSCRIBER_COMMENT_TIMEOUT_MS ?? 110000
      ),
      audioMaxBytes: Number(
        process.env.ASSISTANT_AUDIO_MAX_BYTES ?? DEFAULT_AUDIO_MAX_BYTES
      ),
      audioMimeTypes: parseMimeTypes(
        trimmed(
          process.env.ASSISTANT_AUDIO_MIME_TYPES,
          DEFAULT_AUDIO_MIME_TYPES
        )
      ),
      maxTurns: Number(process.env.ASSISTANT_MAX_TURNS ?? 20),
      maxChars: Number(process.env.ASSISTANT_MAX_CHARS ?? 8000),
      maxToolCalls: Number(process.env.ASSISTANT_MAX_TOOL_CALLS ?? 6),
      turnsPerMinute: Number(process.env.ASSISTANT_TURNS_PER_MINUTE ?? 8),
      concurrency: Number(process.env.ASSISTANT_CONCURRENCY ?? 2),
      retryAfterFallbackSeconds: Number(
        process.env.ASSISTANT_RETRY_AFTER_FALLBACK ?? 30
      ),
      providerTimeoutMs: Number(
        process.env.ASSISTANT_PROVIDER_TIMEOUT_MS ?? 30000
      ),
      turnTimeoutMs: Number(process.env.ASSISTANT_TURN_TIMEOUT_MS ?? 60000),
      allowance: resolveAllowance(process.env),
    };
  }
);
