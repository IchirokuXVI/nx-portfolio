import {
  trace,
  type AttributeValue,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { REDACTION_CENSOR, REDACTION_PATHS } from '../logging/redaction';

/**
 * Safe span attributes (plan 0016, section 4.7).
 *
 * Plan 0004 section 1 established that secrets never reach the log, and span
 * attributes are a second place they could leak that pino's `redact` config does
 * not cover. Rather than keep a second list that can drift, the forbidden keys
 * are **derived** from `logging/redaction.ts`, so the redaction list has exactly
 * one definition: adding a path there also keeps it out of every span.
 *
 * Request and message bodies are never attached to spans at all. These helpers
 * exist for the deliberately chosen, low volume attributes (identifiers, subject
 * names, outcomes) that make a trace readable.
 */

/** Span attribute carrying the user facing correlation id (section 4.4). */
export const CORRELATION_ID_SPAN_ATTRIBUTE = 'luna.correlation_id';

/**
 * Reduces a pino redact path to the key it protects: `*.accessToken` and
 * `req.headers["set-cookie"]` become `accesstoken` and `set-cookie`. A bare `*`
 * protects no particular key and is dropped.
 */
function redactionPathToKey(path: string): string | undefined {
  const bracketed = /\[\s*["']([^"']+)["']\s*\]\s*$/.exec(path);
  if (bracketed) {
    return bracketed[1].toLowerCase();
  }
  const segment = path.split('.').pop();
  return segment && segment !== '*' ? segment.toLowerCase() : undefined;
}

/** Every key name `logging/redaction.ts` protects, lower cased. */
export const SENSITIVE_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(
  REDACTION_PATHS.map(redactionPathToKey).filter(
    (key): key is string => key !== undefined
  )
);

/**
 * True when an attribute key names a secret. The comparison is on the final
 * dotted segment as well as the whole key, so both `authorization` and the
 * instrumentation style `http.request.header.authorization` are caught.
 */
export function isSensitiveAttributeKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (SENSITIVE_ATTRIBUTE_KEYS.has(lowered)) {
    return true;
  }
  const segment = lowered.split('.').pop();
  return segment !== undefined && SENSITIVE_ATTRIBUTE_KEYS.has(segment);
}

function toAttributeValue(value: unknown): AttributeValue {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    default:
      return Array.isArray(value) ? value.map(String) : String(value);
  }
}

/**
 * Copies attributes, replacing anything whose key names a secret with the same
 * `[Redacted]` marker pino writes, so a span and a log line agree about what was
 * hidden. Keys with a nullish value are dropped rather than recorded as
 * `"undefined"`, which keeps the presence of an attribute meaningful.
 */
export function redactSpanAttributes(
  attributes: Record<string, unknown>
): Attributes {
  const safe: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveAttributeKey(key)) {
      safe[key] = REDACTION_CENSOR;
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    safe[key] = toAttributeValue(value);
  }
  return safe;
}

/** Sets attributes on a span after running them through the redaction above. */
export function setSafeAttributes(
  span: Span | undefined,
  attributes: Record<string, unknown>
): void {
  span?.setAttributes(redactSpanAttributes(attributes));
}

/**
 * Tags the active span with the correlation id, which is what lets a trace be
 * found from an id a user quoted out of a problem+json response (section 4.4).
 * A no op outside a span, so callers never have to guard.
 */
export function setCorrelationIdOnActiveSpan(correlationId: string): void {
  setSafeAttributes(trace.getActiveSpan(), {
    [CORRELATION_ID_SPAN_ATTRIBUTE]: correlationId,
  });
}

// The log side of section 4.4's two way navigation needs nothing here:
// `@opentelemetry/instrumentation-pino` is in the auto bundle and already puts
// `trace_id`, `span_id` and `trace_flags` on every line beside the correlation
// id. See the note in `logging/logger.options.ts`.
