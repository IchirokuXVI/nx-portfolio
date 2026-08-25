import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';
import type { MsgHdrs } from 'nats';
import { getCorrelationId } from '../context/request-context';
import {
  recordNatsMessage,
  type MessagingOperation,
} from './metrics/nats.metrics';
import {
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_SYSTEM,
} from './semconv-incubating';
import { CORRELATION_ID_SPAN_ATTRIBUTE } from './span-attributes';

/**
 * Trace context across the broker (plan 0016, section 4.3).
 *
 * This is the plan's core work item, not an afterthought. There is no official
 * OpenTelemetry instrumentation for the `nats` client, and NATS is the backbone
 * of this system: nearly every interesting trace crosses it at least once.
 * Without the injection and extraction below, every trace would stop dead at the
 * gateway and restart disconnected in auth or core, which is the failure that
 * makes tracing worthless in a broker based system.
 *
 * The seam is the same file that already owns the correlation header, so no
 * service has to know any of this happened: `buildNatsHeaders` injects on send
 * and the RPC interceptor extracts on receive.
 */

const MESSAGING_SYSTEM = 'nats';
const TRACER_NAME = '@portfolio/luna-shopper/platform';

function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/** W3C `traceparent`/`tracestate` are written as ordinary NATS headers. */
const headerSetter: TextMapSetter<MsgHdrs> = {
  set: (headers, key, value) => headers.set(key, value),
};

const headerGetter: TextMapGetter<MsgHdrs> = {
  keys: (headers) => headers.keys(),
  get: (headers, key) => {
    const value = headers.get(key);
    return value ? value : undefined;
  },
};

/**
 * Writes the active trace context onto outbound NATS headers. Called from
 * `buildNatsHeaders`, so every existing and future publish path propagates by
 * default rather than by remembering to. A no op when no span is active, and
 * when telemetry is off the global propagator writes nothing.
 */
export function injectTraceContext(headers: MsgHdrs): void {
  propagation.inject(otelContext.active(), headers, headerSetter);
}

/**
 * Rebuilds the caller's context from inbound NATS headers, so a handler's spans
 * are children of the caller's span rather than roots of a new trace. Returns the
 * current context unchanged when the message carries no trace context (an
 * internal event, a direct probe, a caller with telemetry off).
 */
export function extractTraceContext(headers: MsgHdrs | undefined): Context {
  if (!headers) {
    return otelContext.active();
  }
  return propagation.extract(otelContext.active(), headers, headerGetter);
}

function startMessagingSpan(
  subject: string,
  operation: MessagingOperation,
  parent: Context
): Span {
  const correlationId = getCorrelationId();

  return tracer().startSpan(
    `${subject} ${operation}`,
    {
      kind: operation === 'publish' ? SpanKind.PRODUCER : SpanKind.CONSUMER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: MESSAGING_SYSTEM,
        [ATTR_MESSAGING_DESTINATION_NAME]: subject,
        [ATTR_MESSAGING_OPERATION_TYPE]: operation,
        // The user facing id, so a trace can be found from what a bug report
        // quotes (section 4.4). It is an attribute, never a metric label.
        ...(correlationId
          ? { [CORRELATION_ID_SPAN_ATTRIBUTE]: correlationId }
          : {}),
      },
    },
    parent
  );
}

/**
 * Closes a messaging span and records the matching metric. Span and metric are
 * emitted from this one place so the two signals cannot disagree about what a
 * message is or how long it took (section 5.2).
 */
function finishMessagingSpan(
  span: Span,
  subject: string,
  operation: MessagingOperation,
  startedAt: number,
  error?: unknown
): void {
  if (error !== undefined) {
    const thrown = error instanceof Error ? error : new Error(String(error));
    span.recordException(thrown);
    span.setStatus({ code: SpanStatusCode.ERROR, message: thrown.message });
  }
  span.end();

  recordNatsMessage({
    subject,
    operation,
    outcome: error === undefined ? 'success' : 'failure',
    durationMs: Date.now() - startedAt,
  });
}

/**
 * Runs an outbound request/reply or publish inside a producer span, with that
 * span active so the headers built inside carry it. This is what turns a
 * request/reply round trip into a producer span and a consumer span rather than
 * one opaque gap in the trace.
 */
export function traceNatsSend<T>(subject: string, send: () => T): T {
  const span = startMessagingSpan(subject, 'publish', otelContext.active());
  const startedAt = Date.now();
  const spanContext = trace.setSpan(otelContext.active(), span);

  let result: T;
  try {
    result = otelContext.with(spanContext, send);
  } catch (error) {
    finishMessagingSpan(span, subject, 'publish', startedAt, error);
    throw error;
  }

  // A request/reply send answers with a promise; a fire and forget publish does
  // not. Both are supported so callers do not need two helpers.
  if (result instanceof Promise) {
    return result.then(
      (value) => {
        finishMessagingSpan(span, subject, 'publish', startedAt);
        return value;
      },
      (error: unknown) => {
        finishMessagingSpan(span, subject, 'publish', startedAt, error);
        throw error;
      }
    ) as T;
  }

  finishMessagingSpan(span, subject, 'publish', startedAt);
  return result;
}

/** A consumer span plus the context a handler must run inside. */
export interface ConsumerSpanScope {
  span: Span;
  context: Context;
  /** Ends the span and records the metric. Call exactly once. */
  finish: (error?: unknown) => void;
}

/**
 * Opens a consumer span parented to the caller's span, extracted from the
 * message headers. The handler must run inside `context`, which is what makes
 * everything it does (its database queries, its own outbound messages) a child of
 * the originating request instead of a disconnected new trace.
 */
export function beginConsumerSpan(
  subject: string,
  headers: MsgHdrs | undefined
): ConsumerSpanScope {
  const parent = extractTraceContext(headers);
  const span = startMessagingSpan(subject, 'process', parent);
  const startedAt = Date.now();

  return {
    span,
    context: trace.setSpan(parent, span),
    finish: (error?: unknown) =>
      finishMessagingSpan(span, subject, 'process', startedAt, error),
  };
}
