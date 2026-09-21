import {
  basketMatchRange,
  foldForSearch,
  matchesBasketRow,
} from './basket-search';
import type { BasketProduct, BasketRow } from './basket-view';

/**
 * The basket's search, which runs on the phone (velista `0074`, section 4.2).
 *
 * Two claims are worth a test each and both are about somebody standing in a shop.
 * **Accents and case do not matter**, because a phone keyboard in a hurry produces
 * "platano" and the catalog holds "Plátano". And **a product counts as much as the
 * line**, because the person looking at the own brand shelf types the brand.
 */

function row(content: string, overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    rowKey: `row-${content}`,
    content,
    left: 1,
    bought: 0,
    asked: 1,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    optionIds: [],
    touchedBy: null,
    touchedAt: null,
    entries: [],
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

describe('matchesBasketRow', () => {
  it('folds case and accents on both sides of the comparison', () => {
    expect(matchesBasketRow(row('Plátano'), undefined, 'platano', 'en')).toBe(
      true
    );
    expect(matchesBasketRow(row('platano'), undefined, 'PLÁTANO', 'en')).toBe(
      true
    );
    expect(matchesBasketRow(row('Milk'), undefined, 'MILK', 'en')).toBe(true);
  });

  it('matches part of a line, and refuses what is not there', () => {
    expect(matchesBasketRow(row('Skimmed milk'), undefined, 'mil', 'en')).toBe(
      true
    );
    expect(
      matchesBasketRow(row('Skimmed milk'), undefined, 'yogurt', 'en')
    ).toBe(false);
  });

  it('matches everything on an empty query, whitespace included', () => {
    expect(matchesBasketRow(row('Milk'), undefined, '', 'en')).toBe(true);
    expect(matchesBasketRow(row('Milk'), undefined, '   ', 'en')).toBe(true);
  });

  it("matches the pick's name in the reader's own locale", () => {
    const pick = product('Whole milk', 'Leche entera');

    expect(matchesBasketRow(row('Milk'), pick, 'leche', 'es')).toBe(true);
    // The English reader is offered the English name, so the Spanish one is not
    // what they are searching: `inLocale` decides, exactly as the row's caption does.
    expect(matchesBasketRow(row('Milk'), pick, 'leche', 'en')).toBe(false);
    expect(matchesBasketRow(row('Milk'), pick, 'whole', 'en')).toBe(true);
  });

  it("matches the pick's brand, which is what the own brand shelf is searched by", () => {
    const pick = product('Whole milk', 'Leche entera', 'Hacendado');

    expect(matchesBasketRow(row('Milk'), pick, 'hacendado', 'en')).toBe(true);
  });

  it('matches a line with no pick on its content alone', () => {
    expect(
      matchesBasketRow(row('Something for the cat'), undefined, 'cat', 'en')
    ).toBe(true);
    expect(
      matchesBasketRow(
        row('Something for the cat'),
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
