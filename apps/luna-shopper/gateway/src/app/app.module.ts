import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import {
  MicroserviceHealthIndicator,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  createThrottlerOptions,
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import { GatewayAccountModule } from './account/account.module';
import { GatewayAuthModule } from './auth/auth.module';
import { GatewayCatalogModule } from './catalog/catalog.module';
import type { GatewayConfig } from './config/app-config';
import {
  gatewayConfiguration,
  gatewayValidationSchema,
} from './config/app-config';
import { GatewayListsModule } from './lists/lists.module';
import { GatewayMergeModule } from './merge/merge.module';
import { GatewayZonesModule } from './zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`
      // (NATS_URL, LOG_LEVEL, CORS_ORIGINS). Earlier files win. `nx serve` runs
      // from the workspace root, so these paths are relative to it. A namespaced
      // shared file (not the bare `.env`, which Nx would auto load into every
      // task) keeps these vars scoped to the Luna services.
      envFilePath: [
        'apps/luna-shopper/gateway/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [gatewayConfiguration],
      validationSchema: gatewayValidationSchema,
      // Report every invalid variable at once instead of stopping at the first,
      // and let a shared root `.env` carry the other services' variables too.
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Platform conventions (plan 0004): pino logging, correlation context, the
    // global problem+json exception filter and the validation pipe.
    PlatformModule.forRoot({ serviceName: 'luna-shopper-gateway' }),
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
    // Global rate limiting with stricter named buckets for the open surfaces
    // (plan 0004, section 8).
    ThrottlerModule.forRoot(createThrottlerOptions()),
    // Auth endpoints + JWT verification (plan 0005).
    GatewayAuthModule,
    // Zone + membership endpoints (plan 0006).
    GatewayZonesModule,
    // Shopping list / line / comment endpoints (plan 0007).
    GatewayListsModule,
    // Per zone account merge endpoints (plan 0008).
    GatewayMergeModule,
    // Account deletion endpoint (plan 0011).
    GatewayAccountModule,
    // Catalog endpoints — items, supermarkets, per location prices (plan 0012).
    GatewayCatalogModule,
  ],
  providers: [
    // The throttler guard runs globally; open endpoints opt into a named bucket.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
