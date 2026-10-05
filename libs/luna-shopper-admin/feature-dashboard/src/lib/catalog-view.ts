import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { BarChartView } from '@portfolio/luna-shopper-admin/ui';
import type { StatView } from './dashboard-view';

/**
 * The catalog block of the dashboard document, as the overview draws it.
 *
 * Admin plan 0022 moved both functions to `feature-catalog`, for a dashboard
 * of the Catalog section. That section is gone (admin plan 0043): its screens
 * are the Chains and the Products sections, neither of which opens on a
 * dashboard. So the numbers and the chart are a panel of the overview, and
 * the functions are beside the page that draws them.
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

/**
 * How much of the catalog there is, and how much of it carries a price (admin
 * plan 0046, target 2). A number links to its list.
 */
export function catalogStats(
  catalog: Wire.AdminDashboardAdminCatalogDashboard,
  translate: Translate,
  pathOf: PathOf
): StatView[] {
  return [
    stat(
      'supermarkets',
      'dashboard.catalog.supermarkets',
      catalog.supermarkets,
      pathOf('supermarkets')
    ),
    // A shop is under its chain and has no list of its own (admin plan 0042),
    // so this answers with wherever the registry says the closest list is.
    stat(
      'locations',
      'dashboard.catalog.locations',
      catalog.locations,
      pathOf('locations')
    ),
    stat('items', 'dashboard.catalog.items', catalog.items, pathOf('items')),
    stat(
      'productGroups',
      'dashboard.catalog.productGroups',
      catalog.productGroups,
      pathOf('product-groups')
    ),
    // A price has no screen of its own (admin plan 0043). It is read on its
    // product, and the products are where an operator starts.
    stat(
      'priced',
      'dashboard.catalog.priced',
      catalog.supermarketItems.priced,
      pathOf('items')
    ),
  ];

  function stat(
    key: string,
    label: string,
    value: number,
    link: readonly string[] | null
  ): StatView {
    return {
      key,
      label: translate(label),
      value,
      of: null,
      link,
      danger: false,
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
