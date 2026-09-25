import {
  BasketKind,
  BasketStatus,
  MembershipStatus,
  ParticipantKind,
  RECENT_SHOP_DAYS,
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
  Basket,
  BasketParticipant,
  CORE_ENTITIES,
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { RecentShopsService } from './recent-shops.service';

/**
 * The shops one person bought at recently, against real Postgres (plan 0164,
 * section 4).
 *
 * Every rule is a `WHERE` or a `UNION`, so a fake would agree with itself.
 * What is proven: a shop reaches the reader through each of the three purchase
 * routes, the window is sixty days and nothing else, a reverted settle and a
 * `NOT_AVAILABLE` settle do not count, a settle with no shop does not count,
 * somebody else's purchases never do, and the answer is newest first with the
 * latest date of each shop.
 *
 * Dates are relative to now, so the window cannot drift past a fixed date.
 *
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=recent-shops.integration.spec.ts
 */
describeIntegration(
  'the shops a person bought at recently (real Postgres)',
  () => {
    let dataSource: DataSource;
    let service: RecentShopsService;

    /** The account this test shops as. A new one before every test. */
    let reader = '';
    /** Somebody else, with baskets of their own. */
    const friend = randomUUID();
    const owners: string[] = [friend];
    let zoneId = '';
    let position = 0;

    const SCOPE = randomUUID();
    const CHAIN = randomUUID();

    /** A moment `days` days ago. */
    function daysAgo(days: number): Date {
      return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }

    async function lineOnNewList(): Promise<{
      listId: string;
      lineId: string;
    }> {
      const lists = dataSource.getRepository(ShoppingList);
      const list = await lists.save(
        lists.create({ zoneId, name: 'Recent shops', createdByUserId: reader })
      );
      const lines = dataSource.getRepository(ListLine);
      position += 1;
      const line = await lines.save(
        lines.create({
          listId: list.id,
          content: 'Milk',
          quantity: 5,
          position,
          createdByUserId: reader,
        })
      );
      return { listId: list.id, lineId: line.id };
    }

    async function basket(ownerUserId: string): Promise<string> {
      const repo = dataSource.getRepository(Basket);
      const saved = await repo.save(
        repo.create({
          ownerUserId,
          name: 'Trip',
          status: BasketStatus.FINISHED,
          generatedAt: daysAgo(1),
          kind: BasketKind.GENERATED,
          idempotencyKey: null,
        })
      );
      return saved.id;
    }

    async function participant(
      basketId: string,
      userId: string | null
    ): Promise<string> {
      const repo = dataSource.getRepository(BasketParticipant);
      const saved = await repo.save(
        repo.create({
          basketId,
          shareLinkId: null,
          kind: userId ? ParticipantKind.REGISTERED : ParticipantKind.GUEST,
          userId,
          displayName: userId ? null : 'Guest',
          username: userId ? 'Shopper' : null,
          guestNumber: userId ? null : 1,
          sessionSecretHash: null,
          userAgent: null,
          joinedAt: daysAgo(2),
          lastSeenAt: daysAgo(2),
          revokedAt: null,
          endedReason: null,
          invitedAt: null,
          invitedByUserId: null,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
      );
      return saved.id;
    }

    /**
     * One settle at a shop, `days` ago. With a participant it is a basket settle;
     * without one it is a list page settle by `userId`, the reader by default.
     */
    async function settled(
      shop: string | null,
      days: number,
      options: {
        outcome?: SettlementOutcome;
        basketId?: string;
        participantId?: string;
        userId?: string;
        reverted?: boolean;
      } = {}
    ): Promise<void> {
      const { listId, lineId } = await lineOnNewList();
      const outcome = options.outcome ?? SettlementOutcome.BOUGHT;
      const byParticipant = options.participantId !== undefined;
      const repo = dataSource.getRepository(LineSettlement);
      await repo.save(
        repo.create({
          lineId,
          listId,
          itemId: null,
          outcome,
          quantity: outcome === SettlementOutcome.BOUGHT ? 1 : 0,
          settledByUserId: byParticipant ? null : (options.userId ?? reader),
          settledByParticipantId: byParticipant
            ? (options.participantId as string)
            : null,
          settledAt: daysAgo(days),
          revertedAt: options.reverted ? new Date() : null,
          revertedByParticipantId: options.reverted ? randomUUID() : null,
          basketId: options.basketId ?? null,
          pricePaidCents: null,
          pricePaidCurrency: null,
          // A shop is never recorded without a scope, and its chain never
          // without the shop (`ck_line_settlements_location_scope`).
          priceScopeId: shop ? SCOPE : null,
          supermarketLocationId: shop,
          supermarketId: shop ? CHAIN : null,
        })
      );
    }

    async function recent(): Promise<[string, number][]> {
      const answer = await service.recentShops({ userId: reader });
      // Whole days ago, rounded, so the assertion reads as the fixture does.
      return answer.shops.map((shop) => [
        shop.supermarketLocationId,
        Math.round(
          (Date.now() - new Date(shop.lastBoughtAt).getTime()) /
            (24 * 60 * 60 * 1000)
        ),
      ]);
    }

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();
      service = new RecentShopsService(dataSource);

      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Recent Shops',
          joinCode:
            `RSH${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: friend,
          config: {},
        })
      );
      zoneId = zone.id;
    });

    beforeEach(async () => {
      reader = randomUUID();
      owners.push(reader);
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save(
        memberships.create({
          zoneId,
          userId: reader,
          username: 'Shopper',
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        })
      );
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        const baskets = dataSource.getRepository(Basket);
        for (const owner of owners) {
          await baskets.delete({ ownerUserId: owner });
        }
        if (zoneId) {
          await dataSource.getRepository(Zone).delete({ id: zoneId });
        }
        await dataSource.destroy();
      }
    });

    it('is sixty days', () => {
      expect(RECENT_SHOP_DAYS).toBe(60);
    });

    it('finds a shop by each of the three purchase routes, newest first', async () => {
      const byListPage = randomUUID();
      const byOwnBasket = randomUUID();
      const byTheirBasket = randomUUID();

      // 1. The reader's list page settle.
      await settled(byListPage, 10);
      // 2. A basket the reader owns, bought by a guest.
      const mine = await basket(reader);
      const guest = await participant(mine, null);
      await settled(byOwnBasket, 3, { basketId: mine, participantId: guest });
      // 3. Somebody else's basket, bought by the reader as a participant.
      const theirs = await basket(friend);
      const me = await participant(theirs, reader);
      await settled(byTheirBasket, 20, { basketId: theirs, participantId: me });

      expect(await recent()).toEqual([
        [byOwnBasket, 3],
        [byListPage, 10],
        [byTheirBasket, 20],
      ]);
    });

    it('answers one row per shop with its latest settle', async () => {
      const shop = randomUUID();
      await settled(shop, 40);
      await settled(shop, 5);
      await settled(shop, 12);

      expect(await recent()).toEqual([[shop, 5]]);
    });

    it('counts sixty days and nothing older', async () => {
      const inside = randomUUID();
      const outside = randomUUID();
      await settled(inside, 59);
      await settled(outside, 61);

      expect(await recent()).toEqual([[inside, 59]]);
    });

    it('leaves out reverted and NOT_AVAILABLE settles, and settles with no shop', async () => {
      const reverted = randomUUID();
      const unavailable = randomUUID();
      const bought = randomUUID();
      await settled(reverted, 2, { reverted: true });
      await settled(unavailable, 2, {
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      await settled(null, 1);
      await settled(bought, 4);

      expect(await recent()).toEqual([[bought, 4]]);
    });

    it('keeps a shop whose only newer settle was reverted, at its older date', async () => {
      const shop = randomUUID();
      await settled(shop, 9);
      await settled(shop, 1, { reverted: true });

      expect(await recent()).toEqual([[shop, 9]]);
    });

    it('finds nothing of somebody else’s', async () => {
      // The friend's own list page settle, and a basket the friend owns that
      // the friend shopped: neither is the reader's by any route.
      await settled(randomUUID(), 1, { userId: friend });
      const theirs = await basket(friend);
      const them = await participant(theirs, friend);
      await settled(randomUUID(), 1, { basketId: theirs, participantId: them });

      expect(await recent()).toEqual([]);
    });

    it('starts empty', async () => {
      expect(await service.recentShops({ userId: reader })).toEqual({
        shops: [],
      });
    });
  }
);
