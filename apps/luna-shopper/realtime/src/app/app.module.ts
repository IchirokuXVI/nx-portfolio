import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  realtimeConfiguration,
  realtimeValidationSchema,
} from './config/app-config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`
      // (NATS_URL, LOG_LEVEL, CORS_ORIGINS). Earlier files win.
      envFilePath: [
        'apps/luna-shopper/realtime/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [realtimeConfiguration],
      validationSchema: realtimeValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
