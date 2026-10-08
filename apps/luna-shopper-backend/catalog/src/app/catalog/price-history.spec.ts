import {
  PRICE_HISTORY_LIMITS,
  PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import { type PolicyRow } from './effective-price';
import {
  priceHistory,
  type HistoryPriceRow,
  type PriceHistoryPoint,
} from './price-history';
import { rangeOf } from './price-history.service';

/**
 * The price a shopper saw over time, table driven (plan 0196, section 5): a
 * set of rows, the policies, a range, and the points expected back.
 *
 * Every case is pure. The rows are what the service loads, old ones
 * included, the policies are those of plan 0080 section 3, and the clock is a
 * day number so each table reads as a calendar.
 */

const SCOPE = 'warehouse-4661';
const NATIONAL = 'national';

/** The stack of the scope being read: itself, then the chain's national scope. */
const PRIORITIES = new Map<string, number>([
  [SCOPE, 10],
  [NATIONAL, 100],
]);

const POLICIES: PolicyRow[] = [
  {
    sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
    priority: 10,
    maxAgeDays: null,
    enabled: true,
  },
  {
    sourceKind: PriceSourceKind.OFFICIAL_API,
    priority: 20,
    maxAgeDays: 7,
    enabled: true,
  },
  {
    sourceKind: PriceSourceKind.OFFICIAL_WEB,
    priority: 30,
    maxAgeDays: 7,
    enabled: true,
  },
  {
    sourceKind: PriceSourceKind.ADMIN,
    priority: 40,
    maxAgeDays: null,
    enabled: true,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 5, 1, 12, 0, 0);

/** Day N of the table, at noon. Day 0 is where every range here starts. */
function day(n: number): Date {
  return new Date(BASE + n * DAY_MS);
}

let counter = 0;
function row(
  overrides: Partial<HistoryPriceRow> & {
    sourceKind: PriceSourceKind;
    observedAt: Date;
  }
): HistoryPriceRow {
  counter += 1;
  return {
    // Zero padded, so the id order is the order the rows were written in.
    id: `row-${String(counter).padStart(5, '0')}`,
    priceScopeId: SCOPE,
    price: null,
    currency: 'EUR',
    unitPrice: null,
    unitPriceLabel: null,
    lastObservedAt: overrides.observedAt,
    validFrom: null,
    validUntil: null,
    overrides: null,
    protectedUntil: null,
    ...overrides,
  };
}

function history(
  rows: HistoryPriceRow[],
  options: { from?: Date; to?: Date; maxPoints?: number } = {}
): PriceHistoryPoint[] {
  return priceHistory({
    rows,
    priceScopeId: SCOPE,
    scopePriorities: PRIORITIES,
    policies: POLICIES,
    from: options.from ?? day(0),
    to: options.to ?? day(60),
    maxPoints: options.maxPoints,
  });
}

/** A series as `[day, price]` pairs, which is how each table is written. */
function steps(points: PriceHistoryPoint[]): [number, number | null][] {
  return points.map((point) => [
    (point.at.getTime() - BASE) / DAY_MS,
    point.price,
  ]);
}

describe('priceHistory (plan 0196, section 2)', () => {
  it('one source that changes its price gives one point for each price', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(-5),
        lastObservedAt: day(10),
      }),
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.20',
        observedAt: day(10),
        lastObservedAt: day(60),
      }),
    ]);

    // The first point is at `from` and says what was shown then. The day
    // the first row would have aged out, day 17, adds nothing: by then the
    // second row is the current one.
    expect(steps(points)).toEqual([
      [0, 1.0],
      [10, 1.2],
    ]);
  });

  it('answers numbers, whatever Postgres printed', () => {
    const [point] = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.50',
        unitPrice: '3.0000',
        unitPriceLabel: 'kg',
        observedAt: day(-1),
        lastObservedAt: day(60),
      }),
    ]);

    expect(point).toEqual({
      at: day(0),
      price: 1.5,
      currency: 'EUR',
      unitPrice: 3,
      unitPriceLabel: 'kg',
    });
  });

  it('a narrower scope that starts later takes over on its first day', () => {
    const points = history([
      row({
        priceScopeId: NATIONAL,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '2.00',
        observedAt: day(-5),
        lastObservedAt: day(60),
      }),
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.80',
        observedAt: day(20),
        lastObservedAt: day(60),
      }),
    ]);

    // Before day 20 the scope has no row of its own, and the national price
    // is what its shoppers saw.
    expect(steps(points)).toEqual([
      [0, 2.0],
      [20, 1.8],
    ]);
  });

  it('a leaflet shows inside its window, and the price before it comes back', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.50',
        observedAt: day(-5),
        lastObservedAt: day(60),
      }),
      row({
        sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
        price: '0.99',
        // Imported two days before the offer starts.
        observedAt: day(8),
        validFrom: day(10),
        validUntil: day(17),
      }),
    ]);

    // Day 8 adds nothing: the row exists and is not valid yet.
    expect(steps(points)).toEqual([
      [0, 1.5],
      [10, 0.99],
      [17, 1.5],
    ]);
  });

  it('a row that ages out stays the point, because the stale price is what was shown', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(-5),
        lastObservedAt: day(3),
      }),
    ]);

    // Day 10 is the instant it goes stale. The rule still answers the row,
    // so nothing a shopper saw changed there.
    expect(steps(points)).toEqual([[0, 1.0]]);
  });

  it('a row that ages out gives way to a source that is still fresh', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(-5),
        lastObservedAt: day(3),
      }),
      row({
        priceScopeId: NATIONAL,
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        price: '1.10',
        observedAt: day(-5),
        lastObservedAt: day(60),
      }),
    ]);

    // The crawl wins on priority while it is within its seven days, which
    // end on day 10. The website row was seen all through.
    expect(steps(points)).toEqual([
      [0, 1.0],
      [10, 1.1],
    ]);
  });

  it('an ADMIN row is shown inside its protection, and competes after it', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(-5),
        lastObservedAt: day(60),
      }),
      row({
        sourceKind: PriceSourceKind.ADMIN,
        price: '0.80',
        observedAt: day(5),
        // What the crawl said when the correction was typed. The crawl
        // never says anything else, so it never disputes the correction.
        overrides: { OFFICIAL_API: { price: 1.0, unitPrice: null } },
        protectedUntil: day(12),
      }),
    ]);

    // After day 12 the correction ranks at its policy priority, below the
    // crawl, so the crawl is shown again.
    expect(steps(points)).toEqual([
      [0, 1.0],
      [5, 0.8],
      [12, 1.0],
    ]);
  });

  it('a source that disagrees with an ADMIN row displaces it at once', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(-5),
        lastObservedAt: day(7),
      }),
      row({
        sourceKind: PriceSourceKind.ADMIN,
        price: '0.80',
        observedAt: day(5),
        overrides: { OFFICIAL_API: { price: 1.0, unitPrice: null } },
        protectedUntil: day(12),
      }),
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.35',
        observedAt: day(7),
        lastObservedAt: day(60),
      }),
    ]);

    expect(steps(points)).toEqual([
      [0, 1.0],
      [5, 0.8],
      [7, 1.35],
    ]);
  });

  it('no row at all is one point with a null price', () => {
    expect(history([])).toEqual([
      {
        at: day(0),
        price: null,
        currency: null,
        unitPrice: null,
        unitPriceLabel: null,
      },
    ]);
  });

  it('starts at null when the first row comes after the start of the range', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(4),
        lastObservedAt: day(60),
      }),
    ]);

    expect(steps(points)).toEqual([
      [0, null],
      [4, 1.0],
    ]);
  });

  it('adds a point when only the label of the unit price changes', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        unitPrice: '2.0000',
        unitPriceLabel: 'kg',
        observedAt: day(-5),
        lastObservedAt: day(9),
      }),
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        unitPrice: '2.0000',
        unitPriceLabel: 'l',
        observedAt: day(9),
        lastObservedAt: day(60),
      }),
    ]);

    expect(points.map((point) => point.unitPriceLabel)).toEqual(['kg', 'l']);
  });

  it('adds no point for a new row that states the price already shown', () => {
    const points = history([
      row({
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: '1.00',
        observedAt: day(-5),
        lastObservedAt: day(9),
      }),
      row({
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        price: '1.00',
        observedAt: day(9),
        lastObservedAt: day(60),
      }),
    ]);

    expect(steps(points)).toEqual([[0, 1.0]]);
  });

  it('ignores what happened after the end of the range', () => {
    const points = history(
      [
        row({
          sourceKind: PriceSourceKind.OFFICIAL_API,
          price: '1.00',
          observedAt: day(-5),
          lastObservedAt: day(60),
        }),
        row({
          sourceKind: PriceSourceKind.OFFICIAL_LEAFLET,
          price: '0.50',
          observedAt: day(2),
          validFrom: day(40),
          validUntil: day(47),
        }),
      ],
      { to: day(30) }
    );

    expect(steps(points)).toEqual([[0, 1.0]]);
  });

  it('keeps the newest 500 points, and the first one kept stays where it starts', () => {
    const HOUR_MS = 60 * 60 * 1000;
    // Six hundred prices, one an hour, each different from the one before.
    const rows = Array.from({ length: 600 }, (_, i) => {
      const at = new Date(BASE + (i + 1) * HOUR_MS);
      return row({
        sourceKind: PriceSourceKind.ADMIN,
        price: i % 2 === 0 ? '1.00' : '2.00',
        observedAt: at,
      });
    });

    const points = history(rows);

    // The point at `from` and six hundred changes is 601. The oldest 101 go.
    expect(points).toHaveLength(PRICE_HISTORY_LIMITS.maxPoints);
    expect(points[0].at).toEqual(new Date(BASE + 101 * HOUR_MS));
    expect(points[0].at.getTime()).toBeGreaterThan(day(0).getTime());
    expect(points[points.length - 1].at).toEqual(
      new Date(BASE + 600 * HOUR_MS)
    );
  });
});

describe('the range of a price history read (plan 0196, section 2)', () => {
  const NOW = day(100);

  it('defaults to the 365 days before now', () => {
    expect(rangeOf({}, NOW)).toEqual({ from: day(100 - 365), to: NOW });
  });

  it('counts the default from the end that was named', () => {
    expect(rangeOf({ to: day(50).toISOString() }, NOW)).toEqual({
      from: day(50 - 365),
      to: day(50),
    });
  });

  it('keeps a range of 400 days whole and cuts a longer one at its start', () => {
    expect(rangeOf({ from: day(100 - 400).toISOString() }, NOW).from).toEqual(
      day(100 - 400)
    );
    expect(rangeOf({ from: day(100 - 900).toISOString() }, NOW)).toEqual({
      from: day(100 - 400),
      to: NOW,
    });
  });

  it('refuses a start after the end, and names the field', () => {
    expect(() =>
      rangeOf({ from: day(60).toISOString(), to: day(50).toISOString() }, NOW)
    ).toThrow(/^from /);
  });

  it('takes a start that is the end', () => {
    const at = day(50).toISOString();
    expect(rangeOf({ from: at, to: at }, NOW)).toEqual({
      from: day(50),
      to: day(50),
    });
  });

  it('refuses a value that is not an instant', () => {
    expect(() => rangeOf({ to: 'yesterday' }, NOW)).toThrow(/^to /);
  });
});
