import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  RealtimeEvent,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeCoreConfig } from '../baskets/basket-config.fake';
import { BasketCoverageService } from '../baskets/basket-coverage.service';
import { BasketLineAddService } from '../baskets/basket-line-add.service';
import { BasketProductChangeService } from '../baskets/basket-product-change.service';
import { BasketReadService } from '../baskets/basket-read.service';
import { BasketRowResolver } from '../baskets/basket-row-resolver';
import { BasketWriteContext } from '../baskets/basket-write.context';
import { BasketMarksReader } from '../baskets/changes/basket-marks.reader';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import { CORE_MIGRATIONS } from '../db/migrations';
import { LineNamed1756003900000 } from '../db/migrations/1756003900000-LineNamed';
import {
  Basket,
  BasketParticipant,
  BasketSource,
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineChange,
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
 * A line says whether a person named it (plan 0207, section 3), against
 * Postgres.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43311/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=line-named.integration.spec.ts
 *
 * Three suites. The first runs the migration on a probe database that **holds
 * lines**, forward, back and forward again. The second writes and reads the
 * flag through the real `LineService` on the shared database: the add, the
 * batch add, the edit, a rename that merges, the sync of a product group and
 * the rename of a basket row. The third adds a line through a basket.
 */

const THROUGH = CORE_MIGRATIONS.slice(
  0,
  CORE_MIGRATIONS.indexOf(LineNamed1756003900000) + 1
);
const BEFORE = THROUGH.slice(0, -1);

const PROBE_DATABASE = 'luna_core_0207_probe';

const ZONE = '02070207-0000-4000-a000-00000000000a';
const LIST = '02070207-0000-4000-a000-00000000000b';
const FREE_TEXT_LINE = '02070207-0000-4000-a000-00000000000c';
const PRODUCT_LINE = '02070207-0000-4000-a000-00000000000d';
const OWNER = '02070207-0000-4000-a000-00000000000e';
const ITEM = '02070207-1111-4000-a000-000000000001';

describeIntegration('LineNamed (real Postgres)', () => {
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

  async function column(): Promise<
    | { data_type: string; is_nullable: string; column_default: string | null }
    | undefined
  > {
    const [found] = await probe.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'list_lines' AND column_name = 'named'`
    );
    return found;
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
    // that every deployed database has today. One was typed and one was made
    // from a product, and nothing on either row says which.
    await open(BEFORE);
    await probe.runMigrations({ transaction: 'each' });

    await probe.query(
      `INSERT INTO "zones" ("id", "name", "joinCode", "status", "config")
       VALUES ($1, 'Home', 'P0207P0207P0207', 'ACTIVE', '{}'::jsonb)`,
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
       VALUES ($1, $3, 'Bread', 2, 1, $4),
              ($2, $3, 'Leche entera Hacendado 1 L', 1, 2, $4)`,
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

  it('starts from a table with lines and no such column', async () => {
    expect(await column()).toBeUndefined();
    expect(
      await probe.query(`SELECT count(*)::int AS "n" FROM "list_lines"`)
    ).toEqual([{ n: 2 }]);
  });

  it('adds one boolean column that is true on every row, and changes nothing else', async () => {
    const [breadBefore] = await line(FREE_TEXT_LINE);
    const [milkBefore] = await line(PRODUCT_LINE);

    await open(THROUGH);
    const ran = await probe.runMigrations({ transaction: 'each' });

    expect(ran.map((migration) => migration.name)).toEqual([
      'LineNamed1756003900000',
    ]);
    expect(await column()).toEqual({
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'true',
    });
    // Every column a line had is as it was, `content`, `updatedAt` and
    // `version` included. Section 1.4: the line made from a product says that
    // it was named, because nothing can tell it from a line a person renamed.
    expect(await line(FREE_TEXT_LINE)).toEqual([
      { ...breadBefore, named: true },
    ]);
    expect(await line(PRODUCT_LINE)).toEqual([{ ...milkBefore, named: true }]);
    // The product set is another table, and the migration does not touch it.
    expect(
      await probe.query(
        `SELECT "itemId" FROM "list_line_items" WHERE "lineId" = $1`,
        [PRODUCT_LINE]
      )
    ).toEqual([{ itemId: ITEM }]);
  });

  it('holds false, the entity reads both values, and a row written with no flag is true', async () => {
    await probe.query(
      `UPDATE "list_lines" SET "named" = false WHERE "id" = $1`,
      [PRODUCT_LINE]
    );
    const inserted = randomUUID();
    await probe.query(
      `INSERT INTO "list_lines"
         ("id", "listId", "content", "quantity", "position", "createdByUserId")
       VALUES ($1, $2, 'Eggs', 1, 3, $3)`,
      [inserted, LIST, OWNER]
    );

    const repo = probe.getRepository(ListLine);
    // The column of this migration and no other. The entity names every column
    // of the newest schema, and this database stops at this migration.
    const select = { id: true, named: true } as const;
    expect(
      await repo.findOneOrFail({ where: { id: PRODUCT_LINE }, select })
    ).toMatchObject({ named: false });
    expect(
      await repo.findOneOrFail({ where: { id: FREE_TEXT_LINE }, select })
    ).toMatchObject({ named: true });
    expect(
      await repo.findOneOrFail({ where: { id: inserted }, select })
    ).toMatchObject({ named: true });
  });

  it('refuses a null', async () => {
    await expect(
      probe.query(`UPDATE "list_lines" SET "named" = NULL WHERE "id" = $1`, [
        PRODUCT_LINE,
      ])
    ).rejects.toThrow(/null value/);
  });

  it('reverts and runs again on a table that holds both values, and keeps every name', async () => {
    await probe.undoLastMigration({ transaction: 'each' });

    expect(await column()).toBeUndefined();
    expect(
      await probe.query(
        `SELECT "content" FROM "list_lines" ORDER BY "position"`
      )
    ).toEqual([
      { content: 'Bread' },
      { content: 'Leche entera Hacendado 1 L' },
      { content: 'Eggs' },
    ]);

    await probe.runMigrations({ transaction: 'each' });

    // What `down` lost is the flag: the line that said false says true again.
    expect(await line(PRODUCT_LINE)).toEqual([
      expect.objectContaining({
        content: 'Leche entera Hacendado 1 L',
        named: true,
      }),
    ]);
  });
});

describeIntegration('the flag of a line (real Postgres)', () => {
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
  // Catalog ids are opaque to core, so any uuid is a product or a group.
  const [SEMI, WHOLE, OAT] = [randomUUID(), randomUUID(), randomUUID()];
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
        name: 'Named Zone',
        joinCode: `NAM${Date.now()}`.slice(0, 16),
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
    named?: boolean;
    itemIds?: string[];
    source?: LineItemSource;
    productGroupId?: string;
    approvalStatus?: LineApprovalStatus;
  }): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    const itemIds = seed.itemIds ?? [];
    const saved = await repo.save(
      repo.create({
        listId: ids.list,
        content: seed.content,
        named: seed.named ?? true,
        quantity: 1,
        position: seed.position,
        itemSetHash: itemSetHash(itemIds),
        productGroupId: seed.productGroupId ?? null,
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
    content: string;
    named: boolean;
    quantity: number;
    version: number;
    itemSetHash: string | null;
    approvalStatus: LineApprovalStatus;
  }> {
    const [found] = await dataSource.query(
      `SELECT "content", "named", "quantity", "version", "itemSetHash",
              "approvalStatus"
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

  const add = (
    fields: Omit<Parameters<LineService['add']>[0], 'userId' | 'listId'>
  ) => lines.add({ userId: ids.owner, listId: ids.list, ...fields });

  const update = (
    lineId: string,
    fields: Omit<Parameters<LineService['update']>[0], 'userId' | 'lineId'>,
    userId = ids.owner
  ) => lines.update({ userId, lineId, ...fields });

  describe('the add', () => {
    it('names a line by default, typed or made from a product', async () => {
      const typed = await add({ content: 'Bread' });
      const picked = await add({ content: 'Oat drink', itemIds: [OAT] });

      for (const { line } of [typed, picked]) {
        expect(line.named).toBe(true);
        expect((await row(line.id)).named).toBe(true);
        expect((await read(line.id)).named).toBe(true);
      }
    });

    it('keeps false on a line made from a product, on the row, the read and the event', async () => {
      const { line, merged } = await add({
        content: 'Oat drink',
        itemIds: [OAT],
        named: false,
      });

      expect(merged).toBe(false);
      expect(line).toMatchObject({ content: 'Oat drink', named: false });
      expect(await row(line.id)).toMatchObject({
        content: 'Oat drink',
        named: false,
      });
      expect((await read(line.id)).named).toBe(false);
      expect(emit.mock.calls).toHaveLength(1);
      expect(emit.mock.calls[0][0]).toBe(RealtimeEvent.LineAdded);
      expect(emit.mock.calls[0][2]).toEqual(line);
    });

    it('names a line with no product although the request says false (rule 1)', async () => {
      const { line } = await add({ content: 'Bread', named: false });

      expect(line.named).toBe(true);
      expect((await row(line.id)).named).toBe(true);
    });

    it('leaves the flag of a line that the add raises, in both directions', async () => {
      const notNamed = await seedLine({
        content: 'Oat drink',
        position: 1,
        itemIds: [OAT],
        named: false,
      });
      const named = await seedLine({
        content: 'The good milk',
        position: 2,
        itemIds: [WHOLE],
        named: true,
      });

      // No flag means "a person typed it" on a new line. Here it raises one.
      const first = await add({
        content: 'oat drink',
        itemIds: [OAT],
        quantity: 2,
      });
      const second = await add({
        content: 'the good milk',
        itemIds: [WHOLE],
        named: false,
      });

      expect(first).toMatchObject({
        merged: true,
        line: { id: notNamed.id, quantity: 3, named: false },
      });
      expect(second).toMatchObject({
        merged: true,
        line: { id: named.id, quantity: 2, named: true },
      });
      expect((await row(notNamed.id)).named).toBe(false);
      expect((await row(named.id)).named).toBe(true);
    });
  });

  describe('the batch add', () => {
    it('decides each item by itself, and leaves the flag of a line it raises', async () => {
      const milk = await seedLine({
        content: 'Semi milk',
        position: 1,
        itemIds: [SEMI],
        named: false,
      });

      const results = await lines.addMany({
        userId: ids.owner,
        listId: ids.list,
        items: [
          { content: 'Bread' },
          { content: 'Oat drink', itemIds: [OAT], named: false },
          { content: 'Eggs', named: false },
          { content: 'Whole milk', itemIds: [WHOLE], named: true },
          { content: 'semi milk', itemIds: [SEMI] },
        ],
      });

      expect(
        results.map(({ line, merged }) => [line.content, line.named, merged])
      ).toEqual([
        ['Bread', true, false],
        ['Oat drink', false, false],
        // Rule 1: no product, so it is named whatever the item says.
        ['Eggs', true, false],
        ['Whole milk', true, false],
        ['Semi milk', false, true],
      ]);
      for (const { line } of results) {
        expect((await row(line.id)).named).toBe(line.named);
      }
      expect(await row(milk.id)).toMatchObject({ named: false, quantity: 2 });
    });
  });

  describe('the edit', () => {
    it('names the line on a content alone (rule 2)', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });

      const view = await update(milk.id, { content: 'Milk for the kids' });

      expect(view).toMatchObject({ content: 'Milk for the kids', named: true });
      expect(await row(milk.id)).toMatchObject({
        content: 'Milk for the kids',
        named: true,
      });
      expect(emit.mock.calls[0][2]).toEqual(view);
    });

    it('takes the name away on false beside a content', async () => {
      const milk = await seedLine({
        content: 'Milk for the kids',
        position: 1,
        itemIds: [WHOLE],
      });

      const view = await update(milk.id, {
        content: 'Leche entera 1 L',
        named: false,
      });

      expect(view).toMatchObject({ content: 'Leche entera 1 L', named: false });
      expect(await row(milk.id)).toMatchObject({
        content: 'Leche entera 1 L',
        named: false,
      });
    });

    it('changes the flag and leaves the name on false alone', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
      });

      const view = await update(milk.id, { named: false });

      expect(view).toMatchObject({
        content: 'Leche entera 1 L',
        named: false,
        version: 2,
      });
      expect(await row(milk.id)).toMatchObject({
        content: 'Leche entera 1 L',
        named: false,
        // The flag is not part of the identity of the line.
        itemSetHash: itemSetHash([WHOLE]),
      });
    });

    it('leaves the flag on an edit that names neither the content nor the flag', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });

      await update(milk.id, { quantity: 3 });
      await update(milk.id, { itemIds: [WHOLE, SEMI] });
      await lines.addQuantity({
        userId: ids.owner,
        lineId: milk.id,
        delta: 1,
      });

      expect(await row(milk.id)).toMatchObject({ named: false, quantity: 4 });
    });

    it('names a line that the edit leaves with no product, and keeps its name (rule 1)', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });

      const view = await update(milk.id, { itemIds: [] });

      expect(view).toMatchObject({
        content: 'Leche entera 1 L',
        named: true,
        itemIds: [],
      });
      expect(await row(milk.id)).toMatchObject({
        content: 'Leche entera 1 L',
        named: true,
        itemSetHash: null,
      });
    });

    it('names a line with no product although the edit says false (rule 1)', async () => {
      const bread = await seedLine({ content: 'Bread', position: 1 });

      const view = await update(bread.id, { named: false });

      expect(view.named).toBe(true);
      expect((await row(bread.id)).named).toBe(true);
    });

    it('names the line on the edit of an operator, which sends no flag', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });

      const view = await lines.updateAsOperator(
        ids.list,
        milk.id,
        { content: 'Leche entera 1 l' },
        randomUUID()
      );

      expect(view.named).toBe(true);
      expect((await row(milk.id)).named).toBe(true);
    });

    it('puts an approved line back to waiting when a writer changes the flag, as for a content', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [WHOLE],
        approvalStatus: LineApprovalStatus.APPROVED,
      });

      await update(milk.id, { named: false }, ids.writer);

      expect(await row(milk.id)).toMatchObject({
        named: false,
        approvalStatus: LineApprovalStatus.PENDING,
      });
    });
  });

  describe('a rename that collides', () => {
    it('asks for the merge on false beside a content, and writes nothing', async () => {
      const milk = await seedLine({
        content: 'Milk',
        position: 1,
        itemIds: [SEMI],
      });
      const leche = await seedLine({
        content: 'The good milk',
        position: 2,
        itemIds: [WHOLE],
      });

      await expect(
        update(leche.id, { content: 'milk', named: false })
      ).rejects.toMatchObject({
        code: 'line_merge_required',
        details: { otherLineId: milk.id, otherContent: 'Milk' },
      });

      expect(await row(leche.id)).toMatchObject({
        content: 'The good milk',
        named: true,
        version: 1,
      });
      expect(await row(milk.id)).toMatchObject({ named: true, version: 1 });
    });

    it('names the survivor on a rename with no flag (rule 2), whatever both lines said', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });
      const other = await seedLine({
        content: 'Leche semi 1 L',
        position: 2,
        itemIds: [SEMI],
        named: false,
      });

      const view = await update(other.id, {
        content: 'leche entera 1 l',
        confirmMerge: true,
      });

      expect(view).toMatchObject({
        id: milk.id,
        absorbedLineId: other.id,
        itemIds: [WHOLE, SEMI],
        named: true,
      });
      expect((await row(milk.id)).named).toBe(true);
    });

    it('keeps the flag of the line that held the name on false, when that line survives', async () => {
      const notNamed = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });
      const renamed = await seedLine({
        content: 'Milk for the kids',
        position: 2,
        itemIds: [SEMI],
        named: true,
      });

      const view = await update(renamed.id, {
        content: 'leche entera 1 l',
        named: false,
        confirmMerge: true,
      });

      // Neither line is named after the write, so the survivor is not.
      expect(view).toMatchObject({ id: notNamed.id, named: false });
      expect((await row(notNamed.id)).named).toBe(false);
    });

    it('is named when the line that goes away was named, on false', async () => {
      // The renamed line is the earlier one, so it survives, and the line that
      // held the name, which a person typed, goes away.
      const renamed = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });
      const typed = await seedLine({
        content: 'Milk',
        position: 2,
        itemIds: [SEMI],
        named: true,
      });

      const view = await update(renamed.id, {
        content: 'milk',
        named: false,
        confirmMerge: true,
      });

      expect(view).toMatchObject({
        id: renamed.id,
        absorbedLineId: typed.id,
        named: true,
      });
      expect((await row(renamed.id)).named).toBe(true);
    });
  });

  describe('the writes that send a name and no flag', () => {
    it('names every line that the rename of a basket row writes', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });
      const list = await dataSource
        .getRepository(ShoppingList)
        .findOneOrFail({ where: { id: ids.list } });

      await dataSource.transaction(async (manager) => {
        await lines.lockListsForRename(manager, [ids.list]);
        const plan = await lines.planListRename(
          manager,
          list,
          [milk.id],
          'Milk',
          new Set([ListPermission.WRITE, ListPermission.DECIDE]),
          { userId: ids.owner, participantId: null, basketId: null } as never
        );
        await lines.writeListRename(manager, plan);
      });

      expect(await row(milk.id)).toMatchObject({
        content: 'Milk',
        named: true,
      });
    });

    it('names the survivor when the rename of a basket row merges two lines', async () => {
      const holder = await seedLine({
        content: 'Leche',
        position: 1,
        itemIds: [SEMI],
        named: false,
      });
      const renamed = await seedLine({
        content: 'Leche entera 1 L',
        position: 2,
        itemIds: [WHOLE],
        named: false,
      });
      const list = await dataSource
        .getRepository(ShoppingList)
        .findOneOrFail({ where: { id: ids.list } });

      await dataSource.transaction(async (manager) => {
        await lines.lockListsForRename(manager, [ids.list]);
        const plan = await lines.planListRename(
          manager,
          list,
          [renamed.id],
          'leche',
          new Set([ListPermission.WRITE, ListPermission.DECIDE]),
          { userId: ids.owner, participantId: null, basketId: null } as never
        );
        await lines.writeListRename(manager, plan);
      });

      expect(await row(holder.id)).toMatchObject({ named: true, quantity: 2 });
    });
  });

  describe('the writes that move the products and say nothing of the name', () => {
    it('names a line whose last product its group takes away, in the transaction of the sync', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        source: LineItemSource.GROUP,
        productGroupId: MILK_GROUP,
        named: false,
      });
      const both = await seedLine({
        content: 'Leche semi 1 L',
        position: 2,
        itemIds: [SEMI, WHOLE],
        source: LineItemSource.GROUP,
        productGroupId: MILK_GROUP,
        named: false,
      });

      await sync.handleItemGroupChanged({
        eventId: randomUUID(),
        itemId: WHOLE,
        from: MILK_GROUP,
        to: null,
      } as never);

      expect(await row(milk.id)).toMatchObject({
        content: 'Leche entera 1 L',
        named: true,
        itemSetHash: null,
      });
      // A line that still holds a product keeps its flag.
      expect(await row(both.id)).toMatchObject({
        named: false,
        itemSetHash: itemSetHash([SEMI]),
      });
    });

    it('names a deleted line with its products', async () => {
      const milk = await seedLine({
        content: 'Leche entera 1 L',
        position: 1,
        itemIds: [WHOLE],
        named: false,
      });

      await lines.delete({ userId: ids.owner, lineId: milk.id });

      expect(await row(milk.id)).toMatchObject({
        named: true,
        itemSetHash: null,
      });
    });
  });

  it('holds the rule on every row this suite wrote: no line with no product says false', async () => {
    await seedLine({
      content: 'Leche entera 1 L',
      position: 1,
      itemIds: [WHOLE],
      named: false,
    });
    await add({ content: 'Bread', named: false });
    await add({ content: 'Oat drink', itemIds: [OAT], named: false });

    expect(
      await dataSource.query(
        `SELECT count(*)::int AS "n"
           FROM "list_lines" l
          WHERE l."listId" = $1
            AND l."named" = false
            AND NOT EXISTS (
              SELECT 1 FROM "list_line_items" i WHERE i."lineId" = l."id"
            )`,
        [ids.list]
      )
    ).toEqual([{ n: 0 }]);
  });
});

describeIntegration(
  'the flag of a line added through a basket (real Postgres)',
  () => {
    let dataSource: DataSource;
    let addService: BasketLineAddService;
    const announcer = fakeBasketAnnouncer();
    const user = randomUUID();
    const OAT = randomUUID();
    let zoneId = '';
    let listId = '';
    let basketId = '';
    let participantId = '';

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      const baskets = dataSource.getRepository(Basket);
      const coverage = new BasketCoverageService(baskets);
      // The account is staff of its zone, so it writes every list it covers.
      const sharing = {
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        liveParticipantById: async (id: string) =>
          dataSource
            .getRepository(BasketParticipant)
            .findOne({ where: { id } }),
        listParticipants: async (req: { basketId: string }) => ({
          participants: (
            await dataSource
              .getRepository(BasketParticipant)
              .find({ where: { basketId: req.basketId, revokedAt: IsNull() } })
          ).map((row) => ({
            id: row.id,
            kind: row.kind,
            displayName: row.displayName,
            username: row.username,
            guestNumber: row.guestNumber,
            userId: row.userId,
            shareLinkId: row.shareLinkId,
          })),
        }),
      } as never;
      const listAccess = new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(dataSource.getRepository(ZoneMembership))
      );
      const read = new BasketReadService(
        baskets,
        coverage,
        sharing,
        listAccess,
        { order: async <T>(_userId: string, rows: T[]) => rows } as never,
        new BasketMarksReader(
          dataSource.getRepository(ListLineChange),
          fakeCoreConfig()
        ),
        fakeCoreConfig()
      );
      const context = new BasketWriteContext(
        baskets,
        coverage,
        sharing,
        new BasketRowResolver(baskets, fakeCoreConfig()),
        read,
        announcer
      );
      const events = {
        emit: () => undefined,
        emitTo: () => undefined,
      } as never;
      const lines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        events,
        new CoreAuditService(dataSource),
        new LineMergeService(new LineChangeRecorder()),
        new LineChangeRecorder(),
        announcer
      );
      addService = new BasketLineAddService(
        context,
        lines,
        { pricingProfileId: async () => null } as never,
        events,
        new BasketProductChangeService(dataSource, context, lines, listAccess)
      );

      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Named basket',
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: user,
          config: {},
        })
      );
      zoneId = zone.id;
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save(
        memberships.create({
          zoneId,
          userId: user,
          username: 'Ana',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
      const lists = dataSource.getRepository(ShoppingList);
      listId = (
        await lists.save(
          lists.create({ zoneId, name: 'Weekly', createdByUserId: user })
        )
      ).id;
      const basket = await baskets.save(
        baskets.create({
          ownerUserId: user,
          kind: BasketKind.GENERATED,
          name: 'Saturday',
          status: BasketStatus.OPEN,
          generatedAt: new Date(Date.now() - 60_000),
          idempotencyKey: null,
        })
      );
      basketId = basket.id;
      const sources = dataSource.getRepository(BasketSource);
      await sources.save(sources.create({ basketId, zoneId, listId }));
      const participants = dataSource.getRepository(BasketParticipant);
      participantId = (
        await participants.save(
          participants.create({
            basketId,
            shareLinkId: null,
            kind: ParticipantKind.OWNER,
            userId: user,
            displayName: null,
            username: 'Ana',
            guestNumber: null,
            sessionSecretHash: null,
            userAgent: null,
            joinedAt: new Date(Date.now() - 60_000),
            lastSeenAt: new Date(),
            revokedAt: null,
            expiresAt: null,
          })
        )
      ).id;
    });

    afterAll(async () => {
      if (basketId) {
        await dataSource.getRepository(Basket).delete({ id: basketId });
      }
      if (zoneId) {
        await dataSource.getRepository(Zone).delete({ id: zoneId });
      }
      await dataSource?.destroy();
    });

    const named = async (content: string): Promise<boolean[]> =>
      (
        await dataSource
          .getRepository(ListLine)
          .find({ where: { listId, content } })
      ).map((line) => line.named);

    const add = (fields: {
      content: string;
      itemIds?: string[];
      named?: boolean;
    }) =>
      addService.add({
        basketId,
        participantId,
        userId: user,
        targetListId: listId,
        ...fields,
      });

    it('hands false to the line when the line holds a product', async () => {
      await add({ content: 'Oat drink', itemIds: [OAT], named: false });

      expect(await named('Oat drink')).toEqual([false]);
    });

    it('names the line when the request says nothing', async () => {
      await add({ content: 'Whole milk', itemIds: [randomUUID()] });

      expect(await named('Whole milk')).toEqual([true]);
    });

    it('names a line with no product although the request says false (rule 1)', async () => {
      await add({ content: 'Bread', named: false });

      expect(await named('Bread')).toEqual([true]);
    });
  }
);
