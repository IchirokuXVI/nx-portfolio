import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { formatInstant } from './format-instant';

/** One row of `source_locations`, as the gateway sends it. */
export type Shop = Wire.HarvestSourceLocationView;

/**
 * One row of the shops queue, as the table draws it (admin plan 0011, section
 * 2).
 *
 * A view model rather than the wire row, even though this app uses wire types as
 * its view models (plan 0004, section 2). The exception that section records is
 * about **shapes**, not about formatting: a date is formatted with `Intl` in the
 * selector with the string on the view model, and the three questions a row
 * answers here (what it is mapped to, which actions it offers) are computed from
 * two columns each. Doing that in a template would put the decision somewhere no
 * spec can call it.
 */
export interface ShopRow {
  readonly id: string;
  /** The source's own key, such as `T1`. Monospace, because it is an identifier. */
  readonly code: string;
  readonly printedName: string;
  readonly status: Wire.EnumsSourceLocationStatus;
  /** The shop of ours it points at, by name. Empty when it points at none. */
  readonly mappedTo: string;
  readonly supermarketLocationId: string | null;
  readonly matchedBy: Wire.EnumsItemSourceMatch;
  readonly lastSeen: string;
  readonly lastRunId: string | null;
  readonly canMap: boolean;
  readonly canUnmap: boolean;
  readonly canIgnore: boolean;
  readonly canUnignore: boolean;
}

/**
 * A row, with the three decisions it offers already made.
 *
 * `names` holds the labels of the shops of ours, resolved after the page loads,
 * so a row whose lookup has not answered yet shows its id rather than a blank
 * cell. A blank would read as "not mapped", which is the one thing this column
 * exists to tell apart.
 *
 * **Mapping is offered on an `UNMAPPED` row only.** An `ACTIVE` row already
 * points somewhere, and pointing it somewhere else is unmapping it and mapping
 * it again: two acts, each of which the operator can see the result of.
 */
export function toShopRow(
  shop: Shop,
  names: ReadonlyMap<string, string>
): ShopRow {
  const id = shop.supermarketLocationId;

  return {
    id: shop.id,
    code: shop.externalId,
    printedName: shop.printedName,
    status: shop.status,
    mappedTo: id === null ? '' : (names.get(id) ?? id),
    supermarketLocationId: id,
    matchedBy: shop.matchedBy,
    lastSeen: formatInstant(shop.lastSeenAt),
    lastRunId: shop.lastRunId,
    canMap: shop.status === 'UNMAPPED',
    canUnmap: shop.status === 'ACTIVE',
    canIgnore: shop.status !== 'IGNORED',
    canUnignore: shop.status === 'IGNORED',
  };
}
