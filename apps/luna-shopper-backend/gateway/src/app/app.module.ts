import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import {
  MicroserviceHealthIndicator,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  createThrottlerOptions,
  PlatformHealthModule,
  PlatformModule,
  ProblemThrottlerGuard,
  RedisModule,
  RedisService,
  RedisThrottlerStorage,
} from '@portfolio/luna-shopper/platform';
import { Logger } from 'nestjs-pino';
import { GatewayAccountModule } from './account/account.module';
import { GatewayAdminModule } from './admin/admin.module';
import { GatewayAssistantModule } from './assistant/assistant.module';
import { GatewayAuthModule } from './auth/auth.module';
import { GatewayCatalogModule } from './catalog/catalog.module';
import { MinClientVersionGuard } from './client-version/min-client-version.guard';
import type { GatewayConfig } from './config/app-config';
import {
  gatewayConfiguration,
  gatewayValidationSchema,
} from './config/app-config';
import { GatewayGeneratedListsModule } from './generated-lists/generated-lists.module';
import { GatewayHarvestModule } from './harvest/harvest.module';
import { GatewayListsModule } from './lists/lists.module';
import { GatewayMergeModule } from './merge/merge.module';
import { GatewayStatsModule } from './stats/stats.module';
import { GatewayZonesModule } from './zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper-backend`
      // (NATS_URL, LOG_LEVEL, CORS_ORIGINS). Earlier files win. `nx serve` runs
      // from the workspace root, so these paths are relative to it. A namespaced
      // shared file (not the bare `.env`, which Nx would auto load into every
      // task) keeps these vars scoped to the Luna services.
      envFilePath: [
        'apps/luna-shopper-backend/gateway/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [gatewayConfiguration],
      validationSchema: gatewayValidationSchema,
      // Report every invalid variable at once instead of stopping at the first,
      // and let a shared root `.env` carry the other services' variables too.
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Platform conventions (plan 0004): pino logging, correlation context, the
    // global problem+json exception filter and the validation pipe.
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-gateway' }),
    // Liveness/readiness on /health/live and /health/ready (plan 0004, section 6);
    // readiness probes the broker the gateway depends on for every request.
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
                servers: [config.getOrThrow<GatewayConfig>('gateway').natsUrl],
              },
              timeout: 2000,
            }),
        ],
      },
    }),
    // The backplane (plan 0028). The gateway uses it for the rate limit counters
    // and the public stats cache, and it is required rather than optional
    // because the throttler below fails closed without it.
    RedisModule.forRoot(),
    // Global rate limiting with stricter named buckets for the open surfaces
    // (plan 0004, section 8), counting in Redis rather than in this process
    // (plan 0028, section 2.4).
    //
    // Nothing in `createThrottlerOptions` changes: one bucket, same limits. What
    // changes is where the count lives, so two replicas share one bucket instead
    // of granting two. `verifyResend` and `passwordReset` are `limit: 1` and say
    // of themselves that the whole of the enforcement is the bucket, which is
    // why this is worth doing even at one replica: it is the piece that would
    // otherwise silently double the moment a second pod appeared.
    ThrottlerModule.forRootAsync({
      inject: [RedisService, Logger],
      useFactory: (redis: RedisService, logger: Logger) => ({
        ...createThrottlerOptions(),
        storage: new RedisThrottlerStorage(redis, logger),
      }),
    }),
    // Auth endpoints + JWT verification (plan 0005).
    GatewayAuthModule,
    // The operator identity (plan 0071): a second trust root, its own passport
    // strategy, and the namespace plan 0073 moves the back office routes into.
    GatewayAdminModule,
    // Zone + membership endpoints (plan 0006).
    GatewayZonesModule,
    // Shopping list / line / comment endpoints (plan 0007).
    GatewayListsModule,
    // Per zone account merge endpoints (plan 0008).
    GatewayMergeModule,
    // Account deletion endpoint (plan 0011).
    GatewayAccountModule,
    // The basket a person carries around the shop (plan 0050).
    GatewayGeneratedListsModule,
    // Catalog endpoints — items, supermarkets, per scope prices (plan 0012, and
    // plan 0038 for the scopes).
    GatewayCatalogModule,
    // The harvester's admin surface (plan 0038). Every route is platform admin
    // gated inside the harvester service; nothing here is open to users.
    GatewayHarvestModule,
    // Public platform totals (plan 0017).
    GatewayStatsModule,
    // The assistant (plan 0039). One route, proxied straight through to the
    // assistant service; no logic here, and no new hostname in either
    // environment.
    GatewayAssistantModule,
  ],
  providers: [
    // The throttler guard runs globally; open endpoints override the bucket's
    // limit for themselves. The platform subclass is used rather than the
    // library's own so a 429 carries the wait in the body (plan 0021, section 2).
    { provide: APP_GUARD, useClass: ProblemThrottlerGuard },
    // Advertises the oldest supported client on every response and refuses the ones
    // below it (velista plan 0034). Inert until `MIN_CLIENT_VERSION` is set, which
    // it is in neither cluster by default.
    //
    // Deliberately after the throttler. Nest runs global guards in the order they
    // are declared, and a client hammering the gateway should be told it is being
    // rate limited before it is told it is out of date: the first is the reason the
    // requests are being refused, and answering the second would let an old client
    // burn its bucket learning the same thing once per request.
    { provide: APP_GUARD, useClass: MinClientVersionGuard },
  ],
})
export class AppModule {}
