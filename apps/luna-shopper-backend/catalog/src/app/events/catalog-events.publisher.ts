import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, NatsRecordBuilder } from '@nestjs/microservices';
import {
  CATALOG_EVENTS,
  type ItemGroupChangedEvent,
  type ProductGroupDeletedEvent,
} from '@portfolio/luna-shopper/contracts';
import {
  buildNatsHeaders,
  traceNatsSend,
} from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

/** Injection token for the NATS client catalog publishes its events on. */
export const CATALOG_NATS_EVENTS = 'CATALOG_NATS_EVENTS';

/**
 * What catalog says about product groups (plan 0070, section 5).
 *
 * Catalog has never published anything before this: it is a read surface for
 * everybody and a curated write surface for one admin, and nothing downstream had
 * a reason to react. A line stays subscribed to its group now, so "an admin moved
 * this product into Milk" is a fact somebody else's rows depend on.
 *
 * **Fire and forget, and it cannot fail the write that caused it.** An `emit`
 * rather than a `send`, so a deployment with nothing listening is a no op instead
 * of a timeout on an admin's save, and the try/catch is the second half of the
 * same rule for the case where the broker itself is unreachable. This is exactly
 * how core announces new postal codes, and for exactly the same reason.
 *
 * Every event carries a fresh `eventId`, which is what the consumer's inbox
 * dedupes on. Keyed on the emission rather than on its contents, so a product
 * moved out of Milk and back into it later still applies the second time.
 */
@Injectable()
export class CatalogEventsPublisher {
  constructor(
    @Inject(CATALOG_NATS_EVENTS) private readonly client: ClientProxy,
    private readonly logger: Logger
  ) {}

  /**
   * One product joined a group, left one, or moved between two.
   *
   * Called after the item write commits, and never for a write that left the
   * group where it was: the consumer's work is proportional to how many
   * households subscribe to the group, so an event for a rename or a price change
   * would be a fan out over nothing.
   */
  itemGroupChanged(
    itemId: string,
    from: string | null,
    to: string | null
  ): void {
    const event: ItemGroupChangedEvent = {
      eventId: randomUUID(),
      itemId,
      from,
      to,
    };
    this.emit(CATALOG_EVENTS.itemGroupChanged, event);
  }

  /**
   * A group was deleted, so every line bound to it has to let go.
   *
   * Its own event and not a burst of per item changes, which is the difference
   * between core unbinding those lines and core reading the deletion as "the
   * admin took every product out of Milk" and emptying them. `delete` relies on
   * the foreign key to null every member's `productGroupId`, which happens inside
   * Postgres and would otherwise announce nothing at all.
   */
  productGroupDeleted(productGroupId: string): void {
    const event: ProductGroupDeletedEvent = {
      eventId: randomUUID(),
      productGroupId,
    };
    this.emit(CATALOG_EVENTS.productGroupDeleted, event);
  }

  private emit(subject: string, payload: object): void {
    try {
      // A producer span per event, so the publish is a hop in the admin's own
      // trace instead of an unexplained gap (plan 0016, section 4.3).
      traceNatsSend(subject, () => {
        const record = new NatsRecordBuilder(payload)
          .setHeaders(buildNatsHeaders())
          .build();
        this.client.emit(subject, record);
      });
    } catch (err) {
      this.logger.warn(
        { err, subject, payload },
        'could not announce a catalog change; the write stands'
      );
    }
  }
}
