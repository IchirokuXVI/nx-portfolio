import {
  GENERATED_LIST_SHARING_PATTERNS,
  ITEM_PATTERNS,
  ItemCategory,
  ParticipantKind,
  PriceSourceKind,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  UnitOfMeasure,
  type CatalogScopeView,
  type GeneratedListBasketView,
  type GeneratedListParticipantContext,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { CatalogScopeRequiredException } from '@portfolio/luna-shopper/platform';
import { GeneratedListParticipantController } from './generated-list-sharing.controller';

/**
 * What a basket line costs, and where (plan 0066, sections 3 to 5).
 *
 * The basket read gained two things a client may ignore entirely: a `bestOffer`
 * on every product, and a description of every scope those offers name. Every
 * test here is about the two rules that make that safe rather than about the
 * numbers, which are catalog's and are proven there:
 *
 * - **the scope is the run's, never the reader's**, and failing to price is
 *   never failing to read (section 3);
 * - **the price reaches everybody and the shop reaches only a reader who passes
 *   the all or nothing rule** (section 5).
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';
const OWNER = 'u-owner';
const PROFILE = 'prof-home';
const SCOPE_A = 'scope-a';
const SCOPE_B = 'scope-b';

const participant = (
  overrides: Partial<GeneratedListParticipantContext> = {}
): GeneratedListParticipantContext => ({
  participantId: 'p-1',
  generatedListId: BASKET_ID,
  kind: ParticipantKind.GUEST,
  userId: null,
  seesZoneData: false,
  ...overrides,
});

const basketView = (seesZoneData: boolean): GeneratedListBasketView =>
  ({
    id: BASKET_ID,
    name: null,
    status: 'ACTIVE',
    generatedAt: '2026-09-01T08:00:00.000Z',
    lines: [
      {
        id: 'l1',
        content: 'Milk',
        quantity: 2,
        settledQuantity: 0,
        itemId: 'i-hacendado',
        options: ['i-hacendado', 'i-pascual', 'i-unpriced'],
        position: 0,
      },
    ],
    participants: [],
    me: { id: 'p-1', kind: ParticipantKind.GUEST, displayName: null },
    seesZoneData,
  }) as unknown as GeneratedListBasketView;

const item = (id: string, offer: ItemView['bestOffer']): ItemView => ({
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
  bestOffer: offer,
});

const offer = (itemId: string, priceScopeId: string, price: number) => ({
  itemId,
  priceScopeId,
  price,
  currency: 'EUR',
  unitPrice: price,
  unitPriceLabel: 'EUR/L',
  priceObservedAt: '2026-09-01T06:00:00.000Z',
  priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
});

/** The resolution the run's profile reaches: two scopes, one chain each. */
const resolution = (): CatalogScopeView => ({
  priceScopeIds: [SCOPE_A, SCOPE_B],
  scopes: [
    {
      priceScopeId: SCOPE_A,
      supermarketId: 'mercadona',
      postalCode: '14008',
      origin: 'POSTAL_CODE',
      approximate: false,
    },
    {
      priceScopeId: SCOPE_B,
      supermarketId: 'carrefour',
      postalCode: '14008',
      origin: 'POSTAL_CODE',
      approximate: false,
    },
  ],
  coverage: [],
  approximate: false,
  profileId: PROFILE,
  explicit: false,
});

interface World {
  readonly seesZoneData?: boolean;
  /** What catalog answers the priced lookup with, or a throw. */
  readonly items?: ItemView[] | 'throws';
  /** What the resolver does: a view, or a throw. */
  readonly resolves?: CatalogScopeView | 'throws';
  /** The run's profile, null for a run scoped by hand. */
  readonly profileId?: string | null;
}

function build(world: World = {}) {
  const calls: { subject: string; payload: unknown }[] = [];
  const send = jest.fn(async (subject: string, payload: unknown) => {
    calls.push({ subject, payload });
    switch (subject) {
      case GENERATED_LIST_SHARING_PATTERNS.basketGet:
        return basketView(world.seesZoneData ?? false);
      case GENERATED_LIST_SHARING_PATTERNS.searchScope:
        return {
          ownerUserId: OWNER,
          profileId: world.profileId === undefined ? PROFILE : world.profileId,
        };
      case ITEM_PATTERNS.getMany:
        if (world.items === 'throws') {
          throw new Error('catalog unreachable');
        }
        return {
          items: world.items ?? [
            item('i-hacendado', offer('i-hacendado', SCOPE_A, 0.95)),
            item('i-pascual', offer('i-pascual', SCOPE_A, 1.15)),
            item('i-unpriced', null),
          ],
        };
      case SUPERMARKET_PATTERNS.list:
        return {
          items: [
            { id: 'mercadona', name: { en: 'Mercadona', es: 'Mercadona' } },
            { id: 'carrefour', name: { en: 'Carrefour', es: 'Carrefour' } },
          ],
          nextCursor: null,
        };
      case SUPERMARKET_LOCATION_PATTERNS.list:
        return {
          items: [
            {
              id: 'loc-tejares',
              supermarketId: 'mercadona',
              priceScopeId: SCOPE_A,
              label: null,
              address: 'Ronda de los Tejares 32',
              city: 'Córdoba',
              country: 'ES',
              postalCode: '14008',
              latitude: null,
              longitude: null,
              externalRef: null,
              externalProvider: null,
            },
          ],
          nextCursor: null,
        };
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });

  const describe = jest.fn(async () => {
    if (world.resolves === 'throws') {
      throw new CatalogScopeRequiredException('empty profile');
    }
    return world.resolves ?? resolution();
  });

  const controller = new GeneratedListParticipantController(
    { send } as never,
    { describe } as never
  );

  const lookups = () =>
    calls
      .filter((call) => call.subject === ITEM_PATTERNS.getMany)
      .map(
        (call) => call.payload as { ids: string[]; priceScopeIds?: string[] }
      );
  const locationReads = () =>
    calls
      .filter((call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.list)
      .map((call) => call.payload as { priceScopeId?: string; userId: string });

  return { controller, send, describe, lookups, locationReads };
}

describe('GET /v1/generated-lists/:id/basket: prices (plan 0066)', () => {
  it("prices against the run's profile, never the reader's (section 3)", async () => {
    const { controller, describe, lookups } = build();

    // A registered participant with an account and, presumably, a profile of
    // their own. Nothing about them reaches the resolver.
    await controller.getBasket(
      participant({ kind: ParticipantKind.REGISTERED, userId: 'u-stranger' }),
      BASKET_ID
    );

    expect(describe).toHaveBeenCalledTimes(1);
    expect(describe).toHaveBeenCalledWith(OWNER, { profileId: PROFILE });
    expect(lookups()).toEqual([
      {
        ids: ['i-hacendado', 'i-pascual', 'i-unpriced'],
        priceScopeIds: [SCOPE_A, SCOPE_B],
      },
    ]);
  });

  it('answers the basket unpriced when the profile resolves to nothing (section 3.1)', async () => {
    const { controller, lookups } = build({ resolves: 'throws' });

    const result = await controller.getBasket(participant(), BASKET_ID);

    // No scopes on the lookup, so catalog answers names with no `bestOffer`
    // key, exactly as before; and no scope descriptions, because there is
    // nothing to describe. The read itself is untouched.
    expect(lookups()).toEqual([
      { ids: ['i-hacendado', 'i-pascual', 'i-unpriced'] },
    ]);
    expect(result.id).toBe(BASKET_ID);
    expect(result.scopes).toEqual([]);
  });

  it('answers the basket unpriced when the run names no profile', async () => {
    const { controller, describe, lookups } = build({ profileId: null });

    const result = await controller.getBasket(participant(), BASKET_ID);

    expect(describe).not.toHaveBeenCalled();
    expect(lookups()[0]).not.toHaveProperty('priceScopeIds');
    expect(result.scopes).toEqual([]);
  });

  it('answers the basket with no products and no scopes when catalog throws', async () => {
    const { controller } = build({ items: 'throws' });

    const result = await controller.getBasket(participant(), BASKET_ID);

    expect(result.id).toBe(BASKET_ID);
    expect(result.products).toEqual([]);
    expect(result.scopes).toEqual([]);
  });

  it('gives a guest the chain and no shops (section 5)', async () => {
    const { controller, locationReads } = build({ seesZoneData: false });

    const result = await controller.getBasket(
      participant({ kind: ParticipantKind.GUEST }),
      BASKET_ID
    );

    expect(result.scopes).toEqual([
      {
        priceScopeId: SCOPE_A,
        supermarketId: 'mercadona',
        supermarketName: { en: 'Mercadona', es: 'Mercadona' },
        locations: [],
      },
    ]);
    // Not fetched and then dropped: never asked for. The address is the
    // owner's geography and a guest's read has no business reaching it.
    expect(locationReads()).toEqual([]);
  });

  it('gives a reader who passes the rule the chain and its shops', async () => {
    const { controller, locationReads } = build({ seesZoneData: true });

    const result = await controller.getBasket(
      participant({
        kind: ParticipantKind.OWNER,
        userId: OWNER,
        seesZoneData: true,
      }),
      BASKET_ID
    );

    expect(result.scopes).toHaveLength(1);
    expect(result.scopes[0].supermarketName.en).toBe('Mercadona');
    expect(result.scopes[0].locations).toEqual([
      {
        supermarketLocationId: 'loc-tejares',
        label: null,
        address: 'Ronda de los Tejares 32',
        city: 'Córdoba',
        postalCode: '14008',
      },
    ]);
    // The shops of the one scope the offers name, read as the owner.
    expect(locationReads()).toEqual([
      expect.objectContaining({ priceScopeId: SCOPE_A, userId: OWNER }),
    ]);
  });

  it('describes exactly the scopes the offers reference, with no extras (section 4)', async () => {
    // The profile resolves to two scopes; every offer came from the first.
    const { controller } = build({ seesZoneData: true });

    const result = await controller.getBasket(
      participant({ kind: ParticipantKind.OWNER, seesZoneData: true }),
      BASKET_ID
    );

    expect(result.scopes.map((scope) => scope.priceScopeId)).toEqual([SCOPE_A]);
  });

  it('keeps the prices when the scopes cannot be named', async () => {
    const { controller, send } = build();
    send.mockImplementation(async (subject: string) => {
      if (subject === SUPERMARKET_PATTERNS.list) {
        throw new Error('catalog slow');
      }
      if (subject === GENERATED_LIST_SHARING_PATTERNS.basketGet) {
        return basketView(false);
      }
      if (subject === GENERATED_LIST_SHARING_PATTERNS.searchScope) {
        return { ownerUserId: OWNER, profileId: PROFILE };
      }
      return {
        items: [item('i-hacendado', offer('i-hacendado', SCOPE_A, 0.95))],
      };
    });

    const result = await controller.getBasket(participant(), BASKET_ID);

    // A price with no place is a smaller answer and still the answer to "how
    // much". The client is written to resolve a scope id to nothing.
    expect(result.products[0].bestOffer?.price).toBe(0.95);
    expect(result.scopes).toEqual([]);
  });
});
