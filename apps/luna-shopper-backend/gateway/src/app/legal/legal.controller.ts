import { Controller, Get, Header, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import {
  LEGAL_SCHEMA_IDS,
  type LegalSettingsView,
} from '@portfolio/luna-shopper/contracts';
import type { GatewayConfig } from '../config/app-config';
import { ApiComposedResponse, ApiProblemResponses } from '../docs';
import { AssistantCapabilitiesProbe } from './assistant-capabilities.probe';
import { composeLegalSettings } from './legal-settings';

/**
 * What this deployment states about itself for its privacy policy and Terms
 * (plan 0231, section 2).
 *
 * Public, with no token, on every deployment. A deployment that has published
 * nothing still answers, with `published: false`: an unconfigured feature is a
 * supported deployment (plan 0026). It never waits on NATS; the assistant's
 * half is the last answer {@link AssistantCapabilitiesProbe} kept.
 */
@ApiTags('legal')
@Controller({ path: 'legal', version: '1' })
export class LegalController {
  private readonly logger = new Logger(LegalController.name);
  private readonly config: GatewayConfig;
  private warnedFallback = false;

  constructor(
    configService: ConfigService,
    private readonly capabilities: AssistantCapabilitiesProbe
  ) {
    this.config = configService.getOrThrow<GatewayConfig>('gateway');
  }

  @Get('settings')
  // Five minutes: the values change with a deploy, and a policy page is read
  // far more often than a deploy happens.
  @Header('Cache-Control', 'public, max-age=300')
  @ApiComposedResponse(LEGAL_SCHEMA_IDS.legalSettingsView, {
    description:
      'Composed by the gateway from its configuration and the assistant. Public, no token.',
  })
  @ApiProblemResponses()
  settings(): LegalSettingsView {
    const capabilities = this.capabilities.current();
    if (!capabilities && !this.warnedFallback) {
      this.warnedFallback = true;
      this.logger.warn(
        'The assistant has not said what it can do yet; serving assistant on, transcription off'
      );
    }
    return composeLegalSettings(
      this.config.legal,
      this.config.google.enabled,
      capabilities
    );
  }
}
