import {
  basketMatchRange,
  foldForSearch,
  matchesBasketLine,
} from './basket-search';
import type { BasketLine, BasketProduct } from './basket-view';

/**
 * The basket's search, which runs on the phone (velista `0074`, section 4.2).
 *
 * Two claims are worth a test each and both are about somebody standing in a shop.
 * **Accents and case do not matter**, because a phone keyboard in a hurry produces
 * "platano" and the catalog holds "Plátano". And **a product counts as much as the
 * line**, because the person looking at the own brand shelf types the brand.
 */

function line(
  content: string,
  overrides: Partial<BasketLine> = {}
): BasketLine {
  return {
    id: `line-${content}`,
    content,
    quantity: 1,
    settled: 0,
    pickId: null,
    optionIds: [],
    position: 0,
    createdBy: 'p-owner',
    touchedBy: null,
    touchedAt: null,
    lastOutcome: null,
    ...overrides,
  };
}

function product(
  en: string,
  es: string,
  brand: string | null = null
): BasketProduct {
  return {
    id: 'item-1',
    name: { en, es },
    brand,
    size: null,
    unit: null,
    offer: null,
    categories: ['OTHER'],
  };
}

describe('foldForSearch', () => {
  it('strips accents, lower cases, and collapses whitespace', () => {
    expect(foldForSearch('  Plátano   Canario ')).toBe('platano canario');
  });

  it('is idempotent, so an already folded query can be folded again', () => {
    const once = foldForSearch('Leche Entera');
    expect(foldForSearch(once)).toBe(once);
  });
});

describe('matchesBasketLine', () => {
  it('folds case and accents on both sides of the comparison', () => {
    expect(matchesBasketLine(line('Plátano'), undefined, 'platano', 'en')).toBe(
      true
    );
    expect(matchesBasketLine(line('platano'), undefined, 'PLÁTANO', 'en')).toBe(
      true
    );
    expect(matchesBasketLine(line('Milk'), undefined, 'MILK', 'en')).toBe(true);
  });

  it('matches part of a line, and refuses what is not there', () => {
    expect(
      matchesBasketLine(line('Skimmed milk'), undefined, 'mil', 'en')
    ).toBe(true);
    expect(
      matchesBasketLine(line('Skimmed milk'), undefined, 'yogurt', 'en')
    ).toBe(false);
  });

  it('matches everything on an empty query, whitespace included', () => {
    expect(matchesBasketLine(line('Milk'), undefined, '', 'en')).toBe(true);
    expect(matchesBasketLine(line('Milk'), undefined, '   ', 'en')).toBe(true);
  });

  it("matches the pick's name in the reader's own locale", () => {
    const pick = product('Whole milk', 'Leche entera');

    expect(matchesBasketLine(line('Milk'), pick, 'leche', 'es')).toBe(true);
    // The English reader is offered the English name, so the Spanish one is not
    // what they are searching: `inLocale` decides, exactly as the row's caption does.
    expect(matchesBasketLine(line('Milk'), pick, 'leche', 'en')).toBe(false);
    expect(matchesBasketLine(line('Milk'), pick, 'whole', 'en')).toBe(true);
  });

  it("matches the pick's brand, which is what the own brand shelf is searched by", () => {
    const pick = product('Whole milk', 'Leche entera', 'Hacendado');

    expect(matchesBasketLine(line('Milk'), pick, 'hacendado', 'en')).toBe(true);
  });

  it('matches a line with no pick on its content alone', () => {
    expect(
      matchesBasketLine(line('Something for the cat'), undefined, 'cat', 'en')
    ).toBe(true);
    expect(
      matchesBasketLine(
        line('Something for the cat'),
        undefined,
        'hacendado',
        'en'
      )
    ).toBe(false);
  });
});

describe('basketMatchRange', () => {
  it('names the first match, and keeps the source string intact around it', () => {
    const range = basketMatchRange('Skimmed milk', 'mil');

    expect(range).toEqual({ start: 8, end: 11 });
    expect('Skimmed milk'.slice(range?.start, range?.end)).toBe('mil');
  });

  it('finds an accented match at the index the source actually holds it', () => {
    const content = 'Zumo de plátano';
    const range = basketMatchRange(content, 'platano');

    expect(content.slice(range?.start, range?.end)).toBe('plátano');
  });

  it('is null for an empty query and for a query the content does not hold', () => {
    expect(basketMatchRange('Milk', '')).toBeNull();
    // The line matched on its product's brand, so there is nothing in its own
    // words to point at.
    expect(basketMatchRange('Milk', 'hacendado')).toBeNull();
  });
});
