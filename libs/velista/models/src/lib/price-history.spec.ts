import type { CatalogBrowseContext } from './catalog-browse';
import {
  chainPriceHistories,
  PRICE_HISTORY_MAX_CHAINS,
  priceAt,
  priceHistoryStart,
  priceScale,
  pricesWithin,
  steppedPath,
  stepsWithin,
  type ChainPriceStep,
  type ProductPriceHistory,
  type ScopePriceSeries,
} from './price-history';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 0, 1);

function day(index: number): Date {
  return new Date(START + index * DAY_MS);
}

/** One scope of a chain, as `[day, price]` pairs. */
function series(
  supermarketId: string,
  priceScopeId: string,
  points: readonly (readonly [number, number | null])[]
): ScopePriceSeries {
  return {
    priceScopeId,
    supermarketId,
    points: points.map(([at, price]) => ({
      at: day(at),
      price,
      unitPrice: null,
    })),
  };
}

function history(all: readonly ScopePriceSeries[]): ProductPriceHistory {
  return { from: day(0), to: day(90), series: all };
}

/** A context whose chips are `chips`, and that can also name `named`. */
function context(
  chips: readonly string[],
  named: readonly string[] = []
): CatalogBrowseContext {
  return {
    state: 'priced',
    postalCodes: ['28013'],
    chains: chips.map((id) => ({
      supermarketId: id,
      name: { en: id, es: id },
      locations: 1,
      logoUrl: null,
    })),
    scopes: [],
    chainNames: new Map(named.map((id) => [id, { en: id, es: id }])),
  };
}

function steps(
  ...pairs: readonly (readonly [number, number | null])[]
): ChainPriceStep[] {
  return pairs.map(([at, price]) => ({ at, price }));
}

describe('chainPriceHistories', () => {
  it('draws one line for a chain, at the lowest price any of its scopes showed', () => {
    const lines = chainPriceHistories(
      history([
        series('mercadona', 'scope-1', [
          [0, 1.2],
          [20, 1.0],
        ]),
        series('mercadona', 'scope-2', [
          [0, 1.1],
          [10, 1.3],
        ]),
      ]),
      context(['mercadona'])
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].supermarketId).toBe('mercadona');
    expect(lines[0].chain).toEqual({ en: 'mercadona', es: 'mercadona' });
    expect(lines[0].steps).toEqual([
      { at: day(0).getTime(), price: 1.1 },
      { at: day(10).getTime(), price: 1.2 },
      { at: day(20).getTime(), price: 1.0 },
    ]);
  });

  it('makes no step where a scope moved above the lowest price', () => {
    const [line] = chainPriceHistories(
      history([
        series('mercadona', 'scope-1', [[0, 1.0]]),
        series('mercadona', 'scope-2', [
          [0, 1.5],
          [10, 1.2],
        ]),
      ]),
      context(['mercadona'])
    );

    expect(line.steps).toEqual([{ at: day(0).getTime(), price: 1.0 }]);
  });

  it('keeps the price of one scope while the other shows nothing', () => {
    const [line] = chainPriceHistories(
      history([
        series('mercadona', 'scope-1', [
          [0, 1.0],
          [10, null],
        ]),
        series('mercadona', 'scope-2', [[0, 1.4]]),
      ]),
      context(['mercadona'])
    );

    expect(line.steps.map((step) => step.price)).toEqual([1.0, 1.4]);
  });

  it('draws no line for a chain with no price anywhere in the read', () => {
    const lines = chainPriceHistories(
      history([
        series('mercadona', 'scope-1', [[0, 1.0]]),
        series('dia', 'scope-2', [[0, null]]),
        series('lidl', 'scope-3', []),
      ]),
      context(['mercadona', 'dia', 'lidl'])
    );

    expect(lines.map((line) => line.supermarketId)).toEqual(['mercadona']);
  });

  it('names a chain that is not a chip, and skips one nobody can name', () => {
    const lines = chainPriceHistories(
      history([
        series('mercadona', 'scope-1', [[0, 1.0]]),
        series('deza', 'scope-2', [[0, 1.1]]),
        series('unknown', 'scope-3', [[0, 0.5]]),
      ]),
      context(['mercadona'], ['deza'])
    );

    expect(lines.map((line) => line.supermarketId)).toEqual([
      'mercadona',
      'deza',
    ]);
  });

  it('comes back cheapest today first, which is the order of the price table', () => {
    const lines = chainPriceHistories(
      history([
        // Cheapest at the start of the read, dearest today.
        series('aldi', 'scope-1', [
          [0, 0.5],
          [60, 2.0],
        ]),
        series('dia', 'scope-2', [[0, 1.5]]),
        series('lidl', 'scope-3', [[0, 1.0]]),
      ]),
      context(['aldi', 'dia', 'lidl'])
    );

    expect(lines.map((line) => line.supermarketId)).toEqual([
      'lidl',
      'dia',
      'aldi',
    ]);
  });

  it('puts a chain with no price today after every chain with one', () => {
    const lines = chainPriceHistories(
      history([
        series('aldi', 'scope-1', [
          [0, 0.5],
          [60, null],
        ]),
        series('dia', 'scope-2', [[0, 1.5]]),
      ]),
      context(['aldi', 'dia'])
    );

    expect(lines.map((line) => line.supermarketId)).toEqual(['dia', 'aldi']);
  });

  describe('with more chains than the chart has colours', () => {
    const today: Record<string, number> = {
      aldi: 5,
      bm: 1,
      carrefour: 4,
      dia: 2,
      eroski: 3,
      froiz: 9,
    };
    const lines = chainPriceHistories(
      history(
        Object.entries(today).map(([id, price]) =>
          // Every chain was cheaper once, so only today's price can decide.
          series(id, `scope-${id}`, [
            [0, 10 - price],
            [30, price],
          ])
        )
      ),
      context(Object.keys(today))
    );

    it('keeps the five with the lowest price today', () => {
      expect(lines).toHaveLength(PRICE_HISTORY_MAX_CHAINS);
      expect(lines.map((line) => line.supermarketId)).toEqual([
        'bm',
        'dia',
        'eroski',
        'carrefour',
        'aldi',
      ]);
    });

    it('gives each chain the colour of its place among the sorted chain ids', () => {
      // The order of the lines is by price. The colours are not.
      expect(
        Object.fromEntries(lines.map((line) => [line.supermarketId, line.slot]))
      ).toEqual({ aldi: 0, bm: 1, carrefour: 2, dia: 3, eroski: 4 });
    });
  });

  it('gives a chain the same colour whatever order the prices put the lines in', () => {
    const slotsFor = (prices: Record<string, number>) =>
      Object.fromEntries(
        chainPriceHistories(
          history(
            Object.entries(prices).map(([id, price]) =>
              series(id, `scope-${id}`, [[0, price]])
            )
          ),
          context(['aldi', 'dia', 'lidl'])
        ).map((line) => [line.supermarketId, line.slot])
      );

    const colours = { aldi: 0, dia: 1, lidl: 2 };
    expect(slotsFor({ lidl: 1, dia: 2, aldi: 3 })).toEqual(colours);
    expect(slotsFor({ dia: 3, aldi: 1, lidl: 2 })).toEqual(colours);
  });

  it('keeps the colour of a chain after another one is hidden', () => {
    const lines = chainPriceHistories(
      history([
        series('aldi', 'scope-1', [[0, 3]]),
        series('dia', 'scope-2', [[0, 2]]),
        series('lidl', 'scope-3', [[0, 1]]),
      ]),
      context(['aldi', 'dia', 'lidl'])
    );

    // Hiding is a filter over the lines, and the slot travels with the line.
    const shown = lines.filter((line) => line.supermarketId !== 'aldi');
    expect(shown.map((line) => [line.supermarketId, line.slot])).toEqual([
      ['lidl', 2],
      ['dia', 1],
    ]);
  });
});

describe('priceAt', () => {
  const line = steps([10, 1.0], [20, null], [30, 1.2]);

  it('is the last step that is not after the moment', () => {
    expect(priceAt(line, 10)).toBe(1.0);
    expect(priceAt(line, 19)).toBe(1.0);
    expect(priceAt(line, 30)).toBe(1.2);
    expect(priceAt(line, 99)).toBe(1.2);
  });

  it('is nothing before the first step, and where nothing was shown', () => {
    expect(priceAt(line, 9)).toBeNull();
    expect(priceAt(line, 25)).toBeNull();
    expect(priceAt([], 10)).toBeNull();
  });
});

describe('priceHistoryStart', () => {
  it.each([
    ['month', 30],
    ['quarter', 91],
    ['year', 365],
  ] as const)('is the %s before the end: %d days', (range, days) => {
    expect(priceHistoryStart(range, day(400))).toEqual(day(400 - days));
  });
});

describe('stepsWithin', () => {
  const line = steps([0, 1.0], [10, 1.2], [20, 1.1], [40, 1.3]);

  it('opens at the start of the window with the price in force then', () => {
    expect(stepsWithin(line, 15, 30)).toEqual(steps([15, 1.2], [20, 1.1]));
  });

  it('leaves out every step after the end, and keeps one at the end', () => {
    expect(stepsWithin(line, 0, 20)).toEqual(
      steps([0, 1.0], [10, 1.2], [20, 1.1])
    );
  });

  it('opens with nothing when the line starts inside the window', () => {
    expect(stepsWithin(steps([10, 1.2]), 5, 30)).toEqual(
      steps([5, null], [10, 1.2])
    );
  });

  it('is one flat step when the price did not move in the window', () => {
    expect(stepsWithin(line, 21, 39)).toEqual(steps([21, 1.1]));
  });

  it('does not repeat a step that opens the window', () => {
    expect(stepsWithin(line, 10, 15)).toEqual(steps([10, 1.2]));
  });
});

describe('pricesWithin', () => {
  it('counts the prices of every line, and not where nothing was shown', () => {
    expect(
      pricesWithin([steps([0, 1.0], [10, null], [20, 1.2]), steps([0, 2.0])])
    ).toBe(3);
  });

  it('is under two for one flat price, which draws a sentence and no chart', () => {
    expect(pricesWithin([steps([0, 1.0]), steps([0, null])])).toBe(1);
    expect(pricesWithin([])).toBe(0);
  });
});

describe('priceScale', () => {
  it('is four grid lines on round prices', () => {
    expect(priceScale([1.09, 1.15, 1.25])).toEqual({
      min: 1,
      max: 1.3,
      ticks: [1, 1.1, 1.2, 1.3],
    });
  });

  it('does not start at zero for prices that move by cents', () => {
    expect(priceScale([1.09, 1.11]).min).toBe(1.09);
  });

  it.each([
    [[0.29, 0.31]],
    [[0.07, 0.58]],
    [[0.1, 0.3]],
    [[1.1, 1.4]],
    [[2.49, 3.15]],
    [[19.99, 24.5]],
    [[0.99, 12.95]],
    [[149, 899]],
  ])('holds every value between four even grid lines: %j', (values) => {
    const scale = priceScale(values);

    expect(scale.ticks).toHaveLength(4);
    expect(scale.ticks[0]).toBe(scale.min);
    expect(scale.ticks[3]).toBe(scale.max);
    expect(scale.min).toBeLessThanOrEqual(Math.min(...values));
    expect(scale.max).toBeGreaterThanOrEqual(Math.max(...values));

    const gaps = scale.ticks
      .slice(1)
      .map((tick, index) => Math.round((tick - scale.ticks[index]) * 10000));
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBeGreaterThan(0);
  });

  it('writes no long binary fraction on a grid line', () => {
    for (const tick of priceScale([0.1, 0.3]).ticks) {
      expect(String(tick).length).toBeLessThanOrEqual(6);
    }
  });

  it('still has four grid lines for one flat price', () => {
    expect(priceScale([1.09])).toEqual({
      min: 1.09,
      max: 1.12,
      ticks: [1.09, 1.1, 1.11, 1.12],
    });
  });

  it('still has four grid lines for no price at all', () => {
    const scale = priceScale([]);

    expect(scale.ticks).toHaveLength(4);
    expect(scale.max).toBeGreaterThan(scale.min);
  });
});

describe('steppedPath', () => {
  const x = (at: number): number => at;
  const y = (price: number): number => 100 - price * 10;

  it('is flat until the price changes, then straight to the new price', () => {
    expect(steppedPath(steps([0, 1], [10, 2], [30, 1.5]), 40, x, y)).toBe(
      'M0 90H10V80H30V85H40'
    );
  });

  it('never draws a slope: only moves, flat runs and straight rises', () => {
    expect(steppedPath(steps([0, 1], [10, 2], [30, 1.5]), 40, x, y)).toMatch(
      /^M[\d.]+ [\d.]+(?:[HV][\d.]+)+$/
    );
  });

  it('runs one flat price to the end of the window', () => {
    expect(steppedPath(steps([5, 1]), 40, x, y)).toBe('M5 90H40');
  });

  it('lifts the pen where nothing was shown', () => {
    expect(steppedPath(steps([0, 1], [10, null], [20, 2]), 40, x, y)).toBe(
      'M0 90H10M20 80H40'
    );
  });

  it('starts at the first price when the line opens on nothing', () => {
    expect(steppedPath(steps([0, null], [10, 2]), 40, x, y)).toBe('M10 80H40');
  });

  it('is empty for a line with no price', () => {
    expect(steppedPath(steps([0, null]), 40, x, y)).toBe('');
    expect(steppedPath([], 40, x, y)).toBe('');
  });

  it('places a point to a tenth of a pixel', () => {
    expect(
      steppedPath(
        steps([0, 1]),
        3,
        (at) => at / 3,
        () => 12.345
      )
    ).toBe('M0 12.3H1');
  });
});
