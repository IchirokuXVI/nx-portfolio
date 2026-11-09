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
 * `searchOffers`; backend `0245`, section 4): an offer with a till price first,
 * then the comparable figure within one basis, then pack price, and a product
 * with no offer last.
 *
 * The catalog orders by `comparablePrice` inside a basis block, so a price per
 * kilo is never ranked against a price per unit. velista's copy of the order
 * makes the same choice for the siblings it holds: two offers of different
 * bases, or two with no figure, are ordered by pack price alone, and an offer
 * with a figure comes before one with none.
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
  const figures = a !== null && b !== null ? sameBasisFigure(a, b) : null;
  const compared =
    figures !== null ? figures[0] - figures[1] : figureFirst(a, b);
  return compared !== 0
    ? compared
    : nullsLast(a?.price ?? null, b?.price ?? null);
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
 * Only a comparison both sides can make counts: the comparable figure when both
 * carry one of the same basis (backend `0245`), pack price when neither carries
 * one. A difference of basis is never cheaper, and neither is a figure against
 * no figure. A product with no price is never marked, because nothing says it
 * is dearer, and a tie is not a better price.
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
  const figures = sameBasisFigure(candidate, than);
  if (figures !== null) {
    return figures[0] < figures[1];
  }
  if (candidate.comparableBasis !== null || than.comparableBasis !== null) {
    return false;
  }
  return (
    candidate.price !== null &&
    than.price !== null &&
    candidate.price < than.price
  );
}

/**
 * An offer with a figure before one with none, as before the figure had a
 * basis; zero when both or neither carry one, so two figures of different bases
 * fall through to the pack price.
 */
function figureFirst(a: ProductOffer | null, b: ProductOffer | null): number {
  const aHas = a !== null && a.comparablePrice !== null;
  const bHas = b !== null && b.comparablePrice !== null;
  return aHas === bHas ? 0 : aHas ? -1 : 1;
}

/** The two comparable figures, when both offers carry one of the same basis. */
function sameBasisFigure(
  a: ProductOffer,
  b: ProductOffer
): [number, number] | null {
  return a.comparableBasis !== null &&
    a.comparableBasis === b.comparableBasis &&
    a.comparablePrice !== null &&
    b.comparablePrice !== null
    ? [a.comparablePrice, b.comparablePrice]
    : null;
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return a - b;
}
