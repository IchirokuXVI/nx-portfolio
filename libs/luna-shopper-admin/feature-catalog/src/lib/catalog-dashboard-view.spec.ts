import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { catalogTiles, pricesWrittenChart } from './catalog-dashboard-view';

/** The testing translator does not interpolate, so a spec supplies its own. */
const translate: Translate = (key, values) =>
  values === undefined
    ? key
    : `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`;

/** Every catalog resource, mounted where admin plan 0022 puts it. */
const pathOf: PathOf = (name) => ['/', 'catalog', name];

/** An app that mounted none of them, which draws a tile with no link. */
const nothing: PathOf = () => null;

function days(...counts: readonly number[]): Wire.AdminDashboardDailyCount[] {
  return counts.map((count, index) => ({
    day: `2026-08-${String(index + 1).padStart(2, '0')}`,
    count,
  }));
}

function catalog(
  over: Partial<Wire.AdminDashboardAdminCatalogDashboard> = {}
): Wire.AdminDashboardAdminCatalogDashboard {
  return {
    supermarkets: 3,
    locations: 40,
    items: 500,
    productGroups: 20,
    supermarketItems: { total: 900, priced: 800, stale: 61, unavailable: 12 },
    pricesWritten: [],
    activity: [],
    ...over,
  };
}

describe('catalogTiles', () => {
  it('is five tiles, the last of which opens the price list', () => {
    const tiles = catalogTiles(catalog(), translate, pathOf);

    expect(tiles.map((tile) => tile.key)).toEqual([
      'supermarkets',
      'locations',
      'items',
      'productGroups',
      'supermarketItems',
    ]);
    expect(tiles[4].link).toEqual(['/', 'catalog', 'prices']);
    expect(tiles[4].value).toBe(900);
  });

  /**
   * A tile knows which resource it opens and knows nothing about which section
   * holds it, which is what let fourteen screens move without touching this.
   */
  it('opens every one of them through the section that mounted it', () => {
    const tiles = catalogTiles(catalog(), translate, pathOf);

    expect(tiles.map((tile) => tile.link?.[1])).toEqual([
      'catalog',
      'catalog',
      'catalog',
      'catalog',
      'catalog',
    ]);
  });

  it('draws an unlinked tile where the screen is not mounted', () => {
    const tiles = catalogTiles(catalog(), translate, nothing);

    expect(tiles.map((tile) => tile.link)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(tiles[2].value).toBe(500);
  });
});

describe('pricesWrittenChart', () => {
  const series = (
    kind: Wire.EnumsPriceSourceKind,
    ...counts: readonly number[]
  ) => ({ sourceKind: kind, points: days(...counts) });

  it('gives a kind the colour of its position in the enum, always', () => {
    const chart = pricesWrittenChart(
      catalog({
        pricesWritten: [
          series('OFFICIAL_API', 0, 0, 0),
          series('OFFICIAL_WEB', 1, 2, 3),
          series('OFFICIAL_LEAFLET', 0, 0, 0),
          series('ADMIN', 4, 0, 0),
          series('USER_RECEIPT', 0, 0, 0),
          series('USER_REPORTED', 0, 0, 0),
        ],
      }),
      translate
    );

    expect(chart.series.map((entry) => [entry.key, entry.colour])).toEqual([
      ['OFFICIAL_WEB', 2],
      ['ADMIN', 4],
    ]);
  });

  it('leaves a kind that wrote nothing out of the drawing', () => {
    const chart = pricesWrittenChart(
      catalog({
        pricesWritten: [
          series('OFFICIAL_API', 1, 0, 0),
          series('USER_RECEIPT', 0, 0, 0),
        ],
      }),
      translate
    );

    expect(chart.series.map((entry) => entry.key)).toEqual(['OFFICIAL_API']);
    expect(chart.bars.map((bar) => bar.values)).toEqual([[1], [0], [0]]);
  });

  it('draws one category per day of the window', () => {
    const chart = pricesWrittenChart(
      catalog({ pricesWritten: [series('OFFICIAL_API', 1, 2, 3)] }),
      translate
    );

    expect(chart.bars.map((bar) => bar.key)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  /**
   * Thirty ISO dates along an axis are unreadable, and the chart thins its
   * labels rather than shortening them, which is the caller's job.
   */
  it('labels a day with whatever the caller formats it as', () => {
    const chart = pricesWrittenChart(
      catalog({ pricesWritten: [series('OFFICIAL_API', 1, 2, 3)] }),
      translate,
      (day) => `on ${day.slice(-2)}`
    );

    expect(chart.bars.map((bar) => bar.label)).toEqual([
      'on 01',
      'on 02',
      'on 03',
    ]);
  });
});
