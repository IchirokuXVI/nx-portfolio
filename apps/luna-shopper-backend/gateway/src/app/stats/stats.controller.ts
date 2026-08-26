import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { PlatformStatsResponse } from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { GatewayStatsService } from './stats.service';

/**
 * The platform totals (plan 0017, section 8). Deliberately public: the numbers
 * are a landing page figure shown to a visitor with no token, which makes this
 * the only unauthenticated read in the API and the cheapest thing to hammer, so
 * it carries a tighter throttler bucket on top of the service's 60 second cache.
 */
@ApiTags('stats')
@Controller({ path: 'stats', version: '1' })
export class StatsController {
  constructor(private readonly stats: GatewayStatsService) {}

  @Get()
  @Throttle(THROTTLE_LIMITS.publicStats)
  @ApiOkResponse({
    description:
      'Platform totals. Either block is null when that service did not answer.',
  })
  platform(): Promise<PlatformStatsResponse> {
    return this.stats.platform();
  }
}
