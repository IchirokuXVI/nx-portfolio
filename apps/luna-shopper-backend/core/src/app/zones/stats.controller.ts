import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import {
  STATS_PATTERNS,
  type CoreStats,
} from '@portfolio/luna-shopper/contracts';
import { StatsService } from './stats.service';

/** Core's platform totals over NATS (plan 0017, section 8). Takes no argument. */
@Controller()
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @MessagePattern(STATS_PATTERNS.core)
  core(): Promise<CoreStats> {
    return this.stats.core();
  }
}
