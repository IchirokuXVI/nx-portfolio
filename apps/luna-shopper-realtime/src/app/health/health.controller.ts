import { Controller, Get } from '@nestjs/common';

/**
 * Liveness endpoint. Kept deliberately dependency free for now; the richer
 * readiness/liveness probes built on @nestjs/terminus arrive with the platform
 * conventions in plan 0004.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', service: 'luna-shopper-realtime' };
  }
}
