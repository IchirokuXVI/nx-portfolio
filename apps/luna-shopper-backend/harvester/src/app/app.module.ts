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
import type { HarvesterConfig } from './config/app-config';
import {
  harvesterConfiguration,
  harvesterValidationSchema,
} from './config/app-config';
import { HARVESTER_ENTITIES } from './entities';
import { HarvestModule } from './harvest/harvest.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper-backend/harvester/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [harvesterConfiguration],
      validationSchema: harvesterValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-harvester' }),
    // The harvester owns its private Postgres, the third in the system. Schema is
    // committed migrations only.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<HarvesterConfig>('harvester').dbUrl,
        entities: HARVESTER_ENTITIES,
        synchronize: false,
      }),
    }),
    HarvestModule,
    // Readiness probes the private DB and the broker (plan 0004, section 6).
    // Deliberately NOT the third party sources: this service is ready when it can
    // answer, and Mercadona being slow is a run's problem, not a reason to take
    // the pod out of service.
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
                servers: [
                  config.getOrThrow<HarvesterConfig>('harvester').natsUrl,
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
