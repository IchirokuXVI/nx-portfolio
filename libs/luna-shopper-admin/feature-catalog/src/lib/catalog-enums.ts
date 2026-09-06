import type { EnumOption } from '@portfolio/luna-shopper-admin/models';

/**
 * The catalog's five enumerations, as options with keyed labels.
 *
 * Once each, here, because they are shared: a category is a column on the item
 * list and a filter above it, and a scope kind is read on the scope screen and
 * again on the price screen that has to say what kind of thing it is pricing
 * against. Two descriptors listing the same twelve categories would be two
 * chances for one of them to fall behind the enum.
 *
 * The **values** are the wire's, copied from `Wire.EnumsItemCategory` and its
 * siblings, and a spec asserts that each list still covers its type. The
 * labels are keys, translated where they are drawn.
 */

/** What kind of thing a product is. */
export const ITEM_CATEGORY_OPTIONS: readonly EnumOption[] = [
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

/** What a product is measured in, and what a group compares its members in. */
export const UNIT_OF_MEASURE_OPTIONS: readonly EnumOption[] = [
  { value: 'UNIT', label: 'catalog.unit.UNIT' },
  { value: 'GRAM', label: 'catalog.unit.GRAM' },
  { value: 'KILOGRAM', label: 'catalog.unit.KILOGRAM' },
  { value: 'MILLILITER', label: 'catalog.unit.MILLILITER' },
  { value: 'LITER', label: 'catalog.unit.LITER' },
  { value: 'PACK', label: 'catalog.unit.PACK' },
];

/**
 * How wide a price scope is.
 *
 * The reason the price screen exists in the shape it does. A `REGION` scope is
 * one price shared by every shop in a group the chain defines, so a chain with an
 * automated source has far fewer scopes than shops. A chain with none gets one
 * `STORE` scope per shop, which is what makes a hand typed price work with no
 * special case anywhere.
 */
export const PRICE_SCOPE_KIND_OPTIONS: readonly EnumOption[] = [
  { value: 'NATIONAL', label: 'catalog.priceScopeKind.NATIONAL' },
  { value: 'REGION', label: 'catalog.priceScopeKind.REGION' },
  { value: 'POSTAL_CODE', label: 'catalog.priceScopeKind.POSTAL_CODE' },
  { value: 'STORE', label: 'catalog.priceScopeKind.STORE' },
];

/**
 * Where a price came from, which is the column plan 0005 section 4 is about.
 *
 * `ADMIN` means a person typed it, and an automated fetch will not overwrite it
 * (backend plan 0038, section 6.5). Listing this is the only way to ask "what
 * have I pinned", and there is no queue anywhere else that would say.
 */
export const PRICE_SOURCE_KIND_OPTIONS: readonly EnumOption[] = [
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

/**
 * Where a shop's postal code came from (plan 0005, section 3).
 *
 * `DERIVED` means it was inferred from the nearest centroid rather than known,
 * which is the review flag. It is a **third** state rather than half of a
 * boolean: a shop whose nearest centroid was beyond the bound keeps both the
 * code and the source null, on purpose, because a wrong postcode is worse than
 * none. So a null is not a `DERIVED` and neither is an error.
 */
export const POSTAL_CODE_SOURCE_OPTIONS: readonly EnumOption[] = [
  { value: 'SOURCE', label: 'catalog.postalCodeSource.SOURCE' },
  { value: 'DERIVED', label: 'catalog.postalCodeSource.DERIVED' },
  { value: 'MANUAL', label: 'catalog.postalCodeSource.MANUAL' },
];
