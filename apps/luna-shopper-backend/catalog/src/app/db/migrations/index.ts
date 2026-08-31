import { InitialCatalogSchema1756000500000 } from './1756000500000-InitialCatalogSchema';
import { PriceScopesAndSourceProvenance1756100000000 } from './1756100000000-PriceScopesAndSourceProvenance';
import { CatalogSearchAndProductGroups1756200000000 } from './1756200000000-CatalogSearchAndProductGroups';

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
];
