import type { ConfigService } from '@nestjs/config';
import { AiTextProvider } from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_GEMINI_MODEL,
  type AssistantConfig,
} from '../config/app-config';
import { ClaudeProvider } from '../provider/claude.provider';
import { GeminiProvider } from '../provider/gemini.provider';
import type { ModelProvider } from '../provider/model-provider';
import { SplitModelProvider } from '../provider/split.provider';
import { AssistantService } from './assistant.service';

/**
 * What the assistant says it can do (plan 0231, section 3), for each provider
 * with and without its key. The providers are wired the way the module's
 * factory wires them, so the answer is computed from the same objects that
 * decide the 501s.
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
  transcriptionModel: DEFAULT_GEMINI_MODEL,
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

function capabilitiesOf(overrides: Partial<AssistantConfig>) {
  const config = { ...BASE, ...overrides };
  const configService = {
    getOrThrow: () => config,
  } as unknown as ConfigService;
  const gemini = new GeminiProvider(configService);
  const provider: ModelProvider =
    config.provider === 'claude'
      ? new SplitModelProvider(new ClaudeProvider(configService), gemini)
      : gemini;
  return new AssistantService(
    configService,
    provider,
    {} as never,
    {} as never
  ).capabilities();
}

describe('AssistantService.capabilities (plan 0231, section 3)', () => {
  it('gemini with its key answers and hears', () => {
    expect(capabilitiesOf({ geminiApiKey: 'g' })).toEqual({
      answers: true,
      hears: true,
      textProvider: AiTextProvider.GOOGLE,
    });
  });

  it('gemini without its key does neither', () => {
    expect(capabilitiesOf({})).toEqual({
      answers: false,
      hears: false,
      textProvider: null,
    });
  });

  it('claude with both keys answers with Anthropic and hears with Gemini', () => {
    expect(
      capabilitiesOf({
        provider: 'claude',
        anthropicApiKey: 'a',
        geminiApiKey: 'g',
      })
    ).toEqual({
      answers: true,
      hears: true,
      textProvider: AiTextProvider.ANTHROPIC,
    });
  });

  it('claude without the Gemini key answers and does not hear', () => {
    expect(
      capabilitiesOf({ provider: 'claude', anthropicApiKey: 'a' })
    ).toEqual({
      answers: true,
      hears: false,
      textProvider: AiTextProvider.ANTHROPIC,
    });
  });

  it('claude without its own key does neither, as its 501s say', () => {
    expect(capabilitiesOf({ provider: 'claude', geminiApiKey: 'g' })).toEqual({
      answers: false,
      hears: false,
      textProvider: null,
    });
  });
});
