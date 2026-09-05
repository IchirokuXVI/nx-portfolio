import { DiscoveredPlace } from './discovered-place.entity';
import { HarvestRun } from './harvest-run.entity';
import { PostalCodeDiscoveryRequest } from './postal-code-discovery-request.entity';
import { SourceCatalogEntry } from './source-catalog-entry.entity';
import { SourceEntryPrice } from './source-entry-price.entity';
import { SourceLocation } from './source-location.entity';
import { SupermarketSource } from './supermarket-source.entity';

export { BaseEntity } from './base.entity';
export { DiscoveredPlace } from './discovered-place.entity';
export { HarvestRun } from './harvest-run.entity';
export { PostalCodeDiscoveryRequest } from './postal-code-discovery-request.entity';
export { SourceCatalogEntry } from './source-catalog-entry.entity';
export { SourceEntryPrice } from './source-entry-price.entity';
export { SourceLocation } from './source-location.entity';
export { SupermarketSource } from './supermarket-source.entity';

/** Every harvester entity, for TypeOrmModule registration and the CLI data source. */
export const HARVESTER_ENTITIES = [
  SupermarketSource,
  HarvestRun,
  // One product a source described, however the source said it, and what became
  // of it (plan 0086, D1). `ItemSourceRef` and `SourceAlias` folded into this.
  SourceCatalogEntry,
  // The latest price each scope stated for one of those rows (plan 0086, D3).
  SourceEntryPrice,
  SourceLocation,
  DiscoveredPlace,
  PostalCodeDiscoveryRequest,
];
