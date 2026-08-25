import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
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
import type { AuthConfig } from './config/app-config';
import { authConfiguration, authValidationSchema } from './config/app-config';
import { AUTH_ENTITIES } from './entities';
import {
  IdentityEventsPublisher,
  NATS_EVENTS,
} from './events/identity-events.publisher';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { MailModule } from './mail/mail.module';
import { PasswordService } from './password/password.service';
import { OrphanUserReaperService } from './reaper/orphan-user-reaper.service';
import { TokenService } from './tokens/token.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper/auth/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [authConfiguration],
      validationSchema: authValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-auth' }),
    // Auth owns its private Postgres. Schema is managed by committed migrations
    // (never `synchronize`), applied by the deploy Job (plan 0002/0005).
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<AuthConfig>('auth').dbUrl,
        entities: AUTH_ENTITIES,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature(AUTH_ENTITIES),
    // JwtService for RS256 signing; keys/algorithm are passed per call by
    // TokenService, so no global secret is configured here.
    JwtModule.register({}),
    // NATS client for publishing identity events.
    ClientsModule.registerAsync([
      {
        name: NATS_EVENTS,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: { servers: [config.getOrThrow<AuthConfig>('auth').natsUrl] },
        }),
      },
    ]),
    MailModule,
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
                servers: [config.getOrThrow<AuthConfig>('auth').natsUrl],
              },
              timeout: 2000,
            }),
        ],
      },
    }),
  ],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    TokenService,
    PasswordService,
    IdentityEventsPublisher,
    OrphanUserReaperService,
  ],
})
export class AppModule {}
