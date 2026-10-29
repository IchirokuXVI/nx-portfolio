import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import {
  MicroserviceHealthIndicator,
  TypeOrmHealthIndicator,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import { AccountModule } from './account/account.module';
import { CatalogModule } from './catalog/catalog.module';
import type { CatalogConfig } from './config/app-config';
import {
  catalogConfiguration,
  catalogValidationSchema,
} from './config/app-config';
import { CATALOG_ENTITIES } from './entities';
import { RetentionModule } from './retention/retention.module';
import { ShopWalksModule } from './shop-walks/shop-walks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper-backend/catalog/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [catalogConfiguration],
      validationSchema: catalogValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-catalog' }),
    // Catalog owns its private Postgres. Schema is committed migrations only.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<CatalogConfig>('catalog').dbUrl,
        entities: CATALOG_ENTITIES,
        synchronize: false,
      }),
    }),
    CatalogModule,
    // Plan 0168: a shop's walks and its map.
    ShopWalksModule,
    // Plan 0232: a deleted account's walks lose the link to it.
    AccountModule,
    // Plan 0233: audit rows past their lifetime are deleted.
    RetentionModule,
    // Readiness probes the private DB and the broker (plan 0004, section 6).
    PlatformHealthModule.forRoot({
      readiness: {
        inject: [
          TypeOrmHealthIndicator,
          MicroserviceHealthIndicator,
          ConfigService,
        ],
        useFactory: (
          db: TypeOrmHealthIndicator,
          micro: MicroserviceHealthIndicator,
          config: ConfigService
        ): HealthIndicatorFunction[] => [
          () => db.pingCheck('database'),
          () =>
            micro.pingCheck('nats', {
              transport: Transport.NATS,
              options: {
                servers: [config.getOrThrow<CatalogConfig>('catalog').natsUrl],
              },
              timeout: 2000,
            }),
        ],
      },
    }),
  ],
})
export class AppModule {}
