import { context as otelContext, SpanKind, trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { describeIntegration } from '@portfolio/luna-shopper/test-fixtures/jest';
import { connect, JSONCodec, type NatsConnection } from 'nats';
import { buildNatsHeaders } from '../nats/correlation-headers';
import { beginConsumerSpan, traceNatsSend } from './nats-propagation';

/**
 * One trace across a real broker (plan 0016, sections 10 and 12).
 *
 * The unit suite proves the header round trips. This proves the whole chain over
 * a live NATS connection, which is the exit criterion: a single user action
 * produces **one** trace spanning the gateway, the NATS hops and the fan out,
 * with correct parent/child structure across every service boundary.
 *
 * The shape below is the real one from the service plans, with the handlers
 * standing in for core and realtime:
 *
 *   gateway HTTP span
 *     -> core.lists.list publish        (gateway request/reply, plan 0007)
 *       -> core.lists.list process      (core's handler)
 *         -> list.updated publish       (core emits the domain event)
 *           -> list.updated process     (realtime fans it out, plan 0009)
 *
 * That last link is the one worth having: it is what lets a trace run from the
 * user's HTTP request to the push another user's browser receives.
 */

const REQUEST_SUBJECT = 'core.lists.list';
const EVENT_SUBJECT = 'list.updated';

// Slot 0 / CI defaults. Export NATS_URL to point at another slot's broker.
const natsUrl = process.env['NATS_URL'] ?? 'nats://localhost:4222';

describeIntegration('trace propagation over a real NATS round trip', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const codec = JSONCodec();

  let connection: NatsConnection;
  let fannedOut: Promise<void>;

  beforeAll(async () => {
    provider.register();
    connection = await connect({ servers: [natsUrl], name: 'plan-0016-spec' });

    // Stands in for core: handle the request inside a consumer span, publish a
    // domain event from within it, and answer the caller.
    const requests = connection.subscribe(REQUEST_SUBJECT);
    void (async () => {
      for await (const message of requests) {
        const scope = beginConsumerSpan(REQUEST_SUBJECT, message.headers);
        otelContext.with(scope.context, () => {
          traceNatsSend(EVENT_SUBJECT, () =>
            connection.publish(EVENT_SUBJECT, codec.encode({ listId: 'l-1' }), {
              headers: buildNatsHeaders(),
            })
          );
        });
        scope.finish();
        message.respond(codec.encode({ lists: [] }));
      }
    })();

    // Stands in for the realtime fan out, the far end of the trace.
    const events = connection.subscribe(EVENT_SUBJECT);
    fannedOut = new Promise<void>((resolve) => {
      void (async () => {
        for await (const message of events) {
          beginConsumerSpan(EVENT_SUBJECT, message.headers).finish();
          resolve();
        }
      })();
    });
  }, 20_000);

  afterAll(async () => {
    await connection?.drain();
    await provider.shutdown();
  });

  it('threads one trace from the HTTP request to the fan out', async () => {
    const rootSpan = trace.getTracer('gateway').startSpan('GET /v1/lists', {
      kind: SpanKind.SERVER,
    });
    const rootContext = rootSpan.spanContext();

    await otelContext.with(
      trace.setSpan(otelContext.active(), rootSpan),
      async () => {
        await traceNatsSend(REQUEST_SUBJECT, () =>
          connection.request(REQUEST_SUBJECT, codec.encode({ zoneId: 'z-1' }), {
            headers: buildNatsHeaders({ correlationId: 'c-1', locale: 'en' }),
            timeout: 5000,
          })
        );
      }
    );

    await fannedOut;
    rootSpan.end();

    const byName = new Map(
      exporter.getFinishedSpans().map((span) => [span.name, span])
    );

    const requestPublish = byName.get(`${REQUEST_SUBJECT} publish`);
    const requestProcess = byName.get(`${REQUEST_SUBJECT} process`);
    const eventPublish = byName.get(`${EVENT_SUBJECT} publish`);
    const eventProcess = byName.get(`${EVENT_SUBJECT} process`);

    for (const span of [
      requestPublish,
      requestProcess,
      eventPublish,
      eventProcess,
    ]) {
      expect(span).toBeDefined();
      // One trace, not five. This is the assertion that fails the moment a
      // publish path stops injecting the headers.
      expect(span?.spanContext().traceId).toBe(rootContext.traceId);
    }

    // And the tree has the right shape, not merely the right trace id.
    expect(requestPublish?.parentSpanContext?.spanId).toBe(rootContext.spanId);
    expect(requestProcess?.parentSpanContext?.spanId).toBe(
      requestPublish?.spanContext().spanId
    );
    expect(eventPublish?.parentSpanContext?.spanId).toBe(
      requestProcess?.spanContext().spanId
    );
    expect(eventProcess?.parentSpanContext?.spanId).toBe(
      eventPublish?.spanContext().spanId
    );

    expect(requestPublish?.kind).toBe(SpanKind.PRODUCER);
    expect(requestProcess?.kind).toBe(SpanKind.CONSUMER);
  }, 20_000);
});
