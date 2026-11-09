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
      sizeUnit: 'LITER',
      packCount: null,
    });
  });

  it('states the unit the number is in, for each family a card measures in (plan 0177)', () => {
    // The catalog holds no centilitre, so a centilitre is written as ten
    // millilitres, as every other adapter writes one. It was 0.33 `LITER`.
    expect(
      splitCardName('Cerveza Mahou clásica lata 33 cl.', 'l')
    ).toMatchObject({
      name: 'Cerveza Mahou clásica lata',
      // The printed text is half of the row's key and does not move.
      sizeFormat: '33 cl.',
      unitSize: 330,
      sizeUnit: 'MILLILITER',
    });
    expect(splitCardName('Vino tinto CARREFOUR 75 cl.', 'l')).toMatchObject({
      sizeFormat: '75 cl.',
      unitSize: 750,
      sizeUnit: 'MILLILITER',
    });
    // A volume is in the unit the name printed: millilitres stay millilitres
    // and litres stay litres.
    expect(splitCardName('Zumo DON SIMON 200 ml', 'l')).toMatchObject({
      sizeFormat: '200 ml',
      unitSize: 200,
      sizeUnit: 'MILLILITER',
    });
    expect(splitCardName('Agua mineral Bezoya 1,5 l.', 'l')).toMatchObject({
      unitSize: 1.5,
      sizeUnit: 'LITER',
    });
    expect(splitCardName('Arroz redondo SOS 1 kg.', 'kg')).toMatchObject({
      unitSize: 1,
      sizeUnit: 'KILOGRAM',
    });
    expect(splitCardName('Café molido 500 g', 'kg')).toMatchObject({
      unitSize: 0.5,
      sizeUnit: 'KILOGRAM',
    });
    expect(
      splitCardName('Cápsulas de café CARREFOUR 16 ud.', 'ud')
    ).toMatchObject({ unitSize: 16, sizeUnit: 'UNIT' });
  });

  it('states no size for a length, which is a dimension (plan 0183)', () => {
    expect(
      splitCardName('Papel de aluminio CARREFOUR 30 m.', 'm')
    ).toMatchObject({
      name: 'Papel de aluminio CARREFOUR',
      sizeFormat: '30 m.',
      unitSize: null,
      sizeUnit: null,
    });
  });

  it('writes a centilitre as millilitres, pack phrase included (plan 0177)', () => {
    expect(
      splitCardName('Cerveza Mahou clásica lata 50 cl.', 'l')
    ).toMatchObject({
      name: 'Cerveza Mahou clásica lata',
      sizeFormat: '50 cl.',
      unitSize: 500,
      sizeUnit: 'MILLILITER',
    });
    // Six cans of 33 cl is 1980 ml, which is what the shopper carries out.
    expect(
      splitCardName('Cerveza Mahou clásica pack de 6 latas de 33 cl.', 'l')
    ).toEqual({
      name: 'Cerveza Mahou clásica',
      sizeFormat: 'pack de 6 latas de 33 cl.',
      unitSize: 1980,
      sizeUnit: 'MILLILITER',
      packCount: 6,
    });
  });

  it('writes a decilitre and a cubic centimetre as millilitres too', () => {
    // Both were fractions of a litre, as the centilitre was.
    expect(
      splitCardName('Nata para cocinar CARREFOUR 2 dl', 'l')
    ).toMatchObject({
      sizeFormat: '2 dl',
      unitSize: 200,
      sizeUnit: 'MILLILITER',
    });
    expect(splitCardName('Jarabe CARREFOUR 150 cc', 'l')).toMatchObject({
      sizeFormat: '150 cc',
      unitSize: 150,
      sizeUnit: 'MILLILITER',
    });
  });

  it('reads the unit whatever case the chain printed it in', () => {
    expect(
      splitCardName('Cerveza Mahou clásica lata 33 CL', 'l')
    ).toMatchObject({
      name: 'Cerveza Mahou clásica lata',
      sizeFormat: '33 CL',
      unitSize: 330,
      sizeUnit: 'MILLILITER',
    });
  });

  it('still checks the unit of the name against what the card measures in', () => {
    // The check is on the family. A centilitre on a card priced per unit is
    // the content of the unit and is read (plan 0250, D2). A weight on a card
    // priced per litre is still refused.
    expect(
      splitCardName('Cerveza Mahou clásica lata 33 cl.', 'ud')
    ).toMatchObject({
      name: 'Cerveza Mahou clásica lata',
      sizeFormat: '33 cl.',
      unitSize: 330,
      sizeUnit: 'MILLILITER',
    });
    expect(splitCardName('Café molido 500 g', 'l')).toMatchObject({
      name: 'Café molido 500 g',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
    });
  });

  it('states a weight in kilograms and a count in units, whatever the card measures in', () => {
    expect(splitCardName('Café molido 250 g', 'kg')).toMatchObject({
      unitSize: 0.25,
      sizeUnit: 'KILOGRAM',
    });
    expect(splitCardName('Papel higiénico 12 rollos', 'ud')).toMatchObject({
      unitSize: 12,
      sizeUnit: 'UNIT',
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
      sizeUnit: 'LITER',
      packCount: 9,
    });
  });

  it('moves the pack phrase whatever the chain counts in', () => {
    // The first full crawl left 421 names ending in a dangling `de`, because
    // only `unidades` was accepted. Each of these is a real name from it.
    expect(
      splitCardName(
        'Atún claro Classic Carrefour pack de 8 latas de 52 g.',
        'kg'
      )
    ).toMatchObject({
      name: 'Atún claro Classic Carrefour',
      sizeFormat: 'pack de 8 latas de 52 g.',
      // Eight tins of 52 g, which is what the chain's own price per kilogram
      // says: 6,59 € over 15,84 €/kg is 0,416 kg.
      unitSize: 0.416,
    });
    expect(
      splitCardName('Arroz Carrefour Classic pack 6 unidades de 167 g.', 'kg')
    ).toMatchObject({ name: 'Arroz Carrefour Classic', unitSize: 1.002 });
  });

  it('moves a container phrase that has no pack in front of it', () => {
    expect(splitCardName('Langostinos pink caja de 500 g', 'kg')).toMatchObject(
      {
        name: 'Langostinos pink',
        sizeFormat: 'caja de 500 g',
        unitSize: 0.5,
      }
    );
    expect(
      splitCardName('Gelatina para gatos Carrefour 4 sobres de 100 g.', 'kg')
    ).toMatchObject({ name: 'Gelatina para gatos Carrefour', unitSize: 0.4 });
  });

  it('keeps the aprox the chain prints on a weight that varies', () => {
    // 503 names carry it. It qualifies the size, so it travels with the size
    // rather than being left on the end of a product name.
    expect(splitCardName('Solomillo de cerdo 500 g aprox', 'kg')).toMatchObject(
      {
        name: 'Solomillo de cerdo',
        sizeFormat: '500 g aprox',
        unitSize: 0.5,
      }
    );
  });

  it('does not read a name that merely ends in "de" as a container', () => {
    // The container list is closed for this reason: any word there would eat
    // the last word of a name whenever the name happened to end in `de`.
    expect(
      splitCardName('Aceite de oliva virgen extra Carbonell 1 l', 'l')
    ).toMatchObject({ name: 'Aceite de oliva virgen extra Carbonell' });
  });

  it('states no size when the trailing word is not a unit', () => {
    // The alternative, "a number followed by any short word", reads a till key
    // number or a flavour as a size.
    expect(splitCardName('Rosquillos EL CATETO tecla 36', 'kg')).toEqual({
      name: 'Rosquillos EL CATETO tecla 36',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
  });

  it('states no size when the unit disagrees with what the card measures', () => {
    // This is the check `measure_unit` exists for: a unit from another family
    // is a coincidence, not the package size.
    expect(splitCardName('Servilletas CARREFOUR 30 cm', 'ud')).toEqual({
      name: 'Servilletas CARREFOUR 30 cm',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
  });

  it('states the size but no number when the quantity is a bonus pack', () => {
    // `3x187` is three of something and `28+16` is a bonus pack. The chain
    // prints both in the same field, and guessing which arithmetic it meant
    // writes a number nobody checked.
    expect(splitCardName('Detergente CARREFOUR 28+16 lavados', 'ud')).toEqual({
      name: 'Detergente CARREFOUR',
      // Stored exactly as printed. Expanding `a+b` into its sum belongs to the
      // matcher, and rewriting it here destroys what the chain printed.
      sizeFormat: '28+16 lavados',
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
    expect(splitCardName('Zumo DON SIMON 3x200 ml', 'l')).toMatchObject({
      sizeFormat: '3x200 ml',
      unitSize: null,
      sizeUnit: null,
      packCount: 3,
    });
  });

  it('keeps the whole name when the name is nothing but a size', () => {
    expect(splitCardName('1,5 l', 'l')).toEqual({
      name: '1,5 l',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
  });
});

describe('the sizes the chain prints (plan 0250)', () => {
  it('leaves a number that is no count in the name (section 2.1)', () => {
    // "1880" is the brand. It read 1880 x 0.31 kg = 582.8 kg.
    expect(
      splitCardName(
        'Polvorones de almendra artesanos 1880 estuche de 310 g.',
        'kg'
      )
    ).toEqual({
      name: 'Polvorones de almendra artesanos 1880',
      sizeFormat: 'estuche de 310 g.',
      unitSize: 0.31,
      sizeUnit: 'KILOGRAM',
      packCount: null,
    });
  });

  it('still multiplies a container count within the bounds', () => {
    expect(
      splitCardName('Gelatina para gatos Carrefour 4 sobres de 100 g.', 'kg')
    ).toEqual({
      name: 'Gelatina para gatos Carrefour',
      sizeFormat: '4 sobres de 100 g.',
      unitSize: 0.4,
      sizeUnit: 'KILOGRAM',
      packCount: 4,
    });
  });

  it('states no size for a pack count above the bound', () => {
    // A number after `pack` is a count by its wording, so the phrase still
    // moves across, and the size it would multiply into is not stated.
    expect(
      splitCardName('Bolsas CARREFOUR pack de 5000 unidades de 10 g.', 'kg')
    ).toEqual({
      name: 'Bolsas CARREFOUR',
      sizeFormat: 'pack de 5000 unidades de 10 g.',
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
  });

  it('reads `pack N <noun>` with no `de` as a pack phrase (section 2.2)', () => {
    // The price, 20.72, is for 28 cans.
    expect(
      splitCardName('Cerveza Amstel 100% Malta pack 28 latas 33 cl.', 'l')
    ).toEqual({
      name: 'Cerveza Amstel 100% Malta',
      sizeFormat: 'pack 28 latas 33 cl.',
      unitSize: 9240,
      sizeUnit: 'MILLILITER',
      packCount: 28,
    });
  });

  it('leaves the pack phrase with `de` as it was (section 2.2)', () => {
    expect(
      splitCardName('Leche entera CARREFOUR pack de 9 unidades de 1 l.', 'l')
    ).toEqual({
      name: 'Leche entera CARREFOUR',
      sizeFormat: 'pack de 9 unidades de 1 l.',
      unitSize: 9,
      sizeUnit: 'LITER',
      packCount: 9,
    });
  });

  it('keeps the size of a name that opens with a pack phrase', () => {
    // The phrase cannot move across: the name would be empty. The shape with
    // no `de` is not read at the start, so the name keeps it and the trailing
    // size is one can.
    expect(splitCardName('Pack 6 latas 33 cl.', 'l')).toEqual({
      name: 'Pack 6 latas',
      sizeFormat: '33 cl.',
      unitSize: 330,
      sizeUnit: 'MILLILITER',
      packCount: null,
    });
    // The shape with `de` is read anywhere, so it takes the whole name and the
    // guard keeps the name unsized: `Pack de 6 latas de` is no name either.
    expect(splitCardName('Pack de 6 latas de 33 cl.', 'l')).toEqual({
      name: 'Pack de 6 latas de 33 cl.',
      sizeFormat: null,
      unitSize: null,
      sizeUnit: null,
      packCount: null,
    });
  });

  it('does not read a word after `pack N` that is no container', () => {
    expect(splitCardName('Cerveza CARREFOUR pack 6 rubia 33 cl.', 'l')).toEqual(
      {
        name: 'Cerveza CARREFOUR pack 6 rubia',
        sizeFormat: '33 cl.',
        unitSize: 330,
        sizeUnit: 'MILLILITER',
        packCount: null,
      }
    );
  });

  it('reads a volume on a card priced per unit (section 2.3, D2)', () => {
    expect(splitCardName('Vino tinto CARREFOUR 75 cl.', 'ud')).toEqual({
      name: 'Vino tinto CARREFOUR',
      sizeFormat: '75 cl.',
      unitSize: 750,
      sizeUnit: 'MILLILITER',
      packCount: null,
    });
    expect(splitCardName('Zumo DON SIMON 200 ml', 'ud')).toMatchObject({
      unitSize: 200,
      sizeUnit: 'MILLILITER',
    });
    expect(splitCardName('Aceite de girasol 1 l', 'ud')).toMatchObject({
      unitSize: 1,
      sizeUnit: 'LITER',
    });
  });

  it('reads a weight on a card priced per unit (section 2.3, D2)', () => {
    // The comment of plan 0090 named this as a misread. Plan 0249 now catches
    // a misread by comparing the size with the price per unit.
    expect(splitCardName('Café molido 500 g', 'ud')).toEqual({
      name: 'Café molido',
      sizeFormat: '500 g',
      unitSize: 0.5,
      sizeUnit: 'KILOGRAM',
      packCount: null,
    });
  });

  it('reads a volume on a card priced per kilogram (section 2.3, D1)', () => {
    expect(splitCardName('Helado de vainilla CARREFOUR 900 ml.', 'kg')).toEqual(
      {
        name: 'Helado de vainilla CARREFOUR',
        sizeFormat: '900 ml.',
        unitSize: 900,
        sizeUnit: 'MILLILITER',
        packCount: null,
      }
    );
  });

  it('still refuses the pairs section 2.3 does not name', () => {
    for (const [name, measureUnit] of [
      ['Café molido 500 g', 'l'],
      ['Papel higiénico 12 rollos', 'kg'],
      ['Papel higiénico 12 rollos', 'l'],
      ['Agua mineral 1,5 l.', 'm'],
      ['Servilletas CARREFOUR 30 cm', 'ud'],
    ]) {
      expect(splitCardName(name, measureUnit)).toMatchObject({
        name,
        sizeFormat: null,
        unitSize: null,
      });
    }
  });

  it('carries the size of a card priced per unit onto the product', () => {
    const wine: CarrefourCard = {
      product_id: 'VC4AECOMM-2',
      name: 'Vino tinto CARREFOUR 75 cl.',
      price: '3,00 €',
      price_per_unit: '3,00 €',
      measure_unit: 'ud',
    };
    expect(readCard(wine, ['Vinos'])).toMatchObject({
      name: 'Vino tinto CARREFOUR',
      sizeFormat: '75 cl.',
      unitSize: 750,
      sizeUnit: 'MILLILITER',
      unitPriceLabel: '€/ud',
    });
  });
});

describe('the pack count (plan 0162, section 1)', () => {
  it('reads the count of a pack phrase', () => {
    expect(
      splitCardName('Leche entera CARREFOUR pack de 9 unidades de 1 l.', 'l')
        .packCount
    ).toBe(9);
    expect(
      splitCardName(
        'Atún claro Classic Carrefour pack de 8 latas de 52 g.',
        'kg'
      ).packCount
    ).toBe(8);
    expect(
      splitCardName('Arroz Carrefour Classic pack 6 unidades de 167 g.', 'kg')
        .packCount
    ).toBe(6);
    expect(
      splitCardName('Gelatina para gatos Carrefour 4 sobres de 100 g.', 'kg')
        .packCount
    ).toBe(4);
  });

  it('reads the N of NxQ', () => {
    expect(splitCardName('Zumo DON SIMON 3x200 ml', 'l').packCount).toBe(3);
    expect(splitCardName('Zumo DON SIMON 4 x 1,5 l', 'l').packCount).toBe(4);
  });

  it('reads the N of NxQ printed in centilitres', () => {
    expect(splitCardName('Cerveza MAHOU 6x33 cl', 'l')).toEqual({
      name: 'Cerveza MAHOU',
      sizeFormat: '6x33 cl',
      // This reader never multiplies an `NxQ`, in any unit: the count is read
      // and the size is left for the printed text to state.
      unitSize: null,
      sizeUnit: null,
      packCount: 6,
    });
  });

  it('uses the count of the pack phrase when the NxQ beside it is a dimension (plan 0183)', () => {
    // Both answered null before: the phrase and the `140x` each looked like a
    // count, and a name that states two is a pack of packs. A length is not a
    // count, so the phrase is now the only one and it is read.
    expect(splitCardName('Mantel 2 unidades de 140x200 cm', 'm')).toEqual({
      name: 'Mantel',
      sizeFormat: '2 unidades de 140x200 cm',
      unitSize: null,
      sizeUnit: null,
      packCount: 2,
    });
    expect(
      splitCardName('Mantel CARREFOUR pack de 2 unidades de 140x200 cm', 'm')
    ).toEqual({
      name: 'Mantel CARREFOUR',
      sizeFormat: 'pack de 2 unidades de 140x200 cm',
      unitSize: null,
      sizeUnit: null,
      packCount: 2,
    });
  });

  it('states no count for a dimension (plan 0183)', () => {
    // The two sides of one sheet. A count needs a unit that measures what is
    // inside, and this read a pack of 140.
    for (const measureUnit of ['m', null]) {
      expect(
        splitCardName('Funda nórdica CARREFOUR 140x200 cm', measureUnit)
      ).toEqual({
        name: 'Funda nórdica CARREFOUR',
        // Still split off and still verbatim: it is half of the row's key.
        sizeFormat: '140x200 cm',
        unitSize: null,
        sizeUnit: null,
        packCount: null,
      });
    }
    expect(
      splitCardName('Papel de horno CARREFOUR 2 x 30 m', 'm').packCount
    ).toBeNull();
    expect(
      splitCardName('Bolsas de congelación 60 x 40 mm', 'm').packCount
    ).toBeNull();
  });

  it('keeps the count a pack phrase states in words, whatever the unit', () => {
    expect(
      splitCardName(
        'Papel de aluminio CARREFOUR pack de 2 rollos de 30 m.',
        'm'
      )
    ).toMatchObject({
      sizeFormat: 'pack de 2 rollos de 30 m.',
      unitSize: null,
      sizeUnit: null,
      packCount: 2,
    });
  });

  it('states no count for a container phrase with no number', () => {
    expect(
      splitCardName('Langostinos pink caja de 500 g', 'kg').packCount
    ).toBeNull();
  });

  it('states no count for a bonus pack, a single size or a count of 1', () => {
    expect(
      splitCardName('Detergente CARREFOUR 28+16 lavados', 'ud').packCount
    ).toBeNull();
    expect(
      splitCardName('Agua mineral Bezoya 1,5 l.', 'l').packCount
    ).toBeNull();
    expect(splitCardName('Zumo DON SIMON 1x200 ml', 'l').packCount).toBeNull();
    expect(
      splitCardName('Leche CARREFOUR pack de 1 unidades de 1 l.', 'l').packCount
    ).toBeNull();
  });

  it('states no count when the pack phrase and NxQ both state one', () => {
    // A pack of packs: neither number alone is the count.
    expect(
      splitCardName('Zumo DON SIMON pack de 2 unidades de 3x200 ml', 'l')
        .packCount
    ).toBeNull();
  });

  it('states no count when the size is not read at all', () => {
    expect(
      splitCardName('Servilletas CARREFOUR 30 cm', 'ud').packCount
    ).toBeNull();
  });

  it('carries the count onto the product a card reads into', () => {
    const six: CarrefourCard = {
      product_id: 'VC4AECOMM-1',
      name: 'Leche entera CARREFOUR pack de 6 unidades de 1 l.',
      price: '5,40 €',
      price_per_unit: '0,90 €',
      measure_unit: 'l',
    };
    expect(readCard(six, ['Leche']).packCount).toBe(6);
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
