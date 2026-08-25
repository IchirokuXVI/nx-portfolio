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
