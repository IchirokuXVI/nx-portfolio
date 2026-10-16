import { BasketLineKeys, picksOf } from './basket-line-keys';
import {
  NO_PICKS,
  normalizeContent,
  productOf,
  rowKeyOf,
  type KeyedLine,
} from './line-dedup';

/**
 * The dedup rule (plan 0050, section 3; plan 0201, section 2), which is the one piece of the run that
 * decides something about a person's intention rather than about their access.
 *
 * The cases below are split the way the plan argues them: what must merge,
 * because the point of the feature is one line to buy once, and what must
 * **not**, because merging two things somebody meant separately loses a purchase
 * silently while showing two lines they can merge by hand costs one gesture.
 */
describe('normalizeContent', () => {
  it('folds case, accents and surrounding space', () => {
    expect(normalizeContent('  Café  ')).toBe('cafe');
    expect(normalizeContent('LECHE')).toBe('leche');
  });

  it('collapses runs of whitespace so two spaces are not a different line', () => {
    expect(normalizeContent('tinned  tomatoes')).toBe('tinned tomatoes');
  });

  it('does not stem or strip words', () => {
    // The conservative half of the rule. "milk" and "whole milk" are two things
    // until a person says otherwise.
    expect(normalizeContent('whole milk')).not.toBe(normalizeContent('milk'));
  });
});

/** A line as the key is decided from it. */
function line(over: Partial<KeyedLine> = {}): KeyedLine {
  return {
    lineId: 'l-1',
    content: 'Milk',
    itemIds: [],
    favoriteItemId: null,
    tripItemId: null,
    ...over,
  };
}

/** The key of a line as a caller with no prices works it out. */
function keyOf(over: Partial<KeyedLine>): string {
  const keyed = line(over);
  return rowKeyOf(keyed.content, productOf(keyed, NO_PICKS));
}

describe('rowKeyOf (plan 0201, section 2)', () => {
  it('merges two lines that count as one product, whatever they are called', () => {
    // The identity beats the spelling, which is the case the text rule could
    // never catch: two households typing "leche" and "Milk" for one carton.
    expect(keyOf({ content: 'Leche', itemIds: ['i1'] })).toBe(
      keyOf({ content: 'Milk', itemIds: ['i1'] })
    );
  });

  it('merges two different product sets that count as the same product', () => {
    // Before plan 0201 the key was the whole set, and these were two rows.
    expect(keyOf({ itemIds: ['i1'] })).toBe(keyOf({ itemIds: ['i1', 'i2'] }));
  });

  it('keeps two different products apart', () => {
    expect(keyOf({ itemIds: ['i1'] })).not.toBe(keyOf({ itemIds: ['i2'] }));
  });

  it('keeps one product set with two favourites apart', () => {
    expect(keyOf({ itemIds: ['i1', 'i2'], favoriteItemId: 'i1' })).not.toBe(
      keyOf({ itemIds: ['i1', 'i2'], favoriteItemId: 'i2' })
    );
  });

  it('falls back to normalized text for free text lines', () => {
    expect(keyOf({ content: 'Café' })).toBe(keyOf({ content: 'cafe' }));
    expect(keyOf({ content: 'Café' })).toBe('text:cafe');
  });

  it('never lets a product id collide with text somebody typed', () => {
    // The namespacing. Without it a line whose content happened to equal a
    // product id would merge with the lines of that product.
    expect(keyOf({ content: 'x', itemIds: ['abc123'] })).not.toBe(
      keyOf({ content: 'abc123' })
    );
  });

  it('does not merge a free text line into a line that names a product', () => {
    expect(keyOf({ content: 'Milk', itemIds: ['i1'] })).not.toBe(
      keyOf({ content: 'Milk' })
    );
  });
});

describe('productOf', () => {
  it('reads the pick of its own line and of no other', () => {
    const picks = new Map([['l-2', 'i2']]);

    expect(
      productOf(line({ lineId: 'l-1', itemIds: ['i1', 'i2'] }), picks)
    ).toBe('i1');
    expect(
      productOf(line({ lineId: 'l-2', itemIds: ['i1', 'i2'] }), picks)
    ).toBe('i2');
  });

  it('is null for a line with no product, whatever was picked for it', () => {
    expect(productOf(line(), new Map([['l-1', 'i1']]))).toBeNull();
  });
});

describe('picksOf', () => {
  it('is empty for a request that sent none', () => {
    expect(picksOf(undefined)).toBe(NO_PICKS);
    expect(picksOf([])).toBe(NO_PICKS);
  });

  it('keeps the first pick of a line, so a retry in another order agrees', () => {
    const picks = picksOf([
      { lineId: 'l-1', itemId: 'i1' },
      { lineId: 'l-1', itemId: 'i2' },
      { lineId: 'l-2', itemId: 'i3' },
    ]);

    expect([...picks]).toEqual([
      ['l-1', 'i1'],
      ['l-2', 'i3'],
    ]);
  });
});

describe('BasketLineKeys', () => {
  it('answers one key and one product for each line it was handed', () => {
    const keys = new BasketLineKeys(new Map([['l-2', 'i2']])).add([
      line({ lineId: 'l-1', itemIds: ['i1'] }),
      line({ lineId: 'l-2', itemIds: ['i1', 'i2'] }),
      line({ lineId: 'l-3', content: 'Bread' }),
    ]);

    expect(keys.keyOf({ id: 'l-1', content: 'Milk' })).toBe('item:i1');
    expect(keys.keyOf({ id: 'l-2', content: 'Milk' })).toBe('item:i2');
    expect(keys.keyOf({ id: 'l-3', content: 'Bread' })).toBe('text:bread');
    expect(keys.productOf('l-2')).toBe('i2');
    expect(keys.productOf('l-3')).toBeNull();
  });

  it('keys a line it never read by its text, and guesses no product', () => {
    const keys = new BasketLineKeys();

    expect(keys.keyOf({ id: 'l-9', content: 'Milk' })).toBe('text:milk');
    expect(keys.productOf('l-9')).toBeNull();
  });
});
