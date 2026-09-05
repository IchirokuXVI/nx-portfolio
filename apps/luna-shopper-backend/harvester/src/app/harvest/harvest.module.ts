import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { HarvesterConfig } from '../config/app-config';
import { HARVESTER_ENTITIES } from '../entities';
import { CATALOG_NATS_CLIENT, CatalogClient } from './catalog-client.service';
import { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import { DiscoveredPlaceService } from './discovered-place.service';
import { HarvestRunService } from './harvest-run.service';
import { HarvestRunStore } from './harvest-run.store';
import { HarvestController } from './harvest.controller';
import { ItemSourceRefService } from './item-source-ref.service';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';
import { PostalCodeDiscoveryWorker } from './postal-code-discovery.worker';
import { RefreshRunner } from './refresh.runner';
import { RunExecutor } from './run-executor.service';
import { SourceEntryService } from './source-entry.service';
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
    StoreDiscoveryRunner,
    CatalogDiscoveryRunner,
    RefreshRunner,
    RunExecutor,
    HarvestRunService,
    DiscoveredPlaceService,
    SourceEntryService,
    ItemSourceRefService,
    SourceLocationService,
    PostalCodeDiscoveryStore,
    PostalCodeDiscoveryService,
    PostalCodeDiscoveryWorker,
  ],
})
export class HarvestModule {}
