import type { EnumOption } from '@portfolio/luna-shopper-admin/models';

/**
 * The catalog's enumerations, as the options a control offers.
 *
 * Written out rather than derived from the generated union types, because a
 * TypeScript union is erased before anything can iterate it and each value
 * needs a label anyway. The generated types are still what keeps these honest:
 * a value the document drops stops type checking at the descriptor that uses
 * it.
 *
 * The labels are keys, translated where they are shown, so a spec can assert
 * which option a field offered rather than what it happened to render to.
 */

/** Where a price came from, and whether a person typed it. */
export const PRICE_SOURCE_KINDS: readonly EnumOption[] = [
  { value: 'OFFICIAL_API', label: 'catalog.priceSourceKind.OFFICIAL_API' },
  { value: 'OFFICIAL_WEB', label: 'catalog.priceSourceKind.OFFICIAL_WEB' },
  {
    value: 'OFFICIAL_LEAFLET',
    label: 'catalog.priceSourceKind.OFFICIAL_LEAFLET',
  },
  { value: 'ADMIN', label: 'catalog.priceSourceKind.ADMIN' },
  { value: 'USER_RECEIPT', label: 'catalog.priceSourceKind.USER_RECEIPT' },
  { value: 'USER_REPORTED', label: 'catalog.priceSourceKind.USER_REPORTED' },
];

/** How wide a price reaches: one country, one warehouse, one postcode, one shop. */
export const PRICE_SCOPE_KINDS: readonly EnumOption[] = [
  { value: 'NATIONAL', label: 'catalog.priceScopeKind.NATIONAL' },
  { value: 'WAREHOUSE', label: 'catalog.priceScopeKind.WAREHOUSE' },
  { value: 'POSTAL_CODE', label: 'catalog.priceScopeKind.POSTAL_CODE' },
  { value: 'STORE', label: 'catalog.priceScopeKind.STORE' },
];

/**
 * Where a shop's postal code came from.
 *
 * `DERIVED` is the guessed one, inferred from the nearest centroid rather than
 * known, and it is the whole reason this enumeration is a filter as well as a
 * column (plan 0005, section 3). A shop with no postal code at all has no
 * source either, and matches none of these: that is a third state, not a
 * missing value.
 */
export const POSTAL_CODE_SOURCES: readonly EnumOption[] = [
  { value: 'SOURCE', label: 'catalog.postalCodeSource.SOURCE' },
  { value: 'DERIVED', label: 'catalog.postalCodeSource.DERIVED' },
  { value: 'MANUAL', label: 'catalog.postalCodeSource.MANUAL' },
];

/** What a product is, in the twelve aisles this catalog has. */
export const ITEM_CATEGORIES: readonly EnumOption[] = [
  { value: 'PRODUCE', label: 'catalog.itemCategory.PRODUCE' },
  { value: 'DAIRY', label: 'catalog.itemCategory.DAIRY' },
  { value: 'BAKERY', label: 'catalog.itemCategory.BAKERY' },
  { value: 'MEAT', label: 'catalog.itemCategory.MEAT' },
  { value: 'SEAFOOD', label: 'catalog.itemCategory.SEAFOOD' },
  { value: 'FROZEN', label: 'catalog.itemCategory.FROZEN' },
  { value: 'BEVERAGES', label: 'catalog.itemCategory.BEVERAGES' },
  { value: 'SNACKS', label: 'catalog.itemCategory.SNACKS' },
  { value: 'PANTRY', label: 'catalog.itemCategory.PANTRY' },
  { value: 'HOUSEHOLD', label: 'catalog.itemCategory.HOUSEHOLD' },
  { value: 'PERSONAL_CARE', label: 'catalog.itemCategory.PERSONAL_CARE' },
  { value: 'OTHER', label: 'catalog.itemCategory.OTHER' },
];

/** What a product is measured in. */
export const UNITS_OF_MEASURE: readonly EnumOption[] = [
  { value: 'UNIT', label: 'catalog.unit.UNIT' },
  { value: 'GRAM', label: 'catalog.unit.GRAM' },
  { value: 'KILOGRAM', label: 'catalog.unit.KILOGRAM' },
  { value: 'MILLILITER', label: 'catalog.unit.MILLILITER' },
  { value: 'LITER', label: 'catalog.unit.LITER' },
  { value: 'PACK', label: 'catalog.unit.PACK' },
];

/**
 * The orders every catalog list documents.
 *
 * Only three routes honour them: chains, products and product groups. The other
 * four accept an `order` parameter and drop it, ordering by creation instead, so
 * their descriptors offer no sorts at all rather than a control that changes
 * nothing.
 */
export const CATALOG_SORTS: readonly EnumOption[] = [
  { value: 'name', label: 'catalog.sort.name' },
  { value: 'created', label: 'catalog.sort.created' },
  { value: 'updated', label: 'catalog.sort.updated' },
];
