import {
  HARVEST_SEGMENT,
  postalCodeCaption,
} from '@portfolio/luna-shopper-admin/feature-harvest';
import {
  activityTarget,
  type PathOf,
  type Translate,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import type { TileView } from '@portfolio/luna-shopper-admin/ui';

/**
 * The document turned into what the overview's components take (admin plan
 * 0016, split by admin plan 0022).
 *
 * Every function here is pure and takes its strings through `translate`, so the
 * screen is a template over these and a spec can assert a tile's count and a
 * chart's series without rendering anything. That is also what keeps the rule
 * about assertions: the numbers are on a view model, never only in interpolated
 * text the testing translator does not fill in.
 *
 * **Three of them are left.** The counts and the charts moved to the section
 * that owns them: `peopleTiles`, `signUpsChart` and `zonesAndListsChart` to
 * `feature-people`, `catalogTiles` and `pricesWrittenChart` to
 * `feature-catalog`, `recentRunRows` and `runsByStatusChart` to
 * `feature-harvest`. None of them changed except to take {@link PathOf} where it
 * held a literal path, and nothing was copied. What stays is what is true of the
 * whole system rather than of one part of it: every queue in one place, a fact
 * about the tool itself, and a feed that crosses all three audit trails by
 * definition.
 */

/** A chain's name, or its id when the reference cannot name it (plan 0007, 4). */
export type NameChain = (supermarketId: string) => string;

/** One row of the sign in failure table. */
export interface FailureRow {
  readonly key: string;
  readonly when: string;
  readonly username: string;
  /** The address, or the word for a request that carried none. */
  readonly ip: string;
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
  /** The action and the table, as one sentence. */
  readonly what: string;
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

/**
 * What is waiting for a decision, as tiles that link to where it is made.
 *
 * A tile is in the attention tone whenever its count is above zero, because a
 * queue with rows in it is the reason this screen is the first thing an operator
 * sees. A chain with nothing waiting in a queue draws **no tile** for that
 * queue: a row of zeros reads as noise, and the reader is looking for the one
 * that is not zero.
 *
 * A block that did not answer contributes nothing here, and the screen draws its
 * notice in place of the tiles rather than an empty row. "The harvester did not
 * answer" and "nothing is waiting" are different sentences and must never look
 * the same.
 *
 * The three resource tiles ask `pathOf` where their screen is, and draw as an
 * unlinked tile where the app did not mount it. The harvester's are hand written
 * screens, which have no descriptor and keep the segment constant they have
 * always built from.
 */
export function waitingTiles(
  document: Wire.AdminAdminDashboardResponse,
  translate: Translate,
  nameChain: NameChain,
  pathOf: PathOf
): TileView[] {
  const tiles: TileView[] = [];
  const core = document.core;
  const harvest = document.harvest;
  const catalog = document.catalog;
  const identity = document.identity;

  if (core !== null) {
    tiles.push(
      waiting(
        'memberships',
        translate('dashboard.waiting.joinRequests'),
        core.memberships.pending,
        pathOf('zones')
      )
    );
  }

  if (harvest !== null) {
    for (const queue of harvest.queues.entries) {
      const count = queue.candidate + queue.unresolved;
      if (count > 0) {
        tiles.push(
          waiting(
            `entries-${queue.supermarketId}`,
            translate('dashboard.waiting.entries', {
              chain: nameChain(queue.supermarketId),
            }),
            count,
            // The one queue that reads a chain from the query string, so this
            // link opens it already on the chain (admin plan 0014). The others
            // do not, so their tiles open the unfiltered screen.
            ['/', HARVEST_SEGMENT, 'entries'],
            { supermarketId: queue.supermarketId }
          )
        );
      }
    }

    for (const queue of harvest.queues.shops) {
      if (queue.unmapped > 0) {
        tiles.push(
          waiting(
            `shops-${queue.supermarketId}`,
            translate('dashboard.waiting.shops', {
              chain: nameChain(queue.supermarketId),
            }),
            queue.unmapped,
            ['/', HARVEST_SEGMENT, 'shops']
          )
        );
      }
    }

    tiles.push(
      waiting(
        'places',
        translate('dashboard.waiting.places'),
        harvest.queues.places,
        ['/', HARVEST_SEGMENT, 'places']
      )
    );
  }

  if (catalog !== null) {
    tiles.push(
      waiting(
        'stale',
        translate('dashboard.waiting.stalePrices'),
        catalog.supermarketItems.stale,
        pathOf('prices')
      )
    );
  }

  if (identity !== null) {
    tiles.push(
      // No link: the rows are further down this same page, so sending the
      // operator somewhere else to read five of them would be a worse answer.
      waiting(
        'loginFailures',
        translate('dashboard.waiting.loginFailures'),
        identity.loginFailures.last24h,
        null
      )
    );
  }

  return tiles;
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
 * we have nothing for them. That argument survives admin plan 0022's split
 * intact, which is why the count stays here while the card holding all three
 * numbers is on the harvester's dashboard.
 *
 * `null` where the summary did not answer, because a decoration that could not
 * be read draws nothing rather than a zero that reads as good news.
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

/** The most recent failed admin sign ins, as a short table. */
export function loginFailureRows(
  identity: Wire.AdminDashboardAdminIdentityDashboard,
  translate: Translate,
  formatInstant: (value: string | null) => string
): FailureRow[] {
  return identity.loginFailures.recent.map((failure, index) => ({
    key: `${failure.at}-${index}`,
    when: formatInstant(failure.at),
    username: failure.username,
    // A proxy that did not pass the address through is a real row, and the
    // table says so rather than drawing an empty cell that reads as a bug.
    ip: failure.ip ?? translate('dashboard.signIns.noIp'),
  }));
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
  return entries.map((entry, index) => ({
    key: `${entry.at}-${entry.entity}-${entry.entityId}-${index}`,
    when: formatSince(entry.at),
    at: formatInstant(entry.at),
    who:
      entry.actorKind === 'SERVICE'
        ? translate('dashboard.activity.service')
        : entry.actorName,
    what: translate('dashboard.activity.entry', {
      action: translate(`dashboard.activity.action.${entry.action}`),
      entity: entityLabel(entry.entity, translate),
    }),
    link: activityTarget(entry, pathOf),
  }));
}

function entityLabel(entity: string, translate: Translate): string {
  const key = ENTITY_KEYS[entity];
  // The audit row's own word for the table, where this app has no noun for it.
  // A table name in front of an operator is honest; an invented noun is not.
  return key === undefined ? entity : translate(key);
}
