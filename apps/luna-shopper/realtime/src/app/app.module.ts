import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import {
  realtimeConfiguration,
  realtimeValidationSchema,
} from './config/app-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`. Earlier
      // files win.
      envFilePath: [
        'apps/luna-shopper/realtime/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [realtimeConfiguration],
      validationSchema: realtimeValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Platform conventions (plan 0004): pino logging, correlation context, the
    // global exception filter and the validation pipe.
    PlatformModule.forRoot({ serviceName: 'luna-shopper-realtime' }),
    // Liveness/readiness on /health/live and /health/ready (plan 0004, section 6).
    PlatformHealthModule.forRoot(),
  ],
})
export class AppModule {}
