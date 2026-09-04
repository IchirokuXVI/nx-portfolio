import {
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
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
import {
  CORE_ENTITIES,
  ListAccess,
  ListLine,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ZoneCountsService } from '../zones/zone-counts.service';
import { ListAccessService } from './list-access.service';
import { ListService } from './list.service';
import { SharedListGrantService } from './shared-list-grant.service';

/**
 * "Which other lists hold this item", against real Postgres (plan 0053,
 * section 3).
 *
 * The unit spec beside this one owns the cap and the refusal. What it cannot own
 * is the query, and the query is where every interesting decision in this read
 * lives: the access predicate that decides which lists may be named, the two
 * conditions that define holding, and the `DISTINCT ON` that collapses a list
 * carrying the product on several lines. A fake returning an array of rows would
 * agree with any of those being wrong.
 *
 * What the fixture is: one shopper in two zones, and a stranger in neither. Both
 * zones want the same product. The stranger's list wants it too, and must be
 * invisible to the shopper however the query is written.
 */
describeIntegration('which other lists hold this item (real Postgres)', () => {
  let dataSource: DataSource;
  let lists: ListService;

  const MILK = randomUUID();
  const BREAD = randomUUID();
  const ids = {
    homeZone: '',
    officeZone: '',
    strangerZone: '',
    home: '',
    office: '',
    hidden: '',
    stranger: '',
    shopper: randomUUID(),
    outsider: randomUUID(),
  };

  async function seedZone(name: string, ownerUserId: string): Promise<string> {
    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name,
        joinCode: `${name.slice(0, 3).toUpperCase()}${Date.now()}${Math.floor(
          Math.random() * 1000
        )}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId,
        config: {},
      })
    );
    await dataSource.getRepository(ZoneMembership).save(
      dataSource.getRepository(ZoneMembership).create({
        zoneId: zone.id,
        userId: ownerUserId,
        username: 'Owner',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    return zone.id;
  }

  async function seedList(zoneId: string, name: string): Promise<string> {
    const list = await dataSource.getRepository(ShoppingList).save(
      dataSource.getRepository(ShoppingList).create({
        zoneId,
        name,
        createdByUserId: ids.shopper,
      })
    );
    return list.id;
  }

  /** One line, with a product set, at a stated quantity and approval. */
  async function seedLine(
    listId: string,
    content: string,
    options: {
      quantity?: number;
      approvalStatus?: LineApprovalStatus;
      itemIds?: string[];
    } = {}
  ): Promise<string> {
    const line = await dataSource.getRepository(ListLine).save(
      dataSource.getRepository(ListLine).create({
        listId,
        content,
        quantity: options.quantity ?? 1,
        approvalStatus: options.approvalStatus ?? LineApprovalStatus.APPROVED,
        position: 1,
        createdByUserId: ids.shopper,
      })
    );
    for (const [position, itemId] of (options.itemIds ?? []).entries()) {
      await dataSource.getRepository(ListLineItem).save(
        dataSource.getRepository(ListLineItem).create({
          lineId: line.id,
          itemId,
          position,
        })
      );
    }
    return line.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const memberships = dataSource.getRepository(ZoneMembership);
    const authz = new ZoneAuthzService(memberships);
    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      authz
    );
    lists = new ListService(
      dataSource,
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      authz,
      listAccess,
      new SharedListGrantService(),
      new ZoneCountsService(memberships, { emit: jest.fn() } as never),
      { emit: jest.fn() } as never,
      new CoreAuditService(dataSource)
    );

    ids.homeZone = await seedZone('Home', ids.shopper);
    ids.officeZone = await seedZone('Office', ids.shopper);
    ids.strangerZone = await seedZone('Theirs', ids.outsider);

    ids.home = await seedList(ids.homeZone, 'Weekly shop');
    ids.office = await seedList(ids.officeZone, 'Office kitchen');
    ids.hidden = await seedList(ids.homeZone, 'Nobody reads this');
    ids.stranger = await seedList(ids.strangerZone, 'Their list');
  });

  afterAll(async () => {
    for (const zoneId of [ids.homeZone, ids.officeZone, ids.strangerZone]) {
      if (zoneId) {
        // Memberships, lists, lines, their product sets and access rows all
        // cascade from the zone.
        await dataSource.getRepository(Zone).delete({ id: zoneId });
      }
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    // Lines rather than the whole fixture, so each test states its own list
    // contents and nothing leaks between them.
    for (const listId of [ids.home, ids.office, ids.hidden, ids.stranger]) {
      await dataSource.getRepository(ListLine).delete({ listId });
    }
  });

  it('names every readable list that still wants the product', async () => {
    await seedLine(ids.home, 'Milk', { itemIds: [MILK] });
    await seedLine(ids.office, 'Milk', { itemIds: [MILK] });

    const result = await lists.holdingItem({
      userId: ids.shopper,
      itemId: MILK,
    });

    expect(
      result.lists.map((row) => row.name).sort((a, b) => a.localeCompare(b))
    ).toEqual(['Office kitchen', 'Weekly shop']);
    // The zone travels with the list, because the caption names the household.
    expect(result.lists.every((row) => row.zoneName.length > 0)).toBe(true);
  });

  it('leaves out the list the caller is asking from', async () => {
    await seedLine(ids.home, 'Milk', { itemIds: [MILK] });
    await seedLine(ids.office, 'Milk', { itemIds: [MILK] });

    const result = await lists.holdingItem({
      userId: ids.shopper,
      itemId: MILK,
      excludeListId: ids.home,
    });

    expect(result.lists.map((row) => row.listId)).toEqual([ids.office]);
  });

  it('never names a list in a zone the caller is not in', async () => {
    await seedLine(ids.stranger, 'Milk', { itemIds: [MILK] });

    const result = await lists.holdingItem({
      userId: ids.shopper,
      itemId: MILK,
    });

    // The whole of the authorization is this predicate, applied per row at
    // request time. An empty answer here is the point of the test.
    expect(result.lists).toEqual([]);
  });

  it('does not name a list the caller has no READ on', async () => {
    // A member with an access row that grants nothing on `hidden`. The zone
    // staff shortcut is what would otherwise hide this bug, so the reader is an
    // ordinary MEMBER rather than the owner.
    const reader = randomUUID();
    const membership = await dataSource.getRepository(ZoneMembership).save(
      dataSource.getRepository(ZoneMembership).create({
        zoneId: ids.homeZone,
        userId: reader,
        username: 'Reader',
        role: ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      })
    );
    await dataSource.getRepository(ListAccess).save(
      dataSource.getRepository(ListAccess).create({
        listId: ids.home,
        membershipId: membership.id,
        permissions: [ListPermission.READ],
      })
    );
    await seedLine(ids.home, 'Milk', { itemIds: [MILK] });
    await seedLine(ids.hidden, 'Milk', { itemIds: [MILK] });

    const result = await lists.holdingItem({ userId: reader, itemId: MILK });

    expect(result.lists.map((row) => row.listId)).toEqual([ids.home]);
  });

  it('ignores a line the household does not currently want', async () => {
    // Zero is stocked, not deleted: the household knows about it and does not
    // need it, which is the same rule a generation run applies.
    await seedLine(ids.home, 'Milk', { quantity: 0, itemIds: [MILK] });

    expect(
      (await lists.holdingItem({ userId: ids.shopper, itemId: MILK })).lists
    ).toEqual([]);
  });

  it('ignores a line nobody has agreed to yet, and one that was refused', async () => {
    await seedLine(ids.home, 'Milk', {
      approvalStatus: LineApprovalStatus.PENDING,
      itemIds: [MILK],
    });
    await seedLine(ids.office, 'Milk', {
      approvalStatus: LineApprovalStatus.REJECTED,
      itemIds: [MILK],
    });

    expect(
      (await lists.holdingItem({ userId: ids.shopper, itemId: MILK })).lists
    ).toEqual([]);
  });

  it('reports a list once however many of its lines carry the product', async () => {
    await seedLine(ids.home, 'Milk', { quantity: 1, itemIds: [MILK] });
    await seedLine(ids.home, 'More milk', { quantity: 3, itemIds: [MILK] });

    const result = await lists.holdingItem({
      userId: ids.shopper,
      itemId: MILK,
    });

    expect(result.lists).toHaveLength(1);
    // The largest single outstanding line, not a sum: two lines wanting two each
    // is not a household wanting four of one thing.
    expect(result.lists[0].quantity).toBe(3);
  });

  it('matches on the product and not on what the line says', async () => {
    // The whole reason a line has products: the same thing under another name.
    await seedLine(ids.home, 'Leche entera', { itemIds: [MILK] });
    await seedLine(ids.office, 'Pan', { itemIds: [BREAD] });

    const result = await lists.holdingItem({
      userId: ids.shopper,
      itemId: MILK,
    });

    expect(result.lists.map((row) => row.listId)).toEqual([ids.home]);
  });

  it('answers nothing found for a product no list wants', async () => {
    await seedLine(ids.home, 'Milk', { itemIds: [MILK] });

    const result = await lists.holdingItem({
      userId: ids.shopper,
      itemId: BREAD,
    });

    // Empty and real, which is what the client could not previously tell apart
    // from not having asked.
    expect(result).toEqual({ lists: [], hasMore: false });
  });
});
