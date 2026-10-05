import type {
  PathOf,
  Translate,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { ChartSeries } from '@portfolio/luna-shopper-admin/ui';
import type { StatView } from './dashboard-view';

/**
 * The people the product has, as the overview draws them.
 *
 * Admin plan 0022 moved these functions to `feature-people`, for a
 * dashboard of the Shoppers section. That section opens on its People tab now
 * (admin plan 0045), so the numbers and the chart of sign ups are a panel of
 * the overview (admin plan 0046), and the functions are beside the page that
 * draws them.
 */

/** Registered sign ups per day, as one line. */
export function signUpsChart(
  identity: Wire.AdminDashboardAdminIdentityDashboard,
  translate: Translate
): ChartSeries[] {
  return [
    {
      key: 'signUps',
      label: translate('dashboard.shoppers.signUps'),
      colour: 1,
      points: toPoints(identity.signUps),
    },
  ];
}

function toPoints(
  series: readonly Wire.AdminDashboardDailyCount[]
): { day: string; value: number }[] {
  return series.map((point) => ({ day: point.day, value: point.count }));
}

/**
 * Who is here and what they have made (admin plan 0046, target 2): people,
 * zones, lists, and the shopping lists that are being shopped now.
 *
 * People come from auth and the three others from core, so each half is left
 * out by itself when its service did not answer, and the panel says which.
 *
 * A list and a shopping list have no screen of their own: a list is under its
 * zone and a shopping list under its owner. So those two numbers lead to
 * wherever the registry says the closest list is.
 */
export function shopperStats(
  identity: Wire.AdminDashboardAdminIdentityDashboard | null,
  core: Wire.AdminDashboardAdminCoreDashboard | null,
  translate: Translate,
  pathOf: PathOf
): StatView[] {
  const stats: StatView[] = [];

  if (identity !== null) {
    stats.push(
      stat('users', 'dashboard.shoppers.users', identity.users.total, 'users')
    );
  }

  if (core !== null) {
    stats.push(
      stat('zones', 'dashboard.shoppers.zones', core.zones.total, 'zones'),
      stat('lists', 'dashboard.shoppers.lists', core.lists.total, 'lists'),
      // By name, and never by its segment. A shopping list is under its
      // owner, so this answers with the people.
      stat(
        'beingShopped',
        'dashboard.shoppers.beingShopped',
        core.baskets.open,
        'baskets'
      )
    );
  }

  return stats;

  function stat(
    key: string,
    label: string,
    value: number,
    resource: string
  ): StatView {
    return {
      key,
      label: translate(label),
      value,
      of: null,
      link: pathOf(resource),
      danger: false,
    };
  }
}
