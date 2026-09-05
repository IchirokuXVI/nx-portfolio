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
import type { ShopperSelection } from '../catalog/scope-resolution.service';
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
  observedAt: '2026-09-01T06:00:00.000Z',
  sourceKind: PriceSourceKind.OFFICIAL_WEB,
  stale: false,
});

/** A Mercadona shop in the scope every offer below comes from. */
const location = (id: string, address: string) => ({
  id,
  supermarketId: 'mercadona',
  priceScopeId: SCOPE_A,
  label: null,
  address,
  city: 'Córdoba',
  country: 'ES',
  postalCode: '14008',
  latitude: null,
  longitude: null,
  externalRef: null,
  externalProvider: null,
});

/** The shop of that scope, as the basket names it. */
const named = (id: string, address: string) => ({
  supermarketLocationId: id,
  label: null,
  address,
  city: 'Córdoba',
  postalCode: '14008',
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
  /** What the resolver answers with. */
  readonly resolves?: CatalogScopeView;
  /**
   * The profile core answers with, null for a run composed before plan 0078.
   *
   * A run scoped by hand used to answer null here, which is why no basket
   * velista created ever showed a price. Since plan 0078 core answers the
   * snapshot's `pricingProfileId`, so only a run older than that plan is
   * unpriced.
   */
  readonly profileId?: string | null;
  /** What the run's profile refuses (plan 0064), or a throw. */
  readonly refuses?: ShopperSelection | 'throws';
}

/** Refusing nothing, which is the default every test but two runs with. */
const refusesNothing = (): ShopperSelection => ({
  profileId: PROFILE,
  postalCodes: ['14008'],
  excludedSupermarketIds: [],
  excludedSupermarketLocationIds: [],
});

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
            location('loc-tejares', 'Ronda de los Tejares 32'),
            location('loc-lagartijo', 'Avenida del Gran Capitán 5'),
          ],
          nextCursor: null,
        };
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });

  const describe = jest.fn(async () => world.resolves ?? resolution());
  const forShops = jest.fn(async (): Promise<ShopperSelection> => {
    if (world.refuses === 'throws') {
      throw new Error('core slow');
    }
    return world.refuses ?? refusesNothing();
  });

  const controller = new GeneratedListParticipantController(
    { send } as never,
    { describe, forShops } as never
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

  return { controller, send, describe, forShops, lookups, locationReads };
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
    const { controller, lookups } = build({
      // The ordinary path, not the `catch`: since plan 0069 an empty profile
      // resolves to no scopes rather than raising, so this arrives as a view
      // with nothing in it and the read carries on.
      resolves: {
        priceScopeIds: [],
        scopes: [],
        coverage: [],
        approximate: false,
        profileId: PROFILE,
        explicit: false,
      },
    });

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

  it('answers the basket unpriced for a run composed before plan 0078', async () => {
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
      named('loc-tejares', 'Ronda de los Tejares 32'),
      named('loc-lagartijo', 'Avenida del Gran Capitán 5'),
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

  it("never names a shop the run's profile switched off (section 4)", async () => {
    const { controller, forShops } = build({
      seesZoneData: true,
      refuses: {
        ...refusesNothing(),
        excludedSupermarketLocationIds: ['loc-tejares'],
      },
    });

    const result = await controller.getBasket(
      participant({ kind: ParticipantKind.OWNER, seesZoneData: true }),
      BASKET_ID
    );

    // The refusals are the run's, asked for by the run's profile, exactly as
    // the prices are.
    expect(forShops).toHaveBeenCalledWith(OWNER, { profileId: PROFILE });
    expect(result.scopes[0].locations).toEqual([
      named('loc-lagartijo', 'Avenida del Gran Capitán 5'),
    ]);
  });

  it('hides every shop of a chain refused whole (plan 0064, section 2.1)', async () => {
    const { controller, locationReads } = build({
      seesZoneData: true,
      refuses: {
        ...refusesNothing(),
        excludedSupermarketIds: ['mercadona'],
      },
    });

    const result = await controller.getBasket(
      participant({ kind: ParticipantKind.OWNER, seesZoneData: true }),
      BASKET_ID
    );

    // The chain still names the price, because the price is real and came from
    // a resolution made before the chain was refused. Its shops are not
    // fetched and then dropped: never asked for.
    expect(result.scopes[0].supermarketName.en).toBe('Mercadona');
    expect(result.scopes[0].locations).toEqual([]);
    expect(locationReads()).toEqual([]);
  });

  it('does not ask what a guest, who sees no shops, has refused', async () => {
    const { controller, forShops } = build({ seesZoneData: false });

    await controller.getBasket(participant(), BASKET_ID);

    expect(forShops).not.toHaveBeenCalled();
  });

  it('keeps the shops when the refusals cannot be read', async () => {
    const { controller } = build({ seesZoneData: true, refuses: 'throws' });

    const result = await controller.getBasket(
      participant({ kind: ParticipantKind.OWNER, seesZoneData: true }),
      BASKET_ID
    );

    // A preference that cannot be applied is not a disclosure: `seesZoneData`
    // already decided this reader may see the shops, so core being slow costs
    // an excluded shop staying on the list rather than costing the address.
    expect(result.scopes[0].locations).toHaveLength(2);
  });

  it('asks for no refusals for a run composed before plan 0078', async () => {
    const { controller, forShops } = build({
      seesZoneData: true,
      profileId: null,
    });

    const result = await controller.getBasket(
      participant({ kind: ParticipantKind.OWNER, seesZoneData: true }),
      BASKET_ID
    );

    // Naming none would resolve the owner's default profile, whose opinions
    // about shops are not the ones this basket was composed against.
    expect(forShops).not.toHaveBeenCalled();
    expect(result.scopes).toEqual([]);
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
