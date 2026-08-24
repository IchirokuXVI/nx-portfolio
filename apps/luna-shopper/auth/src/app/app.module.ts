import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { authConfiguration, authValidationSchema } from './config/app-config';
import { HealthController } from './health/health.controller';

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
  ],
  controllers: [HealthController],
})
export class AppModule {}
