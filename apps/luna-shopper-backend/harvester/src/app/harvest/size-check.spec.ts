import {
  sourceSizeUnitOf,
  UnitOfMeasure,
  type SourceSizeUnit,
} from '@portfolio/luna-shopper/contracts';
import { normalizeProduct } from '@portfolio/luna-shopper/mercadona';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkSize,
  labelAmount,
  labelKey,
  SIZE_AGREES_WITHIN,
  type SizeCheckInput,
} from './size-check';

/**
 * Plan 0249: a size its own unit price disproves. Every row of the plan's
 * Context table is a case here, with the stated size the adapter wrote, the
 * price and the comparison price as the chain printed them.
 */

const GRAM = UnitOfMeasure.GRAM as SourceSizeUnit;
const KILOGRAM = UnitOfMeasure.KILOGRAM as SourceSizeUnit;
const MILLILITER = UnitOfMeasure.MILLILITER as SourceSizeUnit;
const LITER = UnitOfMeasure.LITER as SourceSizeUnit;
const UNIT = UnitOfMeasure.UNIT as SourceSizeUnit;

function row(
  unitSize: number | null,
  sizeUnit: SourceSizeUnit | null,
  price: number | null,
  unitPrice: number | null,
  unitPriceLabel: string | null,
  over: Partial<SizeCheckInput> = {}
): SizeCheckInput {
  return {
    unitSize,
    sizeUnit,
    packCount: null,
    soldByWeight: false,
    approxWeight: null,
    prices: [{ price, unitPrice, unitPriceLabel }],
    ...over,
  };
}

const MERCADONA_FIXTURES = join(
  __dirname,
  '../../../../../../libs/luna-shopper/mercadona/src/lib/__fixtures__'
);

/** A Mercadona fixture as the walk writes it (`mercadona-catalog.runner.ts`). */
function mercadona(name: string): SizeCheckInput {
  const detail = normalizeProduct(
    JSON.parse(readFileSync(join(MERCADONA_FIXTURES, name), 'utf8'))
  );
  return {
    unitSize: detail.unitSize,
    sizeUnit: detail.unitSize === null ? null : sourceSizeUnitOf(detail.unit),
    packCount: detail.packCount,
    soldByWeight: detail.soldByWeight,
    approxWeight: detail.approxWeight,
    prices: [
      {
        price: detail.price,
        unitPrice: detail.unitPrice,
        unitPriceLabel: detail.unitPriceLabel,
      },
    ],
  };
}

describe('checkSize: the rows of the Context table (plan 0249)', () => {
  it('doubts the Carrefour cat food stated as 2.8 g, which prices 2.8 kg', () => {
    const verdict = checkSize(row(2.8, GRAM, 18.45, 6.59, '€/kg'));
    expect(verdict).toMatchObject({ agrees: false, stated: 2.8 });
    expect(verdict?.implied).toBeCloseTo(2799.7, 0);
    expect(verdict?.ratio).toBeCloseTo(999.9, 0);
  });

  it('doubts the Carrefour Pepsi printed 1,75 cl, which prices 1.74 l', () => {
    const verdict = checkSize(row(17.5, MILLILITER, 1.69, 0.97, '€/l'));
    expect(verdict).toMatchObject({ agrees: false, stated: 17.5 });
    expect(verdict?.implied).toBeCloseTo(1742.3, 0);
  });

  it('doubts the Carrefour polvorones stated as 582.8 kg, which price 0.31 kg', () => {
    const verdict = checkSize(row(582.8, KILOGRAM, 7.59, 24.48, '€/kg'));
    expect(verdict).toMatchObject({ agrees: false, stated: 582_800 });
    expect(verdict?.implied).toBeCloseTo(310.05, 1);
    expect(verdict?.probablePackCount).toBeNull();
  });

  it('doubts the Amstel pack stated at one can, and names 28 as its probable count', () => {
    const verdict = checkSize(row(330, MILLILITER, 20.72, 2.24, '€/l'));
    expect(verdict).toMatchObject({
      agrees: false,
      stated: 330,
      probablePackCount: 28,
    });
    expect(verdict?.implied).toBeCloseTo(9250, 0);
  });

  it('names no probable count on a row that states one', () => {
    const verdict = checkSize(
      row(330, MILLILITER, 20.72, 2.24, '€/l', { packCount: 28 })
    );
    expect(verdict).toMatchObject({ agrees: false, probablePackCount: null });
  });

  it('doubts Mercadona 18382 stated as 1.6 kg, which prices 0.16 kg', () => {
    const verdict = checkSize(row(1.6, KILOGRAM, 1.7, 10.63, 'kg'));
    expect(verdict).toMatchObject({ agrees: false, stated: 1600 });
    expect(verdict?.implied).toBeCloseTo(159.92, 1);
    expect(verdict?.ratio).toBeCloseTo(0.1, 2);
  });

  it('doubts the El Jamón limpiahogar printed 1.625ml, which prices 1.62 l', () => {
    const verdict = checkSize(row(1.625, MILLILITER, 2.35, 1.45, 'Litro'));
    expect(verdict).toMatchObject({ agrees: false, stated: 1.625 });
    expect(verdict?.ratio).toBeGreaterThan(990);
  });

  it('doubts the DIA Heineken pack 24 x 1 L, which prices 7.9 l', () => {
    const verdict = checkSize(row(24, LITER, 19.92, 2.52, 'LITRO'));
    expect(verdict).toMatchObject({
      agrees: false,
      stated: 24_000,
      probablePackCount: null,
    });
    expect(verdict?.implied).toBeCloseTo(7904.8, 0);
  });
});

describe('checkSize: a row that agrees, from each chain', () => {
  it('Mercadona: every fixture of plans 0189 and 0244 that is priced by its size', () => {
    for (const name of [
      'product-detail-es.json',
      'product-reference-format-100ml.json',
      'product-reference-format-100g.json',
      'product-eggs-per-dozen.json',
      'product-detergent-per-wash.json',
      'product-box-of-capsules.json',
      'product-single-razor.json',
    ]) {
      const verdict = checkSize(mercadona(name));
      expect({ name, agrees: verdict?.agrees ?? 'unchecked' }).not.toEqual({
        name,
        agrees: false,
      });
    }
  });

  it('Mercadona: doubts the capsules whose size reads 0.11 ud beside a price per capsule', () => {
    // `unit_size` 0.11 under `size_format: ud` is the weight of the box in
    // kilos, and 2.60 at 0.13 per capsule is twenty of them. The size is the
    // wrong figure, and a person decides.
    expect(
      checkSize(mercadona('product-capsules-per-unit.json'))
    ).toMatchObject({ agrees: false, probablePackCount: null });
  });

  it('Mercadona: the 0.2 l body oil and the 49 g spice agree once relabelled', () => {
    expect(
      checkSize(mercadona('product-reference-format-100ml.json'))
    ).toMatchObject({ agrees: true, label: 'L' });
    expect(
      checkSize(mercadona('product-reference-format-100g.json'))
    ).toMatchObject({ agrees: true, label: 'kg' });
  });

  it('Mercadona: a stored `100 ml` or `100 g` figure is read as per 100', () => {
    // Product 46815 as it would be stored before plan 0189 relabelled it:
    // 3.40 for 0.2 l at 1.70 per 100 ml.
    expect(checkSize(row(0.2, LITER, 3.4, 1.7, '100 ml'))).toMatchObject({
      agrees: true,
    });
    // Product 34149: 1.60 for 0.049 kg at 3.266 per 100 g.
    expect(checkSize(row(0.049, KILOGRAM, 1.6, 3.266, '100 g'))).toMatchObject({
      agrees: true,
    });
    // The nail polish of the Context: 3.50 for 11 ml printed "per 100 ml".
    // The comparison price is the wrong figure here, and the check cannot
    // tell: it doubts, and a person decides.
    expect(checkSize(row(11, MILLILITER, 3.5, 3.5, '100 ml'))).toMatchObject({
      agrees: false,
    });
  });

  it('Carrefour: Fanta pack 2 botellas 2 l at 3,59 and 0,90 €/l (listing-page.json)', () => {
    expect(checkSize(row(4, LITER, 3.59, 0.9, '€/l'))).toMatchObject({
      agrees: true,
    });
  });

  it('El Jamón: burger vacuno 130g, pk-2 at 5,95 and 22,88 €/Kilo (category-page-1.html)', () => {
    expect(checkSize(row(260, GRAM, 5.95, 22.88, 'Kilo'))).toMatchObject({
      agrees: true,
    });
  });

  it('DIA: Hola Cola pack 4 x 2 L at 3.20 and 0.40 per LITRO (listing-page-1.json)', () => {
    expect(checkSize(row(8, LITER, 3.2, 0.4, 'LITRO'))).toMatchObject({
      agrees: true,
    });
  });

  it('agrees at the edges of the tolerance and not past them', () => {
    const at = (ratio: number) =>
      checkSize(row(1000, GRAM, ratio, 1, 'kg'))?.agrees;
    expect(at(SIZE_AGREES_WITHIN.low)).toBe(true);
    expect(at(SIZE_AGREES_WITHIN.high)).toBe(true);
    expect(at(0.84)).toBe(false);
    expect(at(1.19)).toBe(false);
  });

  it('agrees when any of its prices agrees, and answers the first that disagrees otherwise', () => {
    const two = row(1000, GRAM, 2, 2, 'kg', {
      prices: [
        { price: 2, unitPrice: 20, unitPriceLabel: 'kg' },
        { price: 2, unitPrice: 2, unitPriceLabel: 'kg' },
      ],
    });
    expect(checkSize(two)).toMatchObject({ agrees: true });
    const neither = row(1000, GRAM, 2, 2, 'kg', {
      prices: [
        { price: 2, unitPrice: 20, unitPriceLabel: 'kg' },
        { price: 2, unitPrice: 0.2, unitPriceLabel: 'kg' },
      ],
    });
    expect(checkSize(neither)?.implied).toBe(100);
  });
});

describe('labelAmount: the table of section 1', () => {
  it.each([
    ['kg', 'mass', 1000],
    ['€/kg', 'mass', 1000],
    ['Kilo', 'mass', 1000],
    ['KILO', 'mass', 1000],
    ['100 g', 'mass', 100],
    ['€/100g', 'mass', 100],
    ['100gr', 'mass', 100],
    ['100 GR.', 'mass', 100],
    ['€/g', 'mass', 1],
    ['L', 'volume', 1000],
    ['€/l', 'volume', 1000],
    ['Litro', 'volume', 1000],
    ['LITRO', 'volume', 1000],
    ['100 ml', 'volume', 100],
    ['€/100ml', 'volume', 100],
    ['100ml', 'volume', 100],
    ['100 ML.', 'volume', 100],
    ['ud', 'count', 1],
    ['€/ud', 'count', 1],
    ['Unidad', 'count', 1],
    ['UNIDAD', 'count', 1],
    ['Docena', 'count', 12],
    ['€/docena', 'count', 12],
    ['DOCENA', 'count', 12],
  ])('reads %s', (label, dimension, per) => {
    expect(labelAmount(label)).toEqual({ dimension, per });
  });

  it.each([
    'lv',
    '€/lavado',
    'Lavados',
    'LAVADO',
    'm',
    '€/m',
    'Metro',
    'METRO',
    '',
    '€/rollo',
  ])('answers no check for %j', (label) => {
    expect(labelAmount(label)).toBeNull();
  });

  it('answers no check for a missing label', () => {
    expect(labelAmount(null)).toBeNull();
  });

  it('keys a label lower cased, with no leading €/, no trailing stop and single spaces', () => {
    expect(labelKey('  €/100   ML. ')).toBe('100 ml');
  });

  it('does not check a row whose label it does not know', () => {
    expect(checkSize(row(3000, MILLILITER, 5.85, 0.117, 'lv'))).toBeNull();
  });
});

describe('checkSize: rows it does not judge', () => {
  it('a row sold by weight, whose comparison price is the price itself', () => {
    expect(
      checkSize(row(1.54, KILOGRAM, 14.49, 9.41, 'kg', { soldByWeight: true }))
    ).toBeNull();
  });

  it('an approximate piece priced as one (plan 0244)', () => {
    expect(
      checkSize(
        row(null, null, 3.2, 3.2, 'ud', {
          approxWeight: 400,
        })
      )
    ).toBeNull();
    expect(
      checkSize(row(0.4, KILOGRAM, 3.2, 8, 'kg', { approxWeight: '400.0000' }))
    ).toBeNull();
  });

  it('the Mercadona fixtures of pieces sold by the kilo', () => {
    expect(checkSize(mercadona('product-approximate-weight.json'))).toBeNull();
    expect(
      checkSize(mercadona('product-approximate-weight-per-piece.json'))
    ).toBeNull();
  });

  it('a row with no size, no unit, no price or no comparison price', () => {
    expect(checkSize(row(null, GRAM, 2, 2, 'kg'))).toBeNull();
    expect(checkSize(row(500, null, 2, 2, 'kg'))).toBeNull();
    expect(checkSize(row(500, GRAM, null, 2, 'kg'))).toBeNull();
    expect(checkSize(row(500, GRAM, 2, null, 'kg'))).toBeNull();
    expect(checkSize(row(500, GRAM, 2, 0, 'kg'))).toBeNull();
    expect(checkSize({ ...row(500, GRAM, 2, 2, 'kg'), prices: [] })).toBeNull();
  });

  it('a label of another dimension than the size', () => {
    expect(checkSize(row(500, GRAM, 2, 2, 'L'))).toBeNull();
    expect(checkSize(row(500, MILLILITER, 2, 2, 'kg'))).toBeNull();
  });

  it('a count label beside a size that is not in UNIT', () => {
    expect(checkSize(row(500, GRAM, 2, 2, 'ud'))).toBeNull();
    expect(checkSize(row(12, UNIT, 3.35, 0.28, 'ud'))).toMatchObject({
      agrees: true,
    });
    expect(checkSize(row(12, UNIT, 3.35, 3.35, 'Docena'))).toMatchObject({
      agrees: true,
    });
  });

  it('reads a numeric column as text, as a stored row holds it', () => {
    expect(
      checkSize({
        unitSize: '1.6000',
        sizeUnit: KILOGRAM,
        prices: [{ price: '1.70', unitPrice: '10.63', unitPriceLabel: 'kg' }],
      })
    ).toMatchObject({ agrees: false, stated: 1600 });
  });
});
