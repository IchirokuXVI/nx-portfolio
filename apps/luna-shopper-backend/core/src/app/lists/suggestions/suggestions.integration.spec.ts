import {
  BasketKind,
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
  BasketSource,
  BasketTripRow,
  CORE_ENTITIES,
  GeneratedList,
  LineSettlement,
  ListAccess,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';
import { BasketTripRowsService } from '../../generated-lists/basket-trip-rows.service';
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
  const tripRows = new BasketTripRowsService();
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
        kind: BasketKind.GENERATED,
        idempotencyKey: null,
      })
    );
    return saved.id;
  }

  /**
   * What a run was asked to draw from (plan 0133, section 4).
   *
   * This is the whole of what an **open** basket holds about a list since plan
   * 0136: a source row naming the zone, or that one list, and the owner's
   * `WRITE` on it. There is no copy of a line to seed any more.
   */
  async function source(
    basketId: string,
    listId: string | null
  ): Promise<void> {
    const repo = dataSource.getRepository(BasketSource);
    await repo.save(repo.create({ basketId, zoneId: ids.zone, listId }));
  }

  /** The freeze that ends a trip (plan 0135), run against the basket's coverage. */
  async function freeze(basketId: string): Promise<void> {
    await tripRows.thaw(dataSource.manager, basketId);
    await tripRows.freeze(dataSource.manager, basketId);
  }

  /**
   * An ended basket that asked for each of these lines, `quantity` of each.
   *
   * The rows are written straight into `basket_trip_rows`, which is what a
   * finish would have written: an ended trip's ask is those rows and nothing
   * else (plan 0135, and plan 0136 section 7.2, which left that half alone).
   * Going through the freeze instead would ask the list as it stands **now**,
   * and every candidate here sits at zero, so a freeze would write no row at
   * all.
   */
  async function endedTrip(
    listId: string,
    at: Date,
    lines: readonly string[],
    quantity = 1
  ): Promise<string> {
    const id = await basket(GeneratedListStatus.FINISHED, at);
    await source(id, listId);
    const rows = dataSource.getRepository(BasketTripRow);
    for (const lineId of lines) {
      await rows.insert({ basketId: id, listId, lineId, asked: quantity });
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
      basketId?: string;
    } = {}
  ): Promise<void> {
    const repo = dataSource.getRepository(LineSettlement);
    const outcome = options.outcome ?? SettlementOutcome.BOUGHT;
    const byBasket = options.basketId !== undefined;
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
        basketId: options.basketId ?? null,
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
      // The candidates read shares the claim's coverage fragment, which carries
      // the skip window since plan 0137. Nothing here skips anything, so the
      // default is the only value it has to be.
      skipWindow: () => 12 * 60 * 60 * 1000,
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
    /**
     * Plan 0136, section 7.3 **widens** this rule, and the widening is asserted
     * below rather than worked around.
     *
     * The hold used to be an origin row naming this zone line, so a live basket
     * held exactly the lines its run had copied into it. A basket holds no copy
     * of a line any more, so the question the candidates read asks is
     * `openBasketCoversLine`: is an open trip looking at this list at all. A
     * candidate is a line **at zero** by definition, which no run would ever
     * have copied, and it is held all the same. That is the intended answer: a
     * shopper standing in the shop with this list open should not be handed the
     * line back as a suggestion behind their back.
     */
    it('holds every candidate on a covered list, at zero and never in any basket, until the trip ends', async () => {
      const flat = await list('Flat');
      const bought = await line(flat, 'Bought in the shop');
      const waiting = await line(flat, 'Never copied into anything');
      await weekly(flat, bought, 6);
      await weekly(flat, waiting, 6);

      const live = await basket(GeneratedListStatus.OPEN, daysAgo(0, -1));
      await source(live, flat);
      // Bought through the basket a moment ago, so this line's own claim has
      // already ended. The coverage holds it regardless, which is the wider
      // question section 7.3 asks.
      await settled(flat, bought, daysAgo(0), { basketId: live });

      expect(await read(flat)).toEqual([]);

      await dataSource
        .getRepository(GeneratedList)
        .update({ id: live }, { status: GeneratedListStatus.FINISHED });
      // The status moved by hand here rather than through the service, so the
      // freeze that ends a trip has to be applied by hand too (plan 0135).
      await freeze(live);

      // The basket settle just now is a new purchase, which starts the period
      // again, so the bought line is no longer due by period. The other still is.
      expect((await read(flat)).map((row) => row.lineId)).toEqual([waiting]);
    });

    it('lets a live basket older than the claim window hold nothing', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);
      const stale = await basket(GeneratedListStatus.OPEN, daysAgo(4));
      await source(stale, flat);

      expect((await read(flat)).map((row) => row.lineId)).toEqual([milk]);
    });

    it('is never held by the permanent basket, which covers every list', async () => {
      // `openBasketCoversLine` joins `basket_sources`, which a `LIVE` basket has
      // none of (plan 0133, section 6). Without that join every list its owner
      // can write would be held for ever and nothing would ever be suggested.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);
      const repo = dataSource.getRepository(GeneratedList);
      await repo.save(
        repo.create({
          ownerUserId: ids.shopper,
          name: null,
          status: GeneratedListStatus.OPEN,
          generatedAt: daysAgo(0, -1),
          kind: BasketKind.LIVE,
          idempotencyKey: null,
        })
      );

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
      // Three purchases a week apart, so the period is 7 and the line is due.
      // The last of them came off the newest basket that asked for milk, which
      // is what keeps that basket the last word on the line (plan 0142,
      // section 8.2).
      await settled(flat, milk, daysAgo(20));
      await settled(flat, milk, daysAgo(13));
      const newest = await endedTrip(flat, daysAgo(6), [milk], 3);
      await settled(flat, milk, daysAgo(6), { basketId: newest });
      // An older basket that asked for a different number is not the newest.
      await endedTrip(flat, daysAgo(20), [milk], 2);
      // A newer basket that asked for something else says nothing about milk.
      const bread = await line(flat, 'Bread', { quantity: 1 });
      await endedTrip(flat, daysAgo(4), [bread], 5);

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, quantity: 3 }),
      ]);
    });

    it('reads what the trip asked as its purchases plus what was left (plan 0136, section 7.2)', async () => {
      // This test asserted plan 0094's sum: two sibling basket lines of one
      // basket each carried a part of one ask, and the trip asked for the
      // total. Those rows are gone with the basket's own, and the sum that
      // replaced them is the freeze's: `asked` is `bought + left`. So a line
      // bought all the way down to zero freezes at what the trip asked for
      // rather than at nothing, and it is still one row per zone line.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket(GeneratedListStatus.FINISHED, daysAgo(6));
      await source(id, flat);
      // Three purchases a week apart, so the period is 7 and the line is due.
      // The last one is the trip's, and it took the line to zero. It is the
      // last one so that the trip is still the last word on the line, which is
      // what plan 0142 section 8.2 makes the estimate ask.
      await settled(flat, milk, daysAgo(20));
      await settled(flat, milk, daysAgo(13));
      await settled(flat, milk, daysAgo(6), { quantity: 3, basketId: id });
      await freeze(id);

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

  /**
   * Both tests here used to delete the trip's origin rows by hand and then read
   * again, to prove the two history reads stood on `basket_trip_rows` alone.
   *
   * Plan 0136 drops that table, so the deletes are gone and what they proved is
   * now structural: there is no second place for an ended trip's ask to come
   * from. The assertions stay, because they are the regression that mattered.
   * An ended trip answers from its frozen rows, for the quantity and for the
   * staple count alike, and a basket seeded here holds nothing but those rows.
   */
  describe('where an ended trip’s ask comes from (plan 0135, test 13)', () => {
    it('reads the quantity off the trip’s frozen rows', async () => {
      const flat = await list('Origins taken away');
      const milk = await line(flat, 'Milk');
      await weekly(flat, milk, 6);
      // Newer than the line's last purchase, which is the other half of plan
      // 0142 section 8.2: a basket that asked after the last shop is still the
      // last word on the line even though nothing was bought off it.
      await endedTrip(flat, daysAgo(4), [milk], 4);

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, quantity: 4 }),
      ]);
    });

    it('counts trips and absences off them too', async () => {
      // The staple rule of plan 0123, section 4, over trips that have nothing
      // but their frozen rows. Which baskets are trips of this list, and which
      // of them asked for the line, both come off `basket_trip_rows`.
      const flat = await list('Staple with no origins');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      // Bought yesterday for the only time: no period, and not due by one.
      await settled(flat, milk, daysAgo(1));
      await endedTrip(flat, daysAgo(22), [milk]);
      await endedTrip(flat, daysAgo(15), [milk]);
      // A trip of this list without milk: one absence, never two in a row.
      await endedTrip(flat, daysAgo(12), [bread]);
      await endedTrip(flat, daysAgo(8), [milk]);
      await endedTrip(flat, daysAgo(2), [milk]);

      expect(await read(flat)).toEqual([
        expect.objectContaining({
          lineId: milk,
          reason: LineSuggestionReason.STAPLE,
          tripsWith: 4,
          tripsSeen: 5,
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
      // A deleted basket takes its trip rows with it, so it is not a trip at
      // all and cannot count as an absence.
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

  /**
   * Plan 0142, section 8: a household that shops without baskets has trips
   * too, and they are its sessions.
   *
   * A session here is written as purchases with no `basketId`, which is what a
   * settle off the list page writes, grouped by the same six hour gap the list
   * page groups them by.
   */
  describe('a session is a trip (plan 0142, section 8.1)', () => {
    /**
     * One session: every line bought at one moment, `daysAgo` days back.
     *
     * The extra lines are what make it a trip at all: a session states only
     * what was bought, so it has to have touched at least
     * `STAPLE_SESSION_MIN_LINES` of the list before its silences mean
     * anything.
     */
    async function session(
      listId: string,
      days: number,
      lines: readonly string[],
      hoursAgo = 0
    ): Promise<void> {
      for (const lineId of lines) {
        await settled(listId, lineId, daysAgo(days, -hoursAgo));
      }
    }

    it('makes a staple of a list whose household never composed a basket', async () => {
      const flat = await list('No baskets at all');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      const eggs = await line(flat, 'Eggs', { quantity: 1 });
      // Four weekly shops, each of three lines. The period is 7 and the last
      // purchase is a day old, so the line is not due by the period: what
      // answers here is the staple rule, over sessions alone.
      for (const days of [22, 15, 8, 1]) {
        await session(flat, days, [milk, bread, eggs]);
      }

      expect(await read(flat)).toEqual([
        expect.objectContaining({
          lineId: milk,
          reason: LineSuggestionReason.STAPLE,
          tripsWith: 4,
          tripsSeen: 4,
        }),
      ]);
    });

    it('says nothing when every session was an errand for one thing', async () => {
      const flat = await list('Errands');
      const milk = await line(flat, 'Milk');
      for (const days of [22, 15, 8, 1]) {
        await session(flat, days, [milk]);
      }

      // Four shops, and not one of them says what the household wanted: they
      // say what was bought. Counting them would make every other line of the
      // list absent from four trips running.
      expect(await read(flat)).toEqual([]);
    });

    it('is not a trip while it is still inside the gap', async () => {
      const flat = await list('Still shopping');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      const eggs = await line(flat, 'Eggs', { quantity: 1 });
      for (const days of [22, 15, 8]) {
        await session(flat, days, [milk, bread, eggs]);
      }
      // A fourth shop an hour ago. Somebody is in the shop, and the lines they
      // have not reached yet are not absences.
      await session(flat, 0, [milk, bread, eggs], 1);

      expect(await read(flat)).toEqual([]);
    });

    it('counts it on the first read after it ends', async () => {
      const flat = await list('Finished shopping');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      const eggs = await line(flat, 'Eggs', { quantity: 1 });
      for (const days of [22, 15, 8]) {
        await session(flat, days, [milk, bread, eggs]);
      }
      // The same shopping, seven hours ago instead of one: the silence since
      // is longer than the gap, so the session is over and is the fourth trip.
      await session(flat, 0, [milk, bread, eggs], 7);

      expect(await read(flat)).toEqual([
        expect.objectContaining({
          lineId: milk,
          reason: LineSuggestionReason.STAPLE,
          tripsWith: 4,
          tripsSeen: 4,
        }),
      ]);
    });

    it('counts a session and a basket as trips of the same list', async () => {
      const flat = await list('Both kinds');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      const eggs = await line(flat, 'Eggs', { quantity: 1 });
      await endedTrip(flat, daysAgo(22), [milk]);
      await endedTrip(flat, daysAgo(15), [milk]);
      await session(flat, 8, [milk, bread, eggs]);
      await session(flat, 1, [milk, bread, eggs]);

      expect(await read(flat)).toEqual([
        expect.objectContaining({
          lineId: milk,
          reason: LineSuggestionReason.STAPLE,
          tripsWith: 4,
          tripsSeen: 4,
        }),
      ]);
    });

    // A purchase belongs to a `GENERATED` basket or to a session and never to
    // both (plan 0134, section 4.1), so the union cannot count one shop twice.
    it('does not count a basket’s own purchases as a session as well', async () => {
      const flat = await list('No double counting');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread', { quantity: 1 });
      const eggs = await line(flat, 'Eggs', { quantity: 1 });
      for (const days of [22, 15, 8, 1]) {
        const trip = await endedTrip(flat, daysAgo(days), [milk]);
        for (const lineId of [milk, bread, eggs]) {
          await settled(flat, lineId, daysAgo(days), { basketId: trip });
        }
      }

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, tripsSeen: 4 }),
      ]);
    });
  });

  describe('the quantity when a session came later (plan 0142, section 8.2)', () => {
    it('follows the basket trip when the line was last bought on it', async () => {
      const flat = await list('Bought on the basket');
      const milk = await line(flat, 'Milk');
      await settled(flat, milk, daysAgo(20), { quantity: 1 });
      await settled(flat, milk, daysAgo(13), { quantity: 1 });
      const trip = await endedTrip(flat, daysAgo(6), [milk], 3);
      await settled(flat, milk, daysAgo(6), { quantity: 1, basketId: trip });

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, quantity: 3 }),
      ]);
    });

    // Without this the basket would decide the quantity for ever, because a
    // session asks for nothing and so can never replace the number.
    it('follows the last purchase when a newer session bought a different number', async () => {
      const flat = await list('Bought off the list page since');
      const milk = await line(flat, 'Milk');
      const trip = await endedTrip(flat, daysAgo(20), [milk], 3);
      await settled(flat, milk, daysAgo(20), { quantity: 3, basketId: trip });
      await settled(flat, milk, daysAgo(13), { quantity: 2 });
      await settled(flat, milk, daysAgo(6), { quantity: 2 });

      expect(await read(flat)).toEqual([
        expect.objectContaining({ lineId: milk, quantity: 2 }),
      ]);
    });
  });

  describe('every due line, in order (test 11, amended by plan 0125)', () => {
    it('answers all twenty five due lines, the most overdue first', async () => {
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

      expect(rows).toHaveLength(25);
      expect(rows.map((row) => row.lineId)).toEqual(byOverdue);
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
