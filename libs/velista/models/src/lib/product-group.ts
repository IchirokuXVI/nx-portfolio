import type { CatalogItem, CatalogSuggestion, ProductOffer } from './domain';

/**
 * What the composer's typeahead offers: products only.
 *
 * A group is one product sold under several labels, and it is reached from a
 * product now (its "similar products"), not typed into a line. The search still
 * answers groups, because the same read serves other screens, so every typeahead
 * drops them through this one function rather than each with its own filter.
 */
export function productSuggestions(
  found: readonly CatalogSuggestion[]
): readonly CatalogSuggestion[] {
  return found.filter((row) => row.kind === 'item');
}

/**
 * The order the catalog ranks a group's members in (catalog `item.service.ts`,
 * `searchOffers`): an offer with a till price first, then unit price, then pack
 * price, and a product with no offer last.
 *
 * Unit price leads because the members of a group are the same product in
 * different packets, so the price per litre or per kilo is what compares them.
 */
export function compareGroupOffers(
  a: ProductOffer | null,
  b: ProductOffer | null
): number {
  const aPriced = a !== null && a.price !== null;
  const bPriced = b !== null && b.price !== null;
  if (aPriced !== bPriced) {
    return aPriced ? -1 : 1;
  }
  const unit = nullsLast(a?.unitPrice ?? null, b?.unitPrice ?? null);
  return unit !== 0 ? unit : nullsLast(a?.price ?? null, b?.price ?? null);
}

/**
 * The other products of a group, cheapest first, without the ones named.
 *
 * `excludeIds` is the product the siblings are for, plus whatever else the
 * screen already holds (a line's other products), so nothing offered as a
 * change is a product the line already has.
 */
export function similarProducts(
  members: readonly CatalogItem[],
  excludeIds: readonly string[]
): readonly CatalogItem[] {
  const excluded = new Set(excludeIds);
  return members
    .filter((member) => !excluded.has(member.id))
    .sort((a, b) => compareGroupOffers(a.offer, b.offer));
}

/**
 * Whether another member of the group is cheaper than `offer`, strictly.
 *
 * Only a comparison both sides can make counts: unit price when both carry
 * one, pack price otherwise. A product with no price is never marked, because
 * nothing says it is dearer, and a tie is not a better price.
 */
export function cheaperInGroup(
  productId: string,
  offer: ProductOffer | null,
  members: readonly {
    readonly id: string;
    readonly offer: ProductOffer | null;
  }[]
): boolean {
  if (offer === null || offer.price === null) {
    return false;
  }
  return members.some(
    (member) =>
      member.id !== productId &&
      member.offer !== null &&
      member.offer.price !== null &&
      isCheaper(member.offer, offer)
  );
}

function isCheaper(candidate: ProductOffer, than: ProductOffer): boolean {
  if (candidate.unitPrice !== null && than.unitPrice !== null) {
    return candidate.unitPrice < than.unitPrice;
  }
  return (
    candidate.price !== null &&
    than.price !== null &&
    candidate.price < than.price
  );
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return a - b;
}
