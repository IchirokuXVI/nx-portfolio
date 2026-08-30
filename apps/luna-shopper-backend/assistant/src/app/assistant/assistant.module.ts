import { Module } from '@nestjs/common';
import { GeminiProvider } from '../provider/gemini.provider';
import { MODEL_PROVIDER } from '../provider/model-provider';
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
 * There is no `TypeOrmModule.forFeature` here, and there is not meant to be one.
 */
@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
    GatewayApiClient,
    TurnContextFactory,
    { provide: MODEL_PROVIDER, useClass: GeminiProvider },
  ],
})
export class AssistantModule {}
