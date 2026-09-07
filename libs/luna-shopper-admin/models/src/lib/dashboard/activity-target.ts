import type { PathOf } from '../resource/resource-path';

/**
 * An audit row, as much of it as a route can be built from.
 *
 * Structural rather than the generated wire shape, so a spec can name an entity
 * this app has no screen for without inventing the rest of a feed entry.
 */
export interface ActivitySubject {
  /** The table, as the audit row names it: `zones`, `item_prices`, `users`. */
  readonly entity: string;
  readonly entityId: string;
}

/**
 * The tables whose rows have a screen, and which resource that screen is.
 *
 * The audit trail names a table and this app names a resource, and the two agree
 * only by accident: `shopping_lists` is the table behind the `lists` screen and
 * `item_prices` is the table behind `prices`. So the mapping is written out
 * rather than derived, and a table missing from it has no screen rather than a
 * guessed one.
 *
 * **A resource name, never a URL segment** (admin plan 0022, section 3). This
 * used to be a second hand written copy of the segment list, which drifted
 * silently the day a segment was renamed and broke outright the day the sections
 * moved fourteen screens. Knowing that `shopping_lists` is the `lists` screen is
 * real knowledge that lives nowhere else; knowing where the `lists` screen is
 * mounted belongs to the registry, and comes in through {@link PathOf}.
 */
const RESOURCE_NAMES: Readonly<Record<string, string | undefined>> = {
  zones: 'zones',
  shopping_lists: 'lists',
  users: 'users',
  items: 'items',
  item_prices: 'prices',
};

/**
 * Where a feed row goes when it is followed, or `null` when it goes nowhere.
 *
 * A row of the activity feed says who changed which row of which table, and the
 * feed is worth far more when the row opens. It only opens where this app has a
 * screen addressed by exactly what the audit row carries, which is the table and
 * the row's own id and nothing else.
 *
 * **A target this app cannot build is `null`, never a guessed URL.** A link that
 * lands on the not found page is worse than text: it costs a navigation and a
 * page to find out that the answer was no. That is what rules out the three
 * nested tables, and it rules them out permanently rather than until somebody
 * finds a segment for them. `supermarket_items`, `list_lines` and
 * `zone_memberships` are all addressed by a composite key in this app
 * (`compositeIdOf`), because no route reads one of those rows by its own uuid,
 * and the audit row carries the uuid. There is nothing in the entry to reach the
 * parent's screen with either: `list_lines` would need the list and
 * `zone_memberships` the zone, and the trail records neither.
 *
 * The two other ways to be `null` are new and are the same answer for the same
 * reason: a resolver that does not know the resource, which is an app that did
 * not mount that screen, and an entry with no id.
 */
export function activityTarget(
  entry: ActivitySubject,
  pathOf: PathOf
): readonly string[] | null {
  const resource = RESOURCE_NAMES[entry.entity];
  if (resource === undefined || entry.entityId === '') {
    return null;
  }

  const path = pathOf(resource);

  return path === null ? null : [...path, entry.entityId];
}
