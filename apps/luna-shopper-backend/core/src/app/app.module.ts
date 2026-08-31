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
import type { CoreConfig } from './config/app-config';
import { coreConfiguration, coreValidationSchema } from './config/app-config';
import { CORE_ENTITIES } from './entities';
import { ListsModule } from './lists/lists.module';
import { MergeModule } from './merge/merge.module';
import { ProfilesModule } from './profiles/profiles.module';
import { RealtimeAccessModule } from './realtime/realtime-access.module';
import { ZonesModule } from './zones/zones.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper-backend/core/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [coreConfiguration],
      validationSchema: coreValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-core' }),
    // Core owns its private Postgres. Schema is committed migrations only.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<CoreConfig>('core').dbUrl,
        entities: CORE_ENTITIES,
        synchronize: false,
      }),
    }),
    ZonesModule,
    ListsModule,
    MergeModule,
    RealtimeAccessModule,
    // Shopping profiles: where a person shops (plan 0049).
    ProfilesModule,
    AccountModule,
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
                servers: [config.getOrThrow<CoreConfig>('core').natsUrl],
              },
              timeout: 2000,
            }),
        ],
      },
    }),
  ],
})
export class AppModule {}
