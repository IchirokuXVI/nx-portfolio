import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AssistantConfig } from '../config/app-config';
import { ClaudeProvider } from '../provider/claude.provider';
import { GeminiProvider } from '../provider/gemini.provider';
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
 * The provider the service reads, always a split (plan 0235, section 7).
 *
 * `ASSISTANT_PROVIDER` picks what answers (plan 0224, section 4): `claude` is
 * Claude, anything else is Gemini, the behaviour from before the switch existed.
 * {@link hearingFrom} picks what hears. Exported so the capability spec wires
 * the providers exactly as the module does.
 */
export function buildModelProvider(
  configService: ConfigService
): ModelProvider {
  const config = configService.getOrThrow<AssistantConfig>('assistant');
  const turns =
    config.provider === 'claude'
      ? new ClaudeProvider(configService)
      : new GeminiProvider(configService);
  return new SplitModelProvider(turns, hearingFrom(configService));
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
 */
@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
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
