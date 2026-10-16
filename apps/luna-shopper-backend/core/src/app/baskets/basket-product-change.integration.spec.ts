import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  PURCHASE_SESSION_GAP_MS,
  SettlementOutcome,
  TripKind,
  ZoneRole,
  ZoneStatus,
  type ItemSnapshot,
  type SettlementPaid,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
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
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { SettlementService } from '../lists/settlement.service';
import { PurchasesService } from '../purchases/purchases.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeBasketAnnouncer } from './basket-announcer.fake';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketLineAddService } from './basket-line-add.service';
import { basketScopeOf } from './basket-line-facts';
import { BasketProductChangeService } from './basket-product-change.service';
import { BasketReadService } from './basket-read.service';
import { BASKET_ELSEWHERE_SQL } from './basket-read.sql';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketWriteContext } from './basket-write.context';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/**
 * What a buy records, and a change that rewrites it (plan 0202, section 5).
 *
 * Against Postgres, with the real writes and the real reads. A rewrite is two
 * rows under six check constraints and one unique index, and what it must
 * leave alone is every sum that counts standing rows by `settledAt`. A mocked
 * repository has none of those.
 *
 * Every account here is staff of its zone unless a test says otherwise, so it
 * writes every list. `sharing.writableAmong` answers that directly, as in the
 * suite of plan 0203. What the **actor may edit** is asked of the real
 * `ListAccessService`, because that is the rule of `keep: true`.
 *
 * No basket covers a whole zone: a `GENERATED` basket names its one list, and
 * each test builds a zone of its own (plan 0149).
 *
 * The clock is moved by writing `settledAt`, never by a mocked `Date`: the
 * session of a `LIVE` basket is `now()` inside a statement.
 */
describeIntegration(
  'a change of product rewrites the buys of the trip (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let changeService: BasketProductChangeService;
    let addService: BasketLineAddService;
    let settlements: SettlementService;
    let purchases: PurchasesService;

    const announcer = fakeBasketAnnouncer();
    /** Every zone event the writes emitted, by name. */
    const emitted: string[] = [];
    const zoneIds: string[] = [];
    let position = 0;

    const MILK = randomUUID();
    const OAT_MILK = randomUUID();
    const BREAD = randomUUID();
    const SCOPE = randomUUID();
    const OTHER_SCOPE = randomUUID();
    const SHOP = randomUUID();
    const CHAIN = randomUUID();

    const MILK_NAME: ItemSnapshot = {
      name: { en: 'Whole milk', es: 'Leche entera' },
      brand: 'Hacendado',
      unitSize: 1,
      packCount: 6,
      defaultUnit: 'LITER' as ItemSnapshot['defaultUnit'],
    };
    const OAT_NAME: ItemSnapshot = {
      name: { en: 'Oat drink', es: 'Bebida de avena' },
      brand: null,
      unitSize: 1,
      packCount: null,
      defaultUnit: 'LITER' as ItemSnapshot['defaultUnit'],
    };

    /** A buy at a shop: the scope, the shop, its chain and a price. */
    const AT_SHOP: SettlementPaid = {
      priceScopeId: SCOPE,
      supermarketLocationId: SHOP,
      supermarketId: CHAIN,
      pricePaidCents: 95,
      pricePaidCurrency: 'EUR',
    };

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
      const resolver = new BasketRowResolver(baskets, fakeCoreConfig());
      const marks = new BasketMarksReader(
        dataSource.getRepository(ListLineChange),
        fakeCoreConfig()
      );

      const sharing = {
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        liveParticipantById: async (participantId: string) =>
          dataSource
            .getRepository(BasketParticipant)
            .findOne({ where: { id: participantId } }),
        listParticipants: async ({ basketId }: { basketId: string }) => ({
          participants: (
            await dataSource
              .getRepository(BasketParticipant)
              .find({ where: { basketId, revokedAt: IsNull() } })
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

      read = new BasketReadService(
        baskets,
        coverage,
        sharing,
        listAccess,
        { order: async <T>(_userId: string, rows: T[]) => rows } as never,
        marks,
        fakeCoreConfig()
      );
      const context = new BasketWriteContext(
        baskets,
        coverage,
        sharing,
        resolver,
        read,
        announcer
      );

      const claims = {
        claimsOf: async () => new Map(),
        claimOf: async () => ({ claimed: false, claimedByUserId: null }),
        announceReleased: async () => undefined,
      } as never;
      const events = {
        emit: (event: string) => {
          emitted.push(event);
        },
        emitTo: () => undefined,
      } as never;
      settleService = new BasketSettleService(
        dataSource,
        baskets,
        context,
        claims,
        events,
        new LineChangeRecorder()
      );
      revertService = new BasketRevertService(
        dataSource,
        context,
        claims,
        events,
        new LineChangeRecorder()
      );
      settlements = new SettlementService(
        dataSource,
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        events,
        announcer,
        new LineChangeRecorder()
      );
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
      changeService = new BasketProductChangeService(
        dataSource,
        context,
        lines,
        listAccess
      );
      addService = new BasketLineAddService(
        context,
        lines,
        { pricingProfileId: async () => null } as never,
        events,
        changeService
      );
      purchases = new PurchasesService(dataSource);
    });

    afterAll(async () => {
      const zones = dataSource.getRepository(Zone);
      for (const zoneId of zoneIds) {
        // Memberships, lists, lines, settlements and changes cascade from it.
        await zones.delete({ id: zoneId });
      }
      await dataSource?.destroy();
    });

    beforeEach(() => {
      announcer.reset();
      emitted.length = 0;
    });

    // --- fixtures ----------------------------------------------------------

    interface Shopper {
      userId: string | null;
      basket: Basket;
      participantId: string;
    }

    const earlier = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    async function participant(
      basket: Basket,
      kind: ParticipantKind,
      userId: string | null
    ): Promise<string> {
      const participants = dataSource.getRepository(BasketParticipant);
      const guest = kind === ParticipantKind.GUEST;
      const saved = await participants.save(
        participants.create({
          basketId: basket.id,
          shareLinkId: null,
          kind,
          userId,
          displayName: guest ? 'Marta' : null,
          username: guest ? null : 'Shopper',
          guestNumber: guest ? 1 : null,
          sessionSecretHash: guest ? randomUUID() : null,
          userAgent: null,
          joinedAt: earlier(),
          lastSeenAt: new Date(),
          revokedAt: null,
          expiresAt:
            kind === ParticipantKind.OWNER
              ? null
              : new Date(Date.now() + 12 * 60 * 60 * 1000),
        })
      );
      return saved.id;
    }

    async function basketOf(
      userId: string,
      kind: BasketKind,
      zoneId: string,
      listId: string
    ): Promise<Shopper & { userId: string }> {
      const repo = dataSource.getRepository(Basket);
      const basket = await repo.save(
        repo.create({
          ownerUserId: userId,
          kind,
          name: kind === BasketKind.LIVE ? null : 'Saturday',
          status: BasketStatus.OPEN,
          generatedAt: earlier(),
          idempotencyKey: null,
        })
      );
      if (kind === BasketKind.GENERATED) {
        const sources = dataSource.getRepository(BasketSource);
        await sources.save(
          sources.create({ basketId: basket.id, zoneId, listId })
        );
      }
      return {
        userId,
        basket,
        participantId: await participant(basket, ParticipantKind.OWNER, userId),
      };
    }

    /**
     * One zone, one list, and two people who each shop it from a basket of
     * their own. `GENERATED` by default: its trip is its whole life, so a test
     * that is not about the session needs no clock.
     */
    async function world(kind: BasketKind = BasketKind.GENERATED): Promise<{
      zoneId: string;
      listId: string;
      a: Shopper & { userId: string };
      b: Shopper & { userId: string };
    }> {
      const users = { a: randomUUID(), b: randomUUID() };
      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Product changes',
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: users.a,
          config: {},
        })
      );
      zoneIds.push(zone.id);
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save([
        memberships.create({
          zoneId: zone.id,
          userId: users.a,
          username: 'Ana',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        }),
        memberships.create({
          zoneId: zone.id,
          userId: users.b,
          username: 'Bruno',
          role: ZoneRole.ADMIN,
          status: MembershipStatus.APPROVED,
        }),
      ]);
      const lists = dataSource.getRepository(ShoppingList);
      const list = await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Weekly',
          createdByUserId: users.a,
        })
      );
      return {
        zoneId: zone.id,
        listId: list.id,
        a: await basketOf(users.a, kind, zone.id, list.id),
        b: await basketOf(users.b, kind, zone.id, list.id),
      };
    }

    /** A line that holds these products, in this order. */
    async function line(
      listId: string,
      createdByUserId: string,
      content: string,
      quantity: number,
      itemIds: readonly string[] = [MILK]
    ): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      position += 1;
      const saved = await repo.save(
        repo.create({
          listId,
          content,
          quantity,
          position,
          createdByUserId,
          approvalStatus: LineApprovalStatus.APPROVED,
        })
      );
      const items = dataSource.getRepository(ListLineItem);
      for (const [index, itemId] of itemIds.entries()) {
        await items.save(
          items.create({ lineId: saved.id, itemId, position: index })
        );
      }
      return saved;
    }

    /** Somebody buys units of one line through a basket, as the gateway sends it. */
    const buy = (
      who: Shopper,
      row: ListLine,
      quantity: number,
      from: number,
      extra: {
        itemId?: string;
        paid?: SettlementPaid;
        itemSnapshot?: ItemSnapshot | null;
      } = {}
    ) =>
      settleService.settle({
        basketId: who.basket.id,
        participantId: who.participantId,
        rowKey: row.id,
        lineIds: [row.id],
        outcome: SettlementOutcome.BOUGHT,
        quantity,
        from,
        ...extra,
      });

    const change = (
      who: Shopper,
      rows: readonly ListLine[],
      itemId: string,
      keep: boolean,
      extra: Partial<Parameters<BasketProductChangeService['change']>[0]> = {}
    ) =>
      changeService.change({
        basketId: who.basket.id,
        participantId: who.participantId,
        userId: who.userId ?? '',
        lineIds: rows.map((row) => row.id),
        itemId,
        keep,
        ...extra,
      });

    const viewOf = (who: Shopper) =>
      read.read({ basketId: who.basket.id, participantId: who.participantId });

    /** Every settlement of a line, oldest first, the standing ones last on a tie. */
    const settlementsOf = (lineId: string) =>
      dataSource.getRepository(LineSettlement).find({
        where: { lineId },
        order: { settledAt: 'ASC', createdAt: 'ASC' },
      });

    const standingOf = async (lineId: string) =>
      (await settlementsOf(lineId)).filter((row) => row.revertedAt === null);

    const lineNow = (lineId: string) =>
      dataSource.getRepository(ListLine).findOneOrFail({ where: { id: lineId } });

    const itemsOf = async (lineId: string) =>
      (
        await dataSource.getRepository(ListLineItem).find({
          where: { lineId },
          order: { position: 'ASC', createdAt: 'ASC' },
        })
      ).map((row) => row.itemId);

    const changeRowsOn = (lineId: string) =>
      dataSource.getRepository(ListLineChange).count({ where: { lineId } });

    /** Move every settlement of a line back in time, as the database reads it. */
    const age = (lineId: string, ms: number) =>
      dataSource.query(
        `UPDATE "line_settlements"
         SET "settledAt" = "settledAt" - ($2::double precision * interval '1 millisecond')
         WHERE "lineId" = $1`,
        [lineId, ms]
      );

    const HOUR = 60 * 60 * 1000;

    // --- 1. what a buy records ---------------------------------------------

    it('records the name of the product on a basket buy, with its price and its place', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);

      await buy(a, milk, 2, 2, { paid: AT_SHOP, itemSnapshot: MILK_NAME });

      const [row] = await settlementsOf(milk.id);
      expect(row).toMatchObject({
        itemId: MILK,
        itemSnapshot: MILK_NAME,
        replacesSettlementId: null,
        pricePaidCents: 95,
        pricePaidCurrency: 'EUR',
        priceScopeId: SCOPE,
        supermarketLocationId: SHOP,
        supermarketId: CHAIN,
      });
    });

    it('records a buy with no shop at its scope, with no shop and no chain', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 1);

      // What the gateway sends for a buy with no shop: the cheapest scope.
      await buy(a, milk, 1, 1, {
        paid: {
          priceScopeId: OTHER_SCOPE,
          supermarketLocationId: null,
          supermarketId: null,
          pricePaidCents: 89,
          pricePaidCurrency: 'EUR',
        },
        itemSnapshot: MILK_NAME,
      });

      const [row] = await settlementsOf(milk.id);
      expect(row).toMatchObject({
        pricePaidCents: 89,
        priceScopeId: OTHER_SCOPE,
        supermarketLocationId: null,
        supermarketId: null,
      });
    });

    it('still writes the buy when catalog answered nothing: no price and no name', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 1);

      await buy(a, milk, 1, 1);

      const [row] = await settlementsOf(milk.id);
      expect(row).toMatchObject({
        itemId: MILK,
        quantity: 1,
        itemSnapshot: null,
        pricePaidCents: null,
        priceScopeId: null,
      });
      expect((await lineNow(milk.id)).quantity).toBe(0);
    });

    it('stores no name on a buy that records no product', async () => {
      const { listId, a } = await world();
      // Free text: the line holds no product, so the buy records none.
      const eggs = await line(listId, a.userId, 'Eggs', 1, []);

      await buy(a, eggs, 1, 1, { itemSnapshot: MILK_NAME });

      const [row] = await settlementsOf(eggs.id);
      expect(row.itemId).toBeNull();
      expect(row.itemSnapshot).toBeNull();
    });

    it('refuses a snapshot of the wrong shape, and writes nothing', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 1);

      await expect(
        buy(a, milk, 1, 1, { itemSnapshot: { name: 'Milk' } as never })
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(await settlementsOf(milk.id)).toHaveLength(0);
    });

    it('copies only the five fields of the snapshot', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 1);

      await buy(a, milk, 1, 1, {
        itemSnapshot: { ...MILK_NAME, sku: 'smuggled' } as never,
      });

      const [row] = await settlementsOf(milk.id);
      expect(row.itemSnapshot).toEqual(MILK_NAME);
    });

    it('records the name on a buy made on the list page', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 1);

      await settlements.settle({
        userId: a.userId,
        lineId: milk.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        itemSnapshot: MILK_NAME,
      });

      const [row] = await settlementsOf(milk.id);
      expect(row).toMatchObject({
        itemId: MILK,
        itemSnapshot: MILK_NAME,
        basketId: null,
      });
    });

    it('copies the name onto the half that still stands when a revert splits a buy', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);
      await buy(a, milk, 3, 3, { paid: AT_SHOP, itemSnapshot: MILK_NAME });

      await revertService.revert({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        target: 'UNITS',
        units: 1,
        from: 3,
      });

      const [standing] = await standingOf(milk.id);
      expect(standing).toMatchObject({
        quantity: 2,
        itemSnapshot: MILK_NAME,
        // A split is not a correction: the row above it was given back.
        replacesSettlementId: null,
      });
    });

    // --- 2. the rewrite ----------------------------------------------------

    it('turns two buys of one line in the trip into two new rows, and moves no quantity', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 5);
      await buy(a, milk, 1, 5, { paid: AT_SHOP, itemSnapshot: MILK_NAME });
      await buy(a, milk, 2, 4, { paid: AT_SHOP, itemSnapshot: MILK_NAME });
      const before = await settlementsOf(milk.id);
      const changesBefore = await changeRowsOn(milk.id);
      const versionBefore = (await lineNow(milk.id)).version;

      const answer = await change(a, [milk], OAT_MILK, false, {
        itemSnapshot: OAT_NAME,
        prices: [
          {
            priceScopeId: SCOPE,
            pricePaidCents: 189,
            pricePaidCurrency: 'EUR',
          },
        ],
      });

      const after = await settlementsOf(milk.id);
      expect(after).toHaveLength(4);
      for (const old of before) {
        const marked = after.find((row) => row.id === old.id);
        // The old row is marked by the person who made the correction, which
        // `ck_line_settlements_revert` asks for beside the time.
        expect(marked?.revertedAt).not.toBeNull();
        expect(marked?.revertedByParticipantId).toBe(a.participantId);
        // And it is otherwise the row it was.
        expect(marked).toMatchObject({
          itemId: MILK,
          itemSnapshot: MILK_NAME,
          quantity: old.quantity,
          pricePaidCents: 95,
        });

        const fresh = after.find((row) => row.replacesSettlementId === old.id);
        expect(fresh).toMatchObject({
          lineId: milk.id,
          listId,
          basketId: a.basket.id,
          itemId: OAT_MILK,
          itemSnapshot: OAT_NAME,
          outcome: SettlementOutcome.BOUGHT,
          quantity: old.quantity,
          settledByParticipantId: a.participantId,
          settledByUserId: null,
          revertedAt: null,
          revertedByParticipantId: null,
          // The place of the buy it replaces, and the price of the new
          // product at that scope.
          priceScopeId: SCOPE,
          supermarketLocationId: SHOP,
          supermarketId: CHAIN,
          pricePaidCents: 189,
          pricePaidCurrency: 'EUR',
        });
        // The moment of the purchase is copied, so the order of the buys is
        // what it was.
        expect(fresh?.settledAt.getTime()).toBe(old.settledAt.getTime());
      }

      // No unit went back, the line was not written, and plan 0203 section 1
      // says a write that moves no quantity records no change.
      const now = await lineNow(milk.id);
      expect(now.quantity).toBe(2);
      expect(now.version).toBe(versionBefore);
      expect(await changeRowsOn(milk.id)).toBe(changesBefore);
      expect(await itemsOf(milk.id)).toEqual([MILK]);
      expect(now.favoriteItemId).toBeNull();

      // The answer of every row write: the named lines, and no row.
      expect(answer.entries).toHaveLength(1);
      expect(answer.entries[0]).toMatchObject({
        lineId: milk.id,
        left: 2,
        bought: 3,
        tripItemId: OAT_MILK,
      });

      // The basket now reads the line as the new product.
      const view = await viewOf(a);
      expect(view.rows).toHaveLength(1);
      expect(view.rows[0]).toMatchObject({
        productId: OAT_MILK,
        left: 2,
        bought: 3,
        asked: 5,
      });
    });

    it('tells this basket alone, with no mark, and tells the zone nothing', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);
      announcer.reset();
      emitted.length = 0;

      await change(a, [milk], OAT_MILK, false);

      // One envelope, to the basket the change was made through. Its entries
      // carry `tripItemId`, and a device that holds the line in the row of
      // another product reads the basket again (plan 0204, section 7).
      expect(announcer.calls.basketMoved).toEqual([
        { basketId: a.basket.id, lineIds: [milk.id] },
      ]);
      // No other basket reads anything differently, so none is told.
      expect(announcer.calls.linesMoved).toEqual([]);
      expect(announcer.calls.linesChanged).toEqual([]);
      // The line did not move, so the list page hears nothing.
      expect(emitted).toEqual([]);
    });

    it('leaves alone a buy outside the trip, a buy taken back, "they had none" and a buy of another basket', async () => {
      const { listId, a, b } = await world(BasketKind.LIVE);
      const milk = await line(listId, a.userId, 'Milk', 9);

      // Yesterday's session of this basket: outside the trip.
      await buy(a, milk, 1, 9);
      await age(milk.id, PURCHASE_SESSION_GAP_MS + 2 * HOUR);
      const [yesterday] = await settlementsOf(milk.id);

      // Today: a buy that is then taken back, a buy that stands, "they had
      // none", and a buy through another basket.
      await buy(a, milk, 2, 8);
      await revertService.revert({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        target: 'UNITS',
        units: 2,
        from: 2,
      });
      await buy(a, milk, 1, 8);
      await settleService.settle({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 7,
      });
      await buy(b, milk, 1, 7);
      const before = await settlementsOf(milk.id);
      expect(before).toHaveLength(5);

      await change(a, [milk], OAT_MILK, false);

      const after = await settlementsOf(milk.id);
      // One row was replaced, so there is one row more.
      expect(after).toHaveLength(6);
      const replaced = after.filter((row) => row.replacesSettlementId !== null);
      expect(replaced).toHaveLength(1);
      expect(replaced[0]).toMatchObject({ itemId: OAT_MILK, quantity: 1 });

      const untouched = (id: string) => {
        const was = before.find((row) => row.id === id);
        const is = after.find((row) => row.id === id);
        expect(is).toEqual(was);
      };
      untouched(yesterday.id);
      for (const row of before) {
        const takenBack = row.revertedAt !== null;
        const close = row.outcome === SettlementOutcome.NOT_AVAILABLE;
        const others = row.basketId !== a.basket.id;
        if (takenBack || close || others) {
          untouched(row.id);
        }
      }
      // The buy that was taken back keeps the person who took it back.
      expect(
        after.filter(
          (row) =>
            row.revertedAt !== null &&
            !after.some((other) => other.replacesSettlementId === row.id)
        )
      ).toHaveLength(1);
    });

    it('reads every sum the same after a rewrite as before it', async () => {
      const { listId, a, b } = await world(BasketKind.LIVE);
      const milk = await line(listId, a.userId, 'Milk', 6);
      const bread = await line(listId, a.userId, 'Bread', 2, [BREAD]);
      await buy(a, milk, 1, 6);
      await buy(a, milk, 2, 5);
      await buy(a, bread, 1, 2);
      // Nudged apart, so the session has an order to keep.
      await dataSource.query(
        `UPDATE "line_settlements"
         SET "settledAt" = "settledAt" - interval '20 minutes'
         WHERE "lineId" = $1`,
        [milk.id]
      );

      const sums = async () => {
        const own = await viewOf(a);
        const other = await viewOf(b);
        return {
          // The session of the `LIVE` basket the buys were made through.
          session: await basketScopeOf(dataSource, a.basket),
          own: own.rows.map((row) => ({
            left: row.left,
            bought: row.bought,
            asked: row.asked,
            boughtElsewhere: row.boughtElsewhere,
            state: row.state,
          })),
          ownProgress: own.progress,
          // The same units, as the other basket counts them: bought elsewhere.
          other: other.rows.map((row) => ({
            left: row.left,
            bought: row.bought,
            boughtElsewhere: row.boughtElsewhere,
            state: row.state,
            note: row.note,
            noteAt: row.noteAt,
          })),
          otherProgress: other.progress,
          // The statement itself, for the other basket.
          elsewhere: await dataSource.query(BASKET_ELSEWHERE_SQL, [
            b.basket.id,
            [milk.id, bread.id],
            PURCHASE_SESSION_GAP_MS,
          ]),
          quantities: [
            (await lineNow(milk.id)).quantity,
            (await lineNow(bread.id)).quantity,
          ],
        };
      };
      const before = await sums();
      // The fixture is worth something only if the sums are not empty.
      expect(before.session.enabled).toBe(true);
      expect(before.elsewhere).toHaveLength(2);
      expect(before.other.some((row) => row.boughtElsewhere === 3)).toBe(true);

      await change(a, [milk], OAT_MILK, false);

      // The row of the line counts as another product now, and nothing else
      // moved: the same rows in the same order with the same numbers.
      expect(await sums()).toEqual(before);
    });

    it('moves a line to the row of the new product, beside the line that already counts as it', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3, [MILK]);
      const oat = await line(listId, a.userId, 'Oat drink', 2, [OAT_MILK]);
      await buy(a, milk, 1, 3);
      expect((await viewOf(a)).rows).toHaveLength(2);

      await change(a, [milk], OAT_MILK, false);

      const view = await viewOf(a);
      expect(view.rows).toHaveLength(1);
      expect(view.rows[0].productId).toBe(OAT_MILK);
      expect(view.rows[0].entries.map((entry) => entry.lineId).sort()).toEqual(
        [milk.id, oat.id].sort()
      );
      // Neither line was written: the line page of Milk still says milk.
      expect(await itemsOf(milk.id)).toEqual([MILK]);
    });

    it('writes nothing the second time the same change is sent', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);
      await change(a, [milk], OAT_MILK, false);
      const once = await settlementsOf(milk.id);
      announcer.reset();

      await change(a, [milk], OAT_MILK, false);

      expect(await settlementsOf(milk.id)).toEqual(once);
      // Nothing moved, so nobody is told.
      expect(announcer.calls.basketMoved).toEqual([]);
    });

    it('corrects a correction: the row that replaced a buy is the one a later change replaces', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);
      await change(a, [milk], OAT_MILK, false);

      await change(a, [milk], BREAD, false);

      const rows = await settlementsOf(milk.id);
      expect(rows).toHaveLength(3);
      const standing = rows.filter((row) => row.revertedAt === null);
      expect(standing).toHaveLength(1);
      expect(standing[0].itemId).toBe(BREAD);
      const middle = rows.find((row) => row.id === standing[0].replacesSettlementId);
      expect(middle).toMatchObject({ itemId: OAT_MILK });
      expect(middle?.revertedAt).not.toBeNull();
      expect(rows.find((row) => row.id === middle?.replacesSettlementId)).toMatchObject({
        itemId: MILK,
      });
    });

    // --- 3. the price of a rewritten buy -----------------------------------

    it('keeps the place and records no price when the gateway read none at that scope', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2, { paid: AT_SHOP, itemSnapshot: MILK_NAME });

      // The gateway priced another scope, and not the one this buy was at.
      await change(a, [milk], OAT_MILK, false, {
        prices: [
          {
            priceScopeId: OTHER_SCOPE,
            pricePaidCents: 199,
            pricePaidCurrency: 'EUR',
          },
        ],
      });

      const [standing] = await standingOf(milk.id);
      expect(standing).toMatchObject({
        itemId: OAT_MILK,
        priceScopeId: SCOPE,
        supermarketLocationId: SHOP,
        supermarketId: CHAIN,
        pricePaidCents: null,
        pricePaidCurrency: null,
        // The gateway sent no name either, so none is claimed.
        itemSnapshot: null,
      });
    });

    it('prices a buy that recorded no scope as a settle is priced', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      // No scope: catalog did not answer at the shelf.
      await buy(a, milk, 1, 2);

      await change(a, [milk], OAT_MILK, false, {
        itemSnapshot: OAT_NAME,
        paid: {
          priceScopeId: OTHER_SCOPE,
          supermarketLocationId: null,
          supermarketId: null,
          pricePaidCents: 175,
          pricePaidCurrency: 'EUR',
        },
        // A price at a scope the buy was not at is not used for it.
        prices: [
          { priceScopeId: SCOPE, pricePaidCents: 1, pricePaidCurrency: 'EUR' },
        ],
      });

      const [standing] = await standingOf(milk.id);
      expect(standing).toMatchObject({
        priceScopeId: OTHER_SCOPE,
        supermarketLocationId: null,
        supermarketId: null,
        pricePaidCents: 175,
        pricePaidCurrency: 'EUR',
        itemSnapshot: OAT_NAME,
      });
    });

    it('answers where the buys of the trip were priced, for the gateway to price them', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 5);
      const bread = await line(listId, a.userId, 'Bread', 2, [BREAD]);
      await buy(a, milk, 1, 5, { paid: AT_SHOP });
      await buy(a, milk, 1, 4, { paid: AT_SHOP });
      await buy(a, milk, 1, 3);
      // A buy of a line the question does not name.
      await buy(a, bread, 1, 2, {
        paid: { ...AT_SHOP, priceScopeId: OTHER_SCOPE },
      });

      const scope = await addService.searchScope({
        basketId: a.basket.id,
        participantId: a.participantId,
        lineIds: [milk.id],
        tripBuys: true,
      });

      expect(scope.tripBuys).toEqual({
        priceScopeIds: [SCOPE],
        unscoped: true,
      });
      // Not asked, not answered: a settle asks the same question without it.
      const plain = await addService.searchScope({
        basketId: a.basket.id,
        participantId: a.participantId,
        lineIds: [milk.id],
      });
      expect(plain.tripBuys).toBeUndefined();
    });

    // --- 4. keep ------------------------------------------------------------

    it('with keep, adds the product to the line and makes it the favourite, in the same write', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);
      await buy(a, milk, 1, 3);
      const versionBefore = (await lineNow(milk.id)).version;
      announcer.reset();
      emitted.length = 0;

      await change(a, [milk], OAT_MILK, true, { itemSnapshot: OAT_NAME });

      const now = await lineNow(milk.id);
      expect(await itemsOf(milk.id)).toEqual([MILK, OAT_MILK]);
      expect(now.favoriteItemId).toBe(OAT_MILK);
      expect(now.quantity).toBe(2);
      expect(now.version).toBe(versionBefore + 1);
      const [standing] = await standingOf(milk.id);
      expect(standing).toMatchObject({
        itemId: OAT_MILK,
        itemSnapshot: OAT_NAME,
      });

      // The edit is the line page's own: the zone hears it, and every basket
      // that covers the list is told to read again.
      expect(emitted).toEqual(['line.updated']);
      expect(announcer.calls.linesChanged).toEqual([
        { listId, lineIds: [milk.id] },
      ]);
      // That announcement reaches this basket too, so it is not told twice.
      expect(announcer.calls.basketMoved).toEqual([]);
    });

    it('with keep and no buy in the trip, writes the line and rewrites nothing', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);

      await change(a, [milk], OAT_MILK, true);

      expect(await itemsOf(milk.id)).toEqual([MILK, OAT_MILK]);
      expect((await lineNow(milk.id)).favoriteItemId).toBe(OAT_MILK);
      expect(await settlementsOf(milk.id)).toHaveLength(0);
      // The line follows its favourite (plan 0201, section 1, step 2).
      expect((await viewOf(a)).rows[0].productId).toBe(OAT_MILK);
    });

    it('with keep, makes a product the line already holds its favourite and adds it once', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3, [MILK, OAT_MILK]);

      await change(a, [milk], OAT_MILK, true);

      expect(await itemsOf(milk.id)).toEqual([MILK, OAT_MILK]);
      expect((await lineNow(milk.id)).favoriteItemId).toBe(OAT_MILK);

      // A second time there is nothing left to write.
      const version = (await lineNow(milk.id)).version;
      emitted.length = 0;
      await change(a, [milk], OAT_MILK, true);
      expect((await lineNow(milk.id)).version).toBe(version);
      expect(emitted).toEqual([]);
    });

    it('without keep and with no buy in the trip, writes nothing and answers the lines as they are', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);
      const before = await lineNow(milk.id);
      announcer.reset();

      const answer = await change(a, [milk], OAT_MILK, false);

      expect(await lineNow(milk.id)).toEqual(before);
      expect(await itemsOf(milk.id)).toEqual([MILK]);
      expect(await settlementsOf(milk.id)).toHaveLength(0);
      expect(announcer.calls.basketMoved).toEqual([]);
      expect(answer.entries).toHaveLength(1);
      expect(answer.entries[0]).toMatchObject({
        lineId: milk.id,
        left: 3,
        bought: 0,
        tripItemId: null,
      });
      // The choice lives on the device until the first buy (velista 0140).
      expect((await viewOf(a)).rows[0].productId).toBe(MILK);
    });

    // --- 5. who may, and on which lines ------------------------------------

    it('refuses a guest, and writes nothing', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);
      const guest: Shopper = {
        userId: null,
        basket: a.basket,
        participantId: await participant(a.basket, ParticipantKind.GUEST, null),
      };
      const before = await settlementsOf(milk.id);

      for (const keep of [false, true]) {
        await expect(
          change(guest, [milk], OAT_MILK, keep)
        ).rejects.toMatchObject({ code: 'forbidden' });
      }
      expect(await settlementsOf(milk.id)).toEqual(before);
    });

    it('answers "Row not found" for the whole write when one named line is not a row of the basket', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);
      // A line of a list this basket does not cover.
      const elsewhere = await world();
      const foreign = await line(
        elsewhere.listId,
        elsewhere.a.userId,
        'Milk',
        2
      );
      // And a line of the covered list that is at zero with no buy, which the
      // basket does not draw.
      const gone = await line(listId, a.userId, 'Rice', 0, [BREAD]);
      const before = await settlementsOf(milk.id);

      for (const other of [foreign, gone]) {
        for (const keep of [false, true]) {
          await expect(
            change(a, [milk, other], OAT_MILK, keep)
          ).rejects.toMatchObject({
            code: 'not_found',
            message: 'Row not found',
          });
        }
      }
      // Nothing was applied to the line that was found.
      expect(await settlementsOf(milk.id)).toEqual(before);
      expect(await itemsOf(milk.id)).toEqual([MILK]);
    });

    it('with keep, refuses the whole request when the actor may not edit one of the lines', async () => {
      const { zoneId, listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);
      // A second list of the zone, which the co shopper reads and does not
      // write. The owner's basket covers both.
      const lists = dataSource.getRepository(ShoppingList);
      const second = await lists.save(
        lists.create({ zoneId, name: 'Party', createdByUserId: a.userId })
      );
      const sources = dataSource.getRepository(BasketSource);
      await sources.save(
        sources.create({ basketId: a.basket.id, zoneId, listId: second.id })
      );
      const cake = await line(second.id, a.userId, 'Cake', 1, [BREAD]);

      const coShopper = randomUUID();
      const memberships = dataSource.getRepository(ZoneMembership);
      const membership = await memberships.save(
        memberships.create({
          zoneId,
          userId: coShopper,
          username: 'Carla',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
      const access = dataSource.getRepository(ListAccess);
      await access.save([
        access.create({
          listId,
          membershipId: membership.id,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        }),
        access.create({
          listId: second.id,
          membershipId: membership.id,
          permissions: [ListPermission.READ],
        }),
      ]);
      const carla: Shopper = {
        userId: coShopper,
        basket: a.basket,
        participantId: await participant(
          a.basket,
          ParticipantKind.REGISTERED,
          coShopper
        ),
      };
      const before = await settlementsOf(milk.id);

      await expect(
        change(carla, [milk, cake], OAT_MILK, true)
      ).rejects.toMatchObject({ code: 'forbidden' });

      // Nothing was written: not the buy of the line she may edit, and not
      // that line either.
      expect(await settlementsOf(milk.id)).toEqual(before);
      expect(await itemsOf(milk.id)).toEqual([MILK]);
      expect((await lineNow(milk.id)).favoriteItemId).toBeNull();
      expect(await itemsOf(cake.id)).toEqual([BREAD]);

      // For this trip only she changes no list, so both lines are hers to
      // correct: who may settle did not change.
      await change(carla, [milk, cake], OAT_MILK, false);
      expect((await standingOf(milk.id))[0].itemId).toBe(OAT_MILK);
      // And on the line she writes, she keeps it.
      await change(carla, [milk], OAT_MILK, true);
      expect((await lineNow(milk.id)).favoriteItemId).toBe(OAT_MILK);
    });

    it('with keep, puts an approved line back to pending for a writer who does not approve', async () => {
      const { zoneId, listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      const writer = randomUUID();
      const memberships = dataSource.getRepository(ZoneMembership);
      const membership = await memberships.save(
        memberships.create({
          zoneId,
          userId: writer,
          username: 'Dario',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
      const access = dataSource.getRepository(ListAccess);
      await access.save(
        access.create({
          listId,
          membershipId: membership.id,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        })
      );
      const dario: Shopper = {
        userId: writer,
        basket: a.basket,
        participantId: await participant(
          a.basket,
          ParticipantKind.REGISTERED,
          writer
        ),
      };

      await change(dario, [milk], OAT_MILK, true);

      // The rule of the line page (plan 0076): a writer who changes the
      // products of an approved line puts it back in front of whoever approves.
      expect((await lineNow(milk.id)).approvalStatus).toBe(
        LineApprovalStatus.PENDING
      );
    });

    it('refuses a finished basket', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await dataSource
        .getRepository(Basket)
        .update({ id: a.basket.id }, { status: BasketStatus.FINISHED });

      await expect(change(a, [milk], OAT_MILK, false)).rejects.toMatchObject({
        code: 'basket_finished',
      });
    });

    // --- 6. the history ----------------------------------------------------

    it('shows the new product once in the history of the line, and a plain revert as before', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 6);
      // One buy that is corrected, and one that is taken back.
      await buy(a, milk, 1, 6, { itemSnapshot: MILK_NAME });
      await change(a, [milk], OAT_MILK, false, { itemSnapshot: OAT_NAME });
      await buy(a, milk, 2, 5, { itemId: BREAD });
      await revertService.revert({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        lineIds: [milk.id],
        target: 'UNITS',
        units: 2,
        from: 3,
      });

      const page = await settlements.listForLine({
        userId: a.userId,
        lineId: milk.id,
      });

      // Three rows are stored for the two buys. The replaced one is left out.
      expect(await settlementsOf(milk.id)).toHaveLength(3);
      expect(
        page.items.map((row) => ({
          itemId: row.itemId,
          reverted: row.revertedAt !== null,
          itemSnapshot: row.itemSnapshot,
        }))
      ).toEqual([
        // Newest first: the buy somebody took back is served, marked.
        { itemId: BREAD, reverted: true, itemSnapshot: null },
        { itemId: OAT_MILK, reverted: false, itemSnapshot: OAT_NAME },
      ]);
    });

    it('leaves the replaced row out of the history of the product it named', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2, { itemSnapshot: MILK_NAME });
      await change(a, [milk], OAT_MILK, false, { itemSnapshot: OAT_NAME });

      const ofMilk = await settlements.listForItem({
        userId: a.userId,
        itemId: MILK,
      });
      const ofOat = await settlements.listForItem({
        userId: a.userId,
        itemId: OAT_MILK,
      });

      // Without the clause the old product would read as bought and given
      // back. Nobody bought it.
      expect(ofMilk.items.filter((row) => row.lineId === milk.id)).toEqual([]);
      expect(
        ofOat.items
          .filter((row) => row.lineId === milk.id)
          .map((row) => [row.itemId, row.itemSnapshot])
      ).toEqual([[OAT_MILK, OAT_NAME]]);
    });

    it('serves the copied name in the purchase history, and its totals count the rows that are shown', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 4);
      await buy(a, milk, 2, 4, { paid: AT_SHOP, itemSnapshot: MILK_NAME });
      const entriesBefore = await purchases.listSessions({ userId: a.userId });
      const entryBefore = entriesBefore.items.find(
        (entry) => entry.id === a.basket.id
      );
      expect(entryBefore).toMatchObject({
        kind: TripKind.BASKET,
        spent: { cents: 190, currency: 'EUR' },
        unpricedCount: 0,
      });

      await change(a, [milk], OAT_MILK, false, {
        itemSnapshot: OAT_NAME,
        prices: [
          {
            priceScopeId: SCOPE,
            pricePaidCents: 150,
            pricePaidCurrency: 'EUR',
          },
        ],
      });

      const rows = await purchases.listSessionRows({
        userId: a.userId,
        kind: TripKind.BASKET,
        entryId: a.basket.id,
      });
      // One row, of the product that was really bought, with its own price.
      expect(
        rows.items.map((row) => ({
          itemId: row.itemId,
          itemSnapshot: row.itemSnapshot,
          quantity: row.quantity,
          pricePaid: row.pricePaid,
          supermarketLocationId: row.supermarketLocationId,
        }))
      ).toEqual([
        {
          itemId: OAT_MILK,
          itemSnapshot: OAT_NAME,
          quantity: 2,
          pricePaid: { cents: 150, currency: 'EUR' },
          supermarketLocationId: SHOP,
        },
      ]);
      const entriesAfter = await purchases.listSessions({ userId: a.userId });
      expect(
        entriesAfter.items.find((entry) => entry.id === a.basket.id)
      ).toMatchObject({
        // The same line count, and the total of the rows that are shown.
        settledLineCount: entryBefore?.settledLineCount,
        anyBoughtLineCount: entryBefore?.anyBoughtLineCount,
        spent: { cents: 300, currency: 'EUR' },
        unpricedCount: 0,
      });
    });

    it('serves the name in a session of the list page too', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 1);
      const { settlement } = await settlements.settle({
        userId: a.userId,
        lineId: milk.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        itemSnapshot: MILK_NAME,
      });

      const rows = await purchases.listSessionRows({
        userId: a.userId,
        kind: TripKind.SESSION,
        entryId: settlement.id,
      });

      expect(rows.items.map((row) => row.itemSnapshot)).toEqual([MILK_NAME]);
    });
  }
);
