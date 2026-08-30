import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import {
  AdminHarvestEntriesController,
  AdminHarvestItemRefsController,
  AdminHarvestPlacesController,
  AdminHarvestRunsController,
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
    AdminHarvestPlacesController,
    AdminHarvestEntriesController,
    AdminHarvestItemRefsController,
    AdminHarvestSourcesController,
  ],
})
export class GatewayHarvestModule {}
