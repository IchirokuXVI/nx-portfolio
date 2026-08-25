import { declareGauge, declareHistogram } from './declared-metrics';

/**
 * Process level metrics (plan 0016, section 5.2).
 *
 * Event loop lag, heap usage and GC pauses come from
 * `@opentelemetry/instrumentation-runtime-node`, registered by the SDK bootstrap,
 * so no service wires them and every service reports them identically. Nothing
 * has to be declared here for those.
 *
 * What this file holds is the declarations for the per service additions the plan
 * names. The **shape** lives in the library so the metric name and label set are
 * the same wherever it is reported; the **sampler** is supplied by the service,
 * because only it can read a TypeORM pool or count its own sockets. Every
 * `observe` callback runs on each scrape, so it must read a value the service
 * already has rather than go and fetch one.
 */

/**
 * Connection pool saturation for auth, core and catalog needs **no declaration
 * here**. The plan lists it as a per service addition, but the `pg`
 * instrumentation in the auto bundle already emits `db.client.connection.count`
 * (by `used`/`idle` state) and `db.client.connection.pending_requests` from the
 * same pool the TypeORM DataSource uses, so every service reports it identically
 * with nothing wired. Declaring a second gauge over the same pool would be two
 * numbers that can disagree about one thing, which is what section 5.2 is trying
 * to avoid. Pending requests above zero is the saturation signal to alert on.
 */

/**
 * Sockets currently connected to the realtime service. `transport` separates the
 * socket.io transports from the SSE fallback and is bounded by that set.
 */
export function observeConnectedSockets(
  observe: () => Iterable<{ value: number; labels: { transport: string } }>
): void {
  declareGauge(
    {
      name: 'luna.realtime.connections',
      description: 'Client connections currently held by the realtime service.',
      unit: '1',
      labels: ['transport'] as const,
    },
    observe
  );
}

const fanout = declareHistogram({
  name: 'luna.realtime.fanout.duration',
  description:
    'Time from receiving a domain event to pushing it to the subscribed rooms.',
  unit: 'ms',
  labels: ['event'] as const,
});

/**
 * Fan out latency, from event receipt to push. `event` is the domain event
 * subject, a constant from `@portfolio/luna-shopper/contracts`, so the label set
 * is bounded. Neither the zone nor the list the push went to is labelled: those
 * are unbounded and belong on the span (section 5.3).
 */
export function recordFanoutLatency(event: string, durationMs: number): void {
  fanout.record(durationMs, { event });
}
