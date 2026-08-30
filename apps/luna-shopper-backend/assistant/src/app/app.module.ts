import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import {
  MicroserviceHealthIndicator,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import {
  PlatformHealthModule,
  PlatformModule,
} from '@portfolio/luna-shopper/platform';
import { AssistantModule } from './assistant/assistant.module';
import type { AssistantConfig } from './config/app-config';
import {
  assistantConfiguration,
  assistantValidationSchema,
} from './config/app-config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'apps/luna-shopper-backend/assistant/.env',
        'apps/luna-shopper-backend/.env.luna-shopper-backend',
      ],
      load: [assistantConfiguration],
      validationSchema: assistantValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    PlatformModule.forRoot({ serviceName: 'luna-shopper-backend-assistant' }),
    // No TypeOrmModule. This service owns no database and connects to nobody
    // else's, which is the visible half of rule A1 (plan 0039, section 2): the
    // moment the bot can read a row without a token, a misread sentence can leak
    // a list to somebody who was never in the zone.
    AssistantModule,
    // Readiness probes the broker and nothing else (plan 0004, section 6).
    //
    // Deliberately **not** the model provider: this service is ready when it can
    // accept a turn, and Google being slow or rate limiting is a turn's problem,
    // answered with rule A5's countdown, not a reason to take the pod out of
    // service and hand the traffic to a replica with the identical quota. For the
    // same reason an absent GEMINI_API_KEY leaves the pod healthy: it answers 501
    // on its one route (section 11), which is a statement about the deployment
    // rather than a fault.
    PlatformHealthModule.forRoot({
      readiness: {
        inject: [MicroserviceHealthIndicator, ConfigService],
        useFactory: (
          micro: MicroserviceHealthIndicator,
          config: ConfigService
        ): HealthIndicatorFunction[] => [
          () =>
            micro.pingCheck('nats', {
              transport: Transport.NATS,
              options: {
                servers: [
                  config.getOrThrow<AssistantConfig>('assistant').natsUrl,
                ],
              },
              timeout: 2000,
            }),
        ],
      },
    }),
  ],
})
export class AppModule {}
