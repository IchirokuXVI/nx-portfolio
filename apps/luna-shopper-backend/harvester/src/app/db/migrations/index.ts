import { InitialHarvesterSchema1756200000000 } from './1756200000000-InitialHarvesterSchema';
import { DiscoveredPlaceCountry1756300000000 } from './1756300000000-DiscoveredPlaceCountry';
import { PostalCodeDiscoveryRequests1756400000000 } from './1756400000000-PostalCodeDiscoveryRequests';
import { SourceLocations1756500000000 } from './1756500000000-SourceLocations';
import { HarvestRunReport1756600000000 } from './1756600000000-HarvestRunReport';
import { LeafletImport1756700000000 } from './1756700000000-LeafletImport';
import { RevertedRuns1756800000000 } from './1756800000000-RevertedRuns';
import { OneSourceProduct1756900000000 } from './1756900000000-OneSourceProduct';

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
  PostalCodeDiscoveryRequests1756400000000,
  SourceLocations1756500000000,
  HarvestRunReport1756600000000,
  LeafletImport1756700000000,
  RevertedRuns1756800000000,
  OneSourceProduct1756900000000,
];
