import {
  CATALOG_EVENTS,
  LineItemSource,
  RealtimeEvent,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import { AdminItemUsageService } from '../admin/admin-item-usage.service';
import type { CorePlatformAdminService } from '../admin/platform-admin.service';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import {
  CORE_ENTITIES,
  LineSettlement,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ProcessedEvent,
  ShoppingList,
  Zone,
} from '../entities';
import { ProcessedEventStore } from '../events/idempotency.store';
import { itemSetHash } from './item-set-hash';
import { ProductGroupSyncService } from './product-group-sync.service';

/**
 * Core's half of a product merge, against Postgres (plan 0239, section 3).
 *
 * Every column of core that names a product moves to the survivor, two rows
 * of one line that end on one product become one, and a replayed event is
 * kept out by the real `processed_events` inbox. Section 4's count of the
 * lines that name a product runs here too.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=item-merged-sync.integration.spec.ts
 */
describeIntegration('core and a product merge (real Postgres)', () => {
  let dataSource: DataSource;
  let sync: ProductGroupSyncService;
  let usage: AdminItemUsageService;
  let emitted: { event: string; payload: unknown }[];

  const owner = randomUUID();
  let zoneId: string;
  let listId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    emitted = [];
    sync = new ProductGroupSyncService(
      dataSource,
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ShoppingList),
      fakeLineClaims().service,
      {
        emit: (event: string, _room: string, payload: unknown) =>
          emitted.push({ event, payload }),
      } as never,
      new ProcessedEventStore(dataSource.getRepository(ProcessedEvent)),
      fakeBasketAnnouncer() as never
    );
    usage = new AdminItemUsageService(dataSource, {
      requireAdmin: async () => owner,
    } as unknown as CorePlatformAdminService);

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Merge Zone',
        joinCode: `MRG${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: owner,
        config: {},
      })
    );
    zoneId = zone.id;
    const list = await dataSource.getRepository(ShoppingList).save(
      dataSource.getRepository(ShoppingList).create({
        zoneId,
        name: 'Weekly shop',
        createdByUserId: owner,
      })
    );
    listId = list.id;
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM "zones" WHERE "id" = $1`, [zoneId]);
      await dataSource.destroy();
    }
  });

  beforeEach(() => {
    emitted.length = 0;
  });

  /** A line holding these products, in order, with a hash that says so. */
  async function line(
    content: string,
    products: { itemId: string; source?: LineItemSource }[],
    favoriteItemId: string | null = null
  ): Promise<ListLine> {
    const lines = dataSource.getRepository(ListLine);
    const saved = await lines.save(
      lines.create({
        listId,
        content,
        quantity: 1,
        position: 0,
        createdByUserId: owner,
        itemSetHash: itemSetHash(products.map((p) => p.itemId)),
        favoriteItemId,
      })
    );
    const items = dataSource.getRepository(ListLineItem);
    for (const [position, product] of products.entries()) {
      await items.insert({
        lineId: saved.id,
        itemId: product.itemId,
        position,
        source: product.source ?? LineItemSource.USER,
      });
    }
    return saved;
  }

  const rowsOf = (lineId: string) =>
    dataSource.getRepository(ListLineItem).find({
      where: { lineId },
      order: { position: 'ASC' },
    });
  const lineOf = (id: string) =>
    dataSource.getRepository(ListLine).findOneByOrFail({ id });

  it('moves every column that names the merged product, and collapses a line that held both', async () => {
    const merged = randomUUID();
    const survivor = randomUUID();
    const other = randomUUID();
    // Holds the merged product alone, as its favourite.
    const single = await line(
      'Leche',
      [{ itemId: merged }, { itemId: other }],
      merged
    );
    // Holds both: the person's merged row and the group's survivor row.
    const both = await line('Leche entera', [
      { itemId: survivor, source: LineItemSource.GROUP },
      { itemId: merged, source: LineItemSource.USER },
    ]);
    await dataSource.getRepository(ListLineGroupRemoval).insert([
      { lineId: single.id, itemId: merged },
      { lineId: both.id, itemId: merged },
      { lineId: both.id, itemId: survivor },
    ]);
    await dataSource.query(
      `INSERT INTO "line_settlements"
              ("lineId", "listId", "outcome", "quantity", "itemId", "settledByUserId")
       VALUES ($1, $2, 'BOUGHT', 1, $3, $4)`,
      [single.id, listId, merged, owner]
    );
    const singleVersion = (await lineOf(single.id)).version;

    await sync.handleItemMerged({
      eventId: randomUUID(),
      itemId: merged,
      intoItemId: survivor,
    });

    // The single line holds the survivor where the merged one was.
    expect((await rowsOf(single.id)).map((r) => r.itemId)).toEqual([
      survivor,
      other,
    ]);
    const singleAfter = await lineOf(single.id);
    expect(singleAfter.favoriteItemId).toBe(survivor);
    expect(singleAfter.itemSetHash).toBe(itemSetHash([survivor, other]));
    expect(singleAfter.version).toBe(singleVersion + 1);
    // The line that held both keeps one row, and it is the person's now.
    const bothRows = await rowsOf(both.id);
    expect(bothRows).toHaveLength(1);
    expect(bothRows[0]).toMatchObject({
      itemId: survivor,
      source: LineItemSource.USER,
    });
    expect((await lineOf(both.id)).itemSetHash).toBe(itemSetHash([survivor]));
    // The removals follow the same rule on their own pair.
    const removals = await dataSource.getRepository(ListLineGroupRemoval).find({
      where: { lineId: In([single.id, both.id]) },
    });
    expect(
      removals
        .map((r) => `${r.lineId === single.id ? 'single' : 'both'}:${r.itemId}`)
        .sort()
    ).toEqual([`both:${survivor}`, `single:${survivor}`].sort());
    // A settlement is renamed.
    expect(
      await dataSource.getRepository(LineSettlement).countBy({ itemId: merged })
    ).toBe(0);
    expect(
      await dataSource
        .getRepository(LineSettlement)
        .countBy({ itemId: survivor })
    ).toBe(1);
    // Both lines were announced to their list.
    expect(
      emitted.filter((e) => e.event === RealtimeEvent.LineUpdated)
    ).toHaveLength(2);
  });

  it('keeps a replayed event out through processed_events', async () => {
    const merged = randomUUID();
    const survivor = randomUUID();
    const held = await line('Pan', [{ itemId: merged }]);
    const event = {
      eventId: randomUUID(),
      itemId: merged,
      intoItemId: survivor,
    };

    await sync.handleItemMerged(event);
    const after = await lineOf(held.id);
    emitted.length = 0;
    // Somebody puts the merged id back by hand, so a second run would show.
    await dataSource
      .getRepository(ListLineItem)
      .update({ lineId: held.id }, { itemId: merged });

    await sync.handleItemMerged(event);

    expect((await rowsOf(held.id)).map((r) => r.itemId)).toEqual([merged]);
    expect((await lineOf(held.id)).version).toBe(after.version);
    expect(emitted).toEqual([]);
    expect(
      await dataSource
        .getRepository(ProcessedEvent)
        .countBy({ key: `${CATALOG_EVENTS.itemMerged}:${event.eventId}` })
    ).toBe(1);
  });

  it('counts the lines that name each product, once per line', async () => {
    const counted = randomUUID();
    const favourite = randomUUID();
    const nobody = randomUUID();
    await line('Uno', [{ itemId: counted }], counted);
    await line('Dos', [{ itemId: counted }, { itemId: favourite }], favourite);

    const answer = await usage.usage({
      userId: owner,
      adminToken: 'token',
      itemIds: [counted, favourite, nobody],
    });

    expect(answer.usage).toEqual([
      { itemId: counted, listLineCount: 2 },
      { itemId: favourite, listLineCount: 1 },
      { itemId: nobody, listLineCount: 0 },
    ]);
  });
});
