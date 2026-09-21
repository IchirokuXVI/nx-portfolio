import {
  daysBetween,
  isStaple,
  mergePurchases,
  periodOf,
  windowOf,
} from './suggestion-rules';
import { DAY_MS } from './suggestions.constants';

/**
 * The two rules of plan 0123 (section 7, tests 1 to 6).
 *
 * Every instant is built from a `now` this spec owns, never from a calendar date,
 * so nothing here can start failing on a particular day.
 */

const HOUR_MS = 60 * 60 * 1000;
const now = new Date();

/** An instant `days` before `now`, plus or minus some hours. */
function ago(days: number, hours = 0): Date {
  return new Date(now.getTime() - days * DAY_MS + hours * HOUR_MS);
}

/** `TFTF` as booleans. */
function trips(pattern: string): boolean[] {
  return [...pattern].map((c) => c === 'T');
}

/** One standing purchase, off the list page unless a basket is named. */
function buy(at: Date, quantity: number, basketId: string | null = null) {
  return { at, quantity, basketId };
}

describe('merging settlements into purchases (section 3, step 1)', () => {
  it('folds three settlements within an hour into one purchase with no period', () => {
    const times = [ago(3), ago(3, 0.25), ago(3, 0.9)];

    expect(mergePurchases(times.map((at) => buy(at, 2)))).toEqual([
      buy(ago(3), 6),
    ]);
    expect(periodOf(times, now)).toBeNull();
  });

  it('chains a fold to the previous settlement, not to the first of the group', () => {
    // A slow partial settle: five rows five hours apart over a day. Each is
    // within the session of the one before it, and the last is twenty hours
    // from the first, so a fold measured from the first would answer five
    // purchases (plan 0134, section 7).
    const merged = mergePurchases([
      buy(ago(2), 1),
      buy(ago(2, 5), 1),
      buy(ago(2, 10), 1),
      buy(ago(2, 15), 1),
      buy(ago(2, 20), 1),
    ]);

    expect(merged).toEqual([buy(ago(2), 5)]);
  });

  it('folds purchases exactly the session apart into one', () => {
    // The boundary, stated once in `continuesPurchaseSession` and asserted here
    // in both directions: exactly six hours continues, a millisecond more does
    // not (plan 0134, section 7).
    expect(mergePurchases([buy(ago(2), 1), buy(ago(2, 6), 1)])).toEqual([
      buy(ago(2), 2),
    ]);
  });

  it('keeps purchases a millisecond past the session as two', () => {
    expect(
      mergePurchases([
        buy(ago(2), 1),
        buy(new Date(ago(2, 6).getTime() + 1), 1),
      ])
    ).toHaveLength(2);
  });

  it('sorts before folding, whatever order the rows arrive in', () => {
    expect(
      mergePurchases([buy(ago(1), 1), buy(ago(8), 4)]).map((p) => p.quantity)
    ).toEqual([4, 1]);
  });

  // Plan 0142, section 8.2: the fold answers where the purchase ended up, so a
  // shopper who started on the list page and finished through a basket
  // finished through the basket. The quantity rule asks that question of the
  // last purchase alone, which is why it is the newest row that wins.
  it('carries the basket of the newest folded row', () => {
    expect(
      mergePurchases([
        buy(ago(2), 1, 'b-old'),
        buy(ago(2, 1), 1),
        buy(ago(2, 2), 1, 'b-new'),
      ])
    ).toEqual([buy(ago(2), 3, 'b-new')]);
  });

  it('keeps each purchase’s own basket when nothing folds', () => {
    expect(
      mergePurchases([buy(ago(9), 1, 'b-1'), buy(ago(2), 1, 'b-2')]).map(
        (p) => p.basketId
      )
    ).toEqual(['b-1', 'b-2']);
  });
});

describe('the period (section 3)', () => {
  it('refuses a history of two purchases', () => {
    expect(periodOf([ago(14), ago(7)], now)).toBeNull();
  });

  it('takes the median gap, so gaps of 7, 7 and 30 give 7', () => {
    const period = periodOf([ago(44), ago(37), ago(30), ago(0)], now);

    expect(period?.periodDays).toBe(7);
  });

  it('takes the mean of the middle two gaps when there is an even number', () => {
    // Gaps of 2, 4, 6 and 8: the median is 5.
    const period = periodOf([ago(20), ago(18), ago(14), ago(8), ago(0)], now);

    expect(period?.periodDays).toBe(5);
  });

  it('never answers a period below one day', () => {
    const period = periodOf([ago(0, -30), ago(0, -15), ago(0)], now);

    expect(period?.periodDays).toBe(1);
  });

  it.each([
    [10, 3],
    [7, 2],
    [2, 1],
    [1, 0],
  ])('gives a period of %i a window of %i', (period, window) => {
    expect(windowOf(period)).toBe(window);
  });

  it('is not due at 4 elapsed days on a period of 7, and is due at 5', () => {
    const history = (elapsed: number) => [
      ago(elapsed + 14),
      ago(elapsed + 7),
      ago(elapsed),
    ];

    expect(periodOf(history(4), now)).toEqual({
      periodDays: 7,
      windowDays: 2,
      elapsedDays: 4,
      overdueDays: -1,
      due: false,
    });
    expect(periodOf(history(5), now)).toMatchObject({
      elapsedDays: 5,
      overdueDays: 0,
      due: true,
    });
  });

  it('counts elapsed time from the first settlement of the last purchase', () => {
    const period = periodOf([ago(20), ago(10), ago(6), ago(6, 3)], now);

    expect(period?.elapsedDays).toBe(6);
  });

  it('puts 23:30 and 00:30 seven days later seven days apart', () => {
    const late = new Date(now.getTime());
    late.setUTCHours(23, 30, 0, 0);
    const early = new Date(late.getTime() + 7 * DAY_MS + HOUR_MS);

    expect(daysBetween(late, early)).toBe(7);
    // And the same pair read as a period: one day's shift never adds a day.
    const period = periodOf(
      [new Date(late.getTime() - 7 * DAY_MS), late, early],
      early
    );
    expect(period?.periodDays).toBe(7);
  });
});

describe('the staple rule (section 4)', () => {
  it.each(['TTTTTT', 'TFTFTF', 'FTFTFT', 'TTTT', 'TFTT'])(
    '%s is a staple',
    (pattern) => {
      expect(isStaple(trips(pattern))).toBe(true);
    }
  );

  it.each(['TTFFTT', 'FTFTFF', 'FFTTTT', 'TFFT', 'FFFF'])(
    '%s is not a staple',
    (pattern) => {
      expect(isStaple(trips(pattern))).toBe(false);
    }
  );

  it('answers false below four trips, however present the line is', () => {
    expect(isStaple(trips('TTT'))).toBe(false);
    expect(isStaple([])).toBe(false);
  });

  it('reads only the newest six trips', () => {
    expect(isStaple(trips('TTTTTTFFFF'))).toBe(true);
  });
});
