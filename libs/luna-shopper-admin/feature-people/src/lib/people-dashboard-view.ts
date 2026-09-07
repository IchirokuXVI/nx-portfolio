import {
  weekDelta,
  type PathOf,
  type Translate,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { ChartSeries, TileView } from '@portfolio/luna-shopper-admin/ui';

/**
 * The people the product has, as the shoppers screen draws them.
 *
 * The three functions came from `feature-dashboard` with admin plan 0022 and
 * none of them changed except to take {@link PathOf} where it held a literal
 * path. They are here because this is the library that owns the screens they
 * link to.
 *
 * The section is called Shoppers and this library is called `feature-people`,
 * and the mismatch is on purpose: `Core` and `Auth` are the names of two backend
 * deployments and `People` is this library's own title, and neither is what a
 * tab says. A tab names what the operator is about to look at, and nobody is
 * about to look at a deployment.
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
          draft: core.baskets.draft,
          completed: core.baskets.completed,
        }),
        delta: null,
        trend: null,
        // By name, which is `baskets`. Its segment is `shopping-lists`, the
        // gateway's own word for a generated list, and this link used to be
        // that segment written out: a second copy of a fact the descriptor
        // already holds, and wrong the moment the screen moved into a section.
        link: pathOf('baskets'),
        query: null,
        tone: 'quiet',
      }
    );
  }

  return tiles;
}
