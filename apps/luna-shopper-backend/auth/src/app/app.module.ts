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
import { AdminDirectoryService } from './admin/admin-directory.service';
import { AdminIdentityService } from './admin/admin-identity.service';
import { AdminTokenService } from './admin/admin-token.service';
import { AdminController } from './admin/admin.controller';
import { AuthPlatformAdminService } from './admin/platform-admin.service';
import { AuditModule } from './audit/audit.module';
import type { AuthConfig } from './config/app-config';
import { authConfiguration, authValidationSchema } from './config/app-config';
import { AUTH_ENTITIES } from './entities';
import {
  IdentityEventsPublisher,
  NATS_EVENTS,
} from './events/identity-events.publisher';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { StatsService } from './identity/stats.service';
import { MailModule } from './mail/mail.module';
import { PasswordService } from './password/password.service';
import { OrphanUserReaperService } from './reaper/orphan-user-reaper.service';
import { TokenGrantService } from './tokens/token-grant.service';
import { TokenService } from './tokens/token.service';
import { UsernameGenerator } from './username/username-generator.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper-backend/auth/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [authConfiguration],
      validationSchema: authValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-auth' }),
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
    // The operator audit trail (plan 0077, section 8), before anything that
    // writes on an operator's behalf. Global, so `IdentityService` reaches it
    // without every user facing slice importing a module it never uses.
    AuditModule,
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
  controllers: [IdentityController, AdminController],
  providers: [
    IdentityService,
    StatsService,
    TokenService,
    TokenGrantService,
    // The operator identity (plan 0071). It shares `PasswordService` so argon2
    // parameters stay in one place, and shares nothing else with the user facing
    // services above it.
    AdminTokenService,
    AdminIdentityService,
    // The back office's directory (plan 0074), and the gate it opens with. The
    // gate verifies the operator token against `admin.publicKey`, which is the
    // public half of the pair `AdminTokenService` signs with, so auth cannot
    // mint a token it would then refuse.
    AuthPlatformAdminService,
    AdminDirectoryService,
    PasswordService,
    IdentityEventsPublisher,
    UsernameGenerator,
    OrphanUserReaperService,
  ],
})
export class AppModule {}
