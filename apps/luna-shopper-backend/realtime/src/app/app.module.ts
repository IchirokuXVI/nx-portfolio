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
  RedisModule,
  RedisService,
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
    // The backplane (plan 0028): the socket.io adapter's channels, the relay
    // channel, presence and the JetStream dedupe window all live in Redis, which
    // is what makes more than one replica of this service correct rather than
    // merely running. Global, so the gateway, the consumer and presence all
    // share the one connection.
    RedisModule.forRoot(),
    // The realtime fan out: JetStream consumer, socket gateway, SSE, presence
    // (plan 0009).
    RealtimeModule,
    // Liveness/readiness on /health/live and /health/ready (plan 0004, section 6).
    // Readiness pings the broker: without NATS there is nothing to fan out.
    //
    // Redis joins it (plan 0028, section 5) because a pod that cannot reach the
    // backplane is degraded in a way that is invisible from the outside: its
    // sockets stay connected and its local events still arrive, so nothing looks
    // wrong while cross pod fan out is silently gone. Failing readiness stops it
    // taking new connections and leaves the healthy pods serving. Liveness is
    // deliberately untouched, so a Redis outage never restarts a pod that is
    // still serving the clients it holds.
    PlatformHealthModule.forRoot({
      readiness: {
        inject: [MicroserviceHealthIndicator, ConfigService, RedisService],
        useFactory: (
          micro: MicroserviceHealthIndicator,
          config: ConfigService,
          redis: RedisService
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
          () => redis.check('redis'),
        ],
      },
    }),
  ],
})
export class AppModule {}
