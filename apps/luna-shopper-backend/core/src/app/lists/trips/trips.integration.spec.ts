import {
  BasketKind,
  GeneratedLineOrigin,
  GeneratedListStatus,
  MembershipStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  TripKind,
  TripRowOutcome,
  ZoneRole,
  ZoneStatus,
  type TripView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  BasketSource,
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
  GeneratedListParticipant,
  LineSettlement,
  ListAccess,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';
import { GeneratedListService } from '../../generated-lists/generated-list.service';
import { fakeLineClaims } from '../../generated-lists/line-claims.fake';
import { ZoneAuthzService } from '../../zones/zone-authz.service';
import { ListAccessService } from '../list-access.service';
import { tripListsOfBasket } from './trips.announce';
import { TripsService } from './trips.service';

/** The claim window the spec runs under: sixty hours, the shipped default. */
const WINDOW_MS = 60 * 60 * 60 * 1000;

/**
 * The trips of a zone list, against real Postgres (plan 0122, section 8).
 *
 * Every rule in this plan is a `WHERE`, a `GROUP BY` or a window function, so a
 * mocked repository would agree with whatever the SQL said. What has to be
 * proven is which rows come back: that one zone line is one row however many
 * basket lines fed it, that a session is elapsed time and never a calendar day,
 * that a purchase of a deleted basket lands in a loose trip, and that paging the
 * union of two tables visits every trip once.
 *
 * One zone for the whole file, and **a fresh list per test**, so no test has to
 * clean up after another and the counts a test asserts are its own.
 */
describeIntegration('the trips of a zone list (real Postgres)', () => {
  let dataSource: DataSource;
  let trips: TripsService;

  const ids = {
    zone: '',
    /** The shopper's one permanent basket, made on demand. */
    live: '',
    shopper: randomUUID(),
    leaver: randomUUID(),
    stranger: randomUUID(),
  };
  let position = 0;

  async function list(name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId: ids.zone, name, createdByUserId: ids.shopper })
    );
    return saved.id;
  }

  /** A zone line. Positions rise across the file, so creation order is row order. */
  async function line(listId: string, content: string): Promise<string> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity: 5,
        position,
        createdByUserId: ids.shopper,
      })
    );
    return saved.id;
  }

  async function basket(
    options: {
      name?: string | null;
      status?: GeneratedListStatus;
      generatedAt?: Date;
      kind?: BasketKind;
    } = {}
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        name: options.name ?? null,
        status: options.status ?? GeneratedListStatus.FINISHED,
        generatedAt: options.generatedAt ?? new Date('2026-01-10T10:00:00Z'),
        kind: options.kind ?? BasketKind.GENERATED,
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    return saved.id;
  }

  async function basketLine(generatedListId: string): Promise<string> {
    const repo = dataSource.getRepository(GeneratedListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        generatedListId,
        content: 'Basket line',
        quantity: 1,
        settledQuantity: 0,
        itemId: null,
        origin: GeneratedLineOrigin.DERIVED,
        targetListId: null,
        position,
      })
    );
    return saved.id;
  }

  /** What one basket line asked of one zone line. */
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

  /**
   * The owner's permanent basket, seeded by hand and shared by the tests that
   * need one (plan 0134, tests 9 and 11).
   *
   * Plan 0136 is what creates them, so there is none to settle through yet, and
   * the shape the database holds is narrow: `uq_generated_lists_live_owner`
   * allows one per owner and `ck_generated_lists_live_shape` requires it to be
   * `OPEN`, unnamed and without an idempotency key (plan 0133, section 2).
   */
  async function liveBasket(): Promise<string> {
    if (ids.live) {
      return ids.live;
    }
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        name: null,
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date('2026-01-10T10:00:00Z'),
        kind: BasketKind.LIVE,
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    ids.live = saved.id;
    return saved.id;
  }

  /**
   * A participant of a basket, so a purchase made through one can name a buyer.
   *
   * `userId` is the account behind it, and null is a guest, who has none (plan
   * 0134, section 4.3).
   */
  async function participant(
    generatedListId: string,
    userId: string | null
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedListParticipant);
    const saved = await repo.save(
      repo.create({
        generatedListId,
        shareLinkId: null,
        kind: userId ? ParticipantKind.REGISTERED : ParticipantKind.GUEST,
        userId,
        displayName: userId ? null : 'Guest',
        username: userId ? 'Shopper' : null,
        guestNumber: userId ? null : 1,
        sessionSecretHash: null,
        userAgent: null,
        joinedAt: new Date('2026-01-10T09:00:00Z'),
        lastSeenAt: new Date('2026-01-10T09:00:00Z'),
        revokedAt: null,
        endedReason: null,
        invitedAt: null,
        invitedByUserId: null,
      })
    );
    return saved.id;
  }

  /**
   * One purchase, at a stated moment so the order is not a race.
   *
   * With a basket it is a basket settle, which names a participant and no user,
   * and it writes both basket columns the way every settle path does (plan 0134,
   * section 3). Without one it is a settle off the list page, which names a user
   * and leaves both null.
   *
   * `basketId` can be passed on its own, which is how a purchase through a `LIVE`
   * basket is seeded before plan 0136 creates one.
   */
  async function settled(
    listId: string,
    lineId: string,
    at: string | Date,
    options: {
      outcome?: SettlementOutcome;
      quantity?: number;
      basketLineId?: string;
      basketId?: string;
      participantId?: string;
      userId?: string;
      reverted?: boolean;
    } = {}
  ): Promise<string> {
    const repo = dataSource.getRepository(LineSettlement);
    const outcome = options.outcome ?? SettlementOutcome.BOUGHT;
    const byBasket =
      options.basketLineId !== undefined || options.basketId !== undefined;
    // A basket line names its basket, so a caller that gave one gets both
    // columns written together, which is what every settle path does.
    const basketId =
      options.basketId ??
      (options.basketLineId
        ? ((
            await dataSource
              .getRepository(GeneratedListLine)
              .findOne({ where: { id: options.basketLineId } })
          )?.generatedListId ?? null)
        : null);
    const saved = await repo.save(
      repo.create({
        lineId,
        listId,
        itemId: null,
        outcome,
        quantity:
          outcome === SettlementOutcome.BOUGHT ? (options.quantity ?? 1) : 0,
        settledByUserId: byBasket ? null : (options.userId ?? ids.shopper),
        settledByParticipantId: byBasket
          ? (options.participantId ?? randomUUID())
          : null,
        settledAt: new Date(at),
        revertedAt: options.reverted ? new Date() : null,
        // A reverted row names who took it back (`ck_line_settlements_revert`).
        revertedByParticipantId: options.reverted ? randomUUID() : null,
        generatedListLineId: options.basketLineId ?? null,
        basketId,
        pricePaidCents: null,
        supermarketLocationId: null,
      })
    );
    return saved.id;
  }

  /** Every ended trip of a list, read a page at a time. */
  async function everyEndedTrip(
    listId: string,
    limit: number
  ): Promise<TripView[]> {
    const seen: TripView[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const answer = await trips.list({
        userId: ids.shopper,
        listId,
        limit,
        cursor,
      });
      seen.push(...answer.items);
      if (!answer.nextCursor) {
        return seen;
      }
      cursor = answer.nextCursor;
    }
    throw new Error('the trips never stopped paging');
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
    trips = new TripsService(dataSource, listAccess, {
      since: () => new Date(Date.now() - WINDOW_MS),
    } as never);

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Trips',
        joinCode: `TRP${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(
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
    await memberships.save([
      memberships.create({
        zoneId: zone.id,
        userId: ids.shopper,
        username: 'Shopper',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      }),
      // Somebody who bought things here and has since been removed.
      memberships.create({
        zoneId: zone.id,
        userId: ids.leaver,
        username: 'Leaver',
        role: ZoneRole.MEMBER,
        status: MembershipStatus.KICKED,
      }),
    ]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Baskets belong to a person and not to a zone, so they go on their own.
      // Lists, lines and their settlements cascade with the zone.
      await dataSource
        .getRepository(GeneratedList)
        .delete({ ownerUserId: ids.shopper });
      if (ids.zone) {
        await dataSource.getRepository(Zone).delete({ id: ids.zone });
      }
      await dataSource.destroy();
    }
  });

  describe('a basket trip (sections 3 and 4)', () => {
    it('is a trip of each list it drew from, with each list’s own counts', async () => {
      const flat = await list('Flat');
      const parents = await list('Parents');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const eggs = await line(parents, 'Eggs');

      const id = await basket({ name: 'Saturday' });
      const first = await basketLine(id);
      const second = await basketLine(id);
      await origin(first, flat, milk, 2);
      await origin(first, parents, eggs, 1);
      await origin(second, flat, bread, 1);
      await settled(flat, milk, '2026-01-10T11:00:00Z', {
        basketLineId: first,
        quantity: 2,
      });

      const ofFlat = await trips.list({ userId: ids.shopper, listId: flat });
      const ofParents = await trips.list({
        userId: ids.shopper,
        listId: parents,
      });

      expect(ofFlat.items).toEqual([
        {
          id,
          kind: TripKind.BASKET,
          name: 'Saturday',
          live: false,
          startedAt: '2026-01-10T10:00:00.000Z',
          lineCount: 2,
          boughtLineCount: 1,
        },
      ]);
      expect(ofParents.items).toEqual([
        expect.objectContaining({ id, lineCount: 1, boughtLineCount: 0 }),
      ]);
    });

    it('answers one row a zone line, over two origins and two sibling basket lines', async () => {
      const flat = await list('Siblings');
      const milk = await line(flat, 'Milk');

      const id = await basket();
      // Plan 0094: two basket lines, each naming one product, fed by one zone
      // line. What the trip asked of the line is both origins together.
      const whole = await basketLine(id);
      const skimmed = await basketLine(id);
      await origin(whole, flat, milk, 2);
      await origin(skimmed, flat, milk, 3);
      await settled(flat, milk, '2026-01-10T11:00:00Z', {
        basketLineId: whole,
        quantity: 2,
      });
      await settled(flat, milk, '2026-01-10T11:05:00Z', {
        basketLineId: skimmed,
        quantity: 1,
      });
      // Taken back on a reopen, so it counts for nothing.
      await settled(flat, milk, '2026-01-10T11:10:00Z', {
        basketLineId: skimmed,
        quantity: 3,
        reverted: true,
      });

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
      });

      expect(page.items).toEqual([
        {
          lineId: milk,
          asked: 5,
          bought: 3,
          left: 2,
          outcome: TripRowOutcome.PARTLY,
          settledByUserId: null,
        },
      ]);
      expect(page.nextCursor).toBeNull();
    });

    it('reads each of the four outcomes, and not available after a partial purchase', async () => {
      const flat = await list('Outcomes');
      const bought = await line(flat, 'Bought');
      const partly = await line(flat, 'Partly');
      const none = await line(flat, 'They had none');
      const untouched = await line(flat, 'Untouched');
      const ranOut = await line(flat, 'Ran out');

      const id = await basket();
      const carrier = await basketLine(id);
      await origin(carrier, flat, bought, 2);
      await origin(carrier, flat, partly, 3);
      await origin(carrier, flat, none, 1);
      await origin(carrier, flat, untouched, 1);
      await origin(carrier, flat, ranOut, 3);

      const at = '2026-01-10T11:00:00Z';
      await settled(flat, bought, at, { basketLineId: carrier, quantity: 2 });
      await settled(flat, partly, at, { basketLineId: carrier, quantity: 1 });
      await settled(flat, none, at, {
        basketLineId: carrier,
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      await settled(flat, ranOut, at, { basketLineId: carrier, quantity: 1 });
      await settled(flat, ranOut, '2026-01-10T12:00:00Z', {
        basketLineId: carrier,
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
      });

      // In the zone line's own order, which is the order they were added in.
      expect(
        page.items.map((row) => [row.lineId, row.outcome, row.bought, row.left])
      ).toEqual([
        [bought, TripRowOutcome.BOUGHT, 2, 0],
        [partly, TripRowOutcome.PARTLY, 1, 2],
        [none, TripRowOutcome.NOT_AVAILABLE, 0, 1],
        [untouched, TripRowOutcome.NOT_BOUGHT, 0, 1],
        [ranOut, TripRowOutcome.NOT_AVAILABLE, 1, 2],
      ]);

      // The head counts the rows that read `BOUGHT`, by the same rule.
      const heads = await trips.list({ userId: ids.shopper, listId: flat });
      expect(heads.items[0]).toMatchObject({
        lineCount: 5,
        boughtLineCount: 1,
      });
    });

    it('pages the rows of a trip by the zone line’s position', async () => {
      const flat = await list('Long trip');
      const id = await basket();
      const carrier = await basketLine(id);
      const lineIds: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const lineId = await line(flat, `Line ${i}`);
        lineIds.push(lineId);
        await origin(carrier, flat, lineId, 1);
      }

      const first = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
        limit: 2,
      });
      const second = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      const third = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
        limit: 2,
        cursor: second.nextCursor ?? undefined,
      });

      expect(
        [...first.items, ...second.items, ...third.items].map(
          (row) => row.lineId
        )
      ).toEqual(lineIds);
      expect(third.nextCursor).toBeNull();
    });
  });

  describe('a purchase belongs to the basket, not to its line (plan 0134)', () => {
    it('keeps a purchase in the basket’s trip after the basket line is deleted', async () => {
      // The consequence section 4.1 calls new and wanted. Taking a line out of a
      // basket that still exists used to drop its purchases into a session,
      // because the test was "the basket line exists". They stay where they were
      // made, as a row that was bought and is no longer asked.
      const flat = await list('Line taken out');
      const milk = await line(flat, 'Milk');

      const id = await basket({ name: 'Saturday' });
      const carrier = await basketLine(id);
      await origin(carrier, flat, milk, 2);
      await settled(flat, milk, '2026-01-10T11:00:00Z', {
        basketLineId: carrier,
        quantity: 2,
      });

      await dataSource.getRepository(GeneratedListLine).delete({ id: carrier });

      const heads = await trips.list({ userId: ids.shopper, listId: flat });
      expect(heads.items).toEqual([
        expect.objectContaining({
          id,
          kind: TripKind.BASKET,
          lineCount: 1,
          boughtLineCount: 1,
        }),
      ]);

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
      });
      // Nothing asked, because the origins went with the line, and two bought.
      expect(page.items).toEqual([
        {
          lineId: milk,
          asked: 0,
          bought: 2,
          left: 0,
          outcome: TripRowOutcome.BOUGHT,
          settledByUserId: null,
        },
      ]);
    });

    it('reads one basket’s purchases where two bought the same zone line', async () => {
      // The `bought` half is narrowed by the settlement's own `basketId` now and
      // no longer by a join through the basket line (section 4.2), so the
      // parameter has to reach the right half of the statement.
      const flat = await list('Two baskets');
      const milk = await line(flat, 'Milk');

      const mine = await basket({ name: 'Mine' });
      const theirs = await basket({ name: 'Theirs' });
      const myLine = await basketLine(mine);
      const theirLine = await basketLine(theirs);
      await origin(myLine, flat, milk, 2);
      await origin(theirLine, flat, milk, 5);
      await settled(flat, milk, '2026-01-10T11:00:00Z', {
        basketLineId: myLine,
        quantity: 2,
      });
      await settled(flat, milk, '2026-01-10T11:30:00Z', {
        basketLineId: theirLine,
        quantity: 4,
      });

      const ofMine = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: mine,
      });
      const ofTheirs = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: theirs,
      });

      expect(ofMine.items).toEqual([
        expect.objectContaining({ lineId: milk, asked: 2, bought: 2 }),
      ]);
      expect(ofTheirs.items).toEqual([
        expect.objectContaining({ lineId: milk, asked: 5, bought: 4 }),
      ]);
    });
  });

  describe('a loose trip (section 3)', () => {
    it('groups purchases made by hand by a six hour gap, and never by the calendar', async () => {
      const flat = await list('By hand');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');

      const morning = await settled(flat, milk, '2026-03-01T10:00:00Z');
      // Five hours on: the same trip.
      await settled(flat, bread, '2026-03-01T15:00:00Z');
      // Seven hours and a minute after that: the next one.
      const night = await settled(flat, milk, '2026-03-01T22:01:00Z');
      // Either side of midnight UTC and three hours apart: still that one.
      await settled(flat, bread, '2026-03-02T01:00:00Z');

      const heads = await trips.list({ userId: ids.shopper, listId: flat });

      expect(heads.live).toEqual([]);
      expect(heads.items).toEqual([
        {
          id: night,
          kind: TripKind.LOOSE,
          name: null,
          live: false,
          startedAt: '2026-03-01T22:01:00.000Z',
          lineCount: 2,
          boughtLineCount: 2,
        },
        {
          id: morning,
          kind: TripKind.LOOSE,
          name: null,
          live: false,
          startedAt: '2026-03-01T10:00:00.000Z',
          lineCount: 2,
          boughtLineCount: 2,
        },
      ]);
    });

    it('keeps a gap of exactly six hours in one trip', async () => {
      const flat = await list('Exactly six');
      const milk = await line(flat, 'Milk');
      const first = await settled(flat, milk, '2026-03-01T10:00:00Z');
      await settled(flat, milk, '2026-03-01T16:00:00Z');

      const heads = await trips.list({ userId: ids.shopper, listId: flat });

      expect(heads.items.map((trip) => trip.id)).toEqual([first]);
    });

    it('starts the next trip a millisecond past the gap', async () => {
      // The other side of the boundary the contract states once (plan 0134,
      // section 7): only a silence longer than the gap begins a session.
      const flat = await list('Six and one');
      const milk = await line(flat, 'Milk');
      const first = await settled(flat, milk, '2026-03-01T10:00:00Z');
      const next = await settled(flat, milk, '2026-03-01T16:00:00.001Z');

      const heads = await trips.list({ userId: ids.shopper, listId: flat });

      expect(heads.items.map((trip) => trip.id)).toEqual([next, first]);
    });

    it('splits a session when the purchase bridging it is taken back', async () => {
      const flat = await list('Bridge');
      const milk = await line(flat, 'Milk');
      const first = await settled(flat, milk, '2026-03-01T10:00:00Z');
      await settled(flat, milk, '2026-03-01T15:00:00Z', { reverted: true });
      const last = await settled(flat, milk, '2026-03-01T20:00:00Z');

      const heads = await trips.list({ userId: ids.shopper, listId: flat });

      expect(heads.items.map((trip) => trip.id)).toEqual([last, first]);
    });

    it('answers a row a line, with the latest buyer while they are still in the zone', async () => {
      const flat = await list('Loose rows');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const eggs = await line(flat, 'Eggs');

      const first = await settled(flat, milk, '2026-03-01T10:00:00Z', {
        quantity: 2,
      });
      await settled(flat, milk, '2026-03-01T10:30:00Z', { quantity: 1 });
      await settled(flat, bread, '2026-03-01T10:40:00Z', {
        userId: ids.leaver,
      });
      await settled(flat, eggs, '2026-03-01T10:50:00Z', {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.LOOSE,
        tripId: first,
      });

      expect(page.items).toEqual([
        {
          lineId: milk,
          asked: null,
          bought: 3,
          left: null,
          outcome: TripRowOutcome.BOUGHT,
          settledByUserId: ids.shopper,
        },
        {
          lineId: bread,
          asked: null,
          bought: 1,
          left: null,
          outcome: TripRowOutcome.BOUGHT,
          // Removed from the zone since, so nobody the reader can resolve.
          settledByUserId: null,
        },
        {
          lineId: eggs,
          asked: null,
          bought: 0,
          left: null,
          outcome: TripRowOutcome.NOT_AVAILABLE,
          settledByUserId: ids.shopper,
        },
      ]);
    });

    it('takes in the purchases of a deleted basket, with nothing asked', async () => {
      const flat = await list('Deleted basket');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      const carrier = await basketLine(id);
      await origin(carrier, flat, milk, 4);
      const purchase = await settled(flat, milk, '2026-01-10T11:00:00Z', {
        basketLineId: carrier,
        quantity: 2,
      });

      await dataSource.getRepository(GeneratedList).delete({ id });

      const heads = await trips.list({ userId: ids.shopper, listId: flat });
      expect(heads.items).toEqual([
        expect.objectContaining({
          id: purchase,
          kind: TripKind.LOOSE,
          name: null,
          lineCount: 1,
          boughtLineCount: 1,
        }),
      ]);

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.LOOSE,
        tripId: purchase,
      });
      expect(page.items).toEqual([
        {
          lineId: milk,
          asked: null,
          bought: 2,
          left: null,
          outcome: TripRowOutcome.BOUGHT,
          // A basket settle names a participant and no user.
          settledByUserId: null,
        },
      ]);

      // And the basket is no trip of the list any more.
      await expect(
        trips.rows({
          userId: ids.shopper,
          listId: flat,
          kind: TripKind.BASKET,
          tripId: id,
        })
      ).rejects.toThrow('Trip not found');
    });

    it('takes in a purchase made through the permanent basket', async () => {
      // Plan 0130 sections 3 and 9: the permanent basket never ends, so counting
      // it as a trip would give the list one endless trip. Its purchases are
      // session purchases, and they fold with a purchase made by hand.
      const flat = await list('Live basket');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');

      const live = await liveBasket();
      const first = await settled(flat, milk, '2026-03-01T10:00:00Z', {
        basketId: live,
        quantity: 2,
      });
      await settled(flat, bread, '2026-03-01T15:00:00Z');

      const heads = await trips.list({ userId: ids.shopper, listId: flat });

      expect(heads.items).toEqual([
        expect.objectContaining({
          id: first,
          kind: TripKind.LOOSE,
          lineCount: 2,
        }),
      ]);
    });

    it('names the account behind the participant who bought through a basket', async () => {
      // Section 4.3. A basket settle leaves `settledByUserId` null and names a
      // participant, so a session purchase made through one reads its buyer
      // through that participant, under the same zone membership gate.
      const flat = await list('Buyer through a basket');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const eggs = await line(flat, 'Eggs');

      const live = await liveBasket();
      const mine = await participant(live, ids.shopper);
      const leaver = await participant(live, ids.leaver);
      const guest = await participant(live, null);

      const first = await settled(flat, milk, '2026-03-01T10:00:00Z', {
        basketId: live,
        participantId: mine,
      });
      await settled(flat, bread, '2026-03-01T10:10:00Z', {
        basketId: live,
        participantId: leaver,
      });
      await settled(flat, eggs, '2026-03-01T10:20:00Z', {
        basketId: live,
        participantId: guest,
      });

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.LOOSE,
        tripId: first,
      });

      expect(
        page.items.map((row) => [row.lineId, row.settledByUserId])
      ).toEqual([
        [milk, ids.shopper],
        // Removed from the zone since, so nobody the reader can resolve.
        [bread, null],
        // A guest has no account at all.
        [eggs, null],
      ]);
    });
  });

  describe('a line that no longer exists (section 3)', () => {
    it('skips the row, and drops a trip left with no line', async () => {
      const flat = await list('Deleted lines');
      const kept = await line(flat, 'Kept');
      const gone = await line(flat, 'Gone');
      const alone = await line(flat, 'Alone');

      const two = await basket({ name: 'Two lines' });
      const carrier = await basketLine(two);
      await origin(carrier, flat, kept, 1);
      await origin(carrier, flat, gone, 1);

      const one = await basket({ name: 'One line' });
      const lonely = await basketLine(one);
      await origin(lonely, flat, alone, 1);

      await dataSource.getRepository(ListLine).delete({ id: gone });
      await dataSource.getRepository(ListLine).delete({ id: alone });

      const heads = await trips.list({ userId: ids.shopper, listId: flat });
      expect(heads.items).toEqual([
        expect.objectContaining({ id: two, lineCount: 1 }),
      ]);

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: two,
      });
      expect(page.items.map((row) => row.lineId)).toEqual([kept]);

      await expect(
        trips.rows({
          userId: ids.shopper,
          listId: flat,
          kind: TripKind.BASKET,
          tripId: one,
        })
      ).rejects.toThrow('Trip not found');
    });

    it('does the same for a line soft deleted rather than removed', async () => {
      // Since plan 0132 a member's delete keeps the row, so the sentence this
      // section states ("a purchase whose line was deleted is skipped, and a
      // trip left with no line is not returned") has to hold for a row that is
      // still there. It holds because each read of `list_lines` here carries
      // `"deletedAt" IS NULL` by hand; the join alone no longer does it.
      const flat = await list('Soft deleted lines');
      const kept = await line(flat, 'Kept');
      const gone = await line(flat, 'Gone');
      const alone = await line(flat, 'Alone');

      const two = await basket({ name: 'Two lines' });
      const carrier = await basketLine(two);
      await origin(carrier, flat, kept, 1);
      await origin(carrier, flat, gone, 1);
      await settled(flat, gone, '2026-01-10T11:00:00Z', {
        basketLineId: carrier,
        quantity: 1,
      });

      const one = await basket({ name: 'One line' });
      const lonely = await basketLine(one);
      await origin(lonely, flat, alone, 1);

      const repo = dataSource.getRepository(ListLine);
      await repo.softDelete({ id: gone });
      await repo.softDelete({ id: alone });

      const heads = await trips.list({ userId: ids.shopper, listId: flat });
      expect(heads.items).toEqual([
        expect.objectContaining({ id: two, lineCount: 1 }),
      ]);

      const page = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: two,
      });
      expect(page.items.map((row) => row.lineId)).toEqual([kept]);

      await expect(
        trips.rows({
          userId: ids.shopper,
          listId: flat,
          kind: TripKind.BASKET,
          tripId: one,
        })
      ).rejects.toThrow('Trip not found');
    });

    it('pages on from a cursor naming a line deleted since', async () => {
      // The keyset lookup carries no predicate on purpose (plan 0132, section
      // 4.2). It reads the boundary row's position, and a deleted line that
      // could not give one up would restart the page from the top.
      const flat = await list('Cursor over a tombstone');
      const id = await basket();
      const carrier = await basketLine(id);
      const lineIds: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const lineId = await line(flat, `Line ${i}`);
        lineIds.push(lineId);
        await origin(carrier, flat, lineId, 1);
      }

      const first = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
        limit: 2,
      });
      expect(first.items.map((row) => row.lineId)).toEqual(lineIds.slice(0, 2));

      // The line the cursor names goes between the two pages.
      await dataSource.getRepository(ListLine).softDelete({ id: lineIds[1] });

      const second = await trips.rows({
        userId: ids.shopper,
        listId: flat,
        kind: TripKind.BASKET,
        tripId: id,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });

      expect(second.items.map((row) => row.lineId)).toEqual(lineIds.slice(2));
    });

    it('answers not found for a trip that never existed', async () => {
      const flat = await list('Nothing here');

      await expect(
        trips.rows({
          userId: ids.shopper,
          listId: flat,
          kind: TripKind.LOOSE,
          tripId: randomUUID(),
        })
      ).rejects.toThrow('Trip not found');
      await expect(
        trips.rows({
          userId: ids.shopper,
          listId: flat,
          kind: TripKind.BASKET,
          tripId: 'not-an-id',
        })
      ).rejects.toThrow('Trip not found');
    });
  });

  describe('live trips (section 2)', () => {
    it('holds a live basket inside the window, and rides on the first response only', async () => {
      const flat = await list('Live');
      const milk = await line(flat, 'Milk');

      const now = new Date();
      const inside = await basket({
        name: 'Out now',
        status: GeneratedListStatus.OPEN,
        generatedAt: now,
      });
      // Still `DRAFT`, because the sweep has not reached it, and past the
      // window: it claims nothing, so it is not live.
      const outside = await basket({
        name: 'Forgotten',
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date(now.getTime() - WINDOW_MS - 60_000),
      });
      const finished = await basket({
        name: 'Finished today',
        status: GeneratedListStatus.FINISHED,
        generatedAt: new Date(now.getTime() - 60_000),
      });
      for (const id of [inside, outside, finished]) {
        await origin(await basketLine(id), flat, milk, 1);
      }

      const first = await trips.list({
        userId: ids.shopper,
        listId: flat,
        limit: 1,
      });

      expect(first.live.map((trip) => [trip.id, trip.live])).toEqual([
        [inside, true],
      ]);
      expect(first.items.map((trip) => [trip.id, trip.live])).toEqual([
        [finished, false],
      ]);
      expect(first.nextCursor).not.toBeNull();

      const second = await trips.list({
        userId: ids.shopper,
        listId: flat,
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      });

      expect(second.live).toEqual([]);
      expect(second.items.map((trip) => trip.id)).toEqual([outside]);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('paging the union (section 3)', () => {
    it('visits every trip once where a basket and a session share a startedAt', async () => {
      const flat = await list('Union');
      const milk = await line(flat, 'Milk');

      const older = await settled(flat, milk, '2026-02-01T08:00:00Z');
      const tiedBasket = await basket({ name: 'Tied' });
      await origin(await basketLine(tiedBasket), flat, milk, 1);
      const tiedSession = await settled(flat, milk, '2026-02-10T08:00:00Z');
      const newerBasket = await basket({
        name: 'Newer',
        generatedAt: new Date('2026-02-20T08:00:00Z'),
      });
      await origin(await basketLine(newerBasket), flat, milk, 1);

      // The same moment to the microsecond, and one a millisecond token would
      // round: a cursor carrying an ISO `startedAt` sits below the boundary row
      // and either repeats it or skips its twin.
      const moment = '2026-02-10T08:00:00.000456Z';
      await dataSource.query(
        `UPDATE "generated_lists" SET "generatedAt" = $1::timestamptz WHERE id = $2`,
        [moment, tiedBasket]
      );
      await dataSource.query(
        `UPDATE "line_settlements" SET "settledAt" = $1::timestamptz WHERE id = $2`,
        [moment, tiedSession]
      );

      const seen = await everyEndedTrip(flat, 1);

      // Newest first, and the tie broken by id, descending.
      const tied = [tiedBasket, tiedSession].sort().reverse();
      expect(seen.map((trip) => trip.id)).toEqual([
        newerBasket,
        ...tied,
        older,
      ]);

      // Whatever the page size, the same trips in the same order.
      const byTwo = await everyEndedTrip(flat, 2);
      expect(byTwo.map((trip) => trip.id)).toEqual(seen.map((trip) => trip.id));
    });
  });

  describe('access', () => {
    it('refuses both reads to somebody who cannot read the list', async () => {
      const flat = await list('Private');
      const milk = await line(flat, 'Milk');
      const purchase = await settled(flat, milk, '2026-03-01T10:00:00Z');

      await expect(
        trips.list({ userId: ids.stranger, listId: flat })
      ).rejects.toThrow();
      await expect(
        trips.rows({
          userId: ids.stranger,
          listId: flat,
          kind: TripKind.LOOSE,
          tripId: purchase,
        })
      ).rejects.toThrow();
    });
  });

  describe('the event (section 6)', () => {
    const emitTo = jest.fn();
    let generated: GeneratedListService;

    /** The lists `list.tripsChanged` was addressed to, in order. */
    function announcedLists(): string[] {
      return emitTo.mock.calls
        .filter(([event]) => event === RealtimeEvent.ListTripsChanged)
        .map(([, audience, payload]) => {
          // The list room alone, and a payload that says only which list.
          expect(audience).toEqual({ listId: payload.listId });
          return payload.listId as string;
        });
    }

    beforeAll(() => {
      generated = new GeneratedListService(
        dataSource,
        dataSource.getRepository(GeneratedList),
        dataSource.getRepository(GeneratedListLine),
        dataSource.getRepository(GeneratedListLineOrigin),
        dataSource.getRepository(GeneratedListLineOption),
        dataSource.getRepository(LineSettlement),
        // The run's profile resolution and walk order, which no write here asks.
        undefined as never,
        fakeLineClaims({}).service,
        { emitTo, emitToUsers: jest.fn() } as never,
        undefined as never,
        { liveRegistered: async () => [] } as never,
        dataSource.getRepository(BasketSource)
      );
    });

    beforeEach(() => emitTo.mockClear());

    /** A basket with two lines from one list and one from another. */
    async function basketOverTwoLists(): Promise<{
      id: string;
      flat: string;
      parents: string;
    }> {
      const flat = await list('Event flat');
      const parents = await list('Event parents');
      const id = await basket({ status: GeneratedListStatus.OPEN });
      await origin(await basketLine(id), flat, await line(flat, 'Milk'), 1);
      await origin(await basketLine(id), flat, await line(flat, 'Bread'), 1);
      await origin(
        await basketLine(id),
        parents,
        await line(parents, 'Eggs'),
        1
      );
      return { id, flat, parents };
    }

    it('names each origin list once, however many lines came from it', async () => {
      const { id, flat, parents } = await basketOverTwoLists();

      const lists = await tripListsOfBasket(
        (sql, parameters) => dataSource.query(sql, parameters),
        id
      );

      expect([...lists].sort()).toEqual([flat, parents].sort());
    });

    it('tells each list once when a basket is renamed or changes status', async () => {
      const { id, flat, parents } = await basketOverTwoLists();

      await generated.update({
        userId: ids.shopper,
        generatedListId: id,
        name: 'Renamed',
      });
      expect(announcedLists().sort()).toEqual([flat, parents].sort());

      emitTo.mockClear();
      await generated.update({
        userId: ids.shopper,
        generatedListId: id,
        status: GeneratedListStatus.FINISHED,
      });
      expect(announcedLists().sort()).toEqual([flat, parents].sort());
    });

    it('says nothing when neither the name nor the status moved', async () => {
      const { id, flat } = await basketOverTwoLists();

      await generated.update({
        userId: ids.shopper,
        generatedListId: id,
        defaultTargetListId: flat,
      });

      expect(announcedLists()).toEqual([]);
    });

    it('still knows its lists when the basket is deleted', async () => {
      const { id, flat, parents } = await basketOverTwoLists();

      await generated.delete({ userId: ids.shopper, generatedListId: id });

      expect(announcedLists().sort()).toEqual([flat, parents].sort());
      // The origins went with it, which is why they were read first.
      expect(
        await tripListsOfBasket(
          (sql, parameters) => dataSource.query(sql, parameters),
          id
        )
      ).toEqual([]);
    });
  });
});
