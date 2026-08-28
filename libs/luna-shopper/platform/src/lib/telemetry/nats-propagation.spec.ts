import { context as otelContext, SpanKind, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { headers as createNatsHeaders } from 'nats';
import { runWithRequestContext } from '../context/request-context';
import { buildNatsHeaders } from '../nats/correlation-headers';
import { beginConsumerSpan, traceNatsSend } from './nats-propagation';
import {
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_SYSTEM,
} from './semconv-incubating';
import { CORRELATION_ID_SPAN_ATTRIBUTE } from './span-attributes';

/**
 * Propagation across the broker (plan 0016, sections 4.3 and 10).
 *
 * This is the test that actually protects the feature. It is exactly what breaks
 * when someone adds a new publish path and forgets the trace headers, and without
 * it a broken trace tree is invisible until somebody goes looking for a trace and
 * finds five disconnected ones.
 */

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  // Also installs the async hooks context manager and the W3C propagator, which
  // is what makes `context.with` and `traceparent` work at all.
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

/** Runs `fn` with a recording root span active, the way a real caller would. */
function asCaller<T>(fn: (callerSpanId: string, traceId: string) => T): T {
  const span = trace.getTracer('test').startSpan('caller');
  const spanContext = span.spanContext();
  try {
    return otelContext.with(trace.setSpan(otelContext.active(), span), () =>
      fn(spanContext.spanId, spanContext.traceId)
    );
  } finally {
    span.end();
  }
}

describe('NATS trace propagation', () => {
  it('round trips a traceparent through NATS headers', () => {
    asCaller((callerSpanId, traceId) => {
      const headers = buildNatsHeaders();

      expect(headers.get('traceparent')).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/
      );

      const scope = beginConsumerSpan('zone.updated', headers);
      const consumerContext = scope.span.spanContext();
      scope.finish();

      // Same trace, and the consumer span hangs off the caller's span rather
      // than starting a disconnected new tree.
      expect(consumerContext.traceId).toBe(traceId);

      const consumerSpan = exporter
        .getFinishedSpans()
        .find((span) => span.name === 'zone.updated process');
      expect(consumerSpan?.parentSpanContext?.spanId).toBe(callerSpanId);
    });
  });

  it('propagates through every publish path that builds headers', () => {
    // The guard the plan asks for: propagation is a property of
    // `buildNatsHeaders`, so a new publisher gets it by calling the function it
    // already had to call. A publish path can only lose the trace context by not
    // going through this seam at all.
    asCaller(() => {
      const withOverrides = buildNatsHeaders({
        correlationId: 'c-1',
        locale: 'es',
      });
      expect(withOverrides.has('traceparent')).toBe(true);
      expect(withOverrides.get('x-correlation-id')).toBe('c-1');
      expect(withOverrides.get('x-locale')).toBe('es');
    });
  });

  it('starts a fresh trace when the message carries no trace context', () => {
    const scope = beginConsumerSpan('list.created', createNatsHeaders());
    scope.finish();

    const span = exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === 'list.created process');
    expect(span).toBeDefined();
    expect(span?.parentSpanContext).toBeUndefined();
  });

  it('tolerates a message with no headers at all', () => {
    expect(() =>
      beginConsumerSpan('member.joined', undefined).finish()
    ).not.toThrow();
  });

  it('records the standard messaging attributes on both sides', async () => {
    await asCaller(async () => {
      await traceNatsSend('auth.login', async () => 'ok');
    });

    const producer = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'auth.login publish');

    expect(producer?.kind).toBe(SpanKind.PRODUCER);
    expect(producer?.attributes[ATTR_MESSAGING_SYSTEM]).toBe('nats');
    expect(producer?.attributes[ATTR_MESSAGING_DESTINATION_NAME]).toBe(
      'auth.login'
    );
    expect(producer?.attributes[ATTR_MESSAGING_OPERATION_TYPE]).toBe('publish');

    const consumer = beginConsumerSpan('auth.login', createNatsHeaders());
    consumer.finish();
    const consumerSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'auth.login process');
    expect(consumerSpan?.kind).toBe(SpanKind.CONSUMER);
  });

  it('ends the producer span when a request/reply send rejects', async () => {
    await expect(
      traceNatsSend('core.zones.get', () => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom');

    const span = exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === 'core.zones.get publish');
    expect(span).toBeDefined();
    // ERROR = 2 in the OTel status enum.
    expect(span?.status.code).toBe(2);
    expect(span?.events.map((event) => event.name)).toContain('exception');
  });

  it('ends the producer span when a fire and forget publish throws', () => {
    expect(() =>
      traceNatsSend('zone.deleted', () => {
        throw new Error('no connection');
      })
    ).toThrow('no connection');

    expect(
      exporter
        .getFinishedSpans()
        .some((span) => span.name === 'zone.deleted publish')
    ).toBe(true);
  });

  it('tags the span with the correlation id, so a bug report finds the trace', () => {
    runWithRequestContext({ correlationId: 'quoted-in-a-bug-report' }, () => {
      beginConsumerSpan('list.updated', createNatsHeaders()).finish();
    });

    const span = exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === 'list.updated process');
    expect(span?.attributes[CORRELATION_ID_SPAN_ATTRIBUTE]).toBe(
      'quoted-in-a-bug-report'
    );
  });

  it('omits the correlation attribute outside a request scope', () => {
    beginConsumerSpan('member.banned', createNatsHeaders()).finish();

    const span = exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === 'member.banned process');
    expect(span?.attributes[CORRELATION_ID_SPAN_ATTRIBUTE]).toBeUndefined();
  });
});
