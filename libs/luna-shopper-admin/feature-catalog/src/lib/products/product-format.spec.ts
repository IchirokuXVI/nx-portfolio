import { readFileSync } from 'fs';
import i18next from 'i18next';
import { join } from 'path';
import {
  formatProductSize,
  formatSize,
  formatSizeDoubt,
} from './product-format';

/**
 * The size of a product with no size (admin plan 0068, criterion 4): the
 * weight of one piece, or "by the kilo". The sizes of packs, and the price
 * and unit price formats, are held in `product-list-gateway.spec.ts`.
 */
describe('formatSize, for a product with no size', () => {
  it('writes the weight of a piece of a kilo or more in kilograms', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: 1560 },
        'en'
      )
    ).toBe('~1.56 kg');
  });

  it('writes the weight of a lighter piece in grams, whatever its unit', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: 395 },
        'en'
      )
    ).toBe('~395 g');
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 395 },
        'en'
      )
    ).toBe('~395 g');
  });

  it('keeps two decimals of a kilogram at most', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 1000 },
        'en'
      )
    ).toBe('~1 kg');
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 1234 },
        'en'
      )
    ).toBe('~1.23 kg');
  });

  it('says "by the kilo" for a product sold by the kilo with no weight', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: null },
        'en'
      )
    ).toBe('by the kilo');
    expect(formatSize({ defaultUnit: 'KILOGRAM' }, 'en')).toBe('by the kilo');
  });

  it('keeps 999 g in grams, and writes 1000 g as a kilogram', () => {
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'UNIT', approxWeight: 999 },
        'en'
      )
    ).toBe('~999 g');
    expect(
      formatSize(
        { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight: 1000 },
        'en'
      )
    ).toBe('~1 kg');
  });

  it('reads a weight of zero or less as no weight', () => {
    for (const approxWeight of [0, -250]) {
      expect(
        formatSize(
          { unitSize: null, defaultUnit: 'KILOGRAM', approxWeight },
          'en'
        )
      ).toBe('by the kilo');
      expect(
        formatSize({ unitSize: null, defaultUnit: 'UNIT', approxWeight }, 'en')
      ).toBe('');
    }
  });

  it('lets a size win over a weight beside it', () => {
    expect(
      formatSize(
        { unitSize: 250, defaultUnit: 'GRAM', approxWeight: 1560 },
        'en'
      )
    ).toBe('250 g');
  });

  it('writes nothing for any other product with no size', () => {
    expect(formatSize({ unitSize: null, defaultUnit: 'UNIT' }, 'en')).toBe('');
    expect(formatSize({ unitSize: null, defaultUnit: 'GRAM' }, 'en')).toBe('');
  });

  it('leaves a product with a size as it was', () => {
    expect(formatSize({ unitSize: 250, defaultUnit: 'GRAM' }, 'en')).toBe(
      '250 g'
    );
    expect(
      formatSize({ unitSize: 6, defaultUnit: 'LITER', packCount: 6 }, 'en')
    ).toBe('6 x 1 L');
  });
});

/** The words of a count, as the back office's own English strings give them. */
const EN = JSON.parse(
  readFileSync(join(__dirname, '../../../../ui/assets/i18n/en.json'), 'utf8')
);
const translator = i18next.createInstance();
void translator.init({
  lng: 'en',
  resources: { en: { translation: EN } },
  initImmediate: false,
});
const units = (count: number, figure: string): string =>
  translator.t('harvest.entries.sizeDoubt.units', { count, figure });
const pieces = (count: number, figure: string): string =>
  translator.t('catalog.items.sizePieces', { count, figure });

/**
 * The size the products list prints, with its counts (admin plan 0075, O1 A):
 * the whole size first, then the pack, then the pieces.
 */
describe('formatProductSize', () => {
  const size = (product: Parameters<typeof formatProductSize>[0]) =>
    formatProductSize(product, 'en', pieces);

  it('prints a pack of 4 burgers as the whole and one unit', () => {
    expect(size({ unitSize: 360, defaultUnit: 'GRAM', packCount: 4 })).toBe(
      '360 g (4 x 90 g)'
    );
  });

  it('prints 2 bags with 100 candies between them with the pieces after', () => {
    expect(
      size({ unitSize: 70, defaultUnit: 'GRAM', packCount: 2, pieceCount: 100 })
    ).toBe('70 g (2 x 35 g) · 100 pieces');
  });

  it('prints a bag of 50 pieces with no pack', () => {
    expect(
      size({
        unitSize: 35,
        defaultUnit: 'GRAM',
        packCount: null,
        pieceCount: 50,
      })
    ).toBe('35 g · 50 pieces');
  });

  it('marks a unit that is not a whole number of grams as approximate', () => {
    expect(size({ unitSize: 185, defaultUnit: 'GRAM', packCount: 7 })).toBe(
      '185 g (7 x ~26 g)'
    );
    expect(size({ unitSize: 1.98, defaultUnit: 'LITER', packCount: 6 })).toBe(
      '1.98 L (6 x 0.33 L)'
    );
    expect(
      size({ unitSize: 6000, defaultUnit: 'MILLILITER', packCount: 6 })
    ).toBe('6,000 ml (6 x 1,000 ml)');
  });

  it('keeps a unit that rounds up to one gram as approximate', () => {
    expect(size({ unitSize: 5, defaultUnit: 'GRAM', packCount: 10 })).toBe(
      '5 g (10 x ~1 g)'
    );
  });

  it('prints the size alone when one unit rounds to zero', () => {
    expect(size({ unitSize: 1, defaultUnit: 'GRAM', packCount: 3 })).toBe(
      '1 g'
    );
    expect(size({ unitSize: 0.001, defaultUnit: 'LITER', packCount: 3 })).toBe(
      '0.001 L'
    );
  });

  it('prints the size alone when the size is 0', () => {
    expect(size({ unitSize: 0, defaultUnit: 'GRAM', packCount: 4 })).toBe(
      '0 g'
    );
  });

  it('keeps the pieces after a size printed alone', () => {
    expect(
      size({ unitSize: 1, defaultUnit: 'GRAM', packCount: 3, pieceCount: 6 })
    ).toBe('1 g · 6 pieces');
  });

  it('prints nothing for a count of 1, null or absent', () => {
    expect(
      size({
        unitSize: 250,
        defaultUnit: 'GRAM',
        packCount: 1,
        pieceCount: 1,
      })
    ).toBe('250 g');
    expect(
      size({
        unitSize: 250,
        defaultUnit: 'GRAM',
        packCount: null,
        pieceCount: null,
      })
    ).toBe('250 g');
    expect(size({ unitSize: 250, defaultUnit: 'GRAM' })).toBe('250 g');
  });

  it('prints a pack with no size as a product with no size', () => {
    expect(size({ unitSize: null, defaultUnit: 'UNIT', packCount: 4 })).toBe(
      ''
    );
    expect(
      size({
        unitSize: null,
        defaultUnit: 'KILOGRAM',
        packCount: 4,
        approxWeight: 1560,
      })
    ).toBe('~1.56 kg');
  });

  it('leaves the size of a source entry with a pack count printed as before', () => {
    // The harvest queue calls formatSize, which keeps the count and one unit.
    expect(
      formatSize({ unitSize: 360, defaultUnit: 'GRAM', packCount: 4 }, 'en')
    ).toBe('4 x 90 g');
    expect(
      formatSize(
        {
          unitSize: 70,
          defaultUnit: 'GRAM',
          packCount: 2,
          pieceCount: 100,
        } as Parameters<typeof formatSize>[0],
        'en'
      )
    ).toBe('2 x 35 g');
  });
});

/** The two sizes of a doubted row, as its sentence reads them (admin plan 0072). */
describe('formatSizeDoubt', () => {
  it('writes both sizes in the row unit, with the label it was disproved by', () => {
    expect(
      formatSizeDoubt(
        { stated: 125, implied: 500, unit: 'GRAM', label: 'kg' },
        'en',
        units
      )
    ).toEqual({ stated: '125 g', implied: '500 g', label: 'kg' });
  });

  it('keeps a small implied size, and leaves the currency off a label', () => {
    // A litre and a fifth, priced per millilitre, under a label like `€/kg`.
    expect(
      formatSizeDoubt(
        { stated: 1.2, implied: 0.0012, unit: 'LITER', label: '€/ml' },
        'en',
        units
      )
    ).toEqual({ stated: '1.2 L', implied: '0.0012 L', label: 'ml' });
  });

  it('writes a label as the harvester keys it: lower case, no last stop', () => {
    const label = (printed: string): string =>
      formatSizeDoubt(
        { stated: 1, implied: 2, unit: 'LITER', label: printed },
        'en',
        units
      ).label;

    expect(label('LITRO')).toBe('litro');
    expect(label('KILO')).toBe('kilo');
    expect(label('100 ML.')).toBe('100 ml');
    expect(label('€/KG.')).toBe('kg');
    // A label of a stop alone is none, and picks the sentence with no label.
    expect(label(' . ')).toBe('');
  });

  it('words a count in units, by the plural of the figure', () => {
    expect(
      formatSizeDoubt(
        { stated: 30, implied: 1, unit: 'UNIT', label: 'UD.' },
        'en',
        units
      )
    ).toEqual({ stated: '30 units', implied: '1 unit', label: 'ud' });
    expect(
      formatSizeDoubt(
        { stated: 1, implied: 1.5, unit: 'UNIT', label: null },
        'en',
        units
      )
    ).toEqual({ stated: '1 unit', implied: '1.5 units', label: '' });
  });

  it('hands the plural the count as a number and the figure as the locale writes it', () => {
    const asked: [number, string][] = [];
    formatSizeDoubt(
      { stated: 1200, implied: 2.5, unit: 'UNIT', label: null },
      'en',
      (count, figure) => {
        asked.push([count, figure]);
        return figure;
      }
    );

    expect(asked).toEqual([
      [1200, '1,200'],
      [2.5, '2.5'],
    ]);
  });
});
