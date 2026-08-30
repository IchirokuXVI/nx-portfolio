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
 * The model, as a config value rather than a literal, so changing it is an env
 * edit and a restart (section 9). `gemini-3.1-flash-lite` is the first thing to
 * try if quality disappoints, and the version numbers do not order those two the
 * way they look.
 */
export const DEFAULT_ASSISTANT_MODEL = 'gemini-3.5-flash-lite';

/** Google's public endpoint. Overridable so a fake can be pointed at in dev. */
export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';

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
  ASSISTANT_MODEL: Joi.string().default(DEFAULT_ASSISTANT_MODEL),

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

  ...telemetryValidationSchema,
});

export interface AssistantConfig {
  port: number;
  natsUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  gatewayInternalUrl: string;
  geminiApiKey: string;
  geminiBaseUrl: string;
  model: string;
  maxTurns: number;
  maxChars: number;
  maxToolCalls: number;
  turnsPerMinute: number;
  concurrency: number;
  retryAfterFallbackSeconds: number;
  providerTimeoutMs: number;
}

function trimmed(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim();
  return value.length > 0 ? value : fallback;
}

export const assistantConfiguration = registerAs(
  'assistant',
  (): AssistantConfig => ({
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
    model: trimmed(process.env.ASSISTANT_MODEL, DEFAULT_ASSISTANT_MODEL),
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
  })
);
