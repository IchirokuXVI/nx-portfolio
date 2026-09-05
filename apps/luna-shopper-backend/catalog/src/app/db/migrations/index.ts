import { InitialCatalogSchema1756000500000 } from './1756000500000-InitialCatalogSchema';
import { PriceScopesAndSourceProvenance1756100000000 } from './1756100000000-PriceScopesAndSourceProvenance';
import { CatalogSearchAndProductGroups1756200000000 } from './1756200000000-CatalogSearchAndProductGroups';
import { SupermarketDefaultScope1756300000000 } from './1756300000000-SupermarketDefaultScope';
import { PostalCodePoints1756400000000 } from './1756400000000-PostalCodePoints';
import { DerivedPostalCodes1756500000000 } from './1756500000000-DerivedPostalCodes';
import { CatalogAudit1756600000000 } from './1756600000000-CatalogAudit';
import { ItemPrices1756700000000 } from './1756700000000-ItemPrices';

/**
 * Every catalog migration, in the order TypeORM must apply them (plan 0027,
 * section 2.1).
 *
 * Explicit rather than a filesystem glob: webpack cannot follow a glob, so the
 * bundled `migrate.js` the deploy Job runs would otherwise find zero migrations
 * and report success without creating anything. See the auth index for the full
 * reasoning; this file is the same decision for catalog.
 */
export const CATALOG_MIGRATIONS = [
  InitialCatalogSchema1756000500000,
  PriceScopesAndSourceProvenance1756100000000,
  CatalogSearchAndProductGroups1756200000000,
  SupermarketDefaultScope1756300000000,
  PostalCodePoints1756400000000,
  DerivedPostalCodes1756500000000,
  CatalogAudit1756600000000,
  ItemPrices1756700000000,
];
