import { toBasketView } from './basket-mappers';

/**
 * A price and a place on every product, at the boundary (velista `0062`,
 * section 8).
 *
 * Four cases, and the last is the one that matters: a partially failed gateway
 * composition produces offers whose scope has no entry in `scopes`, and that
 * must degrade to a price with no place rather than throw and cost the page.
 */

const ME = {
  id: 'p-me',
  kind: 'OWNER',
  displayName: 'Ana',
  username: 'ana',
  guestNumber: null,
  userId: 'u-me',
  joinedAt: null,
  lastSeenAt: null,
  shareLinkId: null,
};

const OFFER = {
  itemId: 'i-milk',
  priceScopeId: 'scope-a',
  price: 0.95,
  currency: 'EUR',
  unitPrice: 0.95,
  unitPriceLabel: 'EUR/L',
  observedAt: '2026-09-01T06:00:00.000Z',
  sourceKind: 'OFFICIAL_WEB',
  stale: false,
};

const PRODUCT = {
  id: 'i-milk',
  name: { en: 'Milk', es: 'Leche' },
  brand: 'Hacendado',
  unitSize: 1,
  defaultUnit: 'LITER',
};

const SCOPE = {
  priceScopeId: 'scope-a',
  supermarketId: 'mercadona',
  supermarketName: { en: 'Mercadona', es: 'Mercadona' },
  locations: [
    {
      supermarketLocationId: 'loc-1',
      label: null,
      address: 'Ronda de los Tejares 32',
      city: 'Córdoba',
      postalCode: '14008',
    },
  ],
};

function basket(overrides: Record<string, unknown> = {}) {
  return toBasketView({
    id: 'b1',
    name: null,
    status: 'ACTIVE',
    generatedAt: '2026-09-01T08:00:00.000Z',
    lines: [],
    participants: [ME],
    me: ME,
    seesZoneData: true,
    products: [PRODUCT],
    scopes: [SCOPE],
    ...overrides,
  });
}

describe('toBasketView: prices and places (velista 0062)', () => {
  it('maps an offer whole', () => {
    const view = basket({ products: [{ ...PRODUCT, bestOffer: OFFER }] });

    expect(view?.products.get('i-milk')?.offer).toEqual({
      stale: false,
      price: 0.95,
      currency: 'EUR',
      unitPrice: 0.95,
      unitPriceLabel: 'EUR/L',
      observedAt: new Date('2026-09-01T06:00:00.000Z'),
      sourceKind: 'OFFICIAL_WEB',
      priceScopeId: 'scope-a',
    });
  });

  it('keeps a null offer null, and reads an absent one the same way', () => {
    // Null is a product with no price at the run's scopes; absent is a read
    // that priced nothing. Both draw the same nothing, so both map the same.
    const nulled = basket({ products: [{ ...PRODUCT, bestOffer: null }] });
    const absent = basket({ products: [PRODUCT] });

    expect(nulled?.products.get('i-milk')?.offer).toBeNull();
    expect(absent?.products.get('i-milk')?.offer).toBeNull();
  });

  it("reads a source kind this build does not know as the chain's own", () => {
    const view = basket({
      products: [{ ...PRODUCT, bestOffer: { ...OFFER, sourceKind: 'X' } }],
    });

    // Not `ADMIN`: the only value that changes a sentence is never guessed.
    expect(view?.products.get('i-milk')?.offer?.sourceKind).toBe('UNKNOWN');
  });

  it('maps a scope with its chain and shops', () => {
    const view = basket();

    expect(view?.scopes.get('scope-a')).toEqual({
      priceScopeId: 'scope-a',
      supermarketName: { en: 'Mercadona', es: 'Mercadona' },
      locations: [
        {
          id: 'loc-1',
          label: null,
          address: 'Ronda de los Tejares 32',
          city: 'Córdoba',
          postalCode: '14008',
        },
      ],
    });
  });

  it('reads a missing `scopes` key as an empty map rather than throwing', () => {
    // A backend from before luna `0066`. The products still map, and every
    // offer resolves to no place.
    const view = basket({ scopes: undefined });

    expect(view).not.toBeNull();
    expect(view?.scopes.size).toBe(0);
  });

  it('lets an offer name a scope that is not described', () => {
    // A partially failed gateway composition: the read was priced, the chain
    // listing failed, and `scopes` came back empty. The price survives and the
    // row resolves the scope to nothing.
    const view = basket({
      products: [{ ...PRODUCT, bestOffer: OFFER }],
      scopes: [],
    });

    const offer = view?.products.get('i-milk')?.offer;
    expect(offer?.price).toBe(0.95);
    expect(view?.scopes.get(offer?.priceScopeId ?? '')).toBeUndefined();
  });

  it('drops an offer that names no scope', () => {
    // A price that cannot say where it came from cannot be marked cheapest
    // against anything, and the sheet must never say "cheapest" about a figure
    // it cannot account for.
    const view = basket({
      products: [
        { ...PRODUCT, bestOffer: { ...OFFER, priceScopeId: undefined } },
      ],
    });

    expect(view?.products.get('i-milk')?.offer).toBeNull();
  });
});
