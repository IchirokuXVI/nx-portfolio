import { DiscoveredPlace } from './discovered-place.entity';
import { HarvestRun } from './harvest-run.entity';
import { ItemSourceRef } from './item-source-ref.entity';
import { PostalCodeDiscoveryRequest } from './postal-code-discovery-request.entity';
import { SourceAlias } from './source-alias.entity';
import { SourceCatalogEntry } from './source-catalog-entry.entity';
import { SourceLocation } from './source-location.entity';
import { SupermarketSource } from './supermarket-source.entity';

export { BaseEntity } from './base.entity';
export { DiscoveredPlace } from './discovered-place.entity';
export { HarvestRun } from './harvest-run.entity';
export { ItemSourceRef } from './item-source-ref.entity';
export { PostalCodeDiscoveryRequest } from './postal-code-discovery-request.entity';
export { SourceAlias } from './source-alias.entity';
export { SourceCatalogEntry } from './source-catalog-entry.entity';
export { SourceLocation } from './source-location.entity';
export { SupermarketSource } from './supermarket-source.entity';

/** Every harvester entity, for TypeOrmModule registration and the CLI data source. */
export const HARVESTER_ENTITIES = [
  SupermarketSource,
  HarvestRun,
  SourceCatalogEntry,
  SourceLocation,
  ItemSourceRef,
  // The names a chain printed, and the queue an admin works through
  // (plan 0081, section 2).
  SourceAlias,
  DiscoveredPlace,
  PostalCodeDiscoveryRequest,
];
