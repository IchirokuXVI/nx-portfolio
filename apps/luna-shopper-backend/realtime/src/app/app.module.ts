import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import {
  MicroserviceHealthIndicator,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import {
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import type { RealtimeConfig } from './config/app-config';
import {
  realtimeConfiguration,
  realtimeValidationSchema,
} from './config/app-config';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper-backend`. Earlier
      // files win.
      envFilePath: [
        'apps/luna-shopper-backend/realtime/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [realtimeConfiguration],
      validationSchema: realtimeValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Platform conventions (plan 0004): pino logging, correlation context, the
    // global exception filter and the validation pipe.
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-realtime' }),
    // The realtime fan out: JetStream consumer, socket gateway, SSE, presence
    // (plan 0009).
    RealtimeModule,
    // Liveness/readiness on /health/live and /health/ready (plan 0004, section 6).
    // Readiness pings the broker: without NATS there is nothing to fan out.
    PlatformHealthModule.forRoot({
      readiness: {
        inject: [MicroserviceHealthIndicator, ConfigService],
        useFactory: (
          micro: MicroserviceHealthIndicator,
          config: ConfigService
        ): HealthIndicatorFunction[] => [
          () =>
            micro.pingCheck('nats', {
              transport: Transport.NATS,
              options: {
                servers: [
                  config.getOrThrow<RealtimeConfig>('realtime').natsUrl,
                ],
              },
              timeout: 2000,
            }),
        ],
      },
    }),
  ],
})
export class AppModule {}
