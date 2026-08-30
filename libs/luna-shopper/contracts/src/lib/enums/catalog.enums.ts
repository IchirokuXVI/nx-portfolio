/**
 * Catalog enums (plan 0012, section 2). The product catalog is owner curated
 * reference data read by everyone. These constant sets are enums per the project
 * rule; their string values are the wire format and must stay stable.
 */

/** Unit a catalog item is measured/sold in. */
export enum UnitOfMeasure {
  UNIT = 'UNIT',
  GRAM = 'GRAM',
  KILOGRAM = 'KILOGRAM',
  MILLILITER = 'MILLILITER',
  LITER = 'LITER',
  PACK = 'PACK',
}

/**
 * The scope a price applies to (plan 0038, section 5.1).
 *
 * A chain that publishes one price per warehouse needs one row per warehouse, not
 * one per store: Mercadona answered identically for three warehouses across a 25
 * product sample, so keying prices on the store wrote twelve identical rows for
 * one city. A chain with no obtainable data instead gets one STORE scope per
 * location and hand entered prices. Both are the same shape, which is why nothing
 * downstream branches on the chain.
 */
export enum PriceScopeKind {
  NATIONAL = 'NATIONAL',
  WAREHOUSE = 'WAREHOUSE',
  POSTAL_CODE = 'POSTAL_CODE',
  STORE = 'STORE',
}

/**
 * Where a stored price came from (plan 0038, section 5.3).
 *
 * It ships with backlog 0001's full value set even though only OFFICIAL_API and
 * ADMIN are reachable today, because adding a value to a Postgres enum later is a
 * migration and defining them now is free. The rule that reads it is section 6.5:
 * an automated fetch never overwrites a price a person typed in, it reports the
 * disagreement instead.
 */
export enum PriceSourceKind {
  OFFICIAL_API = 'OFFICIAL_API',
  OFFICIAL_WEB = 'OFFICIAL_WEB',
  OFFICIAL_LEAFLET = 'OFFICIAL_LEAFLET',
  ADMIN = 'ADMIN',
  USER_RECEIPT = 'USER_RECEIPT',
  USER_REPORTED = 'USER_REPORTED',
}

/** Coarse product category used to group and filter items. */
export enum ItemCategory {
  PRODUCE = 'PRODUCE',
  DAIRY = 'DAIRY',
  BAKERY = 'BAKERY',
  MEAT = 'MEAT',
  SEAFOOD = 'SEAFOOD',
  FROZEN = 'FROZEN',
  BEVERAGES = 'BEVERAGES',
  SNACKS = 'SNACKS',
  PANTRY = 'PANTRY',
  HOUSEHOLD = 'HOUSEHOLD',
  PERSONAL_CARE = 'PERSONAL_CARE',
  OTHER = 'OTHER',
}
