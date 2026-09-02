import { InitialHarvesterSchema1756200000000 } from './1756200000000-InitialHarvesterSchema';
import { DiscoveredPlaceCountry1756300000000 } from './1756300000000-DiscoveredPlaceCountry';

/**
 * Every harvester migration, in the order TypeORM must apply them (plan 0027,
 * section 2.1).
 *
 * Explicit rather than a filesystem glob: webpack cannot follow a glob, so the
 * bundled `migrate.js` the deploy Job runs would otherwise find zero migrations
 * and report success without creating anything.
 */
export const HARVESTER_MIGRATIONS = [
  InitialHarvesterSchema1756200000000,
  DiscoveredPlaceCountry1756300000000,
];
