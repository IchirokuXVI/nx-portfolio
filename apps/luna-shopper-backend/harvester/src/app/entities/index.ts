import { DiscoveredPlace } from './discovered-place.entity';
import { HarvestRun } from './harvest-run.entity';
import { ItemSourceRef } from './item-source-ref.entity';
import { SourceCatalogEntry } from './source-catalog-entry.entity';
import { SupermarketSource } from './supermarket-source.entity';

export { BaseEntity } from './base.entity';
export { DiscoveredPlace } from './discovered-place.entity';
export { HarvestRun } from './harvest-run.entity';
export { ItemSourceRef } from './item-source-ref.entity';
export { SourceCatalogEntry } from './source-catalog-entry.entity';
export { SupermarketSource } from './supermarket-source.entity';

/** Every harvester entity, for TypeOrmModule registration and the CLI data source. */
export const HARVESTER_ENTITIES = [
  SupermarketSource,
  HarvestRun,
  SourceCatalogEntry,
  ItemSourceRef,
  DiscoveredPlace,
];
