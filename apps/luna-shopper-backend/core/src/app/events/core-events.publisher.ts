import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  RealtimeEvent,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';

/** Injection token for the NATS client core uses to publish domain events. */
export const NATS_EVENTS = 'NATS_EVENTS';

/**
 * Publishes core's domain events for the realtime fan out (plan 0006, section 9;
 * plan 0007, section 5), wired to sockets in plan 0009. Each event is wrapped in
 * the shared {@link DomainEvent} envelope with a fresh `eventId` (so consumers can
 * dedupe under at-least-once delivery, plan 0004 section 9) and carries the
 * correlation id on its NATS headers.
 */
@Injectable()
export class CoreEventsPublisher {
  constructor(@Inject(NATS_EVENTS) private readonly client: ClientProxy) {}

  /**
   * Publish a domain event. List-scoped events (list/line/comment) pass the
   * `listId` so the realtime service can route them to the `list:{listId}` room
   * straight from the envelope, without inspecting each payload (plan 0009,
   * section 6). Zone, membership and merge events omit it.
   */
  emit<T>(
    event: RealtimeEvent,
    zoneId: string,
    payload: T,
    listId?: string
  ): void {
    const envelope: DomainEvent<T> = {
      event,
      eventId: randomUUID(),
      zoneId,
      ...(listId ? { listId } : {}),
      payload,
    };
    // Inside a producer span so the fan out stays part of the originating
    // request's trace: this publish is the link between the user's HTTP call and
    // the push another user's browser receives (plan 0016, section 4.3).
    traceNatsSend(event, () => {
      const record = new NatsRecordBuilder(envelope)
        .setHeaders(buildNatsHeaders())
        .build();
      this.client.emit(event, record);
    });
  }
}
