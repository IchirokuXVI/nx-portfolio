import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CATALOG_EVENTS,
  LINE_ITEM_SET_CEILING,
  LineItemSource,
  NO_LINE_CLAIM,
  NO_LINE_SETTLEMENTS,
  RealtimeEvent,
  type ItemGroupChangedEvent,
  type ProductGroupDeletedEvent,
} from '@portfolio/luna-shopper/contracts';
import { runOnce } from '@portfolio/luna-shopper/platform';
// `DataSource` is a **value** import, not a type one, and that is load bearing:
// Nest resolves a constructor parameter by its runtime token, so erasing this to
// a type leaves index 0 undefined and the service unconstructable. It costs a
// boot failure that no unit spec sees, because a spec passes its own double in.
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import {
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
} from '../entities';
import { CoreEventsPublisher } from '../events/core-events.publisher';
import { ProcessedEventStore } from '../events/idempotency.store';
import { LineClaimService } from '../generated-lists/line-claim.service';
import { itemSetHash } from './item-set-hash';
import { toLineItemSet } from './line-item-set';
import { toLineView } from './list.mappers';
import { readLineSettlementSummaries } from './settlement.sql';

/**
 * Core's reaction to a product's group changing (plan 0070, sections 5 and 6).
 *
 * Catalog owns which products are in Milk; a line that picked Milk carries a copy
 * of its members plus a record of how the household has diverged from them. This
 * is what keeps the copy current without ever undoing the divergence.
 *
 * ## It is shaped like the identity reconciliation, on purpose
 *
 * There is a working precedent for a fact owned by another service being
 * reconciled into core's rows, and this looks like it rather than inventing a
 * second style: `UsernamePropagationService` wraps its whole handler in
 * {@link runOnce} against the `processed_events` inbox, so an at least once
 * redelivery neither writes twice nor emits twice. The key is the **event id**
 * and not the pair of group ids, so a product moved out of Milk and back into it
 * later still applies the second time.
 *
 * ## The invariant everything else falls out of
 *
 * **A product's source may go from `GROUP` to `USER` and never back.** Said once,
 * in one sentence: the app never takes ownership of something a person touched.
 * So this service only ever inserts, deletes or rewrites a `GROUP` row, and the
 * four cases that would otherwise each need an argument answer themselves.
 *
 * ## What it must not touch (section 8)
 *
 * **Baskets.** A `GeneratedListLine` is a snapshot taken at generation time, and
 * a shopping list that rewrites itself while you are in the shop is hostile. A
 * person editing a line's products mid trip already does not disturb an active
 * basket, so a sync must not either. That requirement is a **negative** one:
 * nothing here may grow a path into `generated_list_lines` or
 * `generated_list_line_options`, and the spec asserts it directly because nothing
 * else would catch its violation.
 *
 * **Settlements**, which hang off basket lines and are a record of what somebody
 * actually bought. **`quantity`**, never touched and in particular never
 * resurrected from zero: zero means the household is stocked, and three new milks
 * in the catalog is not a reason to put milk back on the list. **`approvalStatus`
 * and `content`**: attaching products renames nothing and approves nothing.
 */
@Injectable()
export class ProductGroupSyncService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ListLineItem)
    private readonly lineItems: Repository<ListLineItem>,
    // Read only, and only to find the room each touched line's news belongs in:
    // a line knows its list and a list knows its zone.
    @InjectRepository(ShoppingList)
    private readonly lists: Repository<ShoppingList>,
    private readonly claims: LineClaimService,
    private readonly events: CoreEventsPublisher,
    private readonly store: ProcessedEventStore
  ) {}

  /**
   * One product joined a group, left one, or moved between two (section 6.1).
   *
   * Both halves run, and because a line is bound to at most one group, at most one
   * of them can touch any given line.
   */
  async handleItemGroupChanged(event: ItemGroupChangedEvent): Promise<void> {
    await runOnce(
      this.store,
      `${CATALOG_EVENTS.itemGroupChanged}:${event.eventId}`,
      async () => {
        const touched = await this.dataSource.transaction(async (manager) => {
          const joined =
            event.to === null
              ? []
              : await this.attach(manager, event.to, event.itemId);
          const left =
            event.from === null
              ? []
              : await this.detach(manager, event.from, event.itemId);
          return [...joined, ...left];
        });
        await this.announce(touched);
      }
    );
  }

  /**
   * A group no longer exists, so every line bound to it lets go (section 6.2).
   *
   * **Nothing is taken off the line.** Undoing a curation decision must not delete
   * products out of households' shopping lists, and the group service already
   * reasons this way about its own members. The line becomes what plan 0048
   * shipped: a hand made set, owned entirely by the person holding it.
   */
  async handleProductGroupDeleted(
    event: ProductGroupDeletedEvent
  ): Promise<void> {
    await runOnce(
      this.store,
      `${CATALOG_EVENTS.productGroupDeleted}:${event.eventId}`,
      async () => {
        const touched = await this.dataSource.transaction((manager) =>
          this.unbind(manager, event.productGroupId)
        );
        await this.announce(touched);
      }
    );
  }

  /**
   * The product joined `groupId`, so it goes onto every line bound to it.
   *
   * Three cases, and two of them write nothing:
   *
   * - the line already holds the product, whatever the source: nothing. A set is
   *   a set, and a product on the line twice is not a thing a person can mean.
   * - a removal row exists for the pair: nothing. That is a person's decision and
   *   it does not expire.
   * - otherwise: a `GROUP` row at the end of the set.
   *
   * The ceiling is respected and the cap is not (section 7.2): a subscribed line
   * may pass 100, because the alternative is a subscription that silently stops
   * working at a number the person cannot see, but no line grows past
   * {@link LINE_ITEM_SET_CEILING}, where a request body would stop being bounded.
   */
  private async attach(
    manager: EntityManager,
    groupId: string,
    itemId: string
  ): Promise<ListLine[]> {
    const lines = await manager.getRepository(ListLine).find({
      where: { productGroupId: groupId },
    });
    if (lines.length === 0) {
      return [];
    }

    const items = manager.getRepository(ListLineItem);
    const rows = await items.find({
      where: { lineId: In(lines.map((line) => line.id)) },
      order: { position: 'ASC', id: 'ASC' },
    });
    const refused = await manager.getRepository(ListLineGroupRemoval).find({
      where: { lineId: In(lines.map((line) => line.id)), itemId },
    });
    const refusedBy = new Set(refused.map((row) => row.lineId));

    const touched: ListLine[] = [];
    for (const line of lines) {
      const held = rows.filter((row) => row.lineId === line.id);
      if (
        refusedBy.has(line.id) ||
        held.some((row) => row.itemId === itemId) ||
        held.length >= LINE_ITEM_SET_CEILING
      ) {
        continue;
      }
      await items.insert({
        lineId: line.id,
        itemId,
        // At the end of the set, which is where a product attached later belongs
        // and is what the composer's own order means.
        position:
          held.reduce((max, row) => Math.max(max, row.position), -1) + 1,
        source: LineItemSource.GROUP,
      });
      touched.push(
        await this.restamp(manager, line, [
          ...held.map((row) => row.itemId),
          itemId,
        ])
      );
    }
    return touched;
  }

  /**
   * The product left `groupId`, so it comes off every line bound to it that holds
   * it **as the group's**.
   *
   * - `source = GROUP`: the row goes, and **no** removal row is written. A
   *   tombstone records a person's decision; this is the catalog's, and if the
   *   product rejoins the group later it should come back.
   * - `source = USER`: it stays. Adopted, or added by hand before the group ever
   *   had it, and either way it is not the group's to take away.
   */
  private async detach(
    manager: EntityManager,
    groupId: string,
    itemId: string
  ): Promise<ListLine[]> {
    const lines = await manager.getRepository(ListLine).find({
      where: { productGroupId: groupId },
    });
    if (lines.length === 0) {
      return [];
    }

    const items = manager.getRepository(ListLineItem);
    const rows = await items.find({
      where: { lineId: In(lines.map((line) => line.id)) },
      order: { position: 'ASC', id: 'ASC' },
    });

    const touched: ListLine[] = [];
    for (const line of lines) {
      const held = rows.filter((row) => row.lineId === line.id);
      const owned = held.find(
        (row) => row.itemId === itemId && row.source === LineItemSource.GROUP
      );
      if (!owned) {
        continue;
      }
      await items.delete({ lineId: line.id, itemId });
      touched.push(
        await this.restamp(
          manager,
          line,
          held.filter((row) => row.itemId !== itemId).map((row) => row.itemId)
        )
      );
    }
    return touched;
  }

  /**
   * The group is gone: unbind every line, rewrite every `GROUP` row to `USER`,
   * and drop the removal rows.
   *
   * The tombstones go because they only ever meant "do not let **this group** put
   * this back", and there is no group any more. Leaving them would silently
   * refuse products from whatever group the line is bound to next.
   *
   * The set does not change, so the hash does not either. The version still moves
   * and the event still fires: `productGroupId` and `groupItemIds` are fields of
   * the line, so a client holding the old ones would go on drawing marks for a
   * subscription that no longer exists.
   */
  private async unbind(
    manager: EntityManager,
    groupId: string
  ): Promise<ListLine[]> {
    const lines = await manager.getRepository(ListLine).find({
      where: { productGroupId: groupId },
    });
    if (lines.length === 0) {
      return [];
    }
    const lineIds = lines.map((line) => line.id);

    await manager
      .getRepository(ListLineItem)
      .update(
        { lineId: In(lineIds), source: LineItemSource.GROUP },
        { source: LineItemSource.USER }
      );
    await manager
      .getRepository(ListLineGroupRemoval)
      .delete({ lineId: In(lineIds) });

    const repo = manager.getRepository(ListLine);
    const touched: ListLine[] = [];
    for (const line of lines) {
      line.productGroupId = null;
      line.version += 1;
      touched.push(await repo.save(line));
    }
    return touched;
  }

  /**
   * Refresh what a line says about its own set, after this sync changed it.
   *
   * The hash goes through {@link itemSetHash}, because the one algorithm stays in
   * one file: a sync that wrote products without refreshing the digest would break
   * the dedup in `0050` and the cross list indicator in velista `0043` in a way
   * nothing would notice for weeks. The version bumps for the same reason every
   * other write bumps it, which is that a client reconciles on it.
   */
  private async restamp(
    manager: EntityManager,
    line: ListLine,
    itemIds: readonly string[]
  ): Promise<ListLine> {
    line.itemSetHash = itemSetHash([...itemIds]);
    line.version += 1;
    return manager.getRepository(ListLine).save(line);
  }

  /**
   * Tell each touched line's list room what it now says (section 6.3).
   *
   * **This is the first thing in the product that changes a line with nobody
   * having touched it.** A tab open on the list will redraw, which is correct and
   * is also why velista `0065` marks the products rather than letting them appear
   * anonymously.
   *
   * After the commit, like every other announcement in core, and read rather than
   * assembled: the event carries a whole `LineView` and a client reconciles off
   * it, so the two indicators and the claim have to be the ones a read would give
   * even though nothing here writes any of them. A line whose list has been
   * deleted underneath the sync is skipped rather than announced into a room that
   * does not exist.
   */
  private async announce(lines: readonly ListLine[]): Promise<void> {
    if (lines.length === 0) {
      return;
    }
    const lineIds = lines.map((line) => line.id);
    const lists = await this.lists.find({
      where: { id: In([...new Set(lines.map((line) => line.listId))]) },
    });
    const zoneOf = new Map(lists.map((list) => [list.id, list.zoneId]));

    // Three reads for the whole burst rather than three per line. One admin
    // adding a product to Milk touches every household subscribed to Milk, which
    // is exactly the fan out the plan is about, so a read per row here would be
    // the N+1 the list page was designed out of.
    const rows = await this.lineItems.find({
      where: { lineId: In(lineIds) },
      order: { position: 'ASC', id: 'ASC' },
    });
    const settlements = await readLineSettlementSummaries(
      (sql, parameters) => this.dataSource.query(sql, parameters),
      lineIds
    );
    const claims = await this.claims.claimsOf(lineIds);

    for (const line of lines) {
      const zoneId = zoneOf.get(line.listId);
      if (zoneId === undefined) {
        continue;
      }
      this.events.emit(
        RealtimeEvent.LineUpdated,
        zoneId,
        toLineView(
          line,
          toLineItemSet(rows.filter((row) => row.lineId === line.id)),
          // Neither indicator moves here, and neither may be assumed: an event
          // carries a whole line, so announcing the zero summary would take the
          // bought mark off a settled line over a product joining a group.
          settlements.get(line.id) ?? NO_LINE_SETTLEMENTS,
          claims.get(line.id) ?? NO_LINE_CLAIM
        ),
        line.listId
      );
    }
  }
}
