import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { HARVESTER_ENTITIES } from '../entities';
import { CarrefourCatalogRunner } from './carrefour-catalog.runner';
import { CarrefourDetailRunner } from './carrefour-detail.runner';
import { CATALOG_NATS_CLIENT, CatalogClient } from './catalog-client.service';
import { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import { HarvestDashboardService } from './dashboard.service';
import { DezaCatalogRunner } from './deza-catalog.runner';
import { DiscoveredPlaceService } from './discovered-place.service';
import { FileImportRunner } from './file-import.runner';
import { HarvestRunService } from './harvest-run.service';
import { HarvestRunStore } from './harvest-run.store';
import { HarvestController } from './harvest.controller';
import { LidlCatalogRunner } from './lidl-catalog.runner';
import { LidlStoreDiscoveryRunner } from './lidl-store-discovery.runner';
import { MercadonaCatalogRunner } from './mercadona-catalog.runner';
import { OsmStoreDiscoveryRunner } from './osm-store-discovery.runner';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';
import { PostalCodeDiscoveryWorker } from './postal-code-discovery.worker';
import { RunExecutor } from './run-executor.service';
import { SourceEntryService } from './source-entry.service';
import { SourceIngest } from './source-ingest';
import { SourceLocationService } from './source-location.service';
import { StoreDiscoveryRunner } from './store-discovery.runner';
import { SupermarketSourceService } from './supermarket-source.service';

/**
 * The harvester domain slice (plan 0038): runs, the places and products they
 * find, and the per chain configuration they run with.
 *
 * It holds a NATS **client** as well as being a NATS server, which is unusual for
 * this backend: every other service only answers. The harvester answers *and*
 * calls catalog, because writing what it fetched is the point of fetching it, and
 * the boundary says it may only do so over the broker.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(HARVESTER_ENTITIES),
    // Verification only, and registered with no key (plan 0072): every call
    // passes the public key it wants explicitly, because a default signing key
    // on this module is a key the harvester has no business holding.
    JwtModule.register({}),
    ClientsModule.registerAsync([
      {
        name: CATALOG_NATS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: {
            servers: [config.getOrThrow<HarvesterConfig>('harvester').natsUrl],
          },
        }),
      },
    ]),
  ],
  controllers: [HarvestController],
  providers: [
    PlatformAdminService,
    CatalogClient,
    HarvestRunStore,
    SupermarketSourceService,
    // STORE_DISCOVERY dispatches on the adapter too (plan 0089, section 9):
    // a chain that names its own shops is read from that chain, and everything
    // else is a radius over OpenStreetMap.
    OsmStoreDiscoveryRunner,
    LidlStoreDiscoveryRunner,
    StoreDiscoveryRunner,
    // The second half of every run, whatever the first half was (plan 0086, D5).
    SourceIngest,
    MercadonaCatalogRunner,
    DezaCatalogRunner,
    CarrefourCatalogRunner,
    CarrefourDetailRunner,
    LidlCatalogRunner,
    CatalogDiscoveryRunner,
    // The one runner that fetches nothing at all (plan 0086, D6): its input is
    // an uploaded document rather than a storefront.
    FileImportRunner,
    RunExecutor,
    HarvestRunService,
    DiscoveredPlaceService,
    // The one queue over the one table, and the three decisions about a row
    // (plan 0086, section 7). `SourceAliasService` and `ItemSourceRefService`
    // were the same three decisions over two other tables and are gone.
    SourceEntryService,
    SourceLocationService,
    PostalCodeDiscoveryStore,
    PostalCodeDiscoveryService,
    PostalCodeDiscoveryWorker,
    // The dashboard's harvest block (plan 0088), behind the same gate.
    HarvestDashboardService,
  ],
})
export class HarvestModule {}
