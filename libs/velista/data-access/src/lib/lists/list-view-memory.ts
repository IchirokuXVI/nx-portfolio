import type { ListViewMode, ListViewOrder } from '@portfolio/velista/models';
import { isRecord } from '../mapping/primitives';
import {
  oneOfOrNull,
  readRemembered,
  UNREADABLE,
  untilFor,
  type Remembered,
  type ViewLifetime,
} from '../view-memory';

/**
 * What the zone list filter sheet remembers between visits (velista `0082`, section
 * 8), following `basket-view-memory.ts`.
 *
 * One record per device, not one per list: an order is how somebody reads lists, and
 * the next list they open is read the same way.
 *
 * ## Why the view is in the table and never in storage
 *
 * The category view cannot apply without its category, and the product owner decided
 * on 2026-09-13 that the category is not remembered. So `view` has the `'visit'`
 * lifetime and every visit starts at "All lines". Changing it to `null` later is one
 * line here, and it must also decide what a restored view with no category draws.
 *
 * The search is never stored and is not in this record.
 */
export interface ListViewMemory {
  readonly version: 1;
  readonly order?: Remembered<ListViewOrder>;
  readonly view?: Remembered<ListViewMode>;
}

export type ListRememberedProperty = Exclude<keyof ListViewMemory, 'version'>;

/** How long each property is kept. A property with no entry does not compile. */
export const LIST_VIEW_LIFETIME_MS: Readonly<
  Record<ListRememberedProperty, ViewLifetime>
> = {
  order: null,
  view: 'visit',
};

const VERSION = 1;

/** A record holding nothing, which is what the sheet's Reset writes. */
export const NO_LIST_VIEW_MEMORY: ListViewMemory = { version: VERSION };

const ORDERS: readonly ListViewOrder[] = ['list', 'alpha'];
const VIEWS: readonly ListViewMode[] = ['all', 'category'];

/**
 * Map a stored record, rule D4 applied to storage. Anything this build cannot read
 * answers null, which every caller reads as "nothing was remembered".
 */
export function toListViewMemory(raw: unknown): ListViewMemory | null {
  if (!isRecord(raw) || raw['version'] !== VERSION) {
    return null;
  }

  const order = readRemembered(raw['order'], (value) =>
    oneOfOrNull(value, ORDERS)
  );
  const view = readRemembered(raw['view'], (value) =>
    oneOfOrNull(value, VIEWS)
  );

  if (order === UNREADABLE || view === UNREADABLE) {
    return null;
  }

  return {
    version: VERSION,
    ...(order === undefined ? {} : { order }),
    ...(view === undefined ? {} : { view }),
  };
}

/** {@link toListViewMemory} over what storage hands back: a string or null. */
export function parseListViewMemory(raw: string | null): ListViewMemory | null {
  if (raw === null) {
    return null;
  }

  try {
    return toListViewMemory(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The record with one property set, dated from its own lifetime.
 *
 * A `'visit'` property is **forgotten** instead of written, so a record an older
 * build left behind cannot hand it back either.
 */
export function rememberListView<K extends ListRememberedProperty>(
  memory: ListViewMemory,
  property: K,
  value: NonNullable<ListViewMemory[K]>['value'],
  now: number
): ListViewMemory {
  const lifetime = LIST_VIEW_LIFETIME_MS[property];
  if (lifetime === 'visit') {
    return forgetListView(memory, property);
  }

  return {
    ...memory,
    [property]: { value, until: untilFor(lifetime, now) },
  } as ListViewMemory;
}

/** The record with one property gone. */
export function forgetListView(
  memory: ListViewMemory,
  property: ListRememberedProperty
): ListViewMemory {
  if (memory[property] === undefined) {
    return memory;
  }

  const { [property]: _dropped, ...kept } = memory;
  return kept;
}
