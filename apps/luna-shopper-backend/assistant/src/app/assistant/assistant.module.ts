import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  AllowanceClient,
  CORE_NATS_CLIENT,
} from '../allowance/allowance.client';
import type { AssistantConfig } from '../config/app-config';
import { ClaudeProvider } from '../provider/claude.provider';
import { MODEL_PROVIDER, type ModelProvider } from '../provider/model-provider';
import { NoHearing } from '../provider/no-hearing.provider';
import { SplitModelProvider } from '../provider/split.provider';
import { WhisperProvider } from '../provider/whisper.provider';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GatewayApiClient } from './gateway-api.client';
import { TurnContextFactory } from './turn-context';

/**
 * What hears in this deployment (plan 0235, section 7): the transcriber when
 * `TRANSCRIBER_URL` names one, and nothing otherwise. No model provider hears,
 * so a key alone never turns the microphone on.
 */
export function hearingFrom(configService: ConfigService): ModelProvider {
  const config = configService.getOrThrow<AssistantConfig>('assistant');
  return config.transcriberUrl.length > 0
    ? new WhisperProvider(configService)
    : new NoHearing();
}

/**
 * The provider the service reads, always a split (plan 0235, section 7; plan
 * 0236, section 2).
 *
 * Claude answers every turn and checks every reply (plan 0236). The split stays
 * with one text provider, because it is the one place that says "this answers,
 * that hears". {@link hearingFrom} picks what hears. Exported so the capability
 * spec wires the providers exactly as the module does.
 */
export function buildModelProvider(
  configService: ConfigService
): ModelProvider {
  return new SplitModelProvider(
    new ClaudeProvider(configService),
    hearingFrom(configService)
  );
}

/**
 * The assistant slice (plan 0039).
 *
 * The provider is bound through {@link MODEL_PROVIDER} rather than injected by
 * class, so that rule A4 is a wiring fact and not a discipline: nothing above
 * this line names a provider, and the suite constructs the service against
 * `FakeModelProvider` with no network at all.
 *
 * There is no `TypeOrmModule.forFeature` here, and there is not meant to be one.
 * The allowance's counts live in core (plan 0234, section 3), reached over the
 * NATS client below: the first question this service asks rather than answers.
 */
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: CORE_NATS_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.NATS,
          options: {
            servers: [config.getOrThrow<AssistantConfig>('assistant').natsUrl],
          },
        }),
      },
    ]),
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AllowanceClient,
    GatewayApiClient,
    TurnContextFactory,
    {
      provide: MODEL_PROVIDER,
      inject: [ConfigService],
      useFactory: buildModelProvider,
    },
  ],
})
export class AssistantModule {}
