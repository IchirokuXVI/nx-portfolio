import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AdminHarvestEntriesController,
  AdminHarvestImportsController,
  AdminHarvestPlacesController,
  AdminHarvestPostalCodesController,
  AdminHarvestPresetsController,
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
    // Run requests saved under a name, and the run started from one (plan 0120).
    AdminHarvestPresetsController,
    // The file import, and the one queue it fills along with every walk and
    // crawl (plan 0086). The alias and item ref controllers were the same queue
    // over two other tables and are gone.
    AdminHarvestImportsController,
    AdminHarvestPlacesController,
    AdminHarvestPostalCodesController,
    AdminHarvestEntriesController,
    AdminHarvestShopsController,
    AdminHarvestSourcesController,
  ],
})
export class GatewayHarvestModule {}
