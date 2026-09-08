import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { BarChartView, TileView } from '@portfolio/luna-shopper-admin/ui';

/**
 * The catalog block of the dashboard document, as the catalog screen draws it.
 *
 * Both functions came from `feature-dashboard` with admin plan 0022 and neither
 * changed except to take {@link PathOf} where it held a literal path. They are
 * here because this is the library that owns the screens they link to, which is
 * the same rule that puts a descriptor beside its gateway.
 */

/** The six price source kinds, in the order that fixes their chart colours. */
const PRICE_SOURCE_KINDS: readonly Wire.EnumsPriceSourceKind[] = [
  'OFFICIAL_API',
  'OFFICIAL_WEB',
  'OFFICIAL_LEAFLET',
  'ADMIN',
  'USER_RECEIPT',
  'USER_REPORTED',
];

/** How much of the catalog there is, and how much of it carries a price. */
export function catalogTiles(
  catalog: Wire.AdminDashboardAdminCatalogDashboard,
  translate: Translate,
  pathOf: PathOf
): TileView[] {
  return [
    tile(
      'supermarkets',
      'dashboard.catalog.supermarkets',
      catalog.supermarkets,
      pathOf('supermarkets')
    ),
    tile(
      'locations',
      'dashboard.catalog.locations',
      catalog.locations,
      pathOf('locations')
    ),
    tile('items', 'dashboard.catalog.items', catalog.items, pathOf('items')),
    tile(
      'productGroups',
      'dashboard.catalog.productGroups',
      catalog.productGroups,
      pathOf('product-groups')
    ),
    {
      key: 'supermarketItems',
      label: translate('dashboard.catalog.supermarketItems'),
      value: catalog.supermarketItems.total,
      caption: translate('dashboard.catalog.supermarketItemsCaption', {
        priced: catalog.supermarketItems.priced,
        stale: catalog.supermarketItems.stale,
        unavailable: catalog.supermarketItems.unavailable,
      }),
      delta: null,
      trend: null,
      link: pathOf('prices'),
      query: null,
      tone: 'quiet',
    },
  ];

  function tile(
    key: string,
    label: string,
    value: number,
    link: readonly string[] | null
  ): TileView {
    return {
      key,
      label: translate(label),
      value,
      caption: null,
      delta: null,
      trend: null,
      link,
      query: null,
      tone: 'quiet',
    };
  }
}

/**
 * Prices written per day, one stacked series per source kind.
 *
 * **Colour is the kind's position in the enum, one to six, always.** A kind
 * whose thirty days are all zero is left out of the drawing and the legend and
 * keeps its number for the month it comes back, which is what stops a reader who
 * learned a colour last week being lied to (plan 0015, section 2).
 */
export function pricesWrittenChart(
  catalog: Wire.AdminDashboardAdminCatalogDashboard,
  translate: Translate,
  formatDay: (day: string) => string = (day) => day
): BarChartView {
  const written = new Map(
    catalog.pricesWritten.map((entry) => [entry.sourceKind, entry.points])
  );

  const drawn = PRICE_SOURCE_KINDS.map((kind, index) => ({
    kind,
    colour: index + 1,
    points: written.get(kind) ?? [],
  })).filter((entry) => entry.points.some((point) => point.count > 0));

  const days = catalog.pricesWritten[0]?.points ?? [];

  return {
    series: drawn.map((entry) => ({
      key: entry.kind,
      label: translate(`catalog.priceSourceKind.${entry.kind}`),
      colour: entry.colour,
    })),
    bars: days.map((point, index) => ({
      key: point.day,
      // A short month and a day rather than the ISO string the wire carries.
      // Thirty ISO dates along an axis are unreadable, and the chart thins the
      // labels rather than shortening them, which is the caller's job.
      label: formatDay(point.day),
      values: drawn.map((entry) => entry.points[index]?.count ?? 0),
    })),
  };
}
