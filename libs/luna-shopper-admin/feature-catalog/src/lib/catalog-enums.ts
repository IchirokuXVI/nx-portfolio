import type { EnumOption } from '@portfolio/luna-shopper-admin/models';

/**
 * The catalog's enumerations, as options with keyed labels.
 *
 * Once each, here, because they are shared: a scope kind is read on the scope
 * screen and again on the price screen that has to say what kind of thing it
 * is pricing against, and two descriptors listing the same values would be two
 * chances for one of them to fall behind the wire.
 *
 * A product's category is not one of them any more. It is a row of the
 * category tree (backend plan 0166, admin plan 0036), picked from the tree
 * rather than from a list this file could hold.
 *
 * The **values** are the wire's, copied from `Wire.EnumsUnitOfMeasure` and its
 * siblings, and a spec asserts that each list still covers its type. The
 * labels are keys, translated where they are drawn.
 */

/** Whether a category is a root or sits inside one, as the tree list filters it. */
export const CATEGORY_KIND_OPTIONS: readonly EnumOption[] = [
  { value: 'root', label: 'catalog.categories.kind.root' },
  { value: 'leaf', label: 'catalog.categories.kind.leaf' },
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
 * automated source has far fewer scopes than shops. Every shop also holds one
 * `STORE` scope of its own, which is what makes a hand typed price work with no
 * special case anywhere.
 *
 * `LOCAL_AREA` was `POSTAL_CODE` until backend plan 0116: a Mercadona warehouse
 * is a local area, and it never was a postal code. The labels are the same four
 * words the priority bands use (admin plan 0028, section 2).
 */
export const PRICE_SCOPE_KIND_OPTIONS: readonly EnumOption[] = [
  { value: 'NATIONAL', label: 'catalog.priceScopeKind.NATIONAL' },
  { value: 'REGION', label: 'catalog.priceScopeKind.REGION' },
  { value: 'LOCAL_AREA', label: 'catalog.priceScopeKind.LOCAL_AREA' },
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
