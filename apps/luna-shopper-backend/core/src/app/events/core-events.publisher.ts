import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  domainEventSubject,
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
 * Who an event is for (plan 0030, section 3). The producer states it because the
 * producer built the payload; the realtime consumer routes on it without knowing
 * a single payload shape. At least one field must be set, or the event reaches
 * nobody and the consumer drops it as a fault.
 */
export interface EventAudience {
  /** The zone whose room hears it. */
  zoneId?: string;
  /** The list whose room hears it, for list, line and comment events. */
  listId?: string;
  /** Users whose own sessions hear it whatever rooms they hold. */
  userIds?: readonly string[];
  /**
   * The shared basket whose room hears it (plan 0051, section 7). Its members are
   * participants rather than users, which is what makes a guest reachable.
   */
  generatedListId?: string;
}

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
   * Publish a zone-scoped domain event. List-scoped events (list/line/comment)
   * pass the `listId` so the realtime service can route them to the
   * `list:{listId}` room straight from the envelope, without inspecting each
   * payload (plan 0009, section 6). Zone, membership and merge events omit it.
   */
  emit<T>(
    event: RealtimeEvent,
    zoneId: string,
    payload: T,
    listId?: string
  ): void {
    this.emitTo(event, { zoneId, listId }, payload);
  }

  /**
   * Publish an event addressed to people rather than to a resource (plan 0030,
   * section 2): a zone one of them just created, or their own global username.
   * It carries no zone, because there is no zone room that would reach them.
   */
  emitToUsers<T>(
    event: RealtimeEvent,
    userIds: readonly string[],
    payload: T
  ): void {
    this.emitTo(event, { userIds }, payload);
  }

  /**
   * Publish an event addressed to a shared basket (plan 0051, section 7): every
   * participant holding a live credential for it, guests included.
   *
   * Deliberately not `emitToUsers([ownerUserId])`, which is what plan 0050 used
   * while a basket had exactly one reader. A guest has no user id, so that
   * address cannot reach them at all, and the owner is a participant like anybody
   * else here rather than a second audience to name.
   */
  emitToGeneratedList<T>(
    event: RealtimeEvent,
    generatedListId: string,
    payload: T
  ): void {
    this.emitTo(event, { generatedListId }, payload);
  }

  /**
   * Publish with an explicit audience, which is what the other two are: an event
   * about a person's standing in a zone is addressed to both, so that it reaches
   * them whether or not they hold the zone's room.
   */
  emitTo<T>(event: RealtimeEvent, audience: EventAudience, payload: T): void {
    const envelope: DomainEvent<T> = {
      event,
      eventId: randomUUID(),
      ...(audience.zoneId ? { zoneId: audience.zoneId } : {}),
      ...(audience.listId ? { listId: audience.listId } : {}),
      ...(audience.userIds?.length ? { userIds: audience.userIds } : {}),
      ...(audience.generatedListId
        ? { generatedListId: audience.generatedListId }
        : {}),
      payload,
    };
    // Inside a producer span so the fan out stays part of the originating
    // request's trace: this publish is the link between the user's HTTP call and
    // the push another user's browser receives (plan 0016, section 4.3).
    const subject = domainEventSubject(event);
    traceNatsSend(subject, () => {
      const record = new NatsRecordBuilder(envelope)
        .setHeaders(buildNatsHeaders())
        .build();
      this.client.emit(subject, record);
    });
  }
}
