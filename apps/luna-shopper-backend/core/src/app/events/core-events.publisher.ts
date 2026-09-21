import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  BASKET_FAN_OUT_MAX,
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
   * The baskets whose rooms hear it (plan 0139, section 1). Their members are
   * participants rather than users, which is what makes a guest reachable.
   *
   * Several, because since plan 0136 one write to a list line is a write to every
   * basket that covers the list. An **empty array with no other audience** is not
   * a fault and not published: a write to a list nobody's basket covers is the
   * ordinary case.
   */
  basketIds?: readonly string[];
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
  private readonly logger = new Logger(CoreEventsPublisher.name);

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
   * Publish an event addressed to baskets (plan 0139, section 1): every
   * participant holding a live credential for one of them, guests included.
   *
   * Deliberately not `emitToUsers([ownerUserId])`, which is what plan 0050 used
   * while a basket had exactly one reader. A guest has no user id, so that
   * address cannot reach them at all, and the owner is a participant like anybody
   * else here rather than a second audience to name.
   */
  emitToBaskets<T>(
    event: RealtimeEvent,
    basketIds: readonly string[],
    payload: T
  ): void {
    this.emitTo(event, { basketIds }, payload);
  }

  /**
   * Publish with an explicit audience, which is what the other two are: an event
   * about a person's standing in a zone is addressed to both, so that it reaches
   * them whether or not they hold the zone's room.
   *
   * ## An audience of no baskets and nothing else publishes nothing
   *
   * The consumer drops an envelope addressed to nobody as a fault, and rightly:
   * an optional `zoneId` makes an unaddressed event possible and a silent no-op
   * is how one would be found six months later. A write to a list that no open
   * basket covers is not that. It is the ordinary case, so it is refused here
   * rather than published and faulted downstream.
   *
   * ## A large audience becomes several envelopes
   *
   * At most {@link BASKET_FAN_OUT_MAX} baskets per envelope, each with its own
   * `eventId` and therefore its own dedupe key. The rest of the audience rides on
   * the **first** envelope alone: repeating a user room on all three would
   * deliver the same nudge three times to the one person who is least likely to
   * be in a basket room.
   */
  emitTo<T>(event: RealtimeEvent, audience: EventAudience, payload: T): void {
    const baskets = audience.basketIds ?? [];
    const named =
      Boolean(audience.zoneId) ||
      Boolean(audience.listId) ||
      Boolean(audience.userIds?.length);
    if (audience.basketIds && baskets.length === 0 && !named) {
      return;
    }

    if (baskets.length > BASKET_FAN_OUT_MAX) {
      this.logger.warn(
        { event, basketCount: baskets.length },
        'a basket audience was split across several envelopes'
      );
    }

    // One pass, whatever the size: an audience within the bound is one chunk.
    for (
      let at = 0;
      at < Math.max(baskets.length, 1);
      at += BASKET_FAN_OUT_MAX
    ) {
      const chunk = baskets.slice(at, at + BASKET_FAN_OUT_MAX);
      const first = at === 0;
      this.send(event, payload, {
        ...(first && audience.zoneId ? { zoneId: audience.zoneId } : {}),
        ...(first && audience.listId ? { listId: audience.listId } : {}),
        ...(first && audience.userIds?.length
          ? { userIds: audience.userIds }
          : {}),
        ...(chunk.length ? { basketIds: chunk } : {}),
      });
    }
  }

  /** One envelope, one `eventId`, one publish. */
  private send<T>(
    event: RealtimeEvent,
    payload: T,
    audience: Omit<DomainEvent<T>, 'event' | 'eventId' | 'payload'>
  ): void {
    const envelope: DomainEvent<T> = {
      event,
      eventId: randomUUID(),
      ...audience,
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
