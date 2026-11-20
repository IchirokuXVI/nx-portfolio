import {
  lineAmount,
  lineAmountProductOf,
  type LineUnit,
  type LineUnitProduct,
} from '@portfolio/velista/models';
import en from '../../../assets/i18n/en.json';
import es from '../../../assets/i18n/es.json';
import { lineAmountWords, lineUnitCannotWords } from './line-amount-words';

/**
 * The caption of a member of a line (velista `0183`, target states 4 and 6),
 * against the shipped words of both languages: what the line's amount costs
 * with it, or that it cannot serve the line's unit.
 */
function translatorOf(
  table: Record<string, unknown>
): (key: string, args?: Record<string, unknown>) => string {
  return (key, args) => {
    const found = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        table
      );
    if (typeof found !== 'string') {
      return key;
    }
    return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(args?.[name] ?? '')
    );
  };
}

const LOOSE: LineUnitProduct = {
  unit: 'KILOGRAM',
  size: null,
  approxWeight: null,
};
const PIECE_700_G: LineUnitProduct = {
  unit: 'KILOGRAM',
  size: null,
  approxWeight: 700,
};
const BAG_500_G: LineUnitProduct = {
  unit: 'GRAM',
  size: 500,
  approxWeight: null,
};

function caption(
  product: LineUnitProduct,
  offer: { price: number; piecePrice: number | null },
  line: { quantity: number; unit: LineUnit },
  locale: 'en' | 'es'
): string | null {
  const amount = lineAmount(
    line.quantity,
    line.unit,
    lineAmountProductOf(product),
    offer
  );
  return lineAmountWords(
    amount,
    line,
    product,
    'EUR',
    locale,
    translatorOf(locale === 'en' ? en : es)
  );
}

// Intl puts a no-break space between a number and its currency in Spanish.
const clean = (text: string | null) => text?.replace(/\s/g, ' ');

describe('lineAmountWords (velista 0183, target state 6)', () => {
  const kilo = { quantity: 1000, unit: 'GRAM' as const };

  it('draws the three kinds at 1000 g in English', () => {
    expect(
      clean(caption(LOOSE, { price: 1.99, piecePrice: null }, kilo, 'en'))
    ).toBe('1 kg · €1.99');
    expect(
      clean(caption(PIECE_700_G, { price: 1.99, piecePrice: 1.39 }, kilo, 'en'))
    ).toBe('2 × ~700 g · ≈ €2.78');
    expect(
      clean(caption(BAG_500_G, { price: 1.99, piecePrice: null }, kilo, 'en'))
    ).toBe('2 × 500 g · €3.98');
  });

  it('draws the three kinds at 1000 g in Spanish', () => {
    expect(
      clean(caption(LOOSE, { price: 1.99, piecePrice: null }, kilo, 'es'))
    ).toBe('1 kg · 1,99 €');
    expect(
      clean(caption(PIECE_700_G, { price: 1.99, piecePrice: 1.39 }, kilo, 'es'))
    ).toBe('2 × ~700 g · ≈ 2,78 €');
    expect(
      clean(caption(BAG_500_G, { price: 1.99, piecePrice: null }, kilo, 'es'))
    ).toBe('2 × 500 g · 3,98 €');
  });

  it('draws nothing at 0, where the price of one is the member price line', () => {
    expect(
      caption(
        LOOSE,
        { price: 1.99, piecePrice: null },
        { quantity: 0, unit: 'GRAM' },
        'en'
      )
    ).toBeNull();
  });
});

describe('lineUnitCannotWords (velista 0183, target state 4)', () => {
  it('says a loose product is not sold by the piece on a count line', () => {
    expect(lineUnitCannotWords('UNIT', translatorOf(en))).toBe(
      'not sold by the piece'
    );
    expect(lineUnitCannotWords('UNIT', translatorOf(es))).toBe(
      'no se vende por unidades'
    );
  });

  it('says a counted pack is not sold by weight on a weight line', () => {
    expect(lineUnitCannotWords('GRAM', translatorOf(en))).toBe(
      'not sold by weight'
    );
    expect(lineUnitCannotWords('GRAM', translatorOf(es))).toBe(
      'no se vende a peso'
    );
    expect(lineUnitCannotWords('MILLILITER', translatorOf(en))).toBe(
      'not sold by volume'
    );
  });
});
