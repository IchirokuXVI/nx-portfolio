import {
  BASKET_PATTERNS,
  ITEM_PATTERNS,
  ItemCategory,
  ParticipantKind,
  PriceSourceKind,
  PRODUCT_GROUP_MEMBERS_MAX,
  SUPERMARKET_PATTERNS,
  UnitOfMeasure,
  type BasketParticipantContext,
  type CatalogScopeView,
  type CatalogSuggestResponse,
  type ItemOfferView,
  type ItemPage,
  type ItemView,
  type ProductGroupOfferPage,
} from '@portfolio/luna-shopper/contracts';
import type { CurrentUser } from '../auth/jwt.strategy';
import { BasketCatalogService } from '../baskets/basket-catalog.service';
import { BasketSuggestQueryDto } from '../baskets/basket-sharing.dto';
import { BasketController } from '../baskets/basket.controller';
import { CatalogSuggestService } from './catalog-suggest.service';
import { CatalogSuggestController } from './catalog.controller';
import { SuggestQueryDto } from './catalog.dto';

/**
 * A suggestion carries what the card draws (plan 0161, sections 1 to 3), on
 * both suggest routes.
 *
 * Which offers and members catalog answers is proven in catalog. What is proven
 * here is the gateway's half: both routes ask for every offer and five members,
 * and `scopes` names every scope an offer on the response mentions, only those,
 * and never by guessing.
 */

const USER: CurrentUser = { userId: 'u-caller' } as CurrentUser;
const OWNER = 'u-owner';
const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

/** Mercadona. The group's own offer and one item's second offer. */
const SCOPE_A = 'scope-a';
/** Carrefour. The cheapest member's second offer and a member's best offer. */
const SCOPE_B = 'scope-b';
/** Dia. Resolved, and quoted by nothing on the response. */
const SCOPE_C = 'scope-c';
/** Quoted by an item, and not described by the resolution. */
const SCOPE_UNKNOWN = 'scope-unknown';
/** Quoted by an item, resolved to a chain the listing does not return. */
const SCOPE_NO_CHAIN = 'scope-no-chain';

const offer = (itemId: string, priceScopeId: string): ItemOfferView => ({
  itemId,
  priceScopeId,
  price: 1,
  currency: 'EUR',
  unitPrice: 1,
  unitPriceLabel: 'L',
  unitBasis: 'LITER',
  observedAt: '2026-09-20T10:00:00.000Z',
  sourceKind: PriceSourceKind.OFFICIAL_WEB,
  priceCopiedFromScopeId: null,
  stale: false,
});

const item = (id: string, extra: Partial<ItemView> = {}): ItemView => ({
  id,
  name: { en: id, es: id },
  brand: null,
  imageUrl: null,
  sku: null,
  ean: null,
  unitSize: 1,
  category: ItemCategory.DAIRY,
  defaultUnit: UnitOfMeasure.LITER,
  productGroupId: null,
  ...extra,
});

const groups = (): ProductGroupOfferPage => {
  const groupOffer = offer('i-cheapest', SCOPE_A);
  return {
    items: [
      {
        group: {
          id: 'g-milk',
          name: { en: 'Milk', es: 'Leche' },
          slug: 'milk',
          referenceUnit: UnitOfMeasure.LITER,
          synonyms: { en: [], es: [] },
        },
        cheapestItem: item('i-cheapest', {
          bestOffer: groupOffer,
          offers: [groupOffer, offer('i-cheapest', SCOPE_B)],
        }),
        offer: groupOffer,
        itemIds: ['i-cheapest', 'i-second', 'i-third'],
        members: [
          item('i-cheapest', { bestOffer: groupOffer }),
          item('i-second', { bestOffer: offer('i-second', SCOPE_B) }),
          item('i-third'),
        ],
      },
    ],
    nextCursor: null,
  };
};

const items = (): ItemPage => ({
  items: [
    item('i-both', {
      bestOffer: offer('i-both', SCOPE_A),
      offers: [offer('i-both', SCOPE_A), offer('i-both', SCOPE_UNKNOWN)],
    }),
    item('i-orphan', {
      bestOffer: offer('i-orphan', SCOPE_NO_CHAIN),
      offers: [offer('i-orphan', SCOPE_NO_CHAIN)],
    }),
  ],
  nextCursor: null,
});

const resolution = (): CatalogScopeView => ({
  priceScopeIds: [SCOPE_A, SCOPE_B, SCOPE_C, SCOPE_NO_CHAIN],
  scopes: [
    [SCOPE_A, 'mercadona'],
    [SCOPE_B, 'carrefour'],
    [SCOPE_C, 'dia'],
    [SCOPE_NO_CHAIN, 'gone'],
  ].map(([priceScopeId, supermarketId]) => ({
    priceScopeId,
    supermarketId,
    postalCode: '14013',
    origin: 'POSTAL_CODE',
    approximate: false,
  })),
  coverage: [],
  approximate: false,
  profileId: 'prof-home',
  explicit: false,
});

interface World {
  readonly chains?: 'throws';
  readonly resolves?: CatalogScopeView;
}

function build(world: World = {}) {
  const calls: { subject: string; payload: unknown }[] = [];
  const send = jest.fn(async (subject: string, payload: unknown) => {
    calls.push({ subject, payload });
    switch (subject) {
      case ITEM_PATTERNS.searchOffers:
        return groups();
      case ITEM_PATTERNS.search:
        return items();
      case SUPERMARKET_PATTERNS.list:
        if (world.chains === 'throws') {
          throw new Error('catalog slow');
        }
        return {
          items: ['mercadona', 'carrefour', 'dia'].map((id) => ({
            id,
            name: { en: id, es: id },
          })),
          nextCursor: null,
        };
      case BASKET_PATTERNS.searchScope:
        return {
          ownerUserId: OWNER,
          profileId: 'prof-home',
          servesLocations: false,
        };
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });
  const describe = jest.fn(async () => world.resolves ?? resolution());
  const suggestions = new CatalogSuggestService({ send } as never);

  const catalogRoute = new CatalogSuggestController(suggestions, {
    describe,
  } as never);
  const basketRoute = new BasketController(
    { send } as never,
    new BasketCatalogService(
      { send } as never,
      { describe } as never,
      suggestions
    ),
    {} as never
  );

  const catalogQuery = new SuggestQueryDto();
  catalogQuery.q = 'leche';
  const basketQuery = new BasketSuggestQueryDto();
  basketQuery.q = 'leche';

  const routes: Record<
    'catalog' | 'basket',
    (participant?: BasketParticipantContext) => Promise<CatalogSuggestResponse>
  > = {
    catalog: () => catalogRoute.suggest(USER, catalogQuery),
    basket: (participant) =>
      basketRoute.suggest(
        participant ?? {
          participantId: 'p-owner',
          basketId: BASKET_ID,
          kind: ParticipantKind.OWNER,
          userId: OWNER,
        },
        BASKET_ID,
        basketQuery
      ),
  };
  const sent = (subject: string) =>
    calls.filter((call) => call.subject === subject).map((c) => c.payload);

  return { routes, sent, describe };
}

const chainOf = (priceScopeId: string, supermarketId: string) => ({
  priceScopeId,
  supermarketId,
  supermarketName: { en: supermarketId, es: supermarketId },
});

describe.each(['catalog', 'basket'] as const)(
  'the %s suggest route (plan 0161)',
  (route) => {
    it('asks catalog for every offer, and for five members on groups only', async () => {
      const { routes, sent } = build();

      await routes[route]();

      expect(sent(ITEM_PATTERNS.search)).toEqual([
        expect.objectContaining({ offers: 'all' }),
      ]);
      expect(sent(ITEM_PATTERNS.search)[0]).not.toHaveProperty('members');
      expect(sent(ITEM_PATTERNS.searchOffers)).toEqual([
        expect.objectContaining({
          offers: 'all',
          members: PRODUCT_GROUP_MEMBERS_MAX,
        }),
      ]);
    });

    it('names every scope an offer mentions, and only those', async () => {
      const { routes } = build();

      const result = await routes[route]();

      // A from the group's offer and from an item, B from the cheapest
      // member's offers and from a member. C is resolved and quoted by
      // nothing, so it is not here.
      expect(
        [...result.scopes].sort((a, b) =>
          a.priceScopeId.localeCompare(b.priceScopeId)
        )
      ).toEqual([chainOf(SCOPE_A, 'mercadona'), chainOf(SCOPE_B, 'carrefour')]);
    });

    it('leaves out a scope it cannot name, and keeps the offer', async () => {
      const { routes } = build();

      const result = await routes[route]();

      const named = result.scopes.map((scope) => scope.priceScopeId);
      // Not described by the resolution, and described with a chain the
      // listing does not return: neither is guessed.
      expect(named).not.toContain(SCOPE_UNKNOWN);
      expect(named).not.toContain(SCOPE_NO_CHAIN);
      const offers = result.suggestions
        .flatMap((s) => s.item?.offers ?? [])
        .map((o) => o.priceScopeId);
      expect(offers).toEqual(
        expect.arrayContaining([SCOPE_UNKNOWN, SCOPE_NO_CHAIN])
      );
    });

    it('answers no scopes, and the same suggestions, when the chain listing throws', async () => {
      const named = await build().routes[route]();
      const failed = await build({ chains: 'throws' }).routes[route]();

      expect(failed.scopes).toEqual([]);
      expect(failed.suggestions).toEqual(named.suggestions);
    });

    it('names nothing for a caller who named scope ids outright', async () => {
      const { routes } = build({
        resolves: {
          ...resolution(),
          scopes: [],
          profileId: null,
          explicit: true,
        },
      });

      const result = await routes[route]();

      expect(result.scopes).toEqual([]);
      expect(result.suggestions).toHaveLength(3);
    });
  }
);

describe('the basket suggest route for a guest (plan 0161)', () => {
  it('answers a guest the same members and scopes as the owner', async () => {
    const owner = await build().routes.basket();
    const guest = await build().routes.basket({
      participantId: 'p-guest',
      basketId: BASKET_ID,
      kind: ParticipantKind.GUEST,
      userId: null,
    });

    expect(guest).toEqual(owner);
    expect(guest.suggestions[0].group?.members).toHaveLength(3);
    expect(guest.scopes).toHaveLength(2);
  });
});
