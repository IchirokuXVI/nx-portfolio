import type { ConfigService } from '@nestjs/config';
import { AiTextProvider } from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_ALLOWANCE,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_MODERATION_MODEL,
  type AssistantConfig,
} from '../config/app-config';
import { ClaudeProvider } from '../provider/claude.provider';
import { NoHearing } from '../provider/no-hearing.provider';
import { SplitModelProvider } from '../provider/split.provider';
import { WhisperProvider } from '../provider/whisper.provider';
import { buildModelProvider } from './assistant.module';
import { AssistantService } from './assistant.service';

/**
 * What the assistant says it can do (plan 0231, section 3), with and without
 * its key and with and without a transcriber (plan 0235). Claude is the only
 * text provider since plan 0236. The providers come from the module's own
 * factory, so the answer is computed from the same objects that decide the
 * 501s.
 */

const BASE: AssistantConfig = {
  port: 3006,
  natsUrl: 'nats://unused',
  logLevel: 'silent',
  gatewayInternalUrl: 'http://gateway.invalid',
  anthropicApiKey: '',
  anthropicBaseUrl: 'http://provider.invalid',
  claudeEffort: 'low',
  claudeThinking: 'adaptive',
  model: DEFAULT_CLAUDE_MODEL,
  moderation: true,
  moderationModel: DEFAULT_MODERATION_MODEL,
  emergencyNumber: '112',
  logTurnText: true,
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
  allowance: DEFAULT_ALLOWANCE,
};

const TRANSCRIBER = 'http://luna-shopper-backend-transcriber:3007';

function configOf(overrides: Partial<AssistantConfig>): ConfigService {
  const config = { ...BASE, ...overrides };
  return {
    getOrThrow: () => config,
  } as unknown as ConfigService;
}

function capabilitiesOf(overrides: Partial<AssistantConfig>) {
  const configService = configOf(overrides);
  return new AssistantService(
    configService,
    buildModelProvider(configService),
    {} as never,
    {} as never,
    {} as never
  ).capabilities();
}

describe('buildModelProvider (plan 0236, section 2)', () => {
  /** The two halves of the split, read the way the module wired them. */
  function halves(overrides: Partial<AssistantConfig>) {
    const provider = buildModelProvider(configOf(overrides));
    const split = provider as unknown as {
      turns: unknown;
      hearing: unknown;
    };
    return { provider, turns: split.turns, hearing: split.hearing };
  }

  it('is always a split whose text half is Claude', () => {
    for (const overrides of [
      {},
      { anthropicApiKey: 'a' },
      { transcriberUrl: TRANSCRIBER },
    ]) {
      const { provider, turns } = halves(overrides);
      expect(provider).toBeInstanceOf(SplitModelProvider);
      expect(turns).toBeInstanceOf(ClaudeProvider);
    }
  });

  it('hears with NoHearing when no transcriber runs', () => {
    expect(halves({ anthropicApiKey: 'a' }).hearing).toBeInstanceOf(NoHearing);
  });

  it('hears with the transcriber when one runs', () => {
    expect(halves({ transcriberUrl: TRANSCRIBER }).hearing).toBeInstanceOf(
      WhisperProvider
    );
  });
});

describe('AssistantService.capabilities (plan 0231, section 3)', () => {
  it('with its key and a transcriber answers with Anthropic and hears', () => {
    expect(
      capabilitiesOf({ anthropicApiKey: 'a', transcriberUrl: TRANSCRIBER })
    ).toEqual({
      answers: true,
      hears: true,
      textProvider: AiTextProvider.ANTHROPIC,
    });
  });

  it('with its key and no transcriber answers and does not hear', () => {
    // A key alone never turns the microphone on (plan 0235).
    expect(capabilitiesOf({ anthropicApiKey: 'a' })).toEqual({
      answers: true,
      hears: false,
      textProvider: AiTextProvider.ANTHROPIC,
    });
  });

  it('without its key does neither, whatever hears, as its 501s say', () => {
    expect(capabilitiesOf({ transcriberUrl: TRANSCRIBER })).toEqual({
      answers: false,
      hears: false,
      textProvider: null,
    });
  });
});
