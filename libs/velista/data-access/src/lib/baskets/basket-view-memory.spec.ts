import {
  BASKET_VIEW_LIFETIME_MS,
  dropExpired,
  forget,
  hasExpired,
  parseBasketViewMemory,
  remember,
  toBasketViewMemory,
  type BasketViewMemory,
} from './basket-view-memory';

/**
 * The record the filter sheet keeps on this device (velista `0076`).
 *
 * Two ideas carry every test here. **A date is compared, never counted down**, so
 * everything takes the moment it is asked about as an argument. And **a record this
 * build cannot read is no record**, rather than a record with one field patched up:
 * a stored grouping outside its own union would otherwise be read as `'none'` and
 * apply a grouping nobody chose.
 */

/** A fixed moment, so nothing here depends on the day the suite runs. */
const NOW = Date.UTC(2026, 0, 15, 10, 0, 0);

const HOUR = 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe('toBasketViewMemory', () => {
  it('reads a record holding all three properties', () => {
    expect(
      toBasketViewMemory({
        version: 1,
        order: { value: 'alpha', until: null },
        grouping: { value: 'category', until: null },
        shop: { value: 'scope-1', until: at(HOUR) },
      })
    ).toEqual({
      version: 1,
      order: { value: 'alpha', until: null },
      grouping: { value: 'category', until: null },
      shop: { value: 'scope-1', until: at(HOUR) },
    });
  });

  it('reads a record holding none of them', () => {
    expect(toBasketViewMemory({ version: 1 })).toEqual({ version: 1 });
  });

  it.each([
    ['not a record', 'basket-view'],
    ['an array', []],
    ['null', null],
    ['no version', { order: { value: 'alpha', until: null } }],
    ['a version this build does not write', { version: 2 }],
    ['a version that is a string', { version: '1' }],
  ])('reads %s as no record at all', (_case, raw) => {
    expect(toBasketViewMemory(raw)).toBeNull();
  });

  it.each([
    ['an order outside its union', { order: { value: 'newest', until: null } }],
    [
      'a grouping outside its union',
      { grouping: { value: 'aisle', until: null } },
    ],
    ['a value of the wrong type', { order: { value: 4, until: null } }],
    ['a shop that is empty', { shop: { value: '', until: null } }],
    ['a property that is not a record', { order: 'alpha' }],
    [
      'an until that is not an instant',
      { order: { value: 'alpha', until: 'soon' } },
    ],
    ['an until of the wrong type', { order: { value: 'alpha', until: 12 } }],
  ])('condemns the whole record for %s', (_case, held) => {
    expect(toBasketViewMemory({ version: 1, ...held })).toBeNull();
  });

  /**
   * A newer build's extra property is not a reason to throw away the two this build
   * understands: the version says how the record is shaped, and nothing about a key
   * this one has never heard of says the rest of it is wrong.
   */
  it('ignores a property it does not know', () => {
    expect(
      toBasketViewMemory({
        version: 1,
        order: { value: 'alpha', until: null },
        density: { value: 'compact', until: null },
      })
    ).toEqual({ version: 1, order: { value: 'alpha', until: null } });
  });
});

describe('parseBasketViewMemory', () => {
  it('reads what was written', () => {
    const memory: BasketViewMemory = {
      version: 1,
      grouping: { value: 'list', until: null },
    };

    expect(parseBasketViewMemory(JSON.stringify(memory))).toEqual(memory);
  });

  it.each([
    ['nothing stored', null],
    ['a value that is not JSON', '{'],
    ['JSON that is not a record', '"alpha"'],
  ])('reads %s as no record', (_case, raw) => {
    expect(parseBasketViewMemory(raw)).toBeNull();
  });
});

describe('hasExpired', () => {
  it('never expires a value with no date', () => {
    expect(hasExpired({ value: 'alpha', until: null }, NOW)).toBe(false);
  });

  it('expires a value whose date has passed', () => {
    expect(hasExpired({ value: 'scope-1', until: at(-1) }, NOW)).toBe(true);
  });

  it('keeps a value whose date is still ahead', () => {
    expect(hasExpired({ value: 'scope-1', until: at(HOUR) }, NOW)).toBe(false);
  });

  /**
   * The moment itself counts as passed. Either answer is defensible for one
   * millisecond; what matters is that the same comparison is made everywhere, and
   * that the expiry is inclusive is the half that costs nothing when it is wrong.
   */
  it('expires a value at exactly its own date', () => {
    expect(hasExpired({ value: 'scope-1', until: at(0) }, NOW)).toBe(true);
  });
});

describe('dropExpired', () => {
  it('drops what has expired and keeps the rest', () => {
    const memory: BasketViewMemory = {
      version: 1,
      order: { value: 'alpha', until: null },
      grouping: { value: 'category', until: at(HOUR) },
      shop: { value: 'scope-1', until: at(-HOUR) },
    };

    expect(dropExpired(memory, NOW)).toEqual({
      version: 1,
      order: { value: 'alpha', until: null },
      grouping: { value: 'category', until: at(HOUR) },
    });
  });

  /**
   * By identity, so the caller can write the record back **only** when something
   * actually went. Every basket that opens reads this record, and re-writing an
   * unchanged one on each of them is a write nobody asked for.
   */
  it('gives back the record it was given when nothing has expired', () => {
    const memory: BasketViewMemory = {
      version: 1,
      order: { value: 'alpha', until: null },
    };

    expect(dropExpired(memory, NOW)).toBe(memory);
  });
});

describe('remember', () => {
  it('dates a property from its own lifetime', () => {
    expect(remember({ version: 1 }, 'shop', 'scope-1', NOW)).toEqual({
      version: 1,
      shop: { value: 'scope-1', until: at(2 * HOUR) },
    });
  });

  it('writes no date for a property that is kept for ever', () => {
    expect(remember({ version: 1 }, 'order', 'alpha', NOW)).toEqual({
      version: 1,
      order: { value: 'alpha', until: null },
    });
  });

  /** Setting the grouping must not extend the shop's two hours (section 4). */
  it('carries every other property over with its own date', () => {
    const memory: BasketViewMemory = {
      version: 1,
      shop: { value: 'scope-1', until: at(HOUR) },
    };

    expect(remember(memory, 'grouping', 'category', NOW + HOUR)).toEqual({
      version: 1,
      shop: { value: 'scope-1', until: at(HOUR) },
      grouping: { value: 'category', until: null },
    });
  });
});

describe('forget', () => {
  it('takes a property out', () => {
    expect(
      forget({ version: 1, shop: { value: 'scope-1', until: null } }, 'shop')
    ).toEqual({ version: 1 });
  });

  it('gives back the record it was given when the property is not there', () => {
    const memory: BasketViewMemory = { version: 1 };

    expect(forget(memory, 'shop')).toBe(memory);
  });
});

/**
 * The numbers themselves, because this table is the only place they live and a plan
 * that says "two hours" deserves a test that says two hours.
 */
describe('BASKET_VIEW_LIFETIME_MS', () => {
  it('keeps the order and the grouping for ever, and the shop for two hours', () => {
    expect(BASKET_VIEW_LIFETIME_MS).toEqual({
      order: null,
      grouping: null,
      shop: 2 * HOUR,
    });
  });
});
