import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  gatewayConfiguration,
  gatewayValidationSchema,
} from './config/app-config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`
      // (NATS_URL, LOG_LEVEL, CORS_ORIGINS). Earlier files win. `nx serve` runs
      // from the workspace root, so these paths are relative to it. A namespaced
      // shared file (not the bare `.env`, which Nx would auto load into every
      // task) keeps these vars scoped to the Luna services.
      envFilePath: [
        'apps/luna-shopper/gateway/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [gatewayConfiguration],
      validationSchema: gatewayValidationSchema,
      // Report every invalid variable at once instead of stopping at the first,
      // and let a shared root `.env` carry the other services' variables too.
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
