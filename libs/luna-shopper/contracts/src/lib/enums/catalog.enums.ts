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
 * The scope a price applies to (plan 0038, section 5.1; renamed by plan 0089).
 *
 * A chain that publishes one price for a group of shops needs one row per group,
 * not one per store: Mercadona answered identically for three warehouses across a
 * 25 product sample, so keying prices on the store wrote twelve identical rows for
 * one city. A chain with no obtainable data instead gets one STORE scope per
 * location and hand entered prices. Both are the same shape, which is why nothing
 * downstream branches on the chain.
 */
export enum PriceScopeKind {
  NATIONAL = 'NATIONAL',
  /**
   * A grouping the chain defines and names itself, whatever it calls it.
   *
   * Mercadona calls it a warehouse and keys it `4661`. LIDL calls it an offer
   * region and keys it `26`. Neither is a postal code and neither is a shop, and
   * the two behave identically here, so they are one kind. This value was
   * `WAREHOUSE` until plan 0089 found the second chain that needed it.
   */
  REGION = 'REGION',
  POSTAL_CODE = 'POSTAL_CODE',
  STORE = 'STORE',
}

/**
 * Where a location's postal code came from (plan 0061, section 5).
 *
 * Nullable on the row, alongside a null `postalCode`, so "we have no idea" stays
 * expressible: a store whose nearest centroid is beyond the bound keeps both
 * columns null rather than taking a confident wrong code.
 *
 * An enum rather than `isDerived: boolean` because `MANUAL` and `SOURCE` behave
 * identically today and will not forever: a person correcting a bad OSM tag
 * should not have their correction overwritten the next time that place is re
 * discovered, and a boolean cannot express that.
 */
export enum PostalCodeSource {
  /** The discovery source gave it, and a source value is never overridden. */
  SOURCE = 'SOURCE',
  /** The nearest centroid, within the bound. This is the review flag. */
  DERIVED = 'DERIVED',
  /** A person typed it, and it outranks a later re discovery. */
  MANUAL = 'MANUAL',
}

/**
 * Where a stored price came from (plan 0038, section 5.3).
 *
 * It ships with backlog 0001's full value set even though only a few are
 * reachable today, because adding a value to a Postgres enum later is a
 * migration and defining them now is free. Since plan 0080 every kind's rows are
 * stored side by side in `item_prices`, and `price_policies` plus the `ADMIN`
 * row's protection window decide which one a shopper sees.
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

/**
 * Why one operation of a bulk decision request was refused (plan 0100).
 *
 * Shared by both bulk routes, because the two kinds of decision they replay
 * fail the same handful of ways: a row that moved since the file was written, a
 * reference to something the file never created, and the same subject named
 * twice. A tool reads the code, and an operator reads the detail beside it.
 */
export enum BulkOperationErrorCode {
  /** The row the operation names is gone. */
  NOT_FOUND = 'NOT_FOUND',
  /** The row is no longer waiting for a decision. */
  NOT_PENDING = 'NOT_PENDING',
  /** The row moved since the file was written, so `expect` no longer holds. */
  EXPECT_MISMATCH = 'EXPECT_MISMATCH',
  /** Two operations name the same subject, so the file contradicts itself. */
  DUPLICATE_SUBJECT = 'DUPLICATE_SUBJECT',
  /** A reference this request never creates, or one it creates twice. */
  UNKNOWN_REFERENCE = 'UNKNOWN_REFERENCE',
  /** The operation names neither of two required alternatives, or both. */
  MALFORMED_OPERATION = 'MALFORMED_OPERATION',
  /** Another row already holds the identifier this one would take. */
  ALREADY_TAKEN = 'ALREADY_TAKEN',
}
