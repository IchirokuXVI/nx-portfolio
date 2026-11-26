import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NO_COUNTS,
  productBrandSizeText,
  productDetailText,
  productSizeText,
  type SizeTranslate,
} from './product-size';

/** Words for the units this spec names, and the bare key for any other. */
const translate = (key: string, args?: Record<string, unknown>) => {
  const size = String(args?.['size'] ?? '');
  switch (key) {
    case 'list.add.size.LITER':
      return `${size} L`;
    case 'list.add.weight.KILOGRAM':
      return `~${size}\u00a0kg`;
    case 'list.add.weight.GRAM':
      return `~${size}\u00a0g`;
    case 'list.add.size.UNIT':
      return `${size} units`;
    default:
      return key;
  }
};

describe('productSizeText', () => {
  it('says how big the packet is, in the reader’s number format', () => {
    expect(
      productSizeText(1.5, 'LITER', 'en', translate, null, NO_COUNTS)
    ).toBe('1.5 L');
    expect(
      productSizeText(1.5, 'LITER', 'es', translate, null, NO_COUNTS)
    ).toBe('1,5 L');
  });

  it('says nothing where the catalog knows no size', () => {
    expect(
      productSizeText(null, 'LITER', 'en', translate, null, NO_COUNTS)
    ).toBeNull();
    expect(
      productSizeText(0, 'LITER', 'en', translate, null, NO_COUNTS)
    ).toBeNull();
    expect(
      productSizeText(1, null, 'en', translate, null, NO_COUNTS)
    ).toBeNull();
  });

  it('says nothing for a count of one, which every product is', () => {
    expect(
      productSizeText(1, 'UNIT', 'en', translate, null, NO_COUNTS)
    ).toBeNull();
    expect(productSizeText(6, 'UNIT', 'en', translate, null, NO_COUNTS)).toBe(
      '6 units'
    );
  });

  it('says the approximate weight of a piece in kilos, in the reader’s format', () => {
    expect(
      productSizeText(null, 'KILOGRAM', 'es', translate, 1560, NO_COUNTS)
    ).toBe('~1,56\u00a0kg');
    expect(
      productSizeText(null, 'KILOGRAM', 'en', translate, 1560, NO_COUNTS)
    ).toBe('~1.56\u00a0kg');
    expect(
      productSizeText(null, 'KILOGRAM', 'en', translate, 1000, NO_COUNTS)
    ).toBe('~1\u00a0kg');
  });

  it('says a weight under a kilo in grams', () => {
    expect(
      productSizeText(null, 'KILOGRAM', 'es', translate, 395, NO_COUNTS)
    ).toBe('~395\u00a0g');
  });

  it('says a weight that rounds to a kilo in kilos, never as 1,000 grams', () => {
    expect(
      productSizeText(null, 'KILOGRAM', 'en', translate, 999.6, NO_COUNTS)
    ).toBe('~1\u00a0kg');
    expect(
      productSizeText(null, 'KILOGRAM', 'en', translate, 999.4, NO_COUNTS)
    ).toBe('~999\u00a0g');
  });

  it('says the weight of a piece priced as one, whatever its unit', () => {
    expect(productSizeText(null, 'UNIT', 'es', translate, 580, NO_COUNTS)).toBe(
      '~580\u00a0g'
    );
  });

  it('falls back to the size with no weight or a weight of zero', () => {
    expect(productSizeText(1.5, 'LITER', 'en', translate, 0, NO_COUNTS)).toBe(
      '1.5 L'
    );
    expect(
      productSizeText(null, 'KILOGRAM', 'en', translate, null, NO_COUNTS)
    ).toBeNull();
    expect(
      productSizeText(null, 'KILOGRAM', 'en', translate, 0, NO_COUNTS)
    ).toBeNull();
  });

  it('never lets a key reach the screen for a unit it has no words for', () => {
    expect(
      productSizeText(2, 'FURLONG', 'en', translate, null, NO_COUNTS)
    ).toBeNull();
  });
});

describe('productDetailText', () => {
  it('states the format, then the brand', () => {
    expect(
      productDetailText(
        {
          size: 1,
          unit: 'LITER',
          approxWeight: null,
          ...NO_COUNTS,
          brand: 'Oatly',
        },
        'en',
        translate
      )
    ).toBe('1 L · Oatly');
  });

  it('states whichever of the two the catalog knows, with no separator', () => {
    expect(
      productDetailText(
        {
          size: null,
          unit: 'LITER',
          approxWeight: null,
          ...NO_COUNTS,
          brand: 'Oatly',
        },
        'en',
        translate
      )
    ).toBe('Oatly');
    expect(
      productDetailText(
        {
          size: 1,
          unit: 'LITER',
          approxWeight: null,
          ...NO_COUNTS,
          brand: null,
        },
        'en',
        translate
      )
    ).toBe('1 L');
  });

  it('answers null when it knows neither', () => {
    expect(
      productDetailText(
        {
          size: null,
          unit: null,
          approxWeight: null,
          ...NO_COUNTS,
          brand: ' ',
        },
        'en',
        translate
      )
    ).toBeNull();
  });
});

/** The shipped words of a language, so a spec reads what a reader reads. */
function shipped(locale: 'en' | 'es'): SizeTranslate {
  const words = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'i18n', `${locale}.json`),
      'utf8'
    )
  ) as Record<string, unknown>;
  return (key, args) => {
    let node: unknown = words;
    for (const part of key.split('.')) {
      node =
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }
    if (typeof node !== 'string') {
      return key;
    }
    return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(args?.[name] ?? '')
    );
  };
}

/** Plain spaces, so an expectation reads as the screen does. */
const plain = (text: string | null) =>
  text === null ? null : text.replace(/\u00a0/g, ' ');

describe('productSizeText with its counts (velista 0209)', () => {
  const en = shipped('en');
  const es = shipped('es');
  const counts = (packCount: number | null, pieceCount: number | null) => ({
    packCount,
    pieceCount,
  });
  const both = (
    size: number | null,
    unit: string,
    packCount: number | null,
    pieceCount: number | null,
    approxWeight: number | null = null
  ) => [
    plain(
      productSizeText(
        size,
        unit,
        'en',
        en,
        approxWeight,
        counts(packCount, pieceCount)
      )
    ),
    plain(
      productSizeText(
        size,
        unit,
        'es',
        es,
        approxWeight,
        counts(packCount, pieceCount)
      )
    ),
  ];

  it('prints every case of section 2 in English and in Spanish', () => {
    expect(both(360, 'GRAM', 4, null)).toEqual([
      '360 g (4 × 90 g)',
      '360 g (4 × 90 g)',
    ]);
    expect(both(35, 'GRAM', null, 50)).toEqual([
      '35 g, 50 pieces',
      '35 g, 50 piezas',
    ]);
    expect(both(70, 'GRAM', 2, 100)).toEqual([
      '70 g (2 × 35 g), 100 pieces',
      '70 g (2 × 35 g), 100 piezas',
    ]);
    expect(both(185, 'GRAM', 7, null)).toEqual([
      '185 g (7 × ~26 g)',
      '185 g (7 × ~26 g)',
    ]);
    // English groups thousands and Spanish does not below ten thousand, as
    // `Intl` prints them.
    expect(both(6000, 'MILLILITER', 6, null)).toEqual([
      '6,000 ml (6 × 1,000 ml)',
      '6000 ml (6 × 1000 ml)',
    ]);
    expect(both(null, 'UNIT', 4, null)).toEqual(['Pack 4', 'Pack de 4']);
    expect(both(null, 'KILOGRAM', null, null, 1560)).toEqual([
      '~1.56 kg',
      '~1,56 kg',
    ]);
    expect(both(null, 'KILOGRAM', null, null)).toEqual([null, null]);
  });

  it('keeps the units of a pack on one line, and the pieces with their word', () => {
    const text = productSizeText(70, 'GRAM', 'es', es, null, counts(2, 100));
    expect(text).toBe('70\u00a0g (2\u00a0×\u00a035\u00a0g), 100\u00a0piezas');
  });

  it('prints one unit of kilos and litres to three decimals, rounded with a tilde past them', () => {
    expect(both(1.5, 'LITER', 2, null)).toEqual([
      '1.5 L (2 × 0.75 L)',
      '1,5 L (2 × 0,75 L)',
    ]);
    expect(both(1, 'KILOGRAM', 3, null)).toEqual([
      '1 kg (3 × ~0.333 kg)',
      '1 kg (3 × ~0,333 kg)',
    ]);
  });

  it('prints the units of a counted size only when the pack divides it', () => {
    expect(both(30, 'UNIT', 3, null)).toEqual([
      '30 units (3 × 10 units)',
      '30 uds (3 × 10 uds)',
    ]);
    expect(both(10, 'UNIT', 3, null)).toEqual([
      '10 units · Pack 3',
      '10 uds · Pack de 3',
    ]);
    expect(both(12, 'UNIT', 6, null)).toEqual([
      '12 units (6 × 2 units)',
      '12 uds (6 × 2 uds)',
    ]);
    expect(both(12, 'UNIT', 5, null)).toEqual([
      '12 units · Pack 5',
      '12 uds · Pack de 5',
    ]);
  });

  it('prints a counted size whose pack divides into ones as the total and the pack words', () => {
    expect(both(4, 'UNIT', 4, null)).toEqual([
      '4 units · Pack 4',
      '4 uds · Pack de 4',
    ]);
  });

  it('prints one unit of a float total plain when it divides, with a tilde when it does not', () => {
    expect(both(0.3, 'KILOGRAM', 3, null)).toEqual([
      '0.3 kg (3 × 0.1 kg)',
      '0,3 kg (3 × 0,1 kg)',
    ]);
    expect(both(1.5, 'LITER', 6, null)).toEqual([
      '1.5 L (6 × 0.25 L)',
      '1,5 L (6 × 0,25 L)',
    ]);
    expect(both(1, 'LITER', 3, null)).toEqual([
      '1 L (3 × ~0.333 L)',
      '1 L (3 × ~0,333 L)',
    ]);
  });

  it('falls back to the pack words for a unit that rounds to zero, never "~0"', () => {
    expect(both(5, 'GRAM', 20, null)).toEqual([
      '5 g · Pack 20',
      '5 g · Pack de 20',
    ]);
    expect(both(5, 'GRAM', null, 20)).toEqual([
      '5 g, 20 pieces',
      '5 g, 20 piezas',
    ]);
  });

  it('prints no pieces beside a counted size', () => {
    expect(both(12, 'UNIT', null, 24)).toEqual(['12 units', '12 uds']);
    expect(both(12, 'UNIT', 6, 24)).toEqual([
      '12 units (6 × 2 units)',
      '12 uds (6 × 2 uds)',
    ]);
  });

  it('groups thousands as each language does, Spanish from ten thousand', () => {
    expect(both(12000, 'MILLILITER', 6, null)).toEqual([
      '12,000 ml (6 × 2,000 ml)',
      '12.000 ml (6 × 2000 ml)',
    ]);
  });

  it('keeps a weight first, with a pack beside it as its own words', () => {
    expect(both(null, 'KILOGRAM', 2, 40, 1560)).toEqual([
      '~1.56 kg · Pack 2',
      '~1,56 kg · Pack de 2',
    ]);
  });

  it('reads a pack count of one and a piece count of one as nothing', () => {
    expect(both(360, 'GRAM', 1, 1)).toEqual(['360 g', '360 g']);
  });

  it('prints the total alone under NO_COUNTS', () => {
    expect(plain(productSizeText(360, 'GRAM', 'es', es, null, NO_COUNTS))).toBe(
      '360 g'
    );
    expect(
      plain(productSizeText(null, 'UNIT', 'es', es, null, NO_COUNTS))
    ).toBeNull();
  });

  it('carries the counts into the joined texts', () => {
    const tray = {
      size: 360,
      unit: 'GRAM',
      approxWeight: null,
      brand: 'Hacendado',
      packCount: 4,
      pieceCount: null,
    };
    expect(plain(productBrandSizeText(tray, 'es', es))).toBe(
      'Hacendado · 360 g (4 × 90 g)'
    );
    expect(plain(productDetailText(tray, 'es', es))).toBe(
      '360 g (4 × 90 g) · Hacendado'
    );
    expect(
      plain(
        productBrandSizeText({ ...tray, size: null, unit: 'UNIT' }, 'es', es)
      )
    ).toBe('Hacendado · Pack de 4');
  });
});
