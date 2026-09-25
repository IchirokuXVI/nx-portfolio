import {
  PROFILE_PATTERNS,
  PURCHASE_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  UserKind,
  type BasketShopView,
  type ProfileScopeSelector,
  type RecentShopIdsView,
} from '@portfolio/luna-shopper/contracts';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import type { NatsClient } from '../messaging/nats-client';
import { RecentShopsController } from './recent-shops.controller';

/**
 * The gateway's half of `GET /v1/account/recent-shops` (plan 0164, section 4):
 * core's ids and dates, named by catalog, in core's order, with a shop catalog
 * no longer holds left out. Which shops are recent is core's, proven in
 * `recent-shops.integration.spec.ts` against real Postgres.
 */

const USER = { userId: 'user-1', kind: UserKind.REGISTERED };

function shop(id: string, inProfile = true): BasketShopView {
  return {
    id,
    supermarketId: 'chain-1',
    supermarketName: { en: 'Mart', es: 'Mart' },
    label: null,
    address: `Calle ${id}`,
    city: 'Córdoba',
    postalCode: '14001',
    inProfile,
  };
}

function build(recent: RecentShopIdsView, named: BasketShopView[]) {
  const sent: { subject: string; payload: unknown }[] = [];
  const nats = {
    send: async (subject: string, payload: unknown) => {
      sent.push({ subject, payload });
      if (subject === PURCHASE_PATTERNS.recentShops) {
        return recent;
      }
      if (subject === PROFILE_PATTERNS.resolveScopes) {
        return {
          profileId: 'default-profile',
          postalCodes: ['14001', '14002'],
          supermarketIds: [],
          excludedSupermarketIds: [],
          excludedSupermarketLocationIds: [],
          empty: false,
        } satisfies ProfileScopeSelector;
      }
      if (subject === SUPERMARKET_LOCATION_PATTERNS.shopsById) {
        // Catalog answers in no particular order.
        return { shops: [...named].reverse() };
      }
      throw new Error(`unexpected ${subject}`);
    },
  } as unknown as NatsClient;
  const controller = new RecentShopsController(
    nats,
    new ScopeResolutionService(nats, {} as never)
  );
  return { controller, sent };
}

describe('RecentShopsController (plan 0164)', () => {
  it('names core’s shops in core’s order, and leaves out one catalog no longer holds', async () => {
    const { controller, sent } = build(
      {
        shops: [
          {
            supermarketLocationId: 'b',
            lastBoughtAt: '2026-09-20T10:00:00.000Z',
          },
          {
            supermarketLocationId: 'gone',
            lastBoughtAt: '2026-09-10T10:00:00.000Z',
          },
          {
            supermarketLocationId: 'a',
            lastBoughtAt: '2026-08-01T10:00:00.000Z',
          },
        ],
      },
      [shop('a'), shop('b', false)]
    );

    const answer = await controller.recentShops(USER);

    expect(answer).toEqual({
      shops: [
        { shop: shop('b', false), lastBoughtAt: '2026-09-20T10:00:00.000Z' },
        { shop: shop('a'), lastBoughtAt: '2026-08-01T10:00:00.000Z' },
      ],
    });
    expect(sent[0]).toEqual({
      subject: PURCHASE_PATTERNS.recentShops,
      payload: { userId: 'user-1' },
    });
    // The caller's default profile names `inProfile`.
    expect(sent[1]).toEqual({
      subject: PROFILE_PATTERNS.resolveScopes,
      payload: { userId: 'user-1', profileId: undefined },
    });
    expect(sent[2]).toEqual({
      subject: SUPERMARKET_LOCATION_PATTERNS.shopsById,
      payload: {
        supermarketLocationIds: ['b', 'gone', 'a'],
        profilePostalCodes: ['14001', '14002'],
      },
    });
  });

  it('answers empty without asking anybody else when core has nothing', async () => {
    const { controller, sent } = build({ shops: [] }, []);

    expect(await controller.recentShops(USER)).toEqual({ shops: [] });
    expect(sent.map((s) => s.subject)).toEqual([PURCHASE_PATTERNS.recentShops]);
  });
});
