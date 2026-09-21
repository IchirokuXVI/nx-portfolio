import {
  ITEM_PATTERNS,
  PriceSourceKind,
  SUPERMARKET_LOCATION_PATTERNS,
  type CatalogScopeView,
  type ItemOfferView,
  type ItemView,
} from '@portfolio/luna-shopper/contracts';
import {
  SETTLE_PRICE_BUDGET_MS,
  SettlePriceService,
  type SettlePriceInput,
} from './settle-price.service';

/**
 * What a settle cost, read by the gateway (plan 0143, section 9).
 *
 * The one property every test here serves is the one the plan states twice:
 * **a price never fails a settle, and never delays one past its budget.** So
 * each way of not knowing a price is its own case, because "never fails" is a
 * list of cases rather than a single assertion, and each one ends in nulls and
 * a `SettlementPaid` the settle can send.
 */

const OWNER = 'u-owner';
const PROFILE = 'prof-home';
const SCOPE = 'b4e2c6a8-1f37-4d95-8a0b-2c6e4f9a1d73';
const OTHER_SCOPE = '1f37b4e2-c6a8-4d95-8a0b-2c6e4f9a1d73';
const ITEM = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';
const SHOP = '9a1d73b4-e2c6-4a81-b37d-95f80b2c6e4f';
const OTHER_SHOP = '73b49a1d-e2c6-4a81-b37d-95f80b2c6e4f';

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
  observedAt: '2026-09-01T08:00:00.000Z',
  sourceKind: PriceSourceKind.CHAIN,
  priceCopiedFromScopeId: null,
  stale: false,
  ...extra,
});

const product = (offers: ItemOfferView[]): ItemView =>
  ({ id: ITEM, offers }) as ItemView;

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
    },
    {
      priceScopeId: OTHER_SCOPE,
      supermarketId: 'carrefour',
      postalCode: '14013',
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
  /** What catalog answers the priced lookup with, a throw, or silence. */
  readonly items?: ItemView[] | 'throws' | 'never answers';
  /** What the resolver answers with, or a throw. */
  readonly resolves?: CatalogScopeView | 'throws';
  /** What the shop listing answers with, or a throw. */
  readonly shops?: string[] | 'throws';
}

function build(world: World = {}) {
  const calls: string[] = [];
  const send = jest.fn(async (subject: string) => {
    calls.push(subject);
    switch (subject) {
      case ITEM_PATTERNS.getMany:
        if (world.items === 'throws') {
          throw new Error('catalog unreachable');
        }
        if (world.items === 'never answers') {
          // Nest's NATS client has no timeout of its own, so this is exactly
          // what a catalog that stopped answering looks like from here.
          return new Promise(() => undefined);
        }
        return { items: world.items ?? [product([offer(SCOPE, 0.95)])] };
      case SUPERMARKET_LOCATION_PATTERNS.list:
        if (world.shops === 'throws') {
          throw new Error('catalog unreachable');
        }
        return {
          items: (world.shops ?? [SHOP]).map((id) => ({ id })),
          nextCursor: null,
        };
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });

  const describe = jest.fn(async () => {
    if (world.resolves === 'throws') {
      throw new Error('core slow');
    }
    return world.resolves ?? resolution();
  });

  return {
    service: new SettlePriceService({ send } as never, { describe } as never),
    calls,
    describe,
  };
}

/** The ordinary settle: the owner's scope, one product, one shop. */
const input = (extra: Partial<SettlePriceInput> = {}): SettlePriceInput => ({
  userId: OWNER,
  profileId: PROFILE,
  itemId: ITEM,
  priceScopeId: SCOPE,
  supermarketLocationId: undefined,
  servedLocations: false,
  ...extra,
});

describe('the price a settle records (plan 0143, section 4.2)', () => {
  it('records what one unit cost, and the scope it was read at', async () => {
    const w = build();

    expect(await w.service.read(input())).toEqual({
      priceScopeId: SCOPE,
      supermarketLocationId: null,
      // Catalog holds currency units with two decimals; the column is the
      // minor unit.
      pricePaidCents: 95,
      pricePaidCurrency: 'EUR',
    });
  });

  it('rounds to the cent rather than truncating', async () => {
    const w = build({ items: [product([offer(SCOPE, 2.675)])] });

    expect((await w.service.read(input()))?.pricePaidCents).toBe(268);
  });

  // It is the number the screen showed, which is the whole definition of the
  // column: what was paid as far as anybody knew at the shelf.
  it('records a stale offer', async () => {
    const w = build({
      items: [product([offer(SCOPE, 1.2, { stale: true })])],
    });

    expect((await w.service.read(input()))?.pricePaidCents).toBe(120);
  });

  it('asks catalog for that one product at that one scope', async () => {
    const w = build();

    await w.service.read(input());

    expect(w.calls).toContain(ITEM_PATTERNS.getMany);
  });

  describe('it records nothing at all', () => {
    it('when the client named no scope, without asking catalog', async () => {
      const w = build();

      expect(await w.service.read(input({ priceScopeId: undefined }))).toBe(
        null
      );
      expect(w.calls).toEqual([]);
      expect(w.describe).not.toHaveBeenCalled();
    });

    // The profile can have changed between the read that drew the screen and
    // the tap, and the shopper can neither see that nor fix it. So it is null
    // and never an error.
    it('when the scope is not one the owner’s profile resolves to', async () => {
      const w = build();

      expect(
        await w.service.read(
          input({ priceScopeId: 'ffffffff-1111-4111-8111-111111111111' })
        )
      ).toBe(null);
    });

    it('when the resolver throws', async () => {
      const w = build({ resolves: 'throws' });

      expect(await w.service.read(input())).toBe(null);
    });
  });

  describe('it keeps the scope and records no price', () => {
    it.each([
      ['the offer has no price', [product([offer(SCOPE, null)])]],
      ['the scope quoted nothing', [product([offer(OTHER_SCOPE, 1.1)])]],
      ['the product is absent from the answer', []],
    ])('when %s', async (_name, items) => {
      const w = build({ items });

      expect(await w.service.read(input())).toEqual({
        priceScopeId: SCOPE,
        supermarketLocationId: null,
        pricePaidCents: null,
        pricePaidCurrency: null,
      });
    });

    // A free text line, or a shopper who did not say which product they took.
    it('when there is no itemId, without asking catalog', async () => {
      const w = build();

      const paid = await w.service.read(input({ itemId: undefined }));

      expect(paid).toMatchObject({
        priceScopeId: SCOPE,
        pricePaidCents: null,
        pricePaidCurrency: null,
      });
      expect(w.calls).not.toContain(ITEM_PATTERNS.getMany);
    });

    it('when catalog throws', async () => {
      const w = build({ items: 'throws' });

      expect(await w.service.read(input())).toMatchObject({
        priceScopeId: SCOPE,
        pricePaidCents: null,
      });
    });
  });

  describe('the shop (section 4.4)', () => {
    it('is recorded when it belongs to the scope and the reader is served shops', async () => {
      const w = build();

      const paid = await w.service.read(
        input({ supermarketLocationId: SHOP, servedLocations: true })
      );

      expect(paid?.supermarketLocationId).toBe(SHOP);
      expect(paid?.pricePaidCents).toBe(95);
    });

    it('is dropped when the shop is not in the scope, and the price still stands', async () => {
      const w = build({ shops: [OTHER_SHOP] });

      const paid = await w.service.read(
        input({ supermarketLocationId: SHOP, servedLocations: true })
      );

      expect(paid?.supermarketLocationId).toBe(null);
      expect(paid?.pricePaidCents).toBe(95);
    });

    // What a reader may not be told, they may not write into a household's
    // history either. A street and a time say where somebody was standing.
    it('is dropped from a reader who is not served shops, without asking', async () => {
      const w = build();

      const paid = await w.service.read(
        input({ supermarketLocationId: SHOP, servedLocations: false })
      );

      expect(paid?.supermarketLocationId).toBe(null);
      expect(w.calls).not.toContain(SUPERMARKET_LOCATION_PATTERNS.list);
    });

    it('is dropped when the shop listing throws, and the price still stands', async () => {
      const w = build({ shops: 'throws' });

      const paid = await w.service.read(
        input({ supermarketLocationId: SHOP, servedLocations: true })
      );

      expect(paid).toMatchObject({
        supermarketLocationId: null,
        pricePaidCents: 95,
      });
    });
  });

  /**
   * A catalog that never answers (section 4.5).
   *
   * Nest's NATS client waits for ever, so without a budget of its own a price
   * lookup holds a settle until the proxy cuts it at fifteen seconds. The
   * budget is a `Promise.race` against a timer, and the lookup that lost the
   * race is left to finish and its result dropped.
   */
  it('gives up inside its budget with the scope and nulls', async () => {
    jest.useFakeTimers();
    try {
      const w = build({ items: 'never answers' });

      const pending = w.service.read(input());
      // The resolver's promise has to settle before the timer can be the last
      // thing outstanding, which is what these two flushes are.
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(SETTLE_PRICE_BUDGET_MS);

      expect(await pending).toEqual({
        priceScopeId: SCOPE,
        supermarketLocationId: null,
        pricePaidCents: null,
        pricePaidCurrency: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
