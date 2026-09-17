import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  LineApprovalStatus,
  LineSuggestionReason,
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
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOrigin,
  LineSettlement,
  ListAccess,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';
import { ZoneAuthzService } from '../../zones/zone-authz.service';
import { ListAccessService } from '../list-access.service';
import { DAY_MS } from './suggestions.constants';
import { SuggestionsService } from './suggestions.service';

/** The claim window the spec runs under: sixty hours, the shipped default. */
const WINDOW_MS = 60 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The lines a list suggests, against real Postgres (plan 0123, section 7, tests 7
 * to 12).
 *
 * Which lines are candidates, what counts as a purchase and which baskets are
 * trips of the list are all `WHERE` clauses, so a mocked repository would agree
 * with whatever the SQL said.
 *
 * **No calendar date appears here.** Every instant is `daysAgo` from the moment
 * the test runs, so nothing in this file can start failing on a particular day.
 * One zone for the file and a fresh list per test, so each count is its own.
 */
describeIntegration('the lines a list suggests (real Postgres)', () => {
  let dataSource: DataSource;
  let suggestions: SuggestionsService;

  const ids = {
    zone: '',
    shopper: randomUUID(),
    stranger: randomUUID(),
  };
  let position = 0;

  function daysAgo(days: number, hours = 0): Date {
    return new Date(Date.now() - days * DAY_MS + hours * HOUR_MS);
  }

  async function list(name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId: ids.zone, name, createdByUserId: ids.shopper })
    );
    return saved.id;
  }

  /** A zone line, at zero and approved unless the test says otherwise. */
  async function line(
    listId: string,
    content: string,
    options: { quantity?: number; approvalStatus?: LineApprovalStatus } = {}
  ): Promise<string> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity: options.quantity ?? 0,
        approvalStatus: options.approvalStatus ?? LineApprovalStatus.APPROVED,
        position,
        createdByUserId: ids.shopper,
      })
    );
    return saved.id;
  }

  async function basket(
    status: GeneratedListStatus,
    generatedAt: Date
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        name: null,
        status,
        generatedAt,
        sourceSnapshot: {
          profileId: null,
          pricingProfileId: null,
          sources: [],
        },
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    return saved.id;
  }

  async function basketLine(
    generatedListId: string,
    quantity = 1,
    settledQuantity = 0
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        generatedListId,
        content: 'Basket line',
        quantity,
        settledQuantity,
        itemId: null,
        origin: GeneratedLineOrigin.DERIVED,
        targetListId: null,
        position,
      })
    );
    return saved.id;
  }

  async function origin(
    generatedListLineId: string,
    listId: string,
    lineId: string,
    quantity: number
  ): Promise<void> {
    const repo = dataSource.getRepository(GeneratedListLineOrigin);
    await repo.save(
      repo.create({
        generatedListLineId,
        zoneId: ids.zone,
        listId,
        lineId,
        quantity,
        lineVersion: 1,
      })
    );
  }

  /** An ended basket that asked for each of these lines, `quantity` of each. */
  async function endedTrip(
    listId: string,
    at: Date,
    lines: readonly string[],
    quantity = 1
  ): Promise<string> {
    const id = await basket(GeneratedListStatus.COMPLETED, at);
    const basketLineId = await basketLine(id, quantity);
    for (const lineId of lines) {
      await origin(basketLineId, listId, lineId, quantity);
    }
    return id;
  }

  async function settled(
    listId: string,
    lineId: string,
    at: Date,
    options: {
      outcome?: SettlementOutcome;
      quantity?: number;
      reverted?: boolean;
      basketLineId?: string;
    } = {}
  ): Promise<void> {
    const repo = dataSource.getRepository(LineSettlement);
    const outcome = options.outcome ?? SettlementOutcome.BOUGHT;
    const byBasket = options.basketLineId !== undefined;
    await repo.save(
      repo.create({
        lineId,
        listId,
        itemId: null,
        outcome,
        quantity:
          outcome === SettlementOutcome.BOUGHT ? (options.quantity ?? 1) : 0,
        settledByUserId: byBasket ? null : ids.shopper,
        settledByParticipantId: byBasket ? randomUUID() : null,
        settledAt: at,
        revertedAt: options.reverted ? new Date() : null,
        revertedByParticipantId: options.reverted ? randomUUID() : null,
        generatedListLineId: options.basketLineId ?? null,
        pricePaidCents: null,
        supermarketLocationId: null,
      })
    );
  }

  /**
   * A weekly history whose last purchase was `lastDaysAgo` days ago: three
   * purchases a week apart, so the period is 7, the window 2, and the line is
   * due from 5 days on.
   */
  async function weekly(
    listId: string,
    lineId: string,
    lastDaysAgo: number
  ): Promise<void> {
    for (const weeks of [2, 1, 0]) {
      await settled(listId, lineId, daysAgo(lastDaysAgo + weeks * 7));
    }
  }

  async function read(listId: string) {
    return (await suggestions.list({ userId: ids.shopper, listId })).items;
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
    suggestions = new SuggestionsService(dataSource, listAccess, {
      since: () => new Date(Date.now() - WINDOW_MS),
    } as never);

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Suggestions',
        joinCode: `SUG${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(
          0,
          16
        ),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.shopper,
        config: {},
      })
    );
    ids.zone = zone.id;

    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: ids.shopper,
        username: 'Shopper',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource
        .getRepository(GeneratedList)
        .delete({ ownerUserId: ids.shopper });
      if (ids.zone) {
        await dataSource.getRepository(Zone).delete({ id: ids.zone });
      }
      await dataSource.destroy();
    }
  });

  it('suggests a line whose period has come, with its numbers', async () => {
    const flat = await list('Flat');
    const milk = await line(flat, 'Milk');
    await weekly(flat, milk, 6);

    expect(await read(flat)).toEqual([
      {
        lineId: milk,
        reason: LineSuggestionReason.PERIOD,
        periodDays: 7,
        daysSinceBought: 6,
        tripsWith: null,
        tripsSeen: null,
        quantity: 1,
      },
    ]);
  });

  it('does not suggest a line whose period is still far off', async () => {
    const flat = await list('Flat');
    const milk = await line(flat, 'Milk');
    await weekly(flat, milk, 2);

    expect(await read(flat)).toEqual([]);
  });

  describe('a live basket holds a line (test 7)', () => {
    it('hides the line while the basket is live, settled or not, and suggests it once the basket ends', async () => {
      const flat = await list('Flat');
      const bought = await line(flat, 'Bought in the shop');
      const waiting = await line(flat, 'Still in the trolley list');
      await weekly(flat, bought, 6);
      await weekly(flat, waiting, 6);

      const live = await basket(GeneratedListStatus.ACTIVE, daysAgo(0, -1));
      // Settled all the way through, so the claim has already ended.
      const done = await basketLine(live, 1, 1);
      await origin(done, flat, bought, 1);
      await settled(flat, bought, daysAgo(0), { basketLineId: done });
      const open = await basketLine(live, 1, 0);
      await origin(open, flat, waiting, 1);

      expect(await read(flat)).toEqual([]);

      await dataSource
        .getRepository(GeneratedList)
        .update({ id: live }, { status: GeneratedListStatus.COMPLETED });

      // The basket settle just now is a new purchase, which starts the period
      // again, so the bought line is no longer due by period. The other still is.
      expect((await read(flat)).map((row) => row.lineId)).toEqual([waiting]);
    });

    it('lets a live basket older than the claim window hold nothing', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);
      const stale = await basket(GeneratedListStatus.DRAFT, daysAgo(4));
      await origin(await basketLine(stale), flat, milk, 1);

      expect((await read(flat)).map((row) => row.lineId)).toEqual([milk]);
    });
  });

  describe('what a purchase is (test 8)', () => {
    it('does not count NOT_AVAILABLE rows or reverted rows', async () => {
      const flat = await list('Flat');
      const counted = await line(flat, 'Three purchases');
      const unavailable = await line(flat, 'Two purchases and two nones');
      const reverted = await line(flat, 'Two purchases and one taken back');
      const never = await line(flat, 'Only ever none');

      await weekly(flat, counted, 6);

      await settled(flat, unavailable, daysAgo(20));
      await settled(flat, unavailable, daysAgo(13), {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      await settled(flat, unavailable, daysAgo(6, -1), {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      await settled(flat, unavailable, daysAgo(13, 1));

      await settled(flat, reverted, daysAgo(20));
      await settled(flat, reverted, daysAgo(13), { reverted: true });
      await settled(flat, reverted, daysAgo(6));

      await settled(flat, never, daysAgo(20), {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      await settled(flat, never, daysAgo(6), {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });

      expect((await read(flat)).map((row) => row.lineId)).toEqual([counted]);
    });
  });

  describe('which lines are never candidates (test 9)', () => {
    it('never suggests a pending line, a rejected line or a line above zero', async () => {
      const flat = await list('Flat');
      const pending = await line(flat, 'Pending', {
        approvalStatus: LineApprovalStatus.PENDING,
      });
      const rejected = await line(flat, 'Rejected', {
        approvalStatus: LineApprovalStatus.REJECTED,
      });
      const wanted = await line(flat, 'Already wanted', { quantity: 2 });
      const due = await line(flat, 'Due');
      for (const lineId of [pending, rejected, wanted, due]) {
        await weekly(flat, lineId, 6);
      }

      expect((await read(flat)).map((row) => row.lineId)).toEqual([due]);
    });

    it('never suggests a line nobody has bought, however many baskets asked for it', async () => {
      const flat = await list('Flat');
      const unbought = await line(flat, 'Asked and never bought');
      for (const days of [28, 21, 14, 7]) {
        await endedTrip(flat, daysAgo(days), [unbought]);
      }

      expect(await read(flat)).toEqual([]);
    });
  });

  describe('the quantity (test 10)', () => {
    it('follows what the newest ended basket asked for the line', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);
      await endedTrip(flat, daysAgo(20), [milk], 2);
      await endedTrip(flat, daysAgo(13), [milk], 3);
      // A newer basket that asked for something else says nothing about milk.
      const bread = await line(flat, 'Bread', { quantity: 1 });
      await endedTrip(flat, daysAgo(6), [bread], 5);

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, quantity: 3 }),
      ]);
    });

    it('sums sibling basket lines of one basket', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);
      const id = await basket(GeneratedListStatus.COMPLETED, daysAgo(13));
      await origin(await basketLine(id, 2), flat, milk, 2);
      await origin(await basketLine(id, 1), flat, milk, 1);

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, quantity: 3 }),
      ]);
    });

    it('falls back to the units of the last merged purchase', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await settled(flat, milk, daysAgo(20), { quantity: 6 });
      await settled(flat, milk, daysAgo(13), { quantity: 6 });
      // One trip that wrote two rows an hour apart: one purchase of three.
      await settled(flat, milk, daysAgo(6), { quantity: 2 });
      await settled(flat, milk, daysAgo(6, 1), { quantity: 1 });

      expect(await read(flat)).toEqual([
        expect.objectContaining({
          lineId: milk,
          periodDays: 7,
          daysSinceBought: 6,
          quantity: 3,
        }),
      ]);
    });
  });

  describe('the staple rule (section 4)', () => {
    it('suggests a line every recent basket of this list asked for, whatever the clock says', async () => {
      const flat = await list('Flat');
      const other = await list('Pharmacy');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      const plasters = await line(other, 'Plasters', { quantity: 1 });
      // Bought yesterday for the only time: no period, and not due by one.
      await settled(flat, milk, daysAgo(1));

      await endedTrip(flat, daysAgo(22), [milk]);
      await endedTrip(flat, daysAgo(15), [milk]);
      // A trip of this list without milk: one absence, never two in a row.
      await endedTrip(flat, daysAgo(12), [bread]);
      await endedTrip(flat, daysAgo(8), [milk]);
      await endedTrip(flat, daysAgo(2), [milk]);
      // Trips of another list are not trips of this one, so they are no absence.
      await endedTrip(other, daysAgo(5), [plasters]);
      await endedTrip(other, daysAgo(4), [plasters]);
      // A deleted basket has no origins left, so it is not a trip at all.
      const deleted = await endedTrip(flat, daysAgo(3), [bread]);
      await dataSource.getRepository(GeneratedList).delete({ id: deleted });

      expect(await read(flat)).toEqual([
        {
          lineId: milk,
          reason: LineSuggestionReason.STAPLE,
          periodDays: null,
          daysSinceBought: 1,
          tripsWith: 4,
          tripsSeen: 5,
          quantity: 1,
        },
      ]);
    });

    it('answers nothing as a staple below four ended trips', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await settled(flat, milk, daysAgo(1));
      for (const days of [15, 8, 2]) {
        await endedTrip(flat, daysAgo(days), [milk]);
      }

      expect(await read(flat)).toEqual([]);
    });

    it('lets PERIOD win when both rules hold, and puts it first', async () => {
      const flat = await list('Flat');
      const staple = await line(flat, 'Only a staple');
      const both = await line(flat, 'Both');
      await settled(flat, staple, daysAgo(1));
      await weekly(flat, both, 6);
      for (const days of [30, 25, 20, 16]) {
        await endedTrip(flat, daysAgo(days), [staple, both]);
      }

      const rows = await read(flat);

      expect(rows.map((row) => [row.lineId, row.reason])).toEqual([
        [both, LineSuggestionReason.PERIOD],
        [staple, LineSuggestionReason.STAPLE],
      ]);
      expect(rows[0]).toMatchObject({ tripsWith: null, tripsSeen: null });
    });
  });

  describe('the ceiling and the order (test 11)', () => {
    it('answers twenty of twenty five due lines, the most overdue first', async () => {
      const flat = await list('Flat');
      const byOverdue: string[] = [];
      // Created least overdue first, so position order is the reverse of the
      // order the answer must have.
      for (let i = 0; i < 25; i += 1) {
        const lineId = await line(flat, `Due ${i}`);
        await weekly(flat, lineId, 5 + i);
        byOverdue.unshift(lineId);
      }

      const rows = await read(flat);

      expect(rows).toHaveLength(20);
      expect(rows.map((row) => row.lineId)).toEqual(byOverdue.slice(0, 20));
    });
  });

  describe('access (test 12)', () => {
    it('refuses a caller without READ on the list', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);

      await expect(
        suggestions.list({ userId: ids.stranger, listId: flat })
      ).rejects.toThrow();
    });
  });
});
