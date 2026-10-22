import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AssistantConfig } from '../config/app-config';
import { ClaudeProvider } from '../provider/claude.provider';
import { GeminiProvider } from '../provider/gemini.provider';
import { MODEL_PROVIDER, type ModelProvider } from '../provider/model-provider';
import { SplitModelProvider } from '../provider/split.provider';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GatewayApiClient } from './gateway-api.client';
import { TurnContextFactory } from './turn-context';

/**
 * The assistant slice (plan 0039).
 *
 * The provider is bound through {@link MODEL_PROVIDER} rather than injected by
 * class, so that rule A4 is a wiring fact and not a discipline: nothing above
 * this line names Gemini, and the suite constructs the service against
 * `FakeModelProvider` with no network at all.
 *
 * The factory reads `ASSISTANT_PROVIDER` (plan 0224, section 4). `claude`
 * answers with Claude and hears with Gemini through {@link SplitModelProvider};
 * anything else is Gemini alone, the behaviour from before the switch existed.
 * `GeminiProvider` is built in both branches, because Gemini is the hearing in
 * both.
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
      useFactory: (configService: ConfigService): ModelProvider => {
        const config = configService.getOrThrow<AssistantConfig>('assistant');
        const gemini = new GeminiProvider(configService);
        return config.provider === 'claude'
          ? new SplitModelProvider(new ClaudeProvider(configService), gemini)
          : gemini;
      },
    },
  ],
})
export class AssistantModule {}
