import type { LocalizedName } from './shopping-profile';

/**
 * One section of a shop, an aisle as the shop is walked (velista `0120`, backend
 * `0167`).
 *
 * `GET /v1/catalog/locations/:id/sections` answers a shop's list in the order it is
 * walked, which is the order the basket draws its aisles in. Which products are in a
 * section is **not** decided here: the basket read carries the answer on every
 * product as {@link BasketProduct.sectionIds}, because the rule reads coverage across
 * the shop's own tables. What this adds is the order and the name.
 *
 * A section belongs to one shop and to nothing else (backend `0200`): a chain has no
 * sections and a shop inherits none, so a shop that answers none has none.
 *
 * `categoryIds` is what the section covers, kept for the day a screen explains it.
 * The grouping never reads it: a client that matched categories to sections itself
 * would be a second copy of the server's rule.
 */
export interface ShopSection {
  readonly id: string;
  readonly slug: string;
  /** Resolved where drawn, with `catalogName`: a section named in one language still reads. */
  readonly name: LocalizedName;
  readonly position: number;
  readonly categoryIds: readonly string[];
}
