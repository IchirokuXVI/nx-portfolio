import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AdminHarvestAliasDecisionsController,
  AdminHarvestAliasesController,
  AdminHarvestEntriesController,
  AdminHarvestItemRefsController,
  AdminHarvestLeafletsController,
  AdminHarvestPlacesController,
  AdminHarvestRunsController,
  AdminHarvestShopsController,
  AdminHarvestSourcesController,
} from './harvest.controller';

/**
 * The gateway's harvester surface (plan 0038, section 7), proxying to the
 * harvester over NATS under `/v1/admin/harvest/`.
 *
 * Every route is platform admin gated inside the harvester service, and there is
 * deliberately no push channel here: progress is polled.
 */
@Module({
  imports: [MessagingModule],
  controllers: [
    AdminHarvestRunsController,
    // The leaflet upload and the queue it fills (plan 0081).
    AdminHarvestLeafletsController,
    AdminHarvestAliasesController,
    AdminHarvestAliasDecisionsController,
    AdminHarvestPlacesController,
    AdminHarvestEntriesController,
    AdminHarvestItemRefsController,
    AdminHarvestShopsController,
    AdminHarvestSourcesController,
  ],
})
export class GatewayHarvestModule {}
