import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * A section of a chain, as the screens of admin plan 0037 read it.
 *
 * **This is not a wire type any more.** Backend plan 0200 made the shop the
 * owner of a section, and the gateway document no longer describes this shape
 * or the routes that answered it: the document holds
 * `Wire.CatalogShopSectionView`, which names a shop and not a chain. The shape
 * is stated here only so that these screens still compile. Admin plan 0063
 * rebuilds them on the sections of a shop and removes this file.
 *
 * A type alias and not an interface, as the generated types are: a resource
 * row is read through an index signature, which an interface does not have.
 */
export type ChainSectionView = {
  id: string;
  supermarketId: string;
  slug: string;
  name: Wire.CatalogLocalizedText;
  position: number;
  categoryIds: string[];
  locationCount?: number;
};

/**
 * The body that replaced the pins of one product in one chain. A product has
 * no pin since backend plan 0200, and the route is gone. Stated here for the
 * same reason as {@link ChainSectionView}.
 */
export type SetItemSectionPinsBody = {
  itemId: string;
  sectionIds: string[];
};
