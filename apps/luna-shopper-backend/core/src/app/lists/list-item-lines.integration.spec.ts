import {
  LineApprovalStatus,
  ListPermission,
  LISTS_WITH_ITEM_LINES_LIMITS,
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
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
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
 * "Every list I can read, with its lines that hold this product", against
 * real Postgres (plan 0196, section 3).
 *
 * The read is two statements and every decision in it lives in them: the
 * access test that decides which lists are named, the join that says who is
 * staff, the three conditions that define a line that holds the product, the
 * window that caps the lines of one list, and both orders. A fake that
 * answers rows agrees with any of those being wrong.
 *
 * The fixture is three households. `Alpha` and `Beta` belong to the shopper,
 * so the shopper is staff in both. A member of `Alpha` holds a row on one of
 * its lists and has asked to join `Gamma`, where nobody has let them in yet.
 * Every account is minted for the run, so an answer holds the lists of this
 * fixture and no other.
 */
describeIntegration(
  'the lists and the lines that hold a product (real Postgres)',
  () => {
    let dataSource: DataSource;
    let lists: ListService;

    const MILK = randomUUID();
    const BREAD = randomUUID();
    const users = {
      shopper: randomUUID(),
      member: randomUUID(),
      outsider: randomUUID(),
      hoarder: randomUUID(),
    };
    const ids = {
      alpha: '',
      beta: '',
      gamma: '',
      hoard: '',
      weekly: '',
      pantry: '',
      party: '',
      theirs: '',
    };

    async function seedZone(name: string, ownerUserId: string) {
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
      await seedMembership(zone.id, ownerUserId, ZoneRole.OWNER);
      return zone.id;
    }

    async function seedMembership(
      zoneId: string,
      userId: string,
      role: ZoneRole,
      status = MembershipStatus.APPROVED
    ): Promise<string> {
      const row = await dataSource.getRepository(ZoneMembership).save(
        dataSource.getRepository(ZoneMembership).create({
          zoneId,
          userId,
          username: 'Somebody',
          role,
          status,
        })
      );
      return row.id;
    }

    async function seedList(
      zoneId: string,
      name: string,
      autoApproveLines = false
    ): Promise<string> {
      const list = await dataSource.getRepository(ShoppingList).save(
        dataSource.getRepository(ShoppingList).create({
          zoneId,
          name,
          createdByUserId: users.shopper,
          autoApproveLines,
        })
      );
      return list.id;
    }

    /** One line at a position, holding these products. */
    async function seedLine(
      listId: string,
      content: string,
      options: {
        position?: number;
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
          position: options.position ?? 1,
          createdByUserId: users.shopper,
        })
      );
      for (const [position, itemId] of (options.itemIds ?? [MILK]).entries()) {
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
        new CoreAuditService(dataSource),
        fakeBasketAnnouncer()
      );

      ids.alpha = await seedZone('Alpha', users.shopper);
      ids.beta = await seedZone('Beta', users.shopper);
      ids.gamma = await seedZone('Gamma', users.outsider);

      ids.weekly = await seedList(ids.alpha, 'Weekly shop', true);
      ids.pantry = await seedList(ids.alpha, 'Pantry');
      ids.party = await seedList(ids.beta, 'A party');
      ids.theirs = await seedList(ids.gamma, 'Their list');

      // The member holds a row on one list of Alpha and none on the other,
      // and is still waiting at the door of Gamma.
      const inAlpha = await seedMembership(
        ids.alpha,
        users.member,
        ZoneRole.MEMBER
      );
      await dataSource.getRepository(ListAccess).save(
        dataSource.getRepository(ListAccess).create({
          listId: ids.weekly,
          membershipId: inAlpha,
          // Stored out of the order the answer uses, on purpose.
          permissions: [ListPermission.WRITE, ListPermission.READ],
        })
      );
      await seedMembership(
        ids.gamma,
        users.member,
        ZoneRole.MEMBER,
        MembershipStatus.PENDING
      );
    });

    afterAll(async () => {
      for (const zoneId of [ids.alpha, ids.beta, ids.gamma, ids.hoard]) {
        if (zoneId) {
          // Memberships, lists, lines, their product sets and access rows
          // all cascade from the zone.
          await dataSource.getRepository(Zone).delete({ id: zoneId });
        }
      }
      await dataSource?.destroy();
    });

    beforeEach(async () => {
      // Lines and not the whole fixture, so each test states the contents of
      // its own lists.
      for (const listId of [ids.weekly, ids.pantry, ids.party, ids.theirs]) {
        await dataSource.getRepository(ListLine).delete({ listId });
      }
    });

    const read = (userId: string, itemId: string = MILK) =>
      lists.linesHoldingItem({ userId, itemId });

    it('names a list with its two lines that hold the product, by position', async () => {
      const second = await seedLine(ids.weekly, 'More milk', {
        position: 7,
        quantity: 3,
      });
      const first = await seedLine(ids.weekly, 'Milk', { position: 2 });
      // Another product on the same list is not a line of this answer.
      await seedLine(ids.weekly, 'Bread', { position: 1, itemIds: [BREAD] });

      const result = await read(users.shopper);

      const weekly = result.lists.find((row) => row.listId === ids.weekly);
      expect(weekly?.lines).toEqual([
        {
          id: first,
          content: 'Milk',
          quantity: 1,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
        {
          id: second,
          content: 'More milk',
          quantity: 3,
          approvalStatus: LineApprovalStatus.APPROVED,
        },
      ]);
    });

    it('names a list that holds none of it too, with no lines', async () => {
      await seedLine(ids.weekly, 'Milk');
      await seedLine(ids.pantry, 'Bread', { itemIds: [BREAD] });

      const result = await read(users.shopper);

      // Every readable list, in every zone: by zone name and then list name.
      expect(
        result.lists.map((row) => [row.zoneName, row.name, row.lines.length])
      ).toEqual([
        ['Alpha', 'Pantry', 0],
        ['Alpha', 'Weekly shop', 1],
        ['Beta', 'A party', 0],
      ]);
      expect(result.hasMore).toBe(false);
    });

    it('carries what the sheet draws a row from', async () => {
      const result = await read(users.shopper);

      expect(result.lists.find((row) => row.listId === ids.weekly)).toEqual({
        listId: ids.weekly,
        name: 'Weekly shop',
        zoneId: ids.alpha,
        zoneName: 'Alpha',
        autoApproveLines: true,
        myPermissions: [
          ListPermission.READ,
          ListPermission.WRITE,
          ListPermission.DECIDE,
          ListPermission.MANAGE,
        ],
        lines: [],
      });
      expect(
        result.lists.find((row) => row.listId === ids.pantry)?.autoApproveLines
      ).toBe(false);
    });

    it('gives staff all four and a member the row they hold, in one order', async () => {
      await seedLine(ids.weekly, 'Milk');

      const asMember = await read(users.member);

      // The one list the member holds a row on. `Pantry` is in the same
      // zone, and the member cannot read it.
      expect(asMember.lists.map((row) => row.listId)).toEqual([ids.weekly]);
      expect(asMember.lists[0].myPermissions).toEqual([
        ListPermission.READ,
        ListPermission.WRITE,
      ]);
      expect(asMember.lists[0].lines).toHaveLength(1);
    });

    it('never names a list of a zone the caller is not in', async () => {
      await seedLine(ids.theirs, 'Milk');

      const result = await read(users.shopper);

      expect(result.lists.map((row) => row.listId)).not.toContain(ids.theirs);
    });

    it('names no list of a zone where the membership is pending', async () => {
      await seedLine(ids.theirs, 'Milk');

      const result = await read(users.member);

      // The member asked to join Gamma and nobody answered. Until somebody
      // does, Gamma gives them nothing.
      expect(result.lists.map((row) => row.zoneId)).toEqual([ids.alpha]);
    });

    it('leaves out a rejected line, and keeps a pending one and one at zero', async () => {
      await seedLine(ids.weekly, 'Refused', {
        position: 1,
        approvalStatus: LineApprovalStatus.REJECTED,
      });
      const pending = await seedLine(ids.weekly, 'Asked for', {
        position: 2,
        approvalStatus: LineApprovalStatus.PENDING,
      });
      const zero = await seedLine(ids.weekly, 'Stocked', {
        position: 3,
        quantity: 0,
      });

      const weekly = (await read(users.shopper)).lists.find(
        (row) => row.listId === ids.weekly
      );

      expect(weekly?.lines.map((line) => line.id)).toEqual([pending, zero]);
      expect(weekly?.lines.map((line) => line.approvalStatus)).toEqual([
        LineApprovalStatus.PENDING,
        LineApprovalStatus.APPROVED,
      ]);
      expect(weekly?.lines[1].quantity).toBe(0);
    });

    it('leaves out a deleted line', async () => {
      const kept = await seedLine(ids.weekly, 'Milk', { position: 1 });
      const gone = await seedLine(ids.weekly, 'Old milk', { position: 2 });
      // A soft delete, as plan 0132 leaves a line: the row stays, marked.
      await dataSource.getRepository(ListLine).softDelete({ id: gone });

      const weekly = (await read(users.shopper)).lists.find(
        (row) => row.listId === ids.weekly
      );

      expect(weekly?.lines.map((line) => line.id)).toEqual([kept]);
    });

    it('holds at most twenty lines of one list, the first by position', async () => {
      const cap = LISTS_WITH_ITEM_LINES_LIMITS.maxLinesPerList;
      const seeded: string[] = [];
      for (let position = 1; position <= cap + 2; position += 1) {
        seeded.push(
          await seedLine(ids.pantry, `Milk ${position}`, { position })
        );
      }

      const pantry = (await read(users.shopper)).lists.find(
        (row) => row.listId === ids.pantry
      );

      expect(pantry?.lines.map((line) => line.id)).toEqual(
        seeded.slice(0, cap)
      );
    });

    it('answers for the product asked about and no other', async () => {
      await seedLine(ids.weekly, 'Milk');

      const result = await read(users.shopper, BREAD);

      // The same lists, because the lists do not depend on the product.
      expect(result.lists).toHaveLength(3);
      expect(result.lists.every((row) => row.lines.length === 0)).toBe(true);
    });

    it('answers no list for somebody who reads none', async () => {
      expect(await read(randomUUID())).toEqual({ lists: [], hasMore: false });
    });

    it('caps the answer at a hundred lists and says that more exist', async () => {
      const cap = LISTS_WITH_ITEM_LINES_LIMITS.maxLists;
      ids.hoard = await seedZone('Hoard', users.hoarder);
      await dataSource.getRepository(ShoppingList).insert(
        Array.from({ length: cap + 1 }, (_, i) => ({
          zoneId: ids.hoard,
          // Zero padded, so the order of the names is the order of the
          // numbers.
          name: `List ${String(i).padStart(3, '0')}`,
          createdByUserId: users.hoarder,
        }))
      );

      const result = await read(users.hoarder);

      expect(result.lists).toHaveLength(cap);
      expect(result.hasMore).toBe(true);
      expect(result.lists[0].name).toBe('List 000');
      expect(result.lists[cap - 1].name).toBe('List 099');
    });

    it('refuses an id that is not an item reference', async () => {
      await expect(read(users.shopper, 'milk')).rejects.toMatchObject({
        code: 'validation_failed',
      });
    });
  }
);
