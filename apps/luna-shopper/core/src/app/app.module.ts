import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import { coreConfiguration, coreValidationSchema } from './config/app-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Service specific vars first, then the shared `.env.luna-shopper`. Earlier
      // files win.
      envFilePath: [
        'apps/luna-shopper/core/.env',
        'apps/luna-shopper/.env.luna-shopper',
      ],
      load: [coreConfiguration],
      validationSchema: coreValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Platform conventions (plan 0004): pino logging, correlation context and the
    // global exception filter, which here also guards the NATS message surface.
    PlatformModule.forRoot({ serviceName: 'luna-shopper-core' }),
    // Liveness/readiness on the small HTTP health port (plan 0004, section 6).
    PlatformHealthModule.forRoot(),
  ],
})
export class AppModule {}
