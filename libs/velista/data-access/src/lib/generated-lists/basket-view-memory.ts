import type { BasketGrouping, BasketOrder } from '@portfolio/velista/models';
import { isRecord } from '../mapping/primitives';

/**
 * What the filter sheet remembers between visits, and for how long (velista
 * `0076`).
 *
 * **Not the in-memory backend.** `basket-memory.ts` beside this file is the fake
 * that answers a basket with no server; this is the shopper's own preference,
 * written to this device's storage. "Memory" here is the plan's word for what the
 * sheet keeps, not for where a fake basket lives.
 *
 * ## Why only three properties
 *
 * The order, the grouping and the shop **move** lines and mark them, and somebody
 * who likes the basket grouped by category likes it that way tomorrow too. The
 * search and the list filter **hide** lines, and a basket that opens with half of
 * its lines missing because of a choice made last week is a basket somebody thinks
 * is broken. So the first kind is kept and the second never is, and `lists` and the
 * query are not in this record and will not be added to it.
 *
 * ## Why each property carries its own date
 *
 * One of the three is worth keeping for a while rather than for ever: "prices from
 * Mercadona" is true for the trip and not for the month. Rather than special casing
 * the shop, every property names a lifetime in {@link BASKET_VIEW_LIFETIME_MS} and
 * carries the date that lifetime produced, so a property added later has to answer
 * the same question or the build fails.
 *
 * Everything here is pure and takes its `now` as an argument, which is the shape
 * `access-token-expiry.ts` already uses for a decision made against the clock: the
 * store passes `Date.now()` and a spec passes whatever moment it wants to stand at.
 */
export interface Remembered<T> {
  readonly value: T;
  /** ISO instant after which the value is ignored, or null for never. */
  readonly until: string | null;
}

/** One record for the device, holding whichever of the three were ever set. */
export interface BasketViewMemory {
  readonly version: 1;
  readonly order?: Remembered<BasketOrder>;
  readonly grouping?: Remembered<BasketGrouping>;
  /** A price scope id (`0078`). */
  readonly shop?: Remembered<string>;
}

/**
 * The properties this record may hold, which is every key but the version.
 *
 * The plan wrote the lifetimes as `Record<keyof BasketViewMemory, …>`, which asks
 * for a lifetime for `version` too. Excluding it is what makes the table mean what
 * the plan wanted it to mean: one entry per remembered property, and no entry that
 * stands for nothing.
 */
export type RememberedProperty = Exclude<keyof BasketViewMemory, 'version'>;

/**
 * How long each property is worth keeping, and **the only place the numbers live.**
 *
 * A property added to {@link BasketViewMemory} without an entry here does not
 * compile, which is what makes the expiry a general rule rather than a special case
 * for the shop. Null is "for ever": an order and a grouping are how somebody reads a
 * list, and that does not go stale.
 */
export const BASKET_VIEW_LIFETIME_MS: Readonly<
  Record<RememberedProperty, number | null>
> = {
  order: null,
  grouping: null,
  shop: 2 * 60 * 60 * 1000,
};

/** Every property, for the readers that walk the record. */
export const REMEMBERED_PROPERTIES: readonly RememberedProperty[] = [
  'order',
  'grouping',
  'shop',
];

/**
 * The only version this build reads or writes.
 *
 * A record stamped with anything else reads as no record at all rather than as
 * something to migrate. That is affordable here and nowhere near the token pair:
 * the cost of being wrong is a shopper setting their grouping again.
 */
const VERSION = 1;

/** A record holding nothing, which is what the sheet's Reset writes. */
export const NO_BASKET_VIEW_MEMORY: BasketViewMemory = { version: VERSION };

const ORDERS: readonly BasketOrder[] = ['shop', 'alpha'];
const GROUPINGS: readonly BasketGrouping[] = ['none', 'category', 'list'];

/**
 * That a stored property was present and could not be read, as distinct from
 * absent.
 *
 * The two have to stay tellable apart: an absent property is an ordinary record
 * that never had one, and an unreadable property condemns the **whole** record,
 * because a build that wrote a shape this one cannot read may have written the rest
 * of it differently too.
 */
const UNREADABLE = Symbol('unreadable');

type Read<T> = Remembered<T> | undefined | typeof UNREADABLE;

/**
 * Map a stored record, which is rule D4 applied to storage.
 *
 * What was written days ago by an older build is as untrusted as a response body,
 * and it is the input most likely to be stale in shape. An unreadable record, a
 * version that is not {@link VERSION}, and a value outside its own union all answer
 * null, which every caller reads as "nothing was remembered".
 *
 * Keys this build does not know are ignored rather than rejected, so a record a
 * newer build wrote still yields the properties both builds share.
 */
export function toBasketViewMemory(raw: unknown): BasketViewMemory | null {
  if (!isRecord(raw) || raw['version'] !== VERSION) {
    return null;
  }

  const order = readRemembered(raw['order'], (value) =>
    oneOfOrNull(value, ORDERS)
  );
  const grouping = readRemembered(raw['grouping'], (value) =>
    oneOfOrNull(value, GROUPINGS)
  );
  const shop = readRemembered(raw['shop'], (value) =>
    typeof value === 'string' && value !== '' ? value : null
  );

  if (order === UNREADABLE || grouping === UNREADABLE || shop === UNREADABLE) {
    return null;
  }

  return {
    version: VERSION,
    ...(order === undefined ? {} : { order }),
    ...(grouping === undefined ? {} : { grouping }),
    ...(shop === undefined ? {} : { shop }),
  };
}

/** {@link toBasketViewMemory} over what storage actually hands back: a string or null. */
export function parseBasketViewMemory(
  raw: string | null
): BasketViewMemory | null {
  if (raw === null) {
    return null;
  }

  try {
    return toBasketViewMemory(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Whether a remembered value's date has passed.
 *
 * A null `until` never passes, which is what a lifetime of null means. The
 * comparison is made **once**, by whoever asks: this is a date to compare against,
 * not a timer, so a value read at 11:50 and due at 12:00 stays applied while the
 * basket is open and is ignored by the next basket to open.
 */
export function hasExpired(
  remembered: Remembered<unknown>,
  now: number
): boolean {
  if (remembered.until === null) {
    return false;
  }

  return Date.parse(remembered.until) <= now;
}

/**
 * The record without the properties whose date has passed.
 *
 * Returns the record it was given, by identity, when nothing expired, so a caller
 * can write back only when there is something to write back.
 */
export function dropExpired(
  memory: BasketViewMemory,
  now: number
): BasketViewMemory {
  let kept = memory;

  for (const property of REMEMBERED_PROPERTIES) {
    const remembered = memory[property];
    if (remembered !== undefined && hasExpired(remembered, now)) {
      kept = forget(kept, property);
    }
  }

  return kept;
}

/**
 * The record with one property set, dated from its own lifetime.
 *
 * Every other property is carried over **as it stands, date included**, so setting
 * the grouping does not extend the shop's two hours.
 */
export function remember<K extends RememberedProperty>(
  memory: BasketViewMemory,
  property: K,
  value: NonNullable<BasketViewMemory[K]>['value'],
  now: number
): BasketViewMemory {
  const lifetime = BASKET_VIEW_LIFETIME_MS[property];
  const until =
    lifetime === null ? null : new Date(now + lifetime).toISOString();

  // The computed key is what widens the spread's type, and the shape being built is
  // the one the signature already promised.
  return { ...memory, [property]: { value, until } } as BasketViewMemory;
}

/**
 * The record with one property gone.
 *
 * The one property whose default cannot be written as a value: `shop` is a scope id
 * and its default is **no** scope, which {@link Remembered} has no room for. Storing
 * nothing and storing the default are the same thing to a reader, since a property
 * this record does not hold leaves the state's own default in place, so choosing the
 * cheapest anywhere forgets the shop instead of remembering a null.
 */
export function forget(
  memory: BasketViewMemory,
  property: RememberedProperty
): BasketViewMemory {
  if (memory[property] === undefined) {
    return memory;
  }

  const { [property]: dropped, ...kept } = memory;
  return kept;
}

/**
 * One stored property: present and well formed, absent, or unreadable.
 *
 * A `value` its reader rejects and an `until` that is neither null nor a real
 * instant are both unreadable, and both condemn the record they came from.
 */
function readRemembered<T>(
  raw: unknown,
  readValue: (value: unknown) => T | null
): Read<T> {
  if (raw === undefined) {
    return undefined;
  }

  if (!isRecord(raw)) {
    return UNREADABLE;
  }

  const value = readValue(raw['value']);
  if (value === null) {
    return UNREADABLE;
  }

  const until = raw['until'];
  if (until === null) {
    return { value, until: null };
  }

  if (typeof until !== 'string' || Number.isNaN(Date.parse(until))) {
    return UNREADABLE;
  }

  return { value, until };
}

/**
 * A member of a union, or null.
 *
 * `oneOf` in `mapping/primitives.ts` falls back to a default instead, which is right
 * for a response body a screen has to draw something for and wrong here: a stored
 * value outside its union is a record this build cannot read, and quietly reading it
 * as `'none'` would apply a grouping nobody chose.
 */
function oneOfOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
