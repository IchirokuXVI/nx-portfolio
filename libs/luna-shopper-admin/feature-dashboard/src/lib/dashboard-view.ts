import {
  harvestWaiting,
  type ChainWaiting,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  activityTarget,
  harvestReviewPath,
  type PathOf,
  type Translate,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { TileView } from '@portfolio/luna-shopper-admin/ui';
import { postalCodeCaption } from './harvest-view';

/**
 * The document turned into what the overview draws (admin plan 0016, given
 * its final layout by admin plan 0046).
 *
 * Every function here is pure and takes its strings through `translate`, so the
 * screen is a template over these and a spec can assert a tile's count without
 * rendering anything. That is also what keeps the rule about assertions: the
 * numbers are on a view model, never only in interpolated text the testing
 * translator does not fill in.
 *
 * This file holds what is true of the whole system: everything that waits, in
 * one row, and the feed that crosses all three audit trails. The numbers of
 * each area are beside it, in `catalog-view.ts`, `shoppers-view.ts` and
 * `harvest-view.ts`.
 */

/** A chain's name, or its id when the reference cannot name it (plan 0007, 4). */
export type NameChain = (supermarketId: string) => string;

/**
 * One number of a numbers panel: how many, of what, and where the list is.
 *
 * The three panels share it, so it is here and not in any one of their files.
 */
export interface StatView {
  /** Stable across renders: what `@for` tracks. */
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /**
   * What the value is a part of, for a number read as "0 of 4". `null` for a
   * plain count.
   */
  readonly of: number | null;
  /** Where the list behind the number is, or `null` when it has none. */
  readonly link: readonly string[] | null;
  /** Red, for a count that is a failure when it is above zero. */
  readonly danger: boolean;
}

/** One row of the activity feed. */
export interface ActivityRow {
  readonly key: string;
  /** How long ago, as words. */
  readonly when: string;
  /** The clock time, for the `title`. */
  readonly at: string;
  /** The admin's name, or the service's. */
  readonly who: string;
  /** The action and the table, as words. */
  readonly what: string;
  /** Who did what, as the one sentence the row shows. */
  readonly line: string;
  /** Where the row opens, or `null` where this app has no screen for it. */
  readonly link: readonly string[] | null;
}

/**
 * The tables a feed row can name and what one of their rows is called.
 *
 * A table missing from here is named by the audit row's own word for it, which
 * is a table name in front of an operator and is honest: this app does not know
 * what that row is, and inventing a noun for it would be worse than saying the
 * table.
 */
const ENTITY_KEYS: Readonly<Record<string, string | undefined>> = {
  zones: 'dashboard.activity.entity.zones',
  shopping_lists: 'dashboard.activity.entity.shopping_lists',
  users: 'dashboard.activity.entity.users',
  items: 'dashboard.activity.entity.items',
  item_prices: 'dashboard.activity.entity.item_prices',
  supermarket_items: 'dashboard.activity.entity.supermarket_items',
  list_lines: 'dashboard.activity.entity.list_lines',
  zone_memberships: 'dashboard.activity.entity.zone_memberships',
  // Catalog tables a walk and an operator both write. They have a noun here and
  // no target in `activityTarget`, and the two lists are separate on purpose:
  // knowing what a row is called is not the same as knowing a URL that opens it.
  supermarkets: 'dashboard.activity.entity.supermarkets',
  supermarket_locations: 'dashboard.activity.entity.supermarket_locations',
  product_groups: 'dashboard.activity.entity.product_groups',
  price_scopes: 'dashboard.activity.entity.price_scopes',
  price_policies: 'dashboard.activity.entity.price_policies',
};

/** How many chains the second line of a tile names before it counts the rest. */
const CHAINS_NAMED = 3;

/**
 * What is waiting for a decision, as tiles that link to where it is made
 * (admin plan 0046, target 1).
 *
 * **A tile at zero stays, and is plain.** The row is the same seven tiles on
 * every visit, so the eye learns where each one is, and the one on the waiting
 * wash is the one to open. The two queues that are kept per chain are one tile
 * each, with the chains and their counts as the second line: a tile per chain
 * made the row a different length every day.
 *
 * A block that did not answer contributes no tile, and its numbers panel says
 * that it did not answer. "The harvester did not answer" and "nothing is
 * waiting" are different sentences, and a tile that showed a zero for the
 * first would be the second.
 *
 * `postalCodes` is built beside the document, from its own read, and takes its
 * place in the row here. `failedSignIns` is where the Admins section keeps the
 * table of failed sign ins: its screens are hand written, so the registry
 * cannot answer for it.
 */
export function waitingTiles(
  document: Wire.AdminAdminDashboardResponse,
  postalCodes: TileView | null,
  translate: Translate,
  nameChain: NameChain,
  pathOf: PathOf,
  failedSignIns: readonly string[]
): TileView[] {
  const tiles: TileView[] = [];
  const core = document.core;
  const catalog = document.catalog;
  const identity = document.identity;

  if (document.harvest !== null) {
    const waits = harvestWaiting(document.harvest);

    tiles.push(
      {
        ...waiting(
          'entries',
          translate('dashboard.waiting.entries'),
          waits.products,
          harvestReviewPath('products')
        ),
        caption: chainsCaption(waits.productsByChain, translate, nameChain),
      },
      {
        ...waiting(
          'shops',
          translate('dashboard.waiting.shops'),
          waits.shops,
          harvestReviewPath('shops')
        ),
        caption: chainsCaption(waits.shopsByChain, translate, nameChain),
      },
      waiting(
        'places',
        translate('dashboard.waiting.places'),
        waits.places,
        harvestReviewPath('places')
      )
    );
  }

  if (core !== null) {
    tiles.push(
      waiting(
        'memberships',
        translate('dashboard.waiting.joinRequests'),
        core.memberships.pending,
        pathOf('zones'),
        // The Zones tab, narrowed to the zones where a request waits (admin
        // plan 0045, section 2).
        { hasPending: 'true' }
      )
    );
  }

  if (postalCodes !== null) {
    tiles.push(postalCodes);
  }

  if (catalog !== null) {
    tiles.push(
      waiting(
        'stale',
        translate('dashboard.waiting.stalePrices'),
        catalog.supermarketItems.stale,
        // Every out of date price over every scope has no list of its own
        // (admin plan 0043): the product list shows them one scope at a time,
        // under "Out of date" once a scope is chosen.
        pathOf('items')
      )
    );
  }

  if (identity !== null) {
    tiles.push(
      waiting(
        'loginFailures',
        translate('dashboard.waiting.loginFailures'),
        identity.loginFailures.last24h,
        // The table is the second tab of Admins (admin plan 0046, target 5).
        failedSignIns
      )
    );
  }

  return tiles;
}

/**
 * The chains with something waiting and how much, as the second line of a
 * tile: "Mercadona 61, DIA 35".
 *
 * The first three, most first, and then how many more there are. `null` when
 * no chain has anything, which is a tile at zero.
 */
function chainsCaption(
  chains: readonly ChainWaiting[],
  translate: Translate,
  nameChain: NameChain
): string | null {
  if (chains.length === 0) {
    return null;
  }

  const named = chains
    .slice(0, CHAINS_NAMED)
    .map((chain) => `${nameChain(chain.supermarketId)} ${chain.count}`)
    .join(', ');
  const more = chains.length - CHAINS_NAMED;

  return more > 0
    ? translate('dashboard.waiting.moreChains', { chains: named, count: more })
    : named;
}

/**
 * The postal codes nobody has answered yet (admin plan 0021, section 6).
 *
 * Not part of the dashboard document, and it does not want to be: it is one
 * call, `postalCodeDiscovery.summary`, which the queue screen's banner and the
 * harvester's own dashboard read as well. So it is built from the summary and
 * appended to the tiles rather than folded into {@link waitingTiles}, which is
 * pure over the document.
 *
 * It earns its place on that row because it is the only number on the screen
 * that stands for people waiting on us. A run that failed is our problem. A
 * postal code queued for three weeks is somebody opening velista and being told
 * we have nothing for them.
 *
 * `null` where the summary did not answer, because a number that could not be
 * read draws nothing rather than a zero that reads as good news.
 */
export function postalCodeWaitingTile(
  summary: Wire.HarvestPostalCodeDiscoverySummaryView | null,
  translate: Translate,
  since: (value: string) => string,
  pathOf: PathOf
): TileView | null {
  if (summary === null) {
    return null;
  }

  return {
    ...waiting(
      'postalCodes',
      translate('dashboard.waiting.postalCodes'),
      summary.queued,
      pathOf('postal-codes')
    ),
    caption: postalCodeCaption(summary, translate, since),
  };
}

function waiting(
  key: string,
  label: string,
  count: number,
  link: readonly string[] | null,
  query: Readonly<Record<string, string>> | null = null
): TileView {
  return {
    key,
    label,
    value: count,
    caption: null,
    delta: null,
    trend: null,
    link,
    query,
    // Above zero is work, and work is what an operator opened this to find.
    tone: count > 0 ? 'attention' : 'quiet',
  };
}

/**
 * The three trails merged, as rows that open where this app has a screen.
 *
 * A `SERVICE` actor is named by this app rather than by the gateway: the ids are
 * provisioned per cluster and the harvester is the only service that writes, so
 * the row says "harvester" and the id stays out of it (backend plan 0088,
 * section 4).
 *
 * `activityTarget` takes the resolver rather than owning a segment map of its
 * own, so a row opens at wherever its section mounted the screen.
 */
export function activityRows(
  entries: readonly Wire.AdminDashboardAdminDashboardActivityEntry[],
  translate: Translate,
  formatSince: (value: string) => string,
  formatInstant: (value: string | null) => string,
  pathOf: PathOf
): ActivityRow[] {
  return entries.map((entry, index) => {
    const who =
      entry.actorKind === 'SERVICE'
        ? translate('dashboard.activity.service')
        : entry.actorName;
    const what = translate('dashboard.activity.entry', {
      action: translate(`dashboard.activity.action.${entry.action}`),
      entity: entityLabel(entry.entity, translate),
    });

    return {
      key: `${entry.at}-${entry.entity}-${entry.entityId}-${index}`,
      when: formatSince(entry.at),
      at: formatInstant(entry.at),
      who,
      what,
      line: translate('dashboard.activity.line', { who, what }),
      link: activityTarget(entry, pathOf),
    };
  });
}

function entityLabel(entity: string, translate: Translate): string {
  const key = ENTITY_KEYS[entity];
  // The audit row's own word for the table, where this app has no noun for it.
  // A table name in front of an operator is honest; an invented noun is not.
  return key === undefined ? entity : translate(key);
}
