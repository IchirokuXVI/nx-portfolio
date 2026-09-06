import listingPage from './__fixtures__/listing-page.json';
import { readCard, readCards, splitCardName } from './listing';
import { readListing } from './state';
import type { CarrefourCard } from './types';

const listing = readListing(listingPage as unknown as Record<string, unknown>);

describe('splitCardName', () => {
  it('splits the trailing size the chain prints inside the name', () => {
    expect(splitCardName('Agua mineral Bezoya 1,5 l.', 'l')).toEqual({
      name: 'Agua mineral Bezoya',
      sizeFormat: '1,5 l.',
      unitSize: 1.5,
    });
  });

  it('converts the size into the unit the card measures in', () => {
    expect(
      splitCardName('Cerveza Mahou clásica lata 50 cl.', 'l')
    ).toMatchObject({
      name: 'Cerveza Mahou clásica lata',
      sizeFormat: '50 cl.',
      unitSize: 0.5,
    });
  });

  it('moves a whole pack phrase across, not half of one', () => {
    // Splitting inside the phrase would leave `Leche entera CARREFOUR pack de 9
    // unidades de` as a product name.
    expect(
      splitCardName('Leche entera CARREFOUR pack de 9 unidades de 1 l.', 'l')
    ).toEqual({
      name: 'Leche entera CARREFOUR',
      sizeFormat: 'pack de 9 unidades de 1 l.',
      unitSize: 9,
    });
  });

  it('states no size when the trailing word is not a unit', () => {
    // The alternative, "a number followed by any short word", reads a till key
    // number or a flavour as a size.
    expect(splitCardName('Rosquillos EL CATETO tecla 36', 'kg')).toEqual({
      name: 'Rosquillos EL CATETO tecla 36',
      sizeFormat: null,
      unitSize: null,
    });
  });

  it('states no size when the unit disagrees with what the card measures', () => {
    // This is the check `measure_unit` exists for: a unit from another family
    // is a coincidence, not the package size.
    expect(splitCardName('Servilletas CARREFOUR 30 cm', 'ud')).toEqual({
      name: 'Servilletas CARREFOUR 30 cm',
      sizeFormat: null,
      unitSize: null,
    });
  });

  it('states the size but no number when the quantity is a bonus pack', () => {
    // `3x187` is three of something and `28+16` is a bonus pack. The chain
    // prints both in the same field, and guessing which arithmetic it meant
    // writes a number nobody checked.
    expect(splitCardName('Detergente CARREFOUR 28+16 lavados', null)).toEqual({
      name: 'Detergente CARREFOUR 28+16 lavados',
      sizeFormat: null,
      unitSize: null,
    });
    expect(splitCardName('Zumo DON SIMON 3x200 ml', 'l')).toMatchObject({
      sizeFormat: '3x200 ml',
      unitSize: null,
    });
  });

  it('keeps the whole name when the name is nothing but a size', () => {
    expect(splitCardName('1,5 l', 'l')).toEqual({
      name: '1,5 l',
      sizeFormat: null,
      unitSize: null,
    });
  });
});

describe('readCard', () => {
  const card: CarrefourCard = {
    product_id: 'VC4AECOMM-539367',
    sku_id: '1895370000',
    name: 'Agua mineral Bezoya 1,5 l.',
    brand: 'BEZOYA',
    price: '0,75 €',
    price_per_unit: '0,50 €',
    measure_unit: 'l',
    // Six bottles is the minimum purchase and not the size of one of them.
    sell_pack_unit: 6,
    url: '/supermercado/agua-mineral-bezoya-1-5-l/R-VC4AECOMM-539367/p',
  };

  it('keeps the chain id as the external id and never parses it', () => {
    expect(readCard(card, ['Bebidas']).externalId).toBe('VC4AECOMM-539367');
  });

  it('reads both prices and states what the comparison price is per', () => {
    expect(readCard(card, ['Bebidas'])).toMatchObject({
      priceCents: 75,
      unitPriceCents: 50,
      unitPriceLabel: '€/l',
      measureUnit: 'l',
    });
  });

  it('does not fold the minimum purchase into the size', () => {
    // The card prices one bottle. Folding the six in would make the unit price
    // six times wrong.
    expect(readCard(card, ['Bebidas']).unitSize).toBe(1.5);
  });

  it('writes no price for a card that printed no figure', () => {
    const byWeight: CarrefourCard = { ...card, price: '', price_per_unit: '' };
    expect(readCard(byWeight, []).priceCents).toBeNull();
    expect(readCard(byWeight, []).unitPriceCents).toBeNull();
  });
});

describe('readCards over a real page', () => {
  const products = readCards(listing.cards, ['Bebidas']);

  it('reads every card the page held', () => {
    expect(products).toHaveLength(listing.cards.length);
  });

  it('finds a price on every card of this page', () => {
    // A price is close to universal on this source; the no price case is real
    // and rare (plan 0090, section 6).
    expect(products.every((product) => product.priceCents !== null)).toBe(true);
  });

  it('gives every product a non empty name and a distinct id', () => {
    expect(products.every((product) => product.name.length > 0)).toBe(true);
    expect(new Set(products.map((p) => p.externalId)).size).toBe(
      products.length
    );
  });

  it('takes the size out of most names on the page', () => {
    const withSize = products.filter((product) => product.sizeFormat !== null);
    expect(withSize.length).toBeGreaterThan(products.length / 2);
    for (const product of withSize) {
      expect(product.name).not.toMatch(/\d\s*(l|cl|ml|kg|g)\.?$/i);
    }
  });
});
