import {
  ITEM_PATTERNS,
  PriceSourceKind,
  SUPERMARKET_LOCATION_PATTERNS,
  UnitOfMeasure,
  type CatalogScopeView,
  type GetItemsRequest,
  type ItemOfferView,
  type ItemSnapshot,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import {
  pricedItemId,
  SETTLE_PRICE_BUDGET_MS,
  SettlePriceService,
  snapshotOf,
  type RewritePriceInput,
  type SettlePriceInput,
} from './settle-price.service';

/**
 * What a settle cost and what its product was called, read by the gateway
 * (plan 0143, section 9; plan 0202, sections 1 to 3).
 *
 * The one property every test here serves is the one plan 0143 states twice:
 * **a price never fails a settle, and never delays one past its budget.** So
 * each way of not knowing a price is its own case, because "never fails" is a
 * list of cases rather than a single assertion, and each one ends in nulls and
 * an answer the settle can send.
 *
 * Since plan 0202 the gateway chooses the price. No scope a client sends is
 * read: a settle at a shop records the price of that shop, and a settle with
 * no shop records the cheapest price across the owner's scopes. The same read
 * answers what the product is called.
 */

const OWNER = 'u-owner';
const PROFILE = 'prof-home';
const SCOPE = 'b4e2c6a8-1f37-4d95-8a0b-2c6e4f9a1d73';
const OTHER_SCOPE = '1f37b4e2-c6a8-4d95-8a0b-2c6e4f9a1d73';
const ITEM = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';
const SHOP = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';
/** The chain SHOP belongs to, recorded beside it (plan 0163). */
const CHAIN = '4a81b37d-95f8-4b2c-8e4f-9a1d73b4e2c6';
/** A scope no profile here resolves: the stack of a shop outside it. */
const FAR_SCOPE = 'e2c64a81-b37d-495f-80b2-c6e4f9a1d73b';

const offer = (
  priceScopeId: string,
  price: number | null,
  extra: Partial<ItemOfferView> = {}
): ItemOfferView => ({
  itemId: ITEM,
  priceScopeId,
  price,
  currency: price === null ? null : 'EUR',
  unitPrice: null,
  unitPriceLabel: null,
  unitBasis: null,
  observedAt: '2026-09-01T08:00:00.000Z',
  sourceKind: PriceSourceKind.OFFICIAL_API,
  priceCopiedFromScopeId: null,
  stale: false,
  ...extra,
});

/** What a buy copies of the product below (plan 0202, section 1). */
const SNAPSHOT: ItemSnapshot = {
  name: { en: 'Milk', es: 'Leche' },
  brand: 'Hacendado',
  unitSize: 1,
  packCount: 6,
  defaultUnit: UnitOfMeasure.LITER,
};

/**
 * One product as catalog answers it. `offers` is what an `offers: 'all'` read
 * carries and `bestOffer` what an `offers: 'best'` read does, so one fixture
 * serves both reads. `categoryId` is here to be left out of the snapshot.
 */
const product = (
  offers: ItemOfferView[],
  bestOffer: ItemOfferView | null = offers[0] ?? null
): ItemView =>
  ({
    id: ITEM,
    ...SNAPSHOT,
    categoryId: 'cat-dairy',
    offers,
    bestOffer,
  }) as unknown as ItemView;

/** Two scopes, one chain each, which is what the owner's profile reaches. */
const resolution = (): CatalogScopeView => ({
  priceScopeIds: [SCOPE, OTHER_SCOPE],
  scopes: [
    {
      priceScopeId: SCOPE,
      supermarketId: 'mercadona',
      postalCode: '14013',
      origin: 'POSTAL_CODE',
      approximate: false,
      supermarketLocationId: null,
      priority: 0,
      quoted: true,
      priced: true,
    },
    {
      priceScopeId: OTHER_SCOPE,
      supermarketId: 'carrefour',
      postalCode: '14013',
      origin: 'POSTAL_CODE',
      approximate: false,
      supermarketLocationId: null,
      priority: 0,
      quoted: true,
      priced: true,
    },
  ],
  coverage: [],
  approximate: false,
  profileId: PROFILE,
  explicit: false,
});

interface World {
  /** What catalog answers the product read with, a throw, or silence. */
  readonly items?: ItemView[] | 'throws' | 'never answers';
  /** What the resolver answers with, a throw, or silence. */
  readonly resolves?: CatalogScopeView | 'throws' | 'never answers';
  /**
   * The scope stack catalog answers for SHOP (plan 0163), or a throw. The shop
   * is priced at the first scope of it.
   */
  readonly shopStack?: string[] | 'throws';
}

function build(world: World = {}) {
  const calls: string[] = [];
  /** Every product read, as it was asked. */
  const lookups: GetItemsRequest[] = [];
  const send = jest.fn(async (subject: string, payload?: unknown) => {
    calls.push(subject);
    switch (subject) {
      case ITEM_PATTERNS.getMany:
        lookups.push(payload as GetItemsRequest);
        if (world.items === 'throws') {
          throw new Error('catalog unreachable');
        }
        if (world.items === 'never answers') {
          // Nest's NATS client has no timeout of its own, so this is exactly
          // what a catalog that stopped answering looks like from here.
          return new Promise(() => undefined);
        }
        return {
          items: (world.items ?? [product([offer(SCOPE, 0.95)])]).map((item) =>
            // Catalog reads no price for a request that names no scope.
            (payload as GetItemsRequest).priceScopeIds === undefined
              ? { ...item, offers: undefined, bestOffer: undefined }
              : item
          ),
        };
      case SUPERMARKET_LOCATION_PATTERNS.shopAvailability:
        if (world.shopStack === 'throws') {
          throw new Error('catalog unreachable');
        }
        return {
          location: {
            id: SHOP,
            supermarketId: CHAIN,
            priceScopeId: (world.shopStack ?? [SCOPE])[0],
            priceScopeIds: world.shopStack ?? [SCOPE],
          },
          supermarket: {
            id: CHAIN,
            name: { en: 'Mercadona', es: 'Mercadona' },
          },
          availability: [],
        };
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });

  const describe = jest.fn(
    async (_userId: string, _options: { profileId?: string }) => {
      if (world.resolves === 'throws') {
        throw new Error('core slow');
      }
      if (world.resolves === 'never answers') {
        return new Promise<CatalogScopeView>(() => undefined);
      }
      return world.resolves ?? resolution();
    }
  );

  return {
    service: new SettlePriceService({ send } as never, { describe } as never),
    calls,
    lookups,
    describe,
  };
}

/** The ordinary settle: the owner's scopes, one product, no shop. */
const input = (extra: Partial<SettlePriceInput> = {}): SettlePriceInput => ({
  userId: OWNER,
  profileId: PROFILE,
  itemId: ITEM,
  supermarketLocationId: undefined,
  servedLocations: false,
  ...extra,
});

/** The same settle at SHOP, by a reader who is served shops. */
const atShop = (extra: Partial<SettlePriceInput> = {}): SettlePriceInput =>
  input({ supermarketLocationId: SHOP, servedLocations: true, ...extra });

describe('what a settle with no shop records (plan 0202, section 2)', () => {
  it('records the cheapest price across the owner’s scopes, its scope, and no shop and no chain', async () => {
    const w = build({
      items: [product([], offer(OTHER_SCOPE, 0.89))],
    });

    expect(await w.service.choose(input())).toEqual({
      paid: {
        priceScopeId: OTHER_SCOPE,
        // The scope of the cheapest price is not where the person stood.
        supermarketLocationId: null,
        supermarketId: null,
        // Catalog holds currency units with two decimals; the column is the
        // minor unit.
        pricePaidCents: 89,
        pricePaidCurrency: 'EUR',
      },
      itemSnapshot: SNAPSHOT,
    });
  });

  // `offers: 'best'` is catalog's own answer to "the cheapest across these
  // scopes", so no price is compared in the gateway.
  it('asks catalog for that one product at the owner’s scopes, and for the best offer', async () => {
    const w = build();

    await w.service.choose(input());

    expect(w.describe).toHaveBeenCalledWith(OWNER, { profileId: PROFILE });
    expect(w.lookups).toEqual([
      { ids: [ITEM], priceScopeIds: [SCOPE, OTHER_SCOPE], offers: 'best' },
    ]);
    expect(w.calls).toEqual([ITEM_PATTERNS.getMany]);
  });

  it('rounds to the cent rather than truncating', async () => {
    const w = build({ items: [product([], offer(SCOPE, 2.675))] });

    expect((await w.service.choose(input())).paid?.pricePaidCents).toBe(268);
  });

  // It is the number the screen showed, which is the whole definition of the
  // column: what was paid as far as anybody knew at the shelf.
  it('records a stale offer', async () => {
    const w = build({
      items: [product([], offer(SCOPE, 1.2, { stale: true }))],
    });

    expect((await w.service.choose(input())).paid?.pricePaidCents).toBe(120);
  });

  describe('it records no price, and still the name', () => {
    it.each([
      ['no scope of the owner prices the product', product([], null)],
      ['the best offer has no amount', product([], offer(SCOPE, null))],
    ])('when %s', async (_name, item) => {
      const w = build({ items: [item] });

      expect(await w.service.choose(input())).toEqual({
        paid: null,
        itemSnapshot: SNAPSHOT,
      });
    });

    // A profile emptied or deleted since, or a core that did not answer. No
    // scope resolves, so the read is for the name alone: it carries no scopes
    // and no `offers`.
    it('when the resolver throws, and the product is read with no scopes', async () => {
      const w = build({ resolves: 'throws' });

      expect(await w.service.choose(input())).toEqual({
        paid: null,
        itemSnapshot: SNAPSHOT,
      });
      expect(w.lookups).toEqual([{ ids: [ITEM] }]);
    });
  });

  describe('it records nothing at all', () => {
    // A free text line, and a line with several products of which the caller
    // named none (`pricedItemId`, below).
    it.each([
      ['with no shop', input({ itemId: undefined })],
      ['at a shop', atShop({ itemId: undefined })],
    ])(
      'when no product was named or picked, %s, without asking catalog',
      async (_name, settle) => {
        const w = build();

        expect(await w.service.choose(settle)).toEqual({
          paid: null,
          itemSnapshot: null,
        });
        expect(w.calls).toEqual([]);
        expect(w.describe).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['catalog throws', 'throws' as const],
      ['the product is absent from the answer', [] as ItemView[]],
    ])('when %s', async (_name, items) => {
      const w = build({ items });

      expect(await w.service.choose(input())).toEqual({
        paid: null,
        itemSnapshot: null,
      });
    });
  });
});

/**
 * A settle at a shop (plan 0163, section 5; plan 0202, section 2).
 *
 * The price is the one the basket shows there: the offer at the shop's quoted
 * scope, which is the first of its stack. A shop outside the owner's profile is
 * priced like one inside it. Every way of not finding a price there records no
 * price **and no shop**, and the cheapest price of the owner's scopes is never
 * used in its place.
 */
describe('what a settle at a shop records (plan 0202, section 2)', () => {
  it("records the price at the shop's quoted scope, with the shop and its chain", async () => {
    const w = build({
      shopStack: [FAR_SCOPE, SCOPE],
      items: [product([offer(FAR_SCOPE, 1.1), offer(SCOPE, 0.95)])],
    });

    expect(await w.service.choose(atShop())).toEqual({
      paid: {
        priceScopeId: FAR_SCOPE,
        supermarketLocationId: SHOP,
        supermarketId: CHAIN,
        pricePaidCents: 110,
        pricePaidCurrency: 'EUR',
      },
      itemSnapshot: SNAPSHOT,
    });
  });

  it('reads the shop, then the product at that one scope with every offer, and never the profile', async () => {
    const w = build({ shopStack: [FAR_SCOPE, SCOPE] });

    await w.service.choose(atShop());

    expect(w.calls).toEqual([
      SUPERMARKET_LOCATION_PATTERNS.shopAvailability,
      ITEM_PATTERNS.getMany,
    ]);
    expect(w.lookups).toEqual([
      { ids: [ITEM], priceScopeIds: [FAR_SCOPE], offers: 'all' },
    ]);
    // The scope is the shop's and not the profile's.
    expect(w.describe).not.toHaveBeenCalled();
  });

  it('rounds to the cent rather than truncating', async () => {
    const w = build({ items: [product([offer(SCOPE, 2.675)])] });

    expect((await w.service.choose(atShop())).paid?.pricePaidCents).toBe(268);
  });

  describe('it records no price and no shop, and still the name', () => {
    // The product is priced at SCOPE, which the owner's profile reaches. That
    // price is not the price of this shop, so it is not recorded.
    it('when the product has no price at the quoted scope, whatever the owner’s scopes say', async () => {
      const w = build({
        shopStack: [FAR_SCOPE, SCOPE],
        items: [product([offer(SCOPE, 0.95)])],
      });

      expect(await w.service.choose(atShop())).toEqual({
        paid: null,
        itemSnapshot: SNAPSHOT,
      });
      expect(w.describe).not.toHaveBeenCalled();
    });

    it('when the offer there has no amount', async () => {
      const w = build({ items: [product([offer(SCOPE, null)])] });

      expect(await w.service.choose(atShop())).toEqual({
        paid: null,
        itemSnapshot: SNAPSHOT,
      });
    });

    it.each([
      ['catalog cannot answer for the shop', 'throws' as const],
      ['the shop has no scope at all', [] as string[]],
    ])('when %s', async (_name, shopStack) => {
      const w = build({ shopStack });

      expect(await w.service.choose(atShop())).toEqual({
        paid: null,
        itemSnapshot: SNAPSHOT,
      });
      // The read is then for the name alone.
      expect(w.lookups).toEqual([{ ids: [ITEM] }]);
      expect(w.describe).not.toHaveBeenCalled();
    });

    // What a reader may not be told, they may not write into a household's
    // history either. A street and a time say where somebody was standing.
    it('when the reader is not served shops, without asking for the shop', async () => {
      const w = build();

      expect(
        await w.service.choose(atShop({ servedLocations: false }))
      ).toEqual({ paid: null, itemSnapshot: SNAPSHOT });
      expect(w.calls).toEqual([ITEM_PATTERNS.getMany]);
      expect(w.describe).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['catalog throws', 'throws' as const],
    ['the product is absent from the answer', [] as ItemView[]],
  ])('records nothing at all when %s', async (_name, items) => {
    const w = build({ items });

    expect(await w.service.choose(atShop())).toEqual({
      paid: null,
      itemSnapshot: null,
    });
  });
});

/**
 * What a buy copies of its product (plan 0202, section 1).
 *
 * Five fields, under the names the view uses. The name is the whole localized
 * object, because a buy has no reader yet.
 */
describe('the name a settle records (plan 0202, section 1)', () => {
  it('copies the name in every locale, the brand, the size, the pack count and the unit, and nothing else', () => {
    const view = product([offer(SCOPE, 0.95)]);

    const snapshot = snapshotOf(view);

    expect(snapshot).toEqual(SNAPSHOT);
    expect(Object.keys(snapshot).sort()).toEqual([
      'brand',
      'defaultUnit',
      'name',
      'packCount',
      'unitSize',
    ]);
    // A copy, so the buy does not share an object with the answer it read.
    expect(snapshot.name).not.toBe(view.name);
  });

  it('writes null for a brand, a size and a pack count the product does not have', () => {
    expect(
      snapshotOf({
        id: ITEM,
        name: { en: 'Milk' },
        defaultUnit: UnitOfMeasure.UNIT,
      } as unknown as ItemView)
    ).toEqual({
      name: { en: 'Milk' },
      brand: null,
      unitSize: null,
      packCount: null,
      defaultUnit: UnitOfMeasure.UNIT,
    });
  });
});

/**
 * A catalog that never answers (plan 0143, section 4.5).
 *
 * Nest's NATS client waits for ever, so without a budget of its own a price
 * lookup holds a settle until the proxy cuts it at fifteen seconds. The budget
 * is a `Promise.race` against a timer, and the lookup that lost the race is
 * left to finish and its result dropped.
 *
 * Since plan 0202 a settle that gave up records nothing at all. Before it, the
 * scope the client had named was kept, and no client names one any more.
 */
describe('the budget of a settle (plan 0143, section 4.5)', () => {
  it.each([
    ['catalog never answers for the product', { items: 'never answers' }],
    ['the resolver never answers', { resolves: 'never answers' }],
  ] as [string, World][])(
    'gives up inside its budget with nothing at all when %s',
    async (_name, world) => {
      jest.useFakeTimers();
      try {
        const w = build(world);

        const pending = w.service.choose(input());
        let settled = false;
        void pending.then(() => {
          settled = true;
        });
        // Not before the budget: a catalog that answers late is waited for.
        await jest.advanceTimersByTimeAsync(SETTLE_PRICE_BUDGET_MS - 1);
        expect(settled).toBe(false);
        jest.advanceTimersByTime(1);

        expect(await pending).toEqual({ paid: null, itemSnapshot: null });
      } finally {
        jest.useRealTimers();
      }
    }
  );

  it('asks catalog for no product while the scopes are not resolved', async () => {
    jest.useFakeTimers();
    try {
      const w = build({ resolves: 'never answers' });

      const pending = w.service.choose(input());
      jest.advanceTimersByTime(SETTLE_PRICE_BUDGET_MS);
      await pending;

      expect(w.calls).not.toContain(ITEM_PATTERNS.getMany);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives up at a shop too, with no shop recorded', async () => {
    jest.useFakeTimers();
    try {
      const w = build({ items: 'never answers' });

      const pending = w.service.choose(atShop());
      await jest.advanceTimersByTimeAsync(SETTLE_PRICE_BUDGET_MS);

      expect(await pending).toEqual({ paid: null, itemSnapshot: null });
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * The product a settle is priced and named for (plan 0151, sections 1 and 2;
 * plan 0202).
 *
 * Core answers `pick` with its own rule, so these cases check only what the
 * gateway does with the answer, and never how a row reaches one.
 */
describe('pricedItemId', () => {
  it('prices the product the caller named, whatever core picked', () => {
    expect(pricedItemId(ITEM, { pickedItemId: null, optionCount: 3 })).toBe(
      ITEM
    );
  });

  it('prices the product core records when the caller named none', () => {
    expect(
      pricedItemId(undefined, { pickedItemId: ITEM, optionCount: 1 })
    ).toBe(ITEM);
  });

  it('prices nothing on a free text row', () => {
    expect(
      pricedItemId(undefined, { pickedItemId: null, optionCount: 0 })
    ).toBeUndefined();
  });

  it('prices nothing when core was not asked or did not answer', () => {
    expect(pricedItemId(undefined, undefined)).toBeUndefined();
  });

  // Until plan 0202 this case threw `validation_failed` on `itemId`, on the
  // ground that a scope named by the caller says it saw a price for one
  // product. No caller's scope is read any more, so nothing says that.
  it.each([
    ['core picked none', null],
    // Core never answers a pick beside several options. If it did, several
    // options still mean no product.
    ['core named one all the same', ITEM],
  ])(
    'is no product, and never a refusal, on several products with none named, when %s (plan 0202)',
    (_name, pickedItemId) => {
      expect(
        pricedItemId(undefined, { pickedItemId, optionCount: 2 })
      ).toBeUndefined();
    }
  );
});

/**
 * What a change of product records on the buys it rewrites (plan 0202,
 * section 3).
 *
 * A rewritten buy keeps the place of the buy it replaces. So the new product
 * is priced at each scope those buys recorded, in one catalog read, and a buy
 * that recorded no scope is priced as a settle is.
 */
describe('what a change of product records (plan 0202, section 3)', () => {
  const rewrite = (
    extra: Partial<RewritePriceInput> = {}
  ): RewritePriceInput => ({
    userId: OWNER,
    profileId: PROFILE,
    itemId: ITEM,
    supermarketLocationId: undefined,
    servedLocations: true,
    priceScopeIds: [],
    unscoped: false,
    ...extra,
  });

  it('asks catalog nothing when the trip holds no buy to rewrite', async () => {
    const w = build();

    expect(await w.service.chooseForRewrite(rewrite())).toEqual({
      paid: null,
      itemSnapshot: null,
      prices: [],
    });
    expect(w.calls).toEqual([]);
    expect(w.describe).not.toHaveBeenCalled();
  });

  it('prices the product at each scope the buys recorded, in one read', async () => {
    const w = build({
      items: [product([offer(SCOPE, 0.95), offer(FAR_SCOPE, 1.105)])],
    });

    expect(
      await w.service.chooseForRewrite(
        rewrite({ priceScopeIds: [SCOPE, FAR_SCOPE] })
      )
    ).toEqual({
      prices: [
        { priceScopeId: SCOPE, pricePaidCents: 95, pricePaidCurrency: 'EUR' },
        {
          priceScopeId: FAR_SCOPE,
          // Rounded to the cent, as a settle is.
          pricePaidCents: 111,
          pricePaidCurrency: 'EUR',
        },
      ],
      // Every buy recorded a scope, so nothing is chosen the way a settle
      // chooses.
      paid: null,
      itemSnapshot: SNAPSHOT,
    });
    expect(w.lookups).toEqual([
      { ids: [ITEM], priceScopeIds: [SCOPE, FAR_SCOPE], offers: 'all' },
    ]);
    expect(w.describe).not.toHaveBeenCalled();
  });

  it('asks for a scope once, however many buys recorded it', async () => {
    const w = build();

    await w.service.chooseForRewrite(
      rewrite({ priceScopeIds: [SCOPE, FAR_SCOPE, SCOPE] })
    );

    expect(w.lookups).toEqual([
      { ids: [ITEM], priceScopeIds: [SCOPE, FAR_SCOPE], offers: 'all' },
    ]);
  });

  // Core keeps the scope and the shop of such a buy and writes no price.
  it('leaves out a scope with no amount, and an offer at a scope that was not asked', async () => {
    const w = build({
      items: [
        product([
          offer(SCOPE, null),
          offer(FAR_SCOPE, 1.1),
          offer(OTHER_SCOPE, 0.5),
        ]),
      ],
    });

    const chosen = await w.service.chooseForRewrite(
      rewrite({ priceScopeIds: [SCOPE, FAR_SCOPE] })
    );

    expect(chosen.prices).toEqual([
      {
        priceScopeId: FAR_SCOPE,
        pricePaidCents: 110,
        pricePaidCurrency: 'EUR',
      },
    ]);
  });

  describe('a buy that recorded no scope', () => {
    it('is priced as a settle with no shop is, beside the scoped read', async () => {
      const w = build({
        items: [product([offer(FAR_SCOPE, 1.1)], offer(OTHER_SCOPE, 0.89))],
      });

      expect(
        await w.service.chooseForRewrite(
          rewrite({ priceScopeIds: [FAR_SCOPE], unscoped: true })
        )
      ).toEqual({
        prices: [
          {
            priceScopeId: FAR_SCOPE,
            pricePaidCents: 110,
            pricePaidCurrency: 'EUR',
          },
        ],
        paid: {
          priceScopeId: OTHER_SCOPE,
          supermarketLocationId: null,
          supermarketId: null,
          pricePaidCents: 89,
          pricePaidCurrency: 'EUR',
        },
        itemSnapshot: SNAPSHOT,
      });
      expect(w.lookups).toHaveLength(2);
      expect(w.lookups).toContainEqual({
        ids: [ITEM],
        priceScopeIds: [FAR_SCOPE],
        offers: 'all',
      });
      expect(w.lookups).toContainEqual({
        ids: [ITEM],
        priceScopeIds: [SCOPE, OTHER_SCOPE],
        offers: 'best',
      });
    });

    it("is priced at the basket's shop when it has one", async () => {
      const w = build({
        shopStack: [FAR_SCOPE],
        items: [product([offer(FAR_SCOPE, 1.1)])],
      });

      const chosen = await w.service.chooseForRewrite(
        rewrite({ supermarketLocationId: SHOP, unscoped: true })
      );

      expect(chosen.paid).toEqual({
        priceScopeId: FAR_SCOPE,
        supermarketLocationId: SHOP,
        supermarketId: CHAIN,
        pricePaidCents: 110,
        pricePaidCurrency: 'EUR',
      });
      expect(w.describe).not.toHaveBeenCalled();
    });

    // No scoped read was made, so the name is the one the other lookup read.
    it('answers the name from that lookup when no buy recorded a scope', async () => {
      const w = build();

      expect(
        await w.service.chooseForRewrite(rewrite({ unscoped: true }))
      ).toEqual({
        prices: [],
        paid: {
          priceScopeId: SCOPE,
          supermarketLocationId: null,
          supermarketId: null,
          pricePaidCents: 95,
          pricePaidCurrency: 'EUR',
        },
        itemSnapshot: SNAPSHOT,
      });
      expect(w.lookups).toEqual([
        { ids: [ITEM], priceScopeIds: [SCOPE, OTHER_SCOPE], offers: 'best' },
      ]);
    });
  });

  // The product of a buy is still corrected: core rewrites it with no price
  // and no name.
  it.each([
    ['catalog throws', 'throws' as const],
    ['catalog does not know the product', [] as ItemView[]],
  ])('answers no price and no name when %s', async (_name, items) => {
    const w = build({ items });

    expect(
      await w.service.chooseForRewrite(
        rewrite({ priceScopeIds: [SCOPE], unscoped: true })
      )
    ).toEqual({ paid: null, itemSnapshot: null, prices: [] });
  });

  it('gives up inside its budget with no price and no name', async () => {
    jest.useFakeTimers();
    try {
      const w = build({ items: 'never answers' });

      const pending = w.service.chooseForRewrite(
        rewrite({ priceScopeIds: [SCOPE], unscoped: true })
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(SETTLE_PRICE_BUDGET_MS - 1);
      expect(settled).toBe(false);
      jest.advanceTimersByTime(1);

      expect(await pending).toEqual({
        paid: null,
        itemSnapshot: null,
        prices: [],
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * An `itemId` catalog does not know, told apart from a catalog that is slow
 * (plan 0201, section 4, and point 3 of its review).
 *
 * The product of a settle can be on none of its lines, so core cannot check
 * the id. Only one answer refuses the buy: catalog answered, and the product
 * is not there. Everything else lets the settle through, because somebody at a
 * shelf with a slow catalog still bought the thing.
 *
 * The change of product of plan 0202 asks the same question of its `itemId`.
 */
describe('a settle whose itemId catalog does not know (plan 0201)', () => {
  it('lets a product catalog knows through', async () => {
    const w = build();

    await expect(w.service.refuseUnknownItem(ITEM)).resolves.toBeUndefined();
    // Catalog alone is asked: no scopes are resolved to know a product.
    expect(w.calls).toEqual([ITEM_PATTERNS.getMany]);
    expect(w.describe).not.toHaveBeenCalled();
  });

  it('refuses a product catalog answered without, as a 400 on itemId', async () => {
    const w = build({ items: [] });

    const refused = w.service.refuseUnknownItem(ITEM);

    await expect(refused).rejects.toBeInstanceOf(ValidationException);
    await expect(refused).rejects.toMatchObject({
      code: 'validation_failed',
      messageArgs: { field: 'itemId' },
    });
  });

  it('refuses when catalog answered other products and not this one', async () => {
    const w = build({
      items: [{ id: 'another-product', offers: [] } as unknown as ItemView],
    });

    await expect(w.service.refuseUnknownItem(ITEM)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('lets the settle through when catalog fails', async () => {
    const w = build({ items: 'throws' });

    await expect(w.service.refuseUnknownItem(ITEM)).resolves.toBeUndefined();
  });

  it('lets the settle through when catalog does not answer inside the budget', async () => {
    jest.useFakeTimers();
    try {
      const w = build({ items: 'never answers' });

      const pending = w.service.refuseUnknownItem(ITEM);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      // Not before the budget: a catalog that answers late is waited for.
      jest.advanceTimersByTime(SETTLE_PRICE_BUDGET_MS - 1);
      await Promise.resolve();
      expect(settled).toBe(false);
      jest.advanceTimersByTime(1);

      expect(await pending).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
