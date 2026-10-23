import { registerAs } from '@nestjs/config';
import { telemetryValidationSchema } from '@portfolio/luna-shopper/platform';
import * as Joi from 'joi';

/**
 * Assistant configuration (plan 0039, section 11).
 *
 * Two things about this file are load bearing.
 *
 * **`GEMINI_API_KEY` may be empty**, and the schema says so rather than requiring
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
 * Which provider answers a turn (plan 0224, section 1).
 *
 * `gemini` is the default and the behaviour from before the switch existed.
 * `claude` answers with Claude and still hears with Gemini, because the Messages
 * API takes no audio: a spoken turn and a voice comment are transcribed by the
 * Gemini key whatever this says.
 */
export const ASSISTANT_PROVIDERS = ['gemini', 'claude'] as const;
export type AssistantProviderName = (typeof ASSISTANT_PROVIDERS)[number];

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
 * The Gemini model, as a config value rather than a literal, so changing it is an
 * env edit and a restart (section 9). `gemini-3.1-flash-lite` is the first thing
 * to try if quality disappoints, and the version numbers do not order those two
 * the way they look.
 *
 * It is also the transcription model whenever Claude answers, because Gemini is
 * the only provider here that hears.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

/**
 * The Claude model, effort and thinking that the evaluation of 2026-10-22 chose
 * (plan 0224, section 10): Sonnet scored one point more for seventeen times the
 * cost, and effort `medium` scored the same as `low` and was slower.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';
export const DEFAULT_CLAUDE_EFFORT: (typeof CLAUDE_EFFORTS)[number] = 'low';
export const DEFAULT_CLAUDE_THINKING: (typeof CLAUDE_THINKING_MODES)[number] =
  'adaptive';

/** Google's public endpoint. Overridable so a fake can be pointed at in dev. */
export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';

/** Anthropic's public endpoint. Overridable for the same reason. */
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
 * The containers this service will forward to the provider.
 *
 * Every one of these is on Gemini's own accepted list, checked against the
 * current documentation rather than quoted from the plan (section 3.3, which
 * expected `audio/webm` to be missing and it is not — so there is no container
 * rewrite in this codebase and there does not need to be one).
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
   * Empty is a supported deployment, not a misconfiguration. See the file
   * comment, and `OPTIONAL_EMPTY_KEYS` in provision-release.sh.
   */
  GEMINI_API_KEY: Joi.string().allow('').default(''),
  GEMINI_BASE_URL: Joi.string().allow('').default(''),

  /**
   * The provider switch and the Claude keys (plan 0224, section 5).
   *
   * Every one of them allows `''`, and empty means the shipped default. The
   * chart writes the effort and the thinking empty, and the slot script writes
   * all of them empty, so a `valid()` without `allow('')` would kill the service
   * at boot on the ordinary configuration, the trap the transcription model's
   * comment below describes.
   *
   * `ANTHROPIC_API_KEY` may be empty by the rule `GEMINI_API_KEY` follows: with
   * the switch on `claude` and no key, the turn answers 501 not_configured.
   */
  ASSISTANT_PROVIDER: Joi.string()
    .valid(...ASSISTANT_PROVIDERS)
    .allow('')
    .default('gemini'),
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

  /**
   * The model that answers a turn. Empty means the provider's own default:
   * {@link DEFAULT_GEMINI_MODEL} or {@link DEFAULT_CLAUDE_MODEL}. A literal
   * default here would send a Gemini name to Claude the day the switch flips.
   */
  ASSISTANT_MODEL: Joi.string().allow('').default(''),

  /**
   * The model that transcribes (plan 0041, section 10). Always a Gemini model,
   * whatever the provider (plan 0224, section 5).
   *
   * Its own key so a different model can do this job than answers the turn,
   * without a code change. Whether they *should* differ is a quality question
   * with no answer before there is usage, so the default is the turn's model and
   * the key exists to make changing that an env edit.
   *
   * **`allow('')` is load bearing**, for the same reason `GEMINI_API_KEY` has it:
   * empty is the documented value meaning "whatever answers the turn", and it is
   * what the chart, both compose files and both slot scripts all write. Without
   * this the service dies at boot on a perfectly ordinary configuration, and it
   * dies alone — the gateway stays up and answers 500s, which is a slow thing to
   * diagnose from outside.
   */
  ASSISTANT_TRANSCRIPTION_MODEL: Joi.string().allow('').default(''),
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

  ...telemetryValidationSchema,
});

export interface AssistantConfig {
  port: number;
  natsUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  gatewayInternalUrl: string;
  geminiApiKey: string;
  geminiBaseUrl: string;
  /** Which provider answers a turn. Gemini hears in both cases (plan 0224). */
  provider: AssistantProviderName;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  claudeEffort: (typeof CLAUDE_EFFORTS)[number];
  claudeThinking: (typeof CLAUDE_THINKING_MODES)[number];
  /** The model that answers a turn, already resolved for the provider. */
  model: string;
  /** The Gemini model that transcribes. See {@link resolveAssistantModels}. */
  transcriptionModel: string;
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
}

function trimmed(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim();
  return value.length > 0 ? value : fallback;
}

/**
 * The two model names, from the raw keys and the provider (plan 0224, section 5).
 *
 * An empty `ASSISTANT_MODEL` is the provider's own default. An empty
 * `ASSISTANT_TRANSCRIPTION_MODEL` follows the turn's model when Gemini answers,
 * so the two stay together by default and an operator who changes one has
 * changed one. When Claude answers it falls back to {@link DEFAULT_GEMINI_MODEL}
 * instead, because the transcription goes to the Gemini endpoint and a Claude
 * name there is a 404 on every spoken turn.
 *
 * Exported for its own spec.
 */
export function resolveAssistantModels(env: {
  provider: AssistantProviderName;
  model?: string;
  transcriptionModel?: string;
}): { model: string; transcriptionModel: string } {
  const model = trimmed(
    env.model,
    env.provider === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_GEMINI_MODEL
  );
  return {
    model,
    transcriptionModel: trimmed(
      env.transcriptionModel,
      env.provider === 'claude' ? DEFAULT_GEMINI_MODEL : model
    ),
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
    const provider = trimmed(
      process.env.ASSISTANT_PROVIDER,
      'gemini'
    ) as AssistantProviderName;
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
      geminiApiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
      geminiBaseUrl: trimmed(
        process.env.GEMINI_BASE_URL,
        DEFAULT_GEMINI_BASE_URL
      ).replace(/\/+$/, ''),
      provider,
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
        provider,
        model: process.env.ASSISTANT_MODEL,
        transcriptionModel: process.env.ASSISTANT_TRANSCRIPTION_MODEL,
      }),
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
    };
  }
);
