import {
  declareCounter,
  declareGauge,
  declareHistogram,
} from './declared-metrics';

/**
 * Messaging metrics (plan 0016, section 5.2).
 *
 * There is no OpenTelemetry instrumentation for the `nats` client, so unlike
 * HTTP these are recorded by hand. They are recorded from the same seam as the
 * messaging spans (`nats-propagation.ts`), which is what stops the two signals
 * disagreeing about what a message is.
 *
 * `subject` is a safe label because every Luna subject is a compile time
 * constant from `@portfolio/luna-shopper/contracts` (`zone.updated`,
 * `list.created`, the request/reply command subjects). No subject interpolates an
 * id, so the label set is bounded by the size of those enums. Keep it that way:
 * a subject with an id in it would breach section 5.3.
 */

/** How a message was handled, for the `outcome` label. */
export type MessagingOutcome = 'success' | 'failure';

/** Which side of the exchange recorded the measurement. */
export type MessagingOperation = 'publish' | 'process';

const LABELS = ['subject', 'operation', 'outcome'] as const;

/**
 * Every message sent or handled. Failures are not a second counter: they are
 * this one filtered to `outcome="failure"`, which cannot drift out of step with
 * the total the way a parallel counter can.
 */
const messages = declareCounter({
  name: 'luna.nats.messages',
  description:
    'NATS messages published or handled, by subject, operation and outcome.',
  unit: '1',
  labels: LABELS,
});

/** How long a publish or a handler took. */
const duration = declareHistogram({
  name: 'luna.nats.message.duration',
  description: 'Duration of a NATS publish or message handler.',
  unit: 'ms',
  labels: LABELS,
});

/** Records one message exchange. Called by the propagation helpers. */
export function recordNatsMessage(sample: {
  subject: string;
  operation: MessagingOperation;
  outcome: MessagingOutcome;
  durationMs: number;
}): void {
  const labels = {
    subject: sample.subject,
    operation: sample.operation,
    outcome: sample.outcome,
  };
  messages.add(1, labels);
  duration.record(sample.durationMs, labels);
}

/**
 * JetStream consumer lag (section 5.2). Delivery is at least once and consumers
 * are idempotent (plan 0004, section 9), so a consumer falling behind is silent
 * by design until it is severe: this gauge is the only early warning.
 *
 * The library supplies the declaration; the service that owns a durable consumer
 * supplies the sampler, because only it can ask the broker for the pending count.
 * `observe` runs on every scrape, so it must read a cached value rather than call
 * the broker.
 */
export function observeJetStreamConsumerLag(
  observe: () => Iterable<{
    value: number;
    labels: { stream: string; consumer: string };
  }>
): void {
  declareGauge(
    {
      name: 'luna.nats.jetstream.consumer.lag',
      description:
        'Messages pending for a durable JetStream consumer (num_pending).',
      unit: '1',
      labels: ['stream', 'consumer'] as const,
    },
    observe
  );
}
