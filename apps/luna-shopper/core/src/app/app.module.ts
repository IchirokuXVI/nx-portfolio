import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { coreConfiguration, coreValidationSchema } from './config/app-config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`
      // (NATS_URL, LOG_LEVEL, CORS_ORIGINS). Earlier files win.
      envFilePath: [
        'apps/luna-shopper/core/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [coreConfiguration],
      validationSchema: coreValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
