import {
  ListPermission,
  MembershipStatus,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { ListAccessService } from './list-access.service';
import { SettlementService } from './settlement.service';

/**
 * The two settlement reads, against real Postgres (plan 0047, section 6).
 *
 * Both are things a mocked repository cannot answer. The line's own history is a
 * keyset cursor over `(settledAt, id)`, and the cursor is read back from the
 * boundary row rather than carried in the token precisely because an ISO
 * timestamp is milliseconds and a `timestamptz` is microseconds; a fake with an
 * array of rows would agree with either shape. The cross list history is an
 * access predicate written in raw SQL over three tables, and what it has to get
 * right is which rows it does **not** return.
 *
 * Two people, two zones. The shopper is in both. The stranger is in neither and
 * holds one list of their own, whose purchases of the same product must be
 * invisible to the shopper however many of them there are.
 */
describeIntegration('the settlement history (real Postgres)', () => {
  let dataSource: DataSource;
  let settlements: SettlementService;

  const MILK = randomUUID();
  const ids = {
    zone: '',
    otherZone: '',
    list: '',
    otherList: '',
    strangerZone: '',
    strangerList: '',
    line: '',
    otherLine: '',
    strangerLine: '',
    shopper: randomUUID(),
    stranger: randomUUID(),
  };

  /** A zone the given user owns, with one list and one line on it. */
  async function seedZone(
    name: string,
    ownerUserId: string,
    content: string
  ): Promise<{ zoneId: string; listId: string; lineId: string }> {
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
    const list = await dataSource.getRepository(ShoppingList).save(
      dataSource.getRepository(ShoppingList).create({
        zoneId: zone.id,
        name: `${name} list`,
        createdByUserId: ownerUserId,
      })
    );
    const line = await dataSource.getRepository(ListLine).save(
      dataSource.getRepository(ListLine).create({
        listId: list.id,
        content,
        quantity: 2,
        position: 1,
        createdByUserId: ownerUserId,
      })
    );
    return { zoneId: zone.id, listId: list.id, lineId: line.id };
  }

  /** One settlement, at a stated moment so the ordering is not a race. */
  async function settlement(
    lineId: string,
    listId: string,
    settledAt: string,
    userId = ids.shopper,
    itemId: string | null = MILK
  ): Promise<LineSettlement> {
    const repo = dataSource.getRepository(LineSettlement);
    return repo.save(
      repo.create({
        lineId,
        listId,
        itemId,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        settledByUserId: userId,
        settledAt: new Date(settledAt),
      })
    );
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(dataSource.getRepository(ZoneMembership))
    );
    settlements = new SettlementService(
      dataSource,
      dataSource.getRepository(LineSettlement),
      listAccess,
      fakeLineClaims().service,
      { emit: jest.fn() } as never
    );

    const home = await seedZone('Home', ids.shopper, 'Milk');
    ids.zone = home.zoneId;
    ids.list = home.listId;
    ids.line = home.lineId;

    const office = await seedZone('Office', ids.shopper, 'Milk');
    ids.otherZone = office.zoneId;
    ids.otherList = office.listId;
    ids.otherLine = office.lineId;

    const theirs = await seedZone('Theirs', ids.stranger, 'Milk');
    ids.strangerZone = theirs.zoneId;
    ids.strangerList = theirs.listId;
    ids.strangerLine = theirs.lineId;
  });

  afterAll(async () => {
    for (const zoneId of [ids.zone, ids.otherZone, ids.strangerZone]) {
      if (zoneId) {
        // Memberships, lists, lines and their settlements all cascade.
        await dataSource.getRepository(Zone).delete({ id: zoneId });
      }
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource
      .getRepository(LineSettlement)
      .delete({ listId: ids.list })
      .then(() =>
        dataSource
          .getRepository(LineSettlement)
          .delete({ listId: ids.otherList })
      )
      .then(() =>
        dataSource
          .getRepository(LineSettlement)
          .delete({ listId: ids.strangerList })
      );
  });

  describe("one line's own history (section 6.1)", () => {
    it('answers newest first', async () => {
      await settlement(ids.line, ids.list, '2026-01-01T10:00:00.000Z');
      await settlement(ids.line, ids.list, '2026-02-01T10:00:00.000Z');
      await settlement(ids.line, ids.list, '2026-03-01T10:00:00.000Z');

      const page = await settlements.listForLine({
        userId: ids.shopper,
        lineId: ids.line,
      });

      expect(page.items.map((s) => s.settledAt)).toEqual([
        '2026-03-01T10:00:00.000Z',
        '2026-02-01T10:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
      ]);
    });

    it('pages without repeating or skipping the boundary row', async () => {
      // The microsecond trap this cursor shape exists for: a token carrying an
      // ISO `settledAt` sits just below the row it names, so the boundary row
      // comes back twice on one order and vanishes on the other.
      const written = [];
      for (let i = 0; i < 5; i += 1) {
        written.push(
          await settlement(
            ids.line,
            ids.list,
            `2026-01-0${i + 1}T10:00:00.000123Z`
          )
        );
      }

      const first = await settlements.listForLine({
        userId: ids.shopper,
        lineId: ids.line,
        limit: 2,
      });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await settlements.listForLine({
        userId: ids.shopper,
        lineId: ids.line,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });

      const seen = [...first.items, ...second.items].map((s) => s.id);
      expect(new Set(seen).size).toBe(4);
      expect(seen).not.toContain(written[0].id);
    });

    it('never serves the basket a purchase came out of', async () => {
      // Section 3.1: the purchase is a zone fact and the basket is not. The
      // column is written and there is no field on the view for it to reach.
      const repo = dataSource.getRepository(LineSettlement);
      await repo.save(
        repo.create({
          lineId: ids.line,
          listId: ids.list,
          itemId: MILK,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          settledByUserId: ids.shopper,
          settledAt: new Date('2026-01-01T10:00:00.000Z'),
          generatedListLineId: randomUUID(),
        })
      );

      const page = await settlements.listForLine({
        userId: ids.shopper,
        lineId: ids.line,
      });

      expect(page.items).toHaveLength(1);
      expect(JSON.stringify(page.items[0])).not.toContain('generatedListLine');
    });

    it('is refused for somebody who cannot read the list', async () => {
      await settlement(ids.line, ids.list, '2026-01-01T10:00:00.000Z');

      await expect(
        settlements.listForLine({ userId: ids.stranger, lineId: ids.line })
      ).rejects.toThrow();
    });
  });

  describe('one product across every readable list (section 6.2)', () => {
    it('spans the zones the caller is in, and stops at the ones they are not', async () => {
      await settlement(ids.line, ids.list, '2026-01-01T10:00:00.000Z');
      await settlement(
        ids.otherLine,
        ids.otherList,
        '2026-02-01T10:00:00.000Z'
      );
      // The stranger buys the same milk on their own list, twice.
      await settlement(
        ids.strangerLine,
        ids.strangerList,
        '2026-03-01T10:00:00.000Z',
        ids.stranger
      );
      await settlement(
        ids.strangerLine,
        ids.strangerList,
        '2026-04-01T10:00:00.000Z',
        ids.stranger
      );

      const page = await settlements.listForItem({
        userId: ids.shopper,
        itemId: MILK,
      });

      expect(page.items.map((s) => s.listId).sort()).toEqual(
        [ids.list, ids.otherList].sort()
      );
    });

    it('drops a list the caller has lost access to, at request time', async () => {
      // The rule everything here uses: a zone you have left takes its history
      // with it (section 9), and it is decided when the question is asked rather
      // than when the purchase happened.
      await settlement(
        ids.otherLine,
        ids.otherList,
        '2026-02-01T10:00:00.000Z'
      );

      const before = await settlements.listForItem({
        userId: ids.shopper,
        itemId: MILK,
      });
      expect(before.items).toHaveLength(1);

      const memberships = dataSource.getRepository(ZoneMembership);
      const membership = await memberships.findOneByOrFail({
        zoneId: ids.otherZone,
        userId: ids.shopper,
      });
      await memberships.save({
        ...membership,
        status: MembershipStatus.KICKED,
      });

      try {
        const after = await settlements.listForItem({
          userId: ids.shopper,
          itemId: MILK,
        });
        expect(after.items).toHaveLength(0);
      } finally {
        await memberships.save(membership);
      }
    });

    it('reaches a list held by an ordinary access row, and not one held by none', async () => {
      // A member rather than staff, which is the branch the raw predicate has of
      // its own: `READ` has to be in the stored set literally.
      const memberships = dataSource.getRepository(ZoneMembership);
      const membership = await memberships.save(
        memberships.create({
          zoneId: ids.strangerZone,
          userId: ids.shopper,
          username: 'Guest',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
      await settlement(
        ids.strangerLine,
        ids.strangerList,
        '2026-03-01T10:00:00.000Z',
        ids.stranger
      );

      try {
        // In the zone, with no row on the list: the zone is not the list.
        const without = await settlements.listForItem({
          userId: ids.shopper,
          itemId: MILK,
        });
        expect(without.items).toHaveLength(0);

        const access = dataSource.getRepository(ListAccess);
        await access.save(
          access.create({
            listId: ids.strangerList,
            membershipId: membership.id,
            permissions: [ListPermission.READ],
          })
        );

        const withRow = await settlements.listForItem({
          userId: ids.shopper,
          itemId: MILK,
        });
        expect(withRow.items).toHaveLength(1);
      } finally {
        await memberships.delete({ id: membership.id });
      }
    });

    it('answers nothing for a product nobody readable has bought', async () => {
      await settlement(ids.line, ids.list, '2026-01-01T10:00:00.000Z');

      const page = await settlements.listForItem({
        userId: ids.shopper,
        itemId: randomUUID(),
      });

      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it('pages the same way the line history does', async () => {
      for (let i = 0; i < 3; i += 1) {
        await settlement(
          ids.line,
          ids.list,
          `2026-01-0${i + 1}T10:00:00.000456Z`
        );
      }

      const first = await settlements.listForItem({
        userId: ids.shopper,
        itemId: MILK,
        limit: 2,
      });
      const second = await settlements.listForItem({
        userId: ids.shopper,
        itemId: MILK,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });

      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.items, ...second.items].map((s) => s.id)).size
      ).toBe(3);
    });
  });

  describe('settling, against a row that is really locked', () => {
    it('lands two concurrent settles without losing either', async () => {
      const lines = dataSource.getRepository(ListLine);
      const line = await lines.save(
        lines.create({
          listId: ids.list,
          content: 'Bread',
          quantity: 4,
          position: 2,
          createdByUserId: ids.shopper,
        })
      );

      await Promise.all([
        settlements.settle({
          userId: ids.shopper,
          lineId: line.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
        }),
        settlements.settle({
          userId: ids.shopper,
          lineId: line.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
        }),
      ]);

      // Two, not one: the read is inside the write, so neither settle computed
      // its new quantity from a row the other had already moved.
      const after = await lines.findOneByOrFail({ id: line.id });
      expect(after.quantity).toBe(2);

      await lines.delete({ id: line.id });
    });
  });
  describe('a purchase with no list is invisible to both reads (plan 0093)', () => {
    // Plan 0093 section 2.2 states this as structural rather than careful: both
    // reads select by `lineId` or join the list through `listId`, and a waiting
    // row has neither. It is asserted here rather than trusted, because the day
    // somebody adds a read over `generatedListLineId` alone is the day a guest's
    // purchase could be named to a household that never received the line.
    const basketLine = randomUUID();

    /** A purchase attached to a basket line and to no list at all. */
    async function waiting(): Promise<LineSettlement> {
      const repo = dataSource.getRepository(LineSettlement);
      return repo.save(
        repo.create({
          lineId: null,
          listId: null,
          itemId: MILK,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 4,
          settledByUserId: null,
          settledByParticipantId: randomUUID(),
          settledAt: new Date('2026-05-01T10:00:00.000Z'),
          generatedListLineId: basketLine,
        })
      );
    }

    afterEach(async () => {
      await dataSource
        .getRepository(LineSettlement)
        .delete({ generatedListLineId: basketLine });
    });

    it("is not in the line's own history, next to a purchase that is", async () => {
      await settlement(ids.line, ids.list, '2026-01-01T10:00:00.000Z');
      const hidden = await waiting();

      const page = await settlements.listForLine({
        userId: ids.shopper,
        lineId: ids.line,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items.map((row) => row.id)).not.toContain(hidden.id);
    });

    it("is not in the product's history across every readable list", async () => {
      await settlement(ids.line, ids.list, '2026-01-01T10:00:00.000Z');
      const hidden = await waiting();

      const page = await settlements.listForItem({
        userId: ids.shopper,
        itemId: MILK,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items.map((row) => row.id)).not.toContain(hidden.id);
    });

    it('is stored all the same, which is the point of writing it', async () => {
      // The failing half of the assertion above would be a purchase that was
      // simply never written, which is the state plan 0093 exists to end.
      const written = await waiting();
      const back = await dataSource
        .getRepository(LineSettlement)
        .findOneByOrFail({ id: written.id });

      expect(back).toMatchObject({
        lineId: null,
        listId: null,
        quantity: 4,
        generatedListLineId: basketLine,
      });
    });
  });
});
