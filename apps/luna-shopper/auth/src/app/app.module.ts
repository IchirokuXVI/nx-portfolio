import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import { authConfiguration, authValidationSchema } from './config/app-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`
      // (NATS_URL, LOG_LEVEL, CORS_ORIGINS). Earlier files win.
      envFilePath: [
        'apps/luna-shopper/auth/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [authConfiguration],
      validationSchema: authValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Platform conventions (plan 0004): pino logging, correlation context and the
    // global exception filter, which here also guards the NATS message surface.
    PlatformModule.forRoot({ serviceName: 'luna-shopper-auth' }),
    // Liveness/readiness on the small HTTP health port (plan 0004, section 6).
    PlatformHealthModule.forRoot(),
  ],
})
export class AppModule {}
