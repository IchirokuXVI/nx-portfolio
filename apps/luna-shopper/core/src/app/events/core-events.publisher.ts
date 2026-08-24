import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  RealtimeEvent,
  type DomainEvent,
} from '@portfolio/luna-shopper/contracts';
import { buildNatsHeaders } from '@portfolio/luna-shopper/platform';
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

  emit<T>(event: RealtimeEvent, zoneId: string, payload: T): void {
    const envelope: DomainEvent<T> = {
      event,
      eventId: randomUUID(),
      zoneId,
      payload,
    };
    const record = new NatsRecordBuilder(envelope)
      .setHeaders(buildNatsHeaders())
      .build();
    this.client.emit(event, record);
  }
}
