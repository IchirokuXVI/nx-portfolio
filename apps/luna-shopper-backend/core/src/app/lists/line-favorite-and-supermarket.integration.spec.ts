import {
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import { CORE_MIGRATIONS } from '../db/migrations';
import { LineFavoriteAndSupermarket1756003600000 } from '../db/migrations/1756003600000-LineFavoriteAndSupermarket';
import {
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { LineChangeRecorder } from './changes/line-change.recorder';
import { itemSetHash } from './item-set-hash';
import { LineMergeService } from './line-merge.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';
import { ProductGroupSyncService } from './product-group-sync.service';

/**
 * A line names its favourite product and its supermarket (plan 0199, section
 * 3), against Postgres.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=line-favorite-and-supermarket.integration.spec.ts
 *
 * Two suites. The first runs the migration on a probe database that **holds
 * lines**, forward, back and forward again. The second writes and reads both
 * fields through the real services on the shared database, where a `uuid`
 * column, a transaction and a cascade are real. A mocked repository proves
 * none of those.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(LineFavoriteAndSupermarket1756003600000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0199_probe';

const ZONE = '01990199-0000-4000-a000-00000000000a';
const LIST = '01990199-0000-4000-a000-00000000000b';
const FREE_TEXT_LINE = '01990199-0000-4000-a000-00000000000c';
const PRODUCT_LINE = '01990199-0000-4000-a000-00000000000d';
const OWNER = '01990199-0000-4000-a000-00000000000e';
const ITEM = '01990199-1111-4000-a000-000000000001';
const CHAIN = '01990199-1111-4000-a000-000000000002';

describeIntegration('LineFavoriteAndSupermarket (real Postgres)', () => {
  let admin: DataSource;
  let probe: DataSource;
  let probeUrl: string;

  async function open(migrations = THROUGH): Promise<void> {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    probe = new DataSource({
      type: 'postgres',
      url: probeUrl,
      entities: CORE_ENTITIES,
      migrations,
      migrationsTableName: 'migrations',
      synchronize: false,
    });
    await probe.initialize();
  }

  async function columns(): Promise<
    Map<string, { data_type: string; is_nullable: string }>
  > {
    const rows: {
      column_name: string;
      data_type: string;
      is_nullable: string;
    }[] = await probe.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'list_lines'`
    );
    return new Map(rows.map((row) => [row.column_name, row]));
  }

  function line(id: string): Promise<Record<string, unknown>[]> {
    return probe.query(`SELECT * FROM "list_lines" WHERE "id" = $1`, [id]);
  }

  beforeAll(async () => {
    const url = new URL(requiredEnv('CORE_DB_URL'));
    admin = new DataSource({ type: 'postgres', url: url.toString() });
    await admin.initialize();
    // `DROP` first, so a killed run leaves nothing the next one fails on.
    await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);
    url.pathname = `/${PROBE_DATABASE}`;
    probeUrl = url.toString();

    // Everything before this migration, and then lines written by the schema
    // that every deployed database has today.
    await open(BEFORE);
    await probe.runMigrations({ transaction: 'each' });

    await probe.query(
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
       VALUES ($1, 'Home', 'P0199P0199P0199', 'ACTIVE', '{}'::jsonb)`,
      [ZONE]
    );
    await probe.query(
      `INSERT INTO "shopping_lists" ("id", "zoneId", "name", "createdByUserId")
       VALUES ($1, $2, 'Weekly shop', $3)`,
      [LIST, ZONE, OWNER]
    );
    await probe.query(
      `INSERT INTO "list_lines"
         ("id", "listId", "content", "quantity", "position", "createdByUserId")
       VALUES ($1, $3, 'Bread', 2, 1, $4), ($2, $3, 'Milk', 1, 2, $4)`,
      [FREE_TEXT_LINE, PRODUCT_LINE, LIST, OWNER]
    );
    await probe.query(
      `INSERT INTO "list_line_items" ("lineId", "itemId", "position")
       VALUES ($1, $2, 0)`,
      [PRODUCT_LINE, ITEM]
    );
  });

  afterAll(async () => {
    if (probe?.isInitialized) {
      await probe.destroy();
    }
    await admin?.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
    await admin?.destroy();
  });

  it('starts from a table with lines and neither column', async () => {
    const before = await columns();

    expect(before.has('favoriteItemId')).toBe(false);
    expect(before.has('preferredSupermarketId')).toBe(false);
    expect(
      await probe.query(`SELECT count(*)::int AS "n" FROM "list_lines"`)
    ).toEqual([{ n: 2 }]);
  });

  it('adds two nullable uuid columns, and changes no row', async () => {
    const [breadBefore] = await line(FREE_TEXT_LINE);
    const [milkBefore] = await line(PRODUCT_LINE);

    await open(THROUGH);
    const ran = await probe.runMigrations({ transaction: 'each' });

    expect(ran.map((migration) => migration.name)).toEqual([
      'LineFavoriteAndSupermarket1756003600000',
    ]);
    const after = await columns();
    for (const column of ['favoriteItemId', 'preferredSupermarketId']) {
      expect(after.get(column)).toMatchObject({
        data_type: 'uuid',
        is_nullable: 'YES',
      });
    }
    // Every column a line had is as it was, `updatedAt` and `version`
    // included, and both new ones are null.
    expect(await line(FREE_TEXT_LINE)).toEqual([
      { ...breadBefore, favoriteItemId: null, preferredSupermarketId: null },
    ]);
    expect(await line(PRODUCT_LINE)).toEqual([
      { ...milkBefore, favoriteItemId: null, preferredSupermarketId: null },
    ]);
    // The product set is another table, and the migration does not touch it.
    expect(
      await probe.query(
        `SELECT "itemId" FROM "list_line_items" WHERE "lineId" = $1`,
        [PRODUCT_LINE]
      )
    ).toEqual([{ itemId: ITEM }]);
  });

  it('holds a favourite and a chain, and the entity reads the migrated row', async () => {
    await probe.query(
      `UPDATE "list_lines"
          SET "favoriteItemId" = $2, "preferredSupermarketId" = $3
        WHERE "id" = $1`,
      [PRODUCT_LINE, ITEM, CHAIN]
    );

    const repo = probe.getRepository(ListLine);
    expect(
      await repo.findOneOrFail({ where: { id: PRODUCT_LINE } })
    ).toMatchObject({ favoriteItemId: ITEM, preferredSupermarketId: CHAIN });
    expect(
      await repo.findOneOrFail({ where: { id: FREE_TEXT_LINE } })
    ).toMatchObject({ favoriteItemId: null, preferredSupermarketId: null });
  });

  it('refuses a value that is not a uuid', async () => {
    await expect(
      probe.query(
        `UPDATE "list_lines" SET "preferredSupermarketId" = 'mercadona' WHERE "id" = $1`,
        [PRODUCT_LINE]
      )
    ).rejects.toThrow(/uuid/);
  });

  it('reverts and runs again on a table that holds both values', async () => {
    await probe.undoLastMigration({ transaction: 'each' });

    const reverted = await columns();
    expect(reverted.has('favoriteItemId')).toBe(false);
    expect(reverted.has('preferredSupermarketId')).toBe(false);
    // The lines are still there. What `down` loses is the two choices.
    expect(
      await probe.query(`SELECT count(*)::int AS "n" FROM "list_lines"`)
    ).toEqual([{ n: 2 }]);

    await probe.runMigrations({ transaction: 'each' });

    expect(await line(PRODUCT_LINE)).toEqual([
      expect.objectContaining({
        content: 'Milk',
        favoriteItemId: null,
        preferredSupermarketId: null,
      }),
    ]);
  });
});

describeIntegration(
  'the favourite and the chain of a line (real Postgres)',
  () => {
    let dataSource: DataSource;
    let lines: LineService;
    let sync: ProductGroupSyncService;
    const emit = jest.fn();
    const announcer = fakeBasketAnnouncer();

    const ids = {
      zone: '',
      list: '',
      owner: randomUUID(),
      writer: randomUUID(),
    };
    // Catalog ids are opaque to core, so any uuid is a product, a group or a
    // chain.
    const [SEMI, WHOLE, OAT] = [randomUUID(), randomUUID(), randomUUID()];
    const [MERCADONA, LIDL] = [randomUUID(), randomUUID()];
    const MILK_GROUP = randomUUID();

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      const memberships = dataSource.getRepository(ZoneMembership);
      const claims = fakeLineClaims().service;
      lines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        new ListAccessService(
          dataSource.getRepository(ShoppingList),
          dataSource.getRepository(ListAccess),
          dataSource.getRepository(ListLine),
          new ZoneAuthzService(memberships)
        ),
        claims,
        { emit } as never,
        new CoreAuditService(dataSource),
        new LineMergeService(new LineChangeRecorder()),
        new LineChangeRecorder(),
        announcer
      );
      sync = new ProductGroupSyncService(
        dataSource,
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ShoppingList),
        claims,
        { emit } as never,
        // Every event here is new, so the inbox always says so.
        { firstSeen: async () => true } as never,
        announcer
      );

      const zone = await dataSource.getRepository(Zone).save(
        dataSource.getRepository(Zone).create({
          name: 'Favourite Zone',
          joinCode: `FAV${Date.now()}`.slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: ids.owner,
          config: {},
        })
      );
      ids.zone = zone.id;
      const lists = dataSource.getRepository(ShoppingList);
      ids.list = (
        await lists.save(
          lists.create({
            zoneId: zone.id,
            name: 'Groceries',
            createdByUserId: ids.owner,
          })
        )
      ).id;

      await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId: ids.owner,
          username: 'Owner',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
      const writer = await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId: ids.writer,
          username: 'Writer',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
      await dataSource.getRepository(ListAccess).save(
        dataSource.getRepository(ListAccess).create({
          listId: ids.list,
          membershipId: writer.id,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        })
      );
    });

    afterAll(async () => {
      if (ids.zone) {
        // Memberships, lists, access rows and lines all cascade from the zone.
        await dataSource.getRepository(Zone).delete({ id: ids.zone });
      }
      await dataSource?.destroy();
    });

    beforeEach(async () => {
      emit.mockReset();
      announcer.reset();
      await dataSource.getRepository(ListLine).delete({ listId: ids.list });
    });

    async function seedLine(seed: {
      content: string;
      position: number;
      itemIds?: string[];
      source?: LineItemSource;
      productGroupId?: string;
      favoriteItemId?: string | null;
      preferredSupermarketId?: string | null;
      approvalStatus?: LineApprovalStatus;
    }): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      const itemIds = seed.itemIds ?? [];
      const saved = await repo.save(
        repo.create({
          listId: ids.list,
          content: seed.content,
          quantity: 1,
          position: seed.position,
          itemSetHash: itemSetHash(itemIds),
          productGroupId: seed.productGroupId ?? null,
          favoriteItemId: seed.favoriteItemId ?? null,
          preferredSupermarketId: seed.preferredSupermarketId ?? null,
          approvalStatus: seed.approvalStatus ?? LineApprovalStatus.PENDING,
          createdByUserId: ids.owner,
          approvedByUserId:
            seed.approvalStatus === LineApprovalStatus.APPROVED
              ? ids.owner
              : null,
          version: 1,
        })
      );
      if (itemIds.length > 0) {
        await dataSource.getRepository(ListLineItem).insert(
          itemIds.map((itemId, position) => ({
            lineId: saved.id,
            itemId,
            position,
            source: seed.source ?? LineItemSource.USER,
          }))
        );
      }
      return saved;
    }

    /** The row as Postgres holds it, deleted or not. */
    async function row(lineId: string): Promise<{
      favoriteItemId: string | null;
      preferredSupermarketId: string | null;
      version: number;
      itemSetHash: string | null;
      approvalStatus: LineApprovalStatus;
    }> {
      const [found] = await dataSource.query(
        `SELECT "favoriteItemId", "preferredSupermarketId", "version",
              "itemSetHash", "approvalStatus"
         FROM "list_lines" WHERE "id" = $1`,
        [lineId]
      );
      return found;
    }

    /** The line as `GET /v1/lists/:id/lines` answers it. */
    async function read(lineId: string) {
      const page = await lines.list({ userId: ids.owner, listId: ids.list });
      const found = page.items.find((item) => item.id === lineId);
      if (!found) {
        throw new Error(`line ${lineId} is not on the list`);
      }
      return found;
    }

    const update = (
      lineId: string,
      fields: Omit<Parameters<LineService['update']>[0], 'userId' | 'lineId'>,
      userId = ids.owner
    ) => lines.update({ userId, lineId, ...fields });

    it('writes both fields and reads them back', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI, WHOLE],
      });

      const view = await update(milk.id, {
        favoriteItemId: WHOLE,
        preferredSupermarketId: MERCADONA,
      });

      expect(view).toMatchObject({
        favoriteItemId: WHOLE,
        preferredSupermarketId: MERCADONA,
        version: 2,
      });
      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: WHOLE,
        preferredSupermarketId: MERCADONA,
        version: 2,
        // Neither field is part of the identity of the line.
        itemSetHash: itemSetHash([SEMI, WHOLE]),
      });
      expect(await read(milk.id)).toMatchObject({
        favoriteItemId: WHOLE,
        preferredSupermarketId: MERCADONA,
      });
      // The room hears the line that the write answered with (rule 8).
      expect(emit.mock.calls).toHaveLength(1);
      expect(emit.mock.calls[0][0]).toBe(RealtimeEvent.LineUpdated);
      expect(emit.mock.calls[0][2]).toEqual(view);
    });

    it('reads null for both on a line that names neither, and on a line just added', async () => {
      const bread = await seedLine({ content: 'Bread', position: 1 });
      const { line: added } = await lines.add({
        userId: ids.owner,
        listId: ids.list,
        content: 'Eggs',
        itemIds: [OAT],
      });

      for (const view of [await read(bread.id), added, await read(added.id)]) {
        expect(view.favoriteItemId).toBeNull();
        expect(view.preferredSupermarketId).toBeNull();
      }
    });

    it('clears on null and leaves alone on absent', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
        favoriteItemId: SEMI,
        preferredSupermarketId: MERCADONA,
      });

      await update(milk.id, { quantity: 3 });
      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: SEMI,
        preferredSupermarketId: MERCADONA,
      });

      await update(milk.id, { favoriteItemId: null });
      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: null,
        preferredSupermarketId: MERCADONA,
      });

      await update(milk.id, { preferredSupermarketId: null });
      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: null,
        preferredSupermarketId: null,
      });
    });

    it('refuses a favourite outside the set and writes nothing, also not the rest of the request', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
      });

      await expect(
        update(milk.id, { quantity: 5, favoriteItemId: OAT })
      ).rejects.toMatchObject({ code: 'validation_failed' });
      await expect(
        update(milk.id, { itemIds: [WHOLE], favoriteItemId: SEMI })
      ).rejects.toMatchObject({ code: 'validation_failed' });

      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: null,
        version: 1,
        itemSetHash: itemSetHash([SEMI]),
      });
      expect((await read(milk.id)).itemIds).toEqual([SEMI]);
      expect((await read(milk.id)).quantity).toBe(1);
    });

    it('adds a product and makes it the favourite in one request', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
      });

      const view = await update(milk.id, {
        itemIds: [SEMI, OAT],
        favoriteItemId: OAT,
      });

      expect(view.itemIds).toEqual([SEMI, OAT]);
      expect(view.favoriteItemId).toBe(OAT);
      expect((await row(milk.id)).favoriteItemId).toBe(OAT);
    });

    it('clears a favourite that an update takes off the line, and keeps the chain', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI, WHOLE],
        favoriteItemId: WHOLE,
        preferredSupermarketId: LIDL,
      });

      const view = await update(milk.id, { itemIds: [SEMI] });

      expect(view.favoriteItemId).toBeNull();
      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: null,
        preferredSupermarketId: LIDL,
      });

      // And the chain outlives an empty set.
      await update(milk.id, { itemIds: [] });
      expect((await row(milk.id)).preferredSupermarketId).toBe(LIDL);
    });

    it('clears a favourite that the group takes off the line, in the transaction of the sync', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI, WHOLE],
        source: LineItemSource.GROUP,
        productGroupId: MILK_GROUP,
        favoriteItemId: WHOLE,
        preferredSupermarketId: LIDL,
      });

      await sync.handleItemGroupChanged({
        eventId: randomUUID(),
        itemId: WHOLE,
        from: MILK_GROUP,
        to: null,
      } as never);

      expect((await read(milk.id)).itemIds).toEqual([SEMI]);
      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: null,
        preferredSupermarketId: LIDL,
        version: 2,
      });
      const announced = emit.mock.calls.find(
        (call) => call[0] === RealtimeEvent.LineUpdated
      );
      expect(announced?.[2]).toMatchObject({
        id: milk.id,
        favoriteItemId: null,
        preferredSupermarketId: LIDL,
      });
    });

    it('puts an approved line back to waiting when a writer writes either field', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
        approvalStatus: LineApprovalStatus.APPROVED,
      });

      await update(milk.id, { preferredSupermarketId: MERCADONA }, ids.writer);

      expect(await row(milk.id)).toMatchObject({
        approvalStatus: LineApprovalStatus.PENDING,
        preferredSupermarketId: MERCADONA,
      });
    });

    it('leaves the fields of a line alone when an add raises it', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
        favoriteItemId: SEMI,
        preferredSupermarketId: MERCADONA,
      });

      const { line: view, merged } = await lines.add({
        userId: ids.owner,
        listId: ids.list,
        content: 'milk',
        itemIds: [SEMI],
        quantity: 2,
      });

      expect(merged).toBe(true);
      expect(view).toMatchObject({
        id: milk.id,
        quantity: 3,
        favoriteItemId: SEMI,
        preferredSupermarketId: MERCADONA,
      });
    });

    it('takes the favourite off a deleted line with its products', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
        favoriteItemId: SEMI,
        preferredSupermarketId: MERCADONA,
      });

      await lines.delete({ userId: ids.owner, lineId: milk.id });

      expect(await row(milk.id)).toMatchObject({
        favoriteItemId: null,
        itemSetHash: null,
      });
    });

    describe('a merge (rule 6)', () => {
      const merge = (line: ListLine, content: string, fields = {}) =>
        update(line.id, { content, confirmMerge: true, ...fields });

      it('keeps the fields of the line that survives', async () => {
        const milk = await seedLine({
          content: 'Milk',
          position: 1,
          itemIds: [SEMI],
          favoriteItemId: SEMI,
          preferredSupermarketId: MERCADONA,
        });
        const leche = await seedLine({
          content: 'Leche',
          position: 2,
          itemIds: [WHOLE],
          favoriteItemId: WHOLE,
          preferredSupermarketId: LIDL,
        });

        const view = await merge(leche, 'milk');

        expect(view).toMatchObject({
          id: milk.id,
          absorbedLineId: leche.id,
          itemIds: [SEMI, WHOLE],
          favoriteItemId: SEMI,
          preferredSupermarketId: MERCADONA,
        });
        expect(await row(milk.id)).toMatchObject({
          favoriteItemId: SEMI,
          preferredSupermarketId: MERCADONA,
        });
      });

      it('takes the fields of the line that goes away where the survivor has none', async () => {
        const milk = await seedLine({
          content: 'Milk',
          position: 1,
          itemIds: [SEMI],
        });
        const leche = await seedLine({
          content: 'Leche',
          position: 2,
          itemIds: [WHOLE],
          favoriteItemId: WHOLE,
          preferredSupermarketId: LIDL,
        });

        const view = await merge(leche, 'milk');

        expect(view).toMatchObject({
          id: milk.id,
          itemIds: [SEMI, WHOLE],
          favoriteItemId: WHOLE,
          preferredSupermarketId: LIDL,
        });
        expect(await row(milk.id)).toMatchObject({
          favoriteItemId: WHOLE,
          preferredSupermarketId: LIDL,
        });
      });

      it('decides each field by itself, and survives as the renamed line when that one is earlier', async () => {
        // The renamed line is the earlier one here, so it survives, and the line
        // that held the name goes away.
        const leche = await seedLine({
          content: 'Leche',
          position: 1,
          itemIds: [WHOLE],
          preferredSupermarketId: LIDL,
        });
        const milk = await seedLine({
          content: 'Milk',
          position: 2,
          itemIds: [SEMI],
          favoriteItemId: SEMI,
          preferredSupermarketId: MERCADONA,
        });

        const view = await merge(leche, 'milk');

        expect(view).toMatchObject({
          id: leche.id,
          absorbedLineId: milk.id,
          favoriteItemId: SEMI,
          preferredSupermarketId: LIDL,
        });
      });

      it('does not take a favourite that is not in the merged set', async () => {
        const milk = await seedLine({
          content: 'Milk',
          position: 1,
          itemIds: [SEMI],
        });
        // A row that breaks the rule, written past the service: its favourite
        // is not one of its products.
        const leche = await seedLine({
          content: 'Leche',
          position: 2,
          itemIds: [WHOLE],
          favoriteItemId: OAT,
        });

        const view = await merge(leche, 'milk');

        expect(view.id).toBe(milk.id);
        expect(view.itemIds).toEqual([SEMI, WHOLE]);
        expect(view.favoriteItemId).toBeNull();
      });

      it('lands the fields of the request on the renamed line before the merge', async () => {
        const milk = await seedLine({
          content: 'Milk',
          position: 1,
          itemIds: [SEMI],
        });
        const leche = await seedLine({
          content: 'Leche',
          position: 2,
          itemIds: [WHOLE],
        });

        const view = await merge(leche, 'milk', {
          favoriteItemId: WHOLE,
          preferredSupermarketId: LIDL,
        });

        // The survivor had none, so it takes what the request gave the line
        // that goes away.
        expect(view).toMatchObject({
          id: milk.id,
          favoriteItemId: WHOLE,
          preferredSupermarketId: LIDL,
        });
      });

      it('refuses a favourite outside the set of the renamed line before anything merges', async () => {
        const milk = await seedLine({
          content: 'Milk',
          position: 1,
          itemIds: [SEMI],
        });
        const leche = await seedLine({
          content: 'Leche',
          position: 2,
          itemIds: [WHOLE],
        });

        await expect(
          merge(leche, 'milk', { favoriteItemId: OAT })
        ).rejects.toMatchObject({ code: 'validation_failed' });

        expect((await read(milk.id)).itemIds).toEqual([SEMI]);
        expect((await read(leche.id)).content).toBe('Leche');
      });

      it('writes both fields on a rename to a free name', async () => {
        const milk = await seedLine({
          content: 'Milk',
          position: 1,
          itemIds: [SEMI, WHOLE],
          favoriteItemId: WHOLE,
        });

        const view = await update(milk.id, {
          content: 'Oat milk',
          itemIds: [SEMI],
          preferredSupermarketId: LIDL,
        });

        expect(view).toMatchObject({
          content: 'Oat milk',
          // The same request took the favourite off the line.
          favoriteItemId: null,
          preferredSupermarketId: LIDL,
        });
        expect(await row(milk.id)).toMatchObject({
          favoriteItemId: null,
          preferredSupermarketId: LIDL,
        });
      });
    });
  }
);
