import {
  isGone,
  itemStateOf,
  provesDelistingFor,
  readDelistCountsCrawl,
  readDelistingThreshold,
  stateOf,
  statementOf,
  uncountedReport,
} from './delisting';

/**
 * The pure rules of the delisting counter (plan 0220, sections 5, 6.2, 15.1
 * and 15.3), with the clock passed in.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-01T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const DEFAULTS = { walks: 3, days: 14 };

describe('isGone (section 5)', () => {
  it('holds at exactly the walks and exactly the days', () => {
    expect(isGone(3, daysAgo(14), NOW, DEFAULTS)).toBe(true);
  });

  it('does not hold one walk short', () => {
    expect(isGone(2, daysAgo(30), NOW, DEFAULTS)).toBe(false);
  });

  it('does not hold one millisecond short of the days', () => {
    const almost = new Date(daysAgo(14).getTime() + 1);
    expect(isGone(3, almost, NOW, DEFAULTS)).toBe(false);
  });

  it('does not hold for three misses in three days under the default days', () => {
    expect(isGone(3, daysAgo(3), NOW, DEFAULTS)).toBe(false);
  });

  it('never holds for a pair that was not missed', () => {
    expect(isGone(0, null, NOW, { walks: 1, days: 0 })).toBe(false);
    expect(isGone(5, null, NOW, DEFAULTS)).toBe(false);
  });

  it('holds on the first miss with one walk and no days', () => {
    expect(isGone(1, NOW, NOW, { walks: 1, days: 0 })).toBe(true);
  });
});

describe('readDelistingThreshold (section 5)', () => {
  it('reads the defaults from a config that names neither key', () => {
    expect(readDelistingThreshold({ postalCode: '28001' })).toEqual({
      walks: 3,
      days: 14,
      fromDefaults: true,
      ignored: [],
    });
    expect(readDelistingThreshold(undefined).fromDefaults).toBe(true);
  });

  it('reads a valid override', () => {
    expect(
      readDelistingThreshold({ delistAfterWalks: 5, delistAfterDays: 0 })
    ).toEqual({ walks: 5, days: 0, fromDefaults: false, ignored: [] });
    expect(
      readDelistingThreshold({ delistAfterWalks: 52, delistAfterDays: 365 })
    ).toMatchObject({ walks: 52, days: 365 });
  });

  it('ignores a value out of range or not an integer, falls back, and names it', () => {
    expect(
      readDelistingThreshold({ delistAfterWalks: 0, delistAfterDays: 366 })
    ).toEqual({
      walks: 3,
      days: 14,
      fromDefaults: true,
      ignored: [
        { key: 'delistAfterWalks', value: 0 },
        { key: 'delistAfterDays', value: 366 },
      ],
    });
    expect(
      readDelistingThreshold({ delistAfterWalks: '4', delistAfterDays: 2.5 })
        .ignored
    ).toEqual([
      { key: 'delistAfterWalks', value: '4' },
      { key: 'delistAfterDays', value: 2.5 },
    ]);
  });
});

describe('which chains may declare a whole listing (section 15.3)', () => {
  it('follows the adapter table', () => {
    expect(provesDelistingFor('mercadona-api', {})).toBe(true);
    expect(provesDelistingFor('dia-api', {})).toBe(true);
    expect(provesDelistingFor('eljamon-web', {})).toBe(true);
    expect(provesDelistingFor('deza-web', {})).toBe(false);
    expect(provesDelistingFor('lidl-api', {})).toBe(false);
    expect(provesDelistingFor('an-adapter-from-next-year', {})).toBe(false);
    expect(provesDelistingFor(null, {})).toBe(false);
  });

  it('lets Carrefour count only behind its own switch, a JSON true', () => {
    expect(provesDelistingFor('carrefour-web', {})).toBe(false);
    expect(
      provesDelistingFor('carrefour-web', { delistCountsCrawl: true })
    ).toBe(true);
    expect(
      provesDelistingFor('carrefour-web', { delistCountsCrawl: 'true' })
    ).toBe(false);
    expect(readDelistCountsCrawl({ delistCountsCrawl: 1 })).toBe(false);
  });

  it('does not let the switch turn on another chain', () => {
    expect(provesDelistingFor('deza-web', { delistCountsCrawl: true })).toBe(
      false
    );
  });
});

describe('the state of a pair and of a product (sections 6.2 and 15.1)', () => {
  const listed = { missedWalks: 0, goneAt: null };
  const missed = { missedWalks: 2, goneAt: null };
  const gone = { missedWalks: 3, goneAt: daysAgo(1) };

  it('is listed, then out of stock from the first miss, then gone', () => {
    expect(stateOf(listed)).toBe('listed');
    expect(stateOf(missed)).toBe('outOfStock');
    expect(stateOf(gone)).toBe('gone');
  });

  it('keeps a product listed while any of its rows is listed', () => {
    expect(itemStateOf([gone, listed])).toBe('listed');
    expect(itemStateOf([missed, listed])).toBe('listed');
  });

  it('makes a product gone only when every row is gone', () => {
    expect(itemStateOf([gone, missed])).toBe('outOfStock');
    expect(itemStateOf([gone, gone])).toBe('gone');
  });

  it('tells catalog what each state means', () => {
    expect(statementOf('i', 'listed')).toEqual({
      itemId: 'i',
      available: true,
      delisted: false,
      outOfStock: false,
    });
    // The first miss hides nothing.
    expect(statementOf('i', 'outOfStock')).toEqual({
      itemId: 'i',
      available: true,
      outOfStock: true,
    });
    // Gone leaves the out of stock instant as it is.
    expect(statementOf('i', 'gone')).toEqual({
      itemId: 'i',
      available: false,
      delisted: true,
    });
  });
});

describe('uncountedReport (section 8)', () => {
  it('says why nothing was counted, with the threshold and the scopes that were not whole', () => {
    const threshold = readDelistingThreshold({ delistAfterWalks: 99 });
    expect(
      uncountedReport('run-not-completed', threshold, [
        { key: '4804', reason: 'category-404', detail: ['112'] },
      ])
    ).toEqual({
      counted: false,
      notCountedBecause: 'run-not-completed',
      threshold: { walks: 3, days: 14, fromDefaults: true },
      thresholdIgnored: [{ key: 'delistAfterWalks', value: 99 }],
      scopes: [],
      notWhole: [{ key: '4804', reason: 'category-404', detail: ['112'] }],
      entriesDelisted: 0,
      entriesBack: 0,
      catalogSent: 0,
      catalogFailed: 0,
      catalogKeptSold: 0,
      error: null,
    });
  });
});
