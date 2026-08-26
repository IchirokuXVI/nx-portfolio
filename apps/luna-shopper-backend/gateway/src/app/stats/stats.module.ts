import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { StatsController } from './stats.controller';
import { GatewayStatsService } from './stats.service';

/** The public platform totals endpoint (plan 0017, section 8). */
@Module({
  imports: [MessagingModule],
  controllers: [StatsController],
  providers: [GatewayStatsService],
})
export class GatewayStatsModule {}
