import type { ConfigService } from '@nestjs/config';
import { AiTextProvider } from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_GEMINI_MODEL,
  type AssistantConfig,
} from '../config/app-config';
import { buildModelProvider } from './assistant.module';
import { AssistantService } from './assistant.service';

/**
 * What the assistant says it can do (plan 0231, section 3), for each provider
 * with and without its key and with and without a transcriber (plan 0235). The
 * providers come from the module's own factory, so the answer is computed from
 * the same objects that decide the 501s.
 */

const BASE: AssistantConfig = {
  port: 3006,
  natsUrl: 'nats://unused',
  logLevel: 'silent',
  gatewayInternalUrl: 'http://gateway.invalid',
  geminiApiKey: '',
  geminiBaseUrl: 'http://provider.invalid',
  provider: 'gemini',
  anthropicApiKey: '',
  anthropicBaseUrl: 'http://provider.invalid',
  claudeEffort: 'low',
  claudeThinking: 'adaptive',
  model: DEFAULT_GEMINI_MODEL,
  transcriberUrl: '',
  transcriberTurnTimeoutMs: 45000,
  transcriberCommentTimeoutMs: 110000,
  audioMaxBytes: 2 * 1024 * 1024,
  audioMimeTypes: ['audio/webm'],
  maxTurns: 20,
  maxChars: 8000,
  maxToolCalls: 6,
  turnsPerMinute: 8,
  concurrency: 2,
  retryAfterFallbackSeconds: 30,
  providerTimeoutMs: 30000,
  turnTimeoutMs: 60000,
};

const TRANSCRIBER = 'http://luna-shopper-backend-transcriber:3007';

function capabilitiesOf(overrides: Partial<AssistantConfig>) {
  const config = { ...BASE, ...overrides };
  const configService = {
    getOrThrow: () => config,
  } as unknown as ConfigService;
  return new AssistantService(
    configService,
    buildModelProvider(configService),
    {} as never,
    {} as never
  ).capabilities();
}

describe('AssistantService.capabilities (plan 0231, section 3)', () => {
  it('gemini with its key and a transcriber answers and hears', () => {
    expect(
      capabilitiesOf({ geminiApiKey: 'g', transcriberUrl: TRANSCRIBER })
    ).toEqual({
      answers: true,
      hears: true,
      textProvider: AiTextProvider.GOOGLE,
    });
  });

  it('gemini with its key and no transcriber answers and does not hear', () => {
    // A key alone no longer turns the microphone on (plan 0235).
    expect(capabilitiesOf({ geminiApiKey: 'g' })).toEqual({
      answers: true,
      hears: false,
      textProvider: AiTextProvider.GOOGLE,
    });
  });

  it('gemini without its key does neither, whatever hears', () => {
    expect(capabilitiesOf({ transcriberUrl: TRANSCRIBER })).toEqual({
      answers: false,
      hears: false,
      textProvider: null,
    });
  });

  it('claude with its key and a transcriber answers with Anthropic and hears', () => {
    expect(
      capabilitiesOf({
        provider: 'claude',
        anthropicApiKey: 'a',
        transcriberUrl: TRANSCRIBER,
      })
    ).toEqual({
      answers: true,
      hears: true,
      textProvider: AiTextProvider.ANTHROPIC,
    });
  });

  it('claude with both keys and no transcriber answers and does not hear', () => {
    expect(
      capabilitiesOf({
        provider: 'claude',
        anthropicApiKey: 'a',
        geminiApiKey: 'g',
      })
    ).toEqual({
      answers: true,
      hears: false,
      textProvider: AiTextProvider.ANTHROPIC,
    });
  });

  it('claude without its own key does neither, as its 501s say', () => {
    expect(
      capabilitiesOf({ provider: 'claude', transcriberUrl: TRANSCRIBER })
    ).toEqual({
      answers: false,
      hears: false,
      textProvider: null,
    });
  });
});
