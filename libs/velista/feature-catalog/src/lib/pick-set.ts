import {
  LINE_ITEM_SET_MAX,
  type CatalogItem,
  type CatalogProduct,
} from '@portfolio/velista/models';

/** What a tick refused at the cap says: the products page's own sentence. */
export interface PickSetFull {
  readonly count: number;
  readonly cap: number;
}

/** A tick on a card: the set it leaves, or the cap it would pass. */
export type PickSetTick =
  | { readonly kind: 'ticked'; readonly ticked: readonly string[] }
  | { readonly kind: 'full'; readonly full: PickSetFull };

/**
 * A press on a card of the catalog that chooses the products of a line (velista
 * `0146`, section 3): a product not in the set is added at its end, and one in it
 * is taken out.
 *
 * **The cap is core's, stated before anything is sent**: a set may hold up to
 * `max(LINE_ITEM_SET_MAX, the products the line had)` (`UpdateLineRequest.itemIds`).
 * A line the catalog's own sync took past the cap can still shrink, and can be
 * saved at any size up to what it had, but a tick that would pass both is
 * refused, and the sentence names that bound. A press that takes a product out
 * is never refused.
 */
export function tickProduct(
  ticked: readonly string[],
  itemId: string,
  before: readonly string[]
): PickSetTick {
  if (ticked.includes(itemId)) {
    return {
      kind: 'ticked',
      ticked: ticked.filter((held) => held !== itemId),
    };
  }
  const cap = Math.max(LINE_ITEM_SET_MAX, before.length);
  if (ticked.length + 1 > cap) {
    return {
      kind: 'full',
      full: { count: ticked.length, cap },
    };
  }
  return { kind: 'ticked', ticked: [...ticked, itemId] };
}

/**
 * The set to write when the line moved while the page was open (velista
 * `0146`, section 3): what the line holds now, less the products the person
 * unticked, plus the products the person ticked. A product another device
 * added is kept, and one it took off is gone unless the person ticked it.
 * In the order the line holds them, then the person's ticks in their order.
 */
export function rebaseProductSet(
  before: readonly string[],
  ticked: readonly string[],
  live: readonly string[]
): string[] {
  const kept = new Set(ticked);
  const had = new Set(before);
  const holds = new Set(live);
  return [
    ...live.filter((itemId) => kept.has(itemId) || !had.has(itemId)),
    ...ticked.filter((itemId) => !had.has(itemId) && !holds.has(itemId)),
  ];
}

/**
 * A product of the line as a card of the catalog page, from the record the
 * lookup by id answered (`ItemNames`, with its prices). The lookup prices at the
 * person's default profile, which is what the catalog's own read does with no
 * supermarket chosen, the one state that draws these cards apart from the read.
 */
export function lineProductCard(item: CatalogItem): CatalogProduct {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand,
    imageUrl: item.imageUrl,
    size: item.size,
    unit: item.unit,
    categories: item.categories,
    offer: item.offer,
    unitBasis: item.unitBasis,
  };
}
