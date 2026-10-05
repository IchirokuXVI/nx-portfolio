import {
  weekDelta,
  type PathOf,
  type Translate,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { ChartSeries, TileView } from '@portfolio/luna-shopper-admin/ui';

/**
 * The people the product has, as the overview draws them.
 *
 * Admin plan 0022 moved the three functions to `feature-people`, for a
 * dashboard of the Shoppers section. That section opens on its People tab now
 * (admin plan 0045), so the tiles and the two charts are a block of the
 * overview again, and the functions are back beside the page that draws them.
 *
 * A list and a shopping list have no screen of their own any more: a list is
 * under its zone and a shopping list under its owner. So their two tiles lead
 * to the Zones tab and to the People tab, which is where `pathOf` says the
 * closest list is.
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

/** Zones and lists created per day, as two lines on one chart. */
export function zonesAndListsChart(
  core: Wire.AdminDashboardAdminCoreDashboard,
  translate: Translate
): ChartSeries[] {
  return [
    {
      key: 'zones',
      label: translate('dashboard.shoppers.zonesSeries'),
      colour: 1,
      points: toPoints(core.zonesCreated),
    },
    {
      key: 'lists',
      label: translate('dashboard.shoppers.listsSeries'),
      colour: 2,
      points: toPoints(core.listsCreated),
    },
  ];
}

function toPoints(
  series: readonly Wire.AdminDashboardDailyCount[]
): { day: string; value: number }[] {
  return series.map((point) => ({ day: point.day, value: point.count }));
}

/**
 * The people tiles: who is here, and what they have made.
 *
 * Users carries the seven day delta and the sparkline, because it is the one
 * number on this screen whose direction is the question. The other three are
 * totals with a caption breaking them down.
 */
export function peopleTiles(
  identity: Wire.AdminDashboardAdminIdentityDashboard | null,
  core: Wire.AdminDashboardAdminCoreDashboard | null,
  translate: Translate,
  pathOf: PathOf
): TileView[] {
  const tiles: TileView[] = [];

  if (identity !== null) {
    tiles.push({
      key: 'users',
      label: translate('dashboard.shoppers.users'),
      value: identity.users.total,
      caption: translate('dashboard.shoppers.usersCaption', {
        registered: identity.users.registered,
        temporary: identity.users.temporary,
        verified: identity.users.verified,
      }),
      delta: {
        value: weekDelta(identity.signUps),
        caption: translate('dashboard.shoppers.inLast7Days'),
      },
      trend: identity.signUps.map((point) => point.count),
      link: pathOf('users'),
      query: null,
      tone: 'quiet',
    });
  }

  if (core !== null) {
    tiles.push(
      {
        key: 'zones',
        label: translate('dashboard.shoppers.zones'),
        value: core.zones.total,
        caption: translate('dashboard.shoppers.zonesCaption', {
          active: core.zones.active,
          total: core.zones.total,
        }),
        delta: null,
        trend: null,
        link: pathOf('zones'),
        query: null,
        tone: 'quiet',
      },
      {
        key: 'lists',
        label: translate('dashboard.shoppers.lists'),
        value: core.lists.total,
        caption: null,
        delta: null,
        trend: null,
        link: pathOf('lists'),
        query: null,
        tone: 'quiet',
      },
      {
        key: 'baskets',
        label: translate('dashboard.shoppers.baskets'),
        value: core.baskets.total,
        caption: translate('dashboard.shoppers.basketsCaption', {
          open: core.baskets.open,
          finished: core.baskets.finished,
          live: core.baskets.live,
        }),
        delta: null,
        trend: null,
        // By name, and never by its segment. A shopping list is under its
        // owner, so this answers with the people.
        link: pathOf('baskets'),
        query: null,
        tone: 'quiet',
      }
    );
  }

  return tiles;
}
