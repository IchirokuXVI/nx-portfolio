import {
  LineItemSource,
  RealtimeEvent,
  type ItemGroupChangedEvent,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import {
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  type ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { itemSetHash } from './item-set-hash';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { ProductGroupSyncService } from './product-group-sync.service';

/**
 * A line stays subscribed to its product group (plan 0070, sections 6 and 11).
 *
 * The three tables are fakes and the assertions are about the **decisions**: who
 * a product belongs to after each event, what leaves a record and what does not,
 * and which lines a change reaches. That is the whole of what this service
 * decides; there is no SQL here worth pinning.
 *
 * One thing is asserted negatively and deliberately (section 8, and case 13): the
 * sync must never write into a basket. A `GeneratedListLine` is a snapshot taken
 * at generation time, a shopping list that rewrites itself while you are in the
 * shop is hostile, and the requirement is that a path into those tables does not
 * exist. Nothing else would catch its violation, so the manager itself refuses
 * every repository the service has no business asking for.
 */

const MILK = 'g-milk';
const BREAD = 'g-bread';
const SEMI = 'i-semi';
const WHOLE = 'i-whole';
const LACTOSE_FREE = 'i-lactose-free';

const ZONE = 'z1';
const LIST = 'l1';

interface LineSeed {
  id: string;
  productGroupId?: string | null;
  /** Products on the line, and who put each one there. */
  items?: { itemId: string; source?: LineItemSource }[];
  /** Products of the group somebody took off. */
  removed?: string[];
  version?: number;
}

function build(seeds: LineSeed[], options: { firstSeen?: boolean } = {}) {
  const lines = seeds.map(
    (seed, index) =>
      ({
        id: seed.id,
        listId: LIST,
        content: 'Milk',
        quantity: 1,
        itemSetHash: itemSetHash((seed.items ?? []).map((i) => i.itemId)),
        productGroupId: seed.productGroupId ?? null,
        position: index + 1,
        version: seed.version ?? 1,
        // The mapper stamps these onto every announcement, so a row without
        // them is a line the database could not have produced.
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      }) as ListLine
  );

  const items = fakeLineItems(
    seeds.flatMap((seed) =>
      (seed.items ?? []).map((item, position) => ({
        lineId: seed.id,
        itemId: item.itemId,
        position,
        source: item.source ?? LineItemSource.GROUP,
      }))
    )
  );
  const removals = fakeGroupRemovals(
    seeds.flatMap((seed) =>
      (seed.removed ?? []).map((itemId) => ({ lineId: seed.id, itemId }))
    )
  );

  const saved: ListLine[] = [];
  const lineRepo = {
    async find({ where }: { where: { productGroupId: string } }) {
      return lines.filter(
        (line) => line.productGroupId === where.productGroupId
      );
    },
    async save(line: ListLine) {
      saved.push({ ...line });
      return line;
    },
  };

  const dataSource = {
    async transaction<T>(run: (m: EntityManager) => Promise<T>) {
      return run({
        getRepository: (entity: unknown) => {
          if (entity === ListLine) {
            return lineRepo;
          }
          if (entity === ListLineItem) {
            return items.repo;
          }
          if (entity === ListLineGroupRemoval) {
            return removals.repo;
          }
          // Case 13. The negative requirement of section 8 made positive: a
          // basket is a snapshot, so reaching for one of its tables from here is
          // a bug rather than a passing test with a surprising side effect.
          throw new Error(
            `the sync must not touch ${(entity as { name?: string })?.name}`
          );
        },
      } as unknown as EntityManager);
    },
    // The settlement summaries for the burst it is about to announce. No line
    // here has ever been bought, which is what the aggregate answers with an
    // empty result rather than a row of zeroes.
    async query() {
      return [];
    },
  } as unknown as DataSource;

  const events: { event: RealtimeEvent; line: LineView }[] = [];
  const publisher = {
    emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
      events.push({ event, line: payload }),
  } as unknown as CoreEventsPublisher;

  const store = { firstSeen: jest.fn(async () => options.firstSeen ?? true) };

  const service = new ProductGroupSyncService(
    dataSource,
    items.repo as never,
    {
      async find() {
        return [{ id: LIST, zoneId: ZONE } as ShoppingList];
      },
    } as never,
    fakeLineClaims().service,
    publisher,
    store as never
  );

  return { service, items, removals, saved, events, store, lines };
}

const changed = (
  overrides: Partial<ItemGroupChangedEvent> = {}
): ItemGroupChangedEvent => ({
  eventId: 'e1',
  itemId: LACTOSE_FREE,
  from: null,
  to: MILK,
  ...overrides,
});

/** What one line holds, and who each product belongs to. */
function setOf(
  w: ReturnType<typeof build>,
  lineId: string
): { itemId: string; source: LineItemSource }[] {
  return w.items.rows
    .filter((row) => row.lineId === lineId)
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ itemId: row.itemId, source: row.source }));
}

describe('a product joining a group (plan 0070, section 6.1)', () => {
  it('lands on every line bound to it, as the group’s, and on no other line', async () => {
    const w = build([
      { id: 'subscribed', productGroupId: MILK, items: [{ itemId: SEMI }] },
      { id: 'other-group', productGroupId: BREAD, items: [] },
      {
        id: 'hand-made',
        productGroupId: null,
        items: [{ itemId: SEMI, source: LineItemSource.USER }],
      },
    ]);

    await w.service.handleItemGroupChanged(changed());

    expect(setOf(w, 'subscribed')).toEqual([
      { itemId: SEMI, source: LineItemSource.GROUP },
      // At the end of the set, which is where a product attached later belongs.
      { itemId: LACTOSE_FREE, source: LineItemSource.GROUP },
    ]);
    // The fan out is bounded by the binding and not by the catalog (section
    // 6.4): a line bound to another group, or to none, hears nothing.
    expect(setOf(w, 'other-group')).toEqual([]);
    expect(setOf(w, 'hand-made')).toEqual([
      { itemId: SEMI, source: LineItemSource.USER },
    ]);
  });

  it('does nothing to a line that already holds it, and does not duplicate it', async () => {
    // A set is a set. It holds as `USER`, which is the case the invariant is
    // about: adopting is one way to get here, typing it before the group ever
    // had it is the other, and neither may be quietly taken back by the group.
    const w = build([
      {
        id: 'subscribed',
        productGroupId: MILK,
        items: [
          { itemId: SEMI },
          { itemId: LACTOSE_FREE, source: LineItemSource.USER },
        ],
      },
    ]);

    await w.service.handleItemGroupChanged(changed());

    expect(setOf(w, 'subscribed')).toEqual([
      { itemId: SEMI, source: LineItemSource.GROUP },
      { itemId: LACTOSE_FREE, source: LineItemSource.USER },
    ]);
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('does not land on a line whose household took it off, however often it is redelivered', async () => {
    const w = build([
      {
        id: 'subscribed',
        productGroupId: MILK,
        items: [{ itemId: SEMI }],
        removed: [LACTOSE_FREE],
      },
    ]);

    await w.service.handleItemGroupChanged(changed());
    // A second, distinct change naming the same product: the tombstone is a
    // person's decision and it does not expire.
    await w.service.handleItemGroupChanged(changed({ eventId: 'e2' }));

    expect(setOf(w, 'subscribed')).toEqual([
      { itemId: SEMI, source: LineItemSource.GROUP },
    ]);
  });
});

describe('a product leaving a group (plan 0070, section 6.1)', () => {
  it('comes off a line holding it as the group’s and stays on one holding it as a person’s', async () => {
    const w = build([
      {
        id: 'untouched',
        productGroupId: MILK,
        items: [{ itemId: SEMI }, { itemId: LACTOSE_FREE }],
      },
      {
        id: 'adopted',
        productGroupId: MILK,
        items: [
          { itemId: SEMI },
          { itemId: LACTOSE_FREE, source: LineItemSource.USER },
        ],
      },
    ]);

    await w.service.handleItemGroupChanged(
      changed({ from: MILK, to: null, eventId: 'e-left' })
    );

    expect(setOf(w, 'untouched')).toEqual([
      { itemId: SEMI, source: LineItemSource.GROUP },
    ]);
    // Section 3, the fourth row of the table: the group losing a product a
    // person has adopted leaves it exactly where it is.
    expect(setOf(w, 'adopted')).toEqual([
      { itemId: SEMI, source: LineItemSource.GROUP },
      { itemId: LACTOSE_FREE, source: LineItemSource.USER },
    ]);
  });

  it('writes no tombstone, so rejoining puts it back', async () => {
    const w = build([
      {
        id: 'subscribed',
        productGroupId: MILK,
        items: [{ itemId: SEMI }, { itemId: LACTOSE_FREE }],
      },
    ]);

    await w.service.handleItemGroupChanged(
      changed({ from: MILK, to: null, eventId: 'e-left' })
    );
    // A tombstone records a **person's** decision. This was the catalog's, and
    // the catalog is allowed to change its mind.
    expect(w.removals.rows).toEqual([]);

    await w.service.handleItemGroupChanged(
      changed({ from: null, to: MILK, eventId: 'e-back' })
    );
    expect(setOf(w, 'subscribed').map((row) => row.itemId)).toEqual([
      SEMI,
      LACTOSE_FREE,
    ]);
  });
});

describe('provenance moves one way (plan 0070, section 3)', () => {
  it('a product moved between two groups reaches both sets of lines, once each', async () => {
    const w = build([
      { id: 'milk-line', productGroupId: MILK, items: [{ itemId: SEMI }] },
      {
        id: 'bread-line',
        productGroupId: BREAD,
        items: [{ itemId: LACTOSE_FREE }],
      },
    ]);

    await w.service.handleItemGroupChanged(
      changed({ from: BREAD, to: MILK, eventId: 'e-move' })
    );

    // A line is bound to at most one group, so at most one half of the sync can
    // touch any given line, which is what makes running both halves safe.
    expect(setOf(w, 'milk-line').map((row) => row.itemId)).toEqual([
      SEMI,
      LACTOSE_FREE,
    ]);
    expect(setOf(w, 'bread-line')).toEqual([]);
  });
});

describe('a group being deleted (plan 0070, section 6.2)', () => {
  it('unbinds, hands every product to the person, drops the tombstones, and removes nothing', async () => {
    const w = build([
      {
        id: 'subscribed',
        productGroupId: MILK,
        items: [
          { itemId: SEMI },
          { itemId: WHOLE, source: LineItemSource.USER },
        ],
        removed: [LACTOSE_FREE],
      },
      { id: 'other-group', productGroupId: BREAD, items: [{ itemId: WHOLE }] },
    ]);

    await w.service.handleProductGroupDeleted({
      eventId: 'e-del',
      productGroupId: MILK,
    });

    // Nothing is taken off the line. Undoing a curation decision must not delete
    // products out of households' shopping lists.
    expect(setOf(w, 'subscribed')).toEqual([
      { itemId: SEMI, source: LineItemSource.USER },
      { itemId: WHOLE, source: LineItemSource.USER },
    ]);
    expect(w.removals.rows).toEqual([]);
    expect(w.saved.map((line) => line.productGroupId)).toEqual([null]);
    // A line bound to another group is untouched, tombstones included.
    expect(setOf(w, 'other-group')).toEqual([
      { itemId: WHOLE, source: LineItemSource.GROUP },
    ]);
  });
});

describe('what a touched line reports afterwards (plan 0070, section 6.3)', () => {
  it('moves the hash and the version on the line it changed, and on no other', async () => {
    const w = build([
      {
        id: 'subscribed',
        productGroupId: MILK,
        items: [{ itemId: SEMI }],
        version: 4,
      },
      {
        id: 'already-holds-it',
        productGroupId: MILK,
        items: [{ itemId: SEMI }, { itemId: LACTOSE_FREE }],
        version: 9,
      },
    ]);

    await w.service.handleItemGroupChanged(changed());

    expect(w.saved).toHaveLength(1);
    expect(w.saved[0].id).toBe('subscribed');
    expect(w.saved[0].version).toBe(5);
    // Through `itemSetHash`, because the one algorithm stays in one file: a sync
    // that wrote products without refreshing the digest would break the dedup in
    // `0050` and the cross list indicator in velista `0043`.
    expect(w.saved[0].itemSetHash).toBe(itemSetHash([SEMI, LACTOSE_FREE]));
  });

  it('announces the line to its list room, which is the first change nobody made', async () => {
    const w = build([
      { id: 'subscribed', productGroupId: MILK, items: [{ itemId: SEMI }] },
    ]);

    await w.service.handleItemGroupChanged(changed());

    expect(w.events).toHaveLength(1);
    expect(w.events[0].event).toBe(RealtimeEvent.LineUpdated);
    expect(w.events[0].line.itemIds).toEqual([SEMI, LACTOSE_FREE]);
    // And it says which of them the group put there, so velista `0065` can mark
    // them rather than letting them appear anonymously.
    expect(w.events[0].line.groupItemIds).toEqual([SEMI, LACTOSE_FREE]);
    expect(w.events[0].line.productGroupId).toBe(MILK);
  });
});

describe('at least once delivery (plan 0070, section 5.1)', () => {
  it('a redelivered event writes nothing a second time and emits nothing a second time', async () => {
    const w = build(
      [{ id: 'subscribed', productGroupId: MILK, items: [{ itemId: SEMI }] }],
      { firstSeen: false }
    );

    await w.service.handleItemGroupChanged(changed());

    expect(setOf(w, 'subscribed')).toEqual([
      { itemId: SEMI, source: LineItemSource.GROUP },
    ]);
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('keys the inbox on the event id, not on the pair of groups', async () => {
    const w = build([
      { id: 'subscribed', productGroupId: MILK, items: [{ itemId: SEMI }] },
    ]);

    await w.service.handleItemGroupChanged(changed({ eventId: 'e-first' }));

    // A product moved out of Milk and back into it later is a second change and
    // has to apply, which a key built from the group ids would swallow.
    expect(w.store.firstSeen).toHaveBeenCalledWith(
      'catalog.itemGroupChanged:e-first'
    );
  });
});
