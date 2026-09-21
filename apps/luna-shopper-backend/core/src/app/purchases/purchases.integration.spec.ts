import {
  BasketKind,
  GeneratedListStatus,
  MembershipStatus,
  ParticipantEndedReason,
  ParticipantKind,
  SettlementOutcome,
  TripKind,
  ZoneRole,
  ZoneStatus,
  type PurchaseEntryView,
} from '@portfolio/luna-shopper/contracts';
import { NotFoundException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListParticipant,
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { SHARED_BASKETS_SQL } from '../generated-lists/generated-list-members.sql';
import { PurchasesService } from './purchases.service';
import { purchaseEntriesSql, type PurchaseEntryRow } from './purchases.sql';

/**
 * What one person bought, against real Postgres (plan 0142, section 12).
 *
 * Every rule in this plan is a `WHERE`, a `UNION` or a window function, so a
 * mocked repository would agree with whatever the SQL said. What has to be
 * proven is which rows come back: that each of the three routes of section 2
 * finds a purchase and that two routes together find it once, that a session is
 * elapsed time across lists and across zones, that the counts and the total add
 * up over a mix of priced, unpriced, unavailable and reverted rows, and that
 * paging the union of two tables visits every entry once.
 *
 * ## A fresh reader per test
 *
 * A history is one **person's** and not one list's, so a purchase written by an
 * earlier test would be in a later test's answer however many fresh lists it
 * made. Every test therefore shops as a new account, approved in both zones by
 * `beforeEach`, and asserts over the whole of that account's history.
 *
 * Two zones for the whole file, because a session crossing zones is one of the
 * things being proven and a session that stopped at a zone boundary would split
 * one shop into two.
 */
describeIntegration('one person’s purchases (real Postgres)', () => {
  let dataSource: DataSource;
  let purchases: PurchasesService;

  /** The account this test shops as. A new one before every test. */
  let reader = '';
  /** Somebody else, with baskets of their own. One for the whole file. */
  const friend = randomUUID();
  /** Every account that owned a basket here, so `afterAll` can delete them. */
  const owners: string[] = [friend];

  const zones = { flat: '', parents: '' };
  let position = 0;

  async function list(zoneId: string, name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId, name, createdByUserId: reader })
    );
    return saved.id;
  }

  /** A zone line. Positions rise across the file, so creation order is row order. */
  async function line(
    listId: string,
    content: string,
    quantity = 5
  ): Promise<string> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity,
        position,
        createdByUserId: reader,
      })
    );
    return saved.id;
  }

  /**
   * A basket, owned by the reader unless the test says otherwise.
   *
   * A `LIVE` basket goes through the same helper: the shape the database allows
   * is narrow (`uq_generated_lists_live_owner` allows one per owner and
   * `ck_generated_lists_live_shape` requires it to be `OPEN`, unnamed and
   * without an idempotency key, plan 0133 section 2), so the caller passes the
   * kind and nothing more.
   */
  async function basket(
    options: {
      name?: string | null;
      status?: GeneratedListStatus;
      generatedAt?: Date;
      kind?: BasketKind;
      ownerUserId?: string;
    } = {}
  ): Promise<string> {
    const kind = options.kind ?? BasketKind.GENERATED;
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: options.ownerUserId ?? reader,
        name: kind === BasketKind.LIVE ? null : (options.name ?? null),
        status:
          kind === BasketKind.LIVE
            ? GeneratedListStatus.OPEN
            : (options.status ?? GeneratedListStatus.FINISHED),
        generatedAt: options.generatedAt ?? new Date('2026-01-10T10:00:00Z'),
        kind,
        idempotencyKey: null,
      })
    );
    return saved.id;
  }

  /** A participant of a basket. `userId` null is a guest, who has no account. */
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
        // A link visitor always carries an expiry
        // (`ck_generated_list_participants_expiry`, plan 0140).
        expiresAt: new Date('2026-01-10T21:00:00Z'),
      })
    );
    return saved.id;
  }

  /**
   * One purchase, at a stated moment so the order is not a race.
   *
   * With a participant it is a basket settle, which names the participant and
   * no user (plan 0051, section 6). Without one it is a settle off the list
   * page, which names a user. `basketId` is stamped on either, because a
   * purchase made through the permanent basket names it and can still have been
   * settled by its owner from the list page.
   */
  async function settled(
    listId: string,
    lineId: string,
    at: string,
    options: {
      outcome?: SettlementOutcome;
      quantity?: number;
      basketId?: string | null;
      participantId?: string;
      userId?: string;
      itemId?: string | null;
      pricePaidCents?: number | null;
      reverted?: boolean;
    } = {}
  ): Promise<string> {
    const repo = dataSource.getRepository(LineSettlement);
    const outcome = options.outcome ?? SettlementOutcome.BOUGHT;
    const byParticipant = options.participantId !== undefined;
    const saved = await repo.save(
      repo.create({
        lineId,
        listId,
        itemId: options.itemId ?? null,
        outcome,
        quantity:
          outcome === SettlementOutcome.BOUGHT ? (options.quantity ?? 1) : 0,
        settledByUserId: byParticipant ? null : (options.userId ?? reader),
        settledByParticipantId: byParticipant
          ? (options.participantId as string)
          : null,
        settledAt: new Date(at),
        revertedAt: options.reverted ? new Date() : null,
        // A reverted row names who took it back (`ck_line_settlements_revert`).
        revertedByParticipantId: options.reverted ? randomUUID() : null,
        basketId: options.basketId ?? null,
        pricePaidCents: options.pricePaidCents ?? null,
        supermarketLocationId: null,
      })
    );
    return saved.id;
  }

  /** Take a purchase back, after the page that saw it was served. */
  async function revert(settlementId: string): Promise<void> {
    await dataSource
      .getRepository(LineSettlement)
      .update(
        { id: settlementId },
        { revertedAt: new Date(), revertedByParticipantId: randomUUID() }
      );
  }

  /** The reader's history in one page, for the tests that do not page. */
  async function entries(): Promise<PurchaseEntryView[]> {
    const answer = await purchases.listSessions({ userId: reader, limit: 100 });
    return answer.items;
  }

  /** The reader's whole history, read `limit` at a time. */
  async function everyEntry(limit: number): Promise<PurchaseEntryView[]> {
    const seen: PurchaseEntryView[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 30; page += 1) {
      const answer = await purchases.listSessions({
        userId: reader,
        limit,
        cursor,
      });
      seen.push(...answer.items);
      if (!answer.nextCursor) {
        return seen;
      }
      cursor = answer.nextCursor;
    }
    throw new Error('the history never stopped paging');
  }

  async function rowsOf(entry: PurchaseEntryView) {
    const answer = await purchases.listSessionRows({
      userId: reader,
      kind: entry.kind,
      entryId: entry.id,
      limit: 100,
    });
    return answer.items;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    purchases = new PurchasesService(dataSource);

    const repo = dataSource.getRepository(Zone);
    for (const [key, name] of [
      ['flat', 'Purchases Flat'],
      ['parents', 'Purchases Parents'],
    ] as const) {
      const saved = await repo.save(
        repo.create({
          name,
          joinCode:
            `PUR${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: friend,
          config: {},
        })
      );
      zones[key] = saved.id;
    }
  });

  beforeEach(async () => {
    reader = randomUUID();
    owners.push(reader);
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      [zones.flat, zones.parents].map((zoneId) =>
        memberships.create({
          zoneId,
          userId: reader,
          username: 'Shopper',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      )
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Baskets belong to a person and not to a zone, so they go on their own.
      // Lists, lines and their settlements cascade with the zone.
      const baskets = dataSource.getRepository(GeneratedList);
      for (const owner of owners) {
        await baskets.delete({ ownerUserId: owner });
      }
      for (const id of [zones.flat, zones.parents]) {
        if (id) {
          await dataSource.getRepository(Zone).delete({ id });
        }
      }
      await dataSource.destroy();
    }
  });

  describe('whose purchases (section 2)', () => {
    it('finds one through a basket the reader owns, bought by somebody else', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket({ name: 'Saturday' });
      const guest = await participant(id, null);
      await settled(flat, milk, '2026-02-01T10:00:00Z', {
        basketId: id,
        participantId: guest,
      });

      expect(await entries()).toEqual([
        expect.objectContaining({ id, kind: TripKind.BASKET }),
      ]);
    });

    it('finds one the reader settled on the list page', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const purchase = await settled(flat, milk, '2026-02-02T10:00:00Z');

      expect(await entries()).toEqual([
        expect.objectContaining({ id: purchase, kind: TripKind.SESSION }),
      ]);
    });

    it('finds one the reader settled on somebody else’s basket, live or ended', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const theirs = await basket({ name: 'Theirs', ownerUserId: friend });
      const me = await participant(theirs, reader);
      const purchase = await settled(flat, milk, '2026-02-03T10:00:00Z', {
        basketId: theirs,
        participantId: me,
      });

      const before = await entries();
      expect(before).toEqual([
        expect.objectContaining({ id: purchase, kind: TripKind.SESSION }),
      ]);

      // Being removed from the basket afterwards does not unbuy the bread. A
      // revoked row names why (`ck_generated_list_participants_ended`).
      await dataSource.getRepository(GeneratedListParticipant).update(
        { id: me },
        {
          revokedAt: new Date(),
          endedReason: ParticipantEndedReason.REMOVED,
        }
      );

      expect(await entries()).toEqual(before);
    });

    it('counts a purchase reachable by two routes once', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      // The reader's own permanent basket, settled by the reader off the list
      // page: routes 1 and 2 both find this one row.
      const live = await basket({ kind: BasketKind.LIVE });
      const purchase = await settled(flat, milk, '2026-02-04T10:00:00Z', {
        basketId: live,
        userId: reader,
      });

      expect(await entries()).toEqual([
        expect.objectContaining({
          id: purchase,
          kind: TripKind.SESSION,
          lineCount: 1,
        }),
      ]);
    });

    it('finds nothing of somebody else’s', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const theirs = await basket({ ownerUserId: friend, name: 'Theirs' });
      const them = await participant(theirs, friend);
      await settled(flat, milk, '2026-02-05T10:00:00Z', {
        basketId: theirs,
        participantId: them,
      });

      expect(await entries()).toEqual([]);
    });
  });

  describe('which entry a purchase is in (section 3.1)', () => {
    it('puts a guest’s purchase on the reader’s permanent basket in a session', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const live = await basket({ kind: BasketKind.LIVE });
      const guest = await participant(live, null);
      const purchase = await settled(flat, milk, '2026-02-06T10:00:00Z', {
        basketId: live,
        participantId: guest,
      });

      expect(await entries()).toEqual([
        expect.objectContaining({
          id: purchase,
          kind: TripKind.SESSION,
          name: null,
        }),
      ]);
    });

    it('puts a purchase on another owner’s basket in a session, not under its name', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const theirs = await basket({
        ownerUserId: friend,
        name: 'Their Saturday',
      });
      const me = await participant(theirs, reader);
      const purchase = await settled(flat, milk, '2026-02-07T10:00:00Z', {
        basketId: theirs,
        participantId: me,
      });

      const mine = await entries();

      expect(mine).toHaveLength(1);
      expect(mine[0].id).toBe(purchase);
      expect(mine[0].kind).toBe(TripKind.SESSION);
      expect(mine[0].name).toBeNull();
    });

    it('is one basket entry, open following the status, holding everybody’s purchases', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const id = await basket({
        name: 'Saturday',
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date('2026-02-08T09:00:00Z'),
      });
      const guest = await participant(id, null);
      const other = await participant(id, friend);
      await settled(flat, milk, '2026-02-08T10:00:00Z', {
        basketId: id,
        participantId: guest,
      });
      await settled(flat, bread, '2026-02-08T10:05:00Z', {
        basketId: id,
        participantId: other,
      });

      expect(await entries()).toEqual([
        expect.objectContaining({
          id,
          kind: TripKind.BASKET,
          name: 'Saturday',
          open: true,
          lineCount: 2,
          startedAt: '2026-02-08T09:00:00.000Z',
          endedAt: '2026-02-08T10:05:00.000Z',
        }),
      ]);

      await dataSource
        .getRepository(GeneratedList)
        .update({ id }, { status: GeneratedListStatus.FINISHED });

      expect((await entries())[0].open).toBe(false);
    });

    it('leaves out a basket nothing was bought through', async () => {
      const flat = await list(zones.flat, 'Flat');
      await line(flat, 'Milk');
      await basket({ name: 'Nothing bought' });

      expect(await entries()).toEqual([]);
    });

    it('leaves out a basket whose only purchase was reverted', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket({ name: 'Taken back' });
      const guest = await participant(id, null);
      await settled(flat, milk, '2026-02-09T10:00:00Z', {
        basketId: id,
        participantId: guest,
        reverted: true,
      });

      expect(await entries()).toEqual([]);
    });
  });

  describe('a session is elapsed time (section 3.1)', () => {
    /** Two purchases on two lists of two zones, that far apart. */
    async function twoPurchases(
      first: string,
      second: string
    ): Promise<PurchaseEntryView[]> {
      const flat = await list(zones.flat, 'Flat');
      const parents = await list(zones.parents, 'Parents');
      const milk = await line(flat, 'Milk');
      const eggs = await line(parents, 'Eggs');
      await settled(flat, milk, first);
      await settled(parents, eggs, second);
      return entries();
    }

    it('is one session five hours apart', async () => {
      const mine = await twoPurchases(
        '2026-03-01T10:00:00Z',
        '2026-03-01T15:00:00Z'
      );

      expect(mine).toHaveLength(1);
      expect(mine[0].lineCount).toBe(2);
    });

    it('is two sessions seven hours apart', async () => {
      const mine = await twoPurchases(
        '2026-03-02T10:00:00Z',
        '2026-03-02T17:00:00Z'
      );

      expect(mine).toHaveLength(2);
      expect(mine.map((entry) => entry.lineCount)).toEqual([1, 1]);
    });

    // A gap of exactly the constant continues the session. Only a longer one
    // starts the next.
    it('is one session exactly six hours apart', async () => {
      const mine = await twoPurchases(
        '2026-03-03T10:00:00Z',
        '2026-03-03T16:00:00Z'
      );

      expect(mine).toHaveLength(1);
      expect(mine[0].lineCount).toBe(2);
    });

    // No calendar day anywhere, so no time zone can move this answer.
    it('is one session across midnight UTC', async () => {
      const mine = await twoPurchases(
        '2026-03-04T22:00:00Z',
        '2026-03-05T01:00:00Z'
      );

      expect(mine).toHaveLength(1);
      expect(mine[0].lineCount).toBe(2);
    });
  });

  describe('the counts and the total (sections 3.2 and 3.3)', () => {
    it('counts lines, bought lines, the total and what is missing from it', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const eggs = await line(flat, 'Eggs');
      const jam = await line(flat, 'Jam');

      // Two units at 120 each, priced.
      await settled(flat, milk, '2026-04-01T10:00:00Z', {
        quantity: 2,
        pricePaidCents: 120,
      });
      // One unit at 250, priced.
      await settled(flat, bread, '2026-04-01T10:05:00Z', {
        pricePaidCents: 250,
      });
      // Bought with no price: a bought line, and an unpriced one.
      await settled(flat, eggs, '2026-04-01T10:10:00Z', { quantity: 3 });
      // The shop had none: a line of the entry, and not a bought line.
      await settled(flat, jam, '2026-04-01T10:15:00Z', {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      // Reverted: it counts for nothing at all.
      await settled(flat, jam, '2026-04-01T10:20:00Z', {
        quantity: 9,
        pricePaidCents: 9999,
        reverted: true,
      });

      const mine = await entries();

      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        lineCount: 4,
        boughtLineCount: 3,
        spentCents: 2 * 120 + 250,
        unpricedCount: 1,
      });
    });

    // Before plan 0143 nothing writes a price, so this is every entry. Zero
    // would say the shopping was free.
    it('answers null and not zero when no purchase carries a price', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      await settled(flat, milk, '2026-04-02T10:00:00Z', { quantity: 2 });

      const mine = await entries();

      expect(mine[0].spentCents).toBeNull();
      expect(mine[0].unpricedCount).toBe(1);
      expect(mine[0].boughtLineCount).toBe(1);
    });
  });

  describe('paging (section 3.2)', () => {
    it('visits every entry once where a basket and a session share a startedAt', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const shared = '2026-05-01T10:00:00.123Z';

      const id = await basket({
        name: 'Same moment',
        generatedAt: new Date(shared),
      });
      const guest = await participant(id, null);
      await settled(flat, milk, '2026-05-01T10:30:00Z', {
        basketId: id,
        participantId: guest,
      });
      const session = await settled(flat, bread, shared);

      const all = await everyEntry(1);
      const seen = all.map((entry) => entry.id);

      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toEqual(expect.arrayContaining([id, session]));
      expect(all.map((entry) => entry.startedAt)).toEqual([
        '2026-05-01T10:00:00.123Z',
        '2026-05-01T10:00:00.123Z',
      ]);
    });

    it('visits every entry once across a page boundary inside a run of sessions', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      // Five sessions, each a day apart, so every gap is longer than six hours.
      for (let day = 1; day <= 5; day += 1) {
        await settled(flat, milk, `2026-06-0${day}T10:00:00Z`);
      }

      const paged = await everyEntry(2);
      const whole = await entries();

      expect(paged.map((entry) => entry.id)).toEqual(
        whole.map((entry) => entry.id)
      );
      expect(new Set(paged.map((entry) => entry.id)).size).toBe(paged.length);
    });

    /**
     * The narrowing of section 3.2 is a cost saving and not a rule: the window
     * it cuts away holds only sessions that are whole, so removing the
     * predicate has to answer the same entries. A narrowing that changed an
     * answer would be a bug, and comparing the two is the only honest way to
     * say so.
     */
    it('answers the same entries with the narrowing removed', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      for (let day = 1; day <= 4; day += 1) {
        await settled(flat, milk, `2026-06-1${day}T10:00:00Z`);
      }

      const first = await purchases.listSessions({ userId: reader, limit: 2 });
      const boundary = first.items[first.items.length - 1];
      const wide = await dataSource.query<PurchaseEntryRow[]>(
        purchaseEntriesSql(false),
        [reader, 6 * 60 * 60 * 1000, boundary.id, boundary.kind, 100]
      );
      const narrowed = await purchases.listSessions({
        userId: reader,
        cursor: first.nextCursor ?? undefined,
        limit: 100,
      });

      expect(narrowed.items.map((entry) => entry.id)).toEqual(
        wide.map((row) => row.id)
      );
      expect(narrowed.items).toHaveLength(2);
    });

    it('continues from the same moment when the boundary was reverted after the page', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const written: string[] = [];
      for (const at of [
        '2026-07-01T10:00:00Z',
        '2026-07-02T10:00:00Z',
        '2026-07-03T10:00:00Z',
      ]) {
        written.push(await settled(flat, milk, at));
      }

      const first = await purchases.listSessions({ userId: reader, limit: 1 });
      expect(first.items[0].id).toBe(written[2]);

      // The boundary session's only purchase is taken back after the page was
      // served. The boundary row is read from `line_settlements` whether or not
      // it still stands, so the next page starts from the same moment.
      await revert(written[2]);

      const second = await purchases.listSessions({
        userId: reader,
        cursor: first.nextCursor ?? undefined,
        limit: 10,
      });

      expect(second.items.map((entry) => entry.id)).toEqual([
        written[1],
        written[0],
      ]);
    });
  });

  describe('the rows of an entry (section 4)', () => {
    it('folds partial settles at one price into one row, and splits two prices', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const item = randomUUID();

      // Three partial settles of one milk at one price: one row of three.
      for (const at of [
        '2026-08-01T10:00:00Z',
        '2026-08-01T10:10:00Z',
        '2026-08-01T10:20:00Z',
      ]) {
        await settled(flat, milk, at, { itemId: item, pricePaidCents: 100 });
      }
      // The same line at two prices, which is two shops in one session.
      await settled(flat, bread, '2026-08-01T10:30:00Z', {
        pricePaidCents: 200,
      });
      await settled(flat, bread, '2026-08-01T10:40:00Z', {
        pricePaidCents: 250,
      });

      const [entry] = await entries();
      const rows = await rowsOf(entry);

      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        itemId: item,
        quantity: 3,
        pricePaidCents: 100,
        outcome: SettlementOutcome.BOUGHT,
        settledAt: '2026-08-01T10:00:00.000Z',
        content: 'Milk',
      });
      expect(rows.slice(1).map((row) => row.pricePaidCents)).toEqual([
        200, 250,
      ]);
    });

    it('is one row of zero for a line with nothing bought, and none when something was', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');

      // Nothing bought: one row saying so.
      await settled(flat, milk, '2026-08-02T10:00:00Z', {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      // Told there was none, went back and got some: its bought rows alone.
      await settled(flat, bread, '2026-08-02T10:05:00Z', {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      await settled(flat, bread, '2026-08-02T10:10:00Z', { quantity: 2 });

      const [entry] = await entries();
      const rows = await rowsOf(entry);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        content: 'Milk',
        outcome: SettlementOutcome.NOT_AVAILABLE,
        quantity: 0,
      });
      expect(rows[1]).toMatchObject({
        content: 'Bread',
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
      });
    });

    it('serves where it was bought only while the reader can read that list', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const jam = await line(flat, 'Jam');
      await settled(flat, milk, '2026-08-03T10:00:00Z');
      await settled(flat, jam, '2026-08-03T10:05:00Z');
      // A soft deleted line still serves its text: the purchase is what the row
      // is there to show (plan 0132).
      await dataSource
        .getRepository(ListLine)
        .update({ id: jam }, { deletedAt: new Date() });

      const [entry] = await entries();
      const held = await rowsOf(entry);

      expect(held[0]).toMatchObject({
        lineId: milk,
        listId: flat,
        listName: 'Flat',
        zoneId: zones.flat,
        content: 'Milk',
      });
      expect(held[1]).toMatchObject({ lineId: jam, content: 'Jam' });

      // The reader leaves the household. The purchase is still theirs; the list
      // is not.
      await dataSource
        .getRepository(ZoneMembership)
        .update(
          { zoneId: zones.flat, userId: reader },
          { status: MembershipStatus.KICKED }
        );

      const lost = await rowsOf(entry);

      expect(lost).toHaveLength(2);
      expect(lost[0]).toMatchObject({
        quantity: 1,
        outcome: SettlementOutcome.BOUGHT,
        settledAt: '2026-08-03T10:00:00.000Z',
        lineId: null,
        listId: null,
        listName: null,
        zoneId: null,
        content: null,
      });
    });

    it('pages the rows in the order the shopper walked', async () => {
      const flat = await list(zones.flat, 'Flat');
      const first = await line(flat, 'First');
      const second = await line(flat, 'Second');
      const third = await line(flat, 'Third');
      await settled(flat, third, '2026-08-04T10:00:00Z');
      await settled(flat, first, '2026-08-04T10:05:00Z');
      await settled(flat, second, '2026-08-04T10:10:00Z');

      const [entry] = await entries();
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page += 1) {
        const answer = await purchases.listSessionRows({
          userId: reader,
          kind: entry.kind,
          entryId: entry.id,
          limit: 1,
          cursor,
        });
        seen.push(...answer.items.map((row) => row.content ?? ''));
        if (!answer.nextCursor) {
          break;
        }
        cursor = answer.nextCursor;
      }

      expect(seen).toEqual(['Third', 'First', 'Second']);
    });

    it('answers not found for an entry that is not the reader’s', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const theirs = await basket({ ownerUserId: friend, name: 'Theirs' });
      const them = await participant(theirs, friend);
      await settled(flat, milk, '2026-08-05T10:00:00Z', {
        basketId: theirs,
        participantId: them,
      });

      await expect(
        purchases.listSessionRows({
          userId: reader,
          kind: TripKind.BASKET,
          entryId: theirs,
        })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers not found for a session id that names no session', async () => {
      await expect(
        purchases.listSessionRows({
          userId: reader,
          kind: TripKind.SESSION,
          entryId: randomUUID(),
        })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers not found once every purchase of an entry is reverted', async () => {
      const flat = await list(zones.flat, 'Flat');
      const milk = await line(flat, 'Milk');
      const purchase = await settled(flat, milk, '2026-08-06T10:00:00Z');

      const [entry] = await entries();
      expect(entry.id).toBe(purchase);

      await revert(purchase);

      await expect(
        purchases.listSessionRows({
          userId: reader,
          kind: entry.kind,
          entryId: entry.id,
        })
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the index of section 9', () => {
    /**
     * Statistics, without which the plans below are not reproducible, for the
     * reason `zone-summary.integration.spec.ts` gives: a freshly inserted table
     * has none, so the planner picks between indexes arbitrarily.
     */
    beforeAll(async () => {
      await dataSource.query('VACUUM ANALYZE "generated_list_participants"');
    });

    /**
     * The planner picks a sequential scan on a table this small however good
     * the index is, so asking it what it WOULD do is the only assertion here
     * that means anything. With `enable_seqscan` off Postgres still falls back
     * to a sequential scan when no index can serve the query, so seeing the
     * index named really does prove its predicate matches.
     */
    async function planFor(sql: string, params: unknown[]): Promise<string> {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.query('SET enable_seqscan = off');
        const plan = await runner.query(`EXPLAIN ${sql}`, params);
        return plan
          .map((row: Record<string, string>) => Object.values(row)[0])
          .join('\n');
      } finally {
        await runner.query('SET enable_seqscan = on');
        await runner.release();
      }
    }

    it('serves the third route, which needs the ended rows a partial index hides', async () => {
      const text = await planFor(
        `SELECT s.id
         FROM "generated_list_participants" p
         JOIN "line_settlements" s ON s."settledByParticipantId" = p.id
         WHERE p."userId" = $1::uuid AND s."revertedAt" IS NULL`,
        [reader]
      );

      expect(text).toContain('ix_generated_list_participants_user');
    });

    it('still serves the shared baskets read of plan 0114', async () => {
      const text = await planFor(SHARED_BASKETS_SQL, [reader, null, 20]);

      expect(text).toContain('ix_generated_list_participants_user');
    });
  });
});
