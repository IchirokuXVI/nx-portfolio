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
import type { CatalogConfig } from './config/app-config';
import {
  catalogConfiguration,
  catalogValidationSchema,
} from './config/app-config';
import { CatalogModule } from './catalog/catalog.module';
import { CATALOG_ENTITIES } from './entities';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper/catalog/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [catalogConfiguration],
      validationSchema: catalogValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-catalog' }),
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
