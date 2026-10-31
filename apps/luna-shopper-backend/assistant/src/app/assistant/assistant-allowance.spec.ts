import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  AllowanceLimit,
  AllowancePeriod,
  AllowancePurpose,
  AllowanceScope,
  MembershipStatus,
  UserKind,
  type AssistantTurnRequest,
  type AssistantVoiceRequest,
  type LineView,
  type ListView,
  type MyZoneView,
} from '@portfolio/luna-shopper/contracts';
import {
  isDomainException,
  resolveErrorMessage,
  retryAfterSecondsOf,
  runWithRequestContext,
} from '@portfolio/luna-shopper/platform';
import { FakeAllowance } from '../allowance/allowance.fake';
import {
  DEFAULT_ALLOWANCE,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_MODERATION_MODEL,
  type AssistantConfig,
} from '../config/app-config';
import {
  FAKE_AUDIO_SECONDS,
  FakeModelProvider,
} from '../provider/fake-model.provider';
import {
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type ModelReply,
} from '../provider/model-provider';
import {
  AssistantService,
  backAt,
  estimateAudioSeconds,
  TURN_IN_FLIGHT_RETRY_SECONDS,
} from './assistant.service';
import type { GatewayApiClient } from './gateway-api.client';
import { TurnContextFactory } from './turn-context';

/**
 * Each person's allowance, from the assistant's side (plan 0234, section
 * 10.1). Core is {@link FakeAllowance}, which records what it was asked; the
 * counting itself is core's, proved against Postgres in its own spec.
 */

const CONFIG: AssistantConfig = {
  port: 3006,
  natsUrl: 'nats://unused',
  logLevel: 'silent',
  gatewayInternalUrl: 'http://gateway.invalid',
  anthropicApiKey: 'not-used-by-the-fake',
  anthropicBaseUrl: 'http://provider.invalid',
  claudeEffort: 'low',
  claudeThinking: 'adaptive',
  model: DEFAULT_CLAUDE_MODEL,
  moderation: true,
  moderationModel: DEFAULT_MODERATION_MODEL,
  emergencyNumber: '112',
  logTurnText: true,
  transcriberUrl: 'http://transcriber.invalid',
  transcriberTurnTimeoutMs: 45000,
  transcriberCommentTimeoutMs: 110000,
  audioMaxBytes: 2 * 1024 * 1024,
  audioMimeTypes: ['audio/webm'],
  maxTurns: 20,
  maxChars: 8000,
  maxToolCalls: 6,
  turnsPerMinute: 100,
  concurrency: 2,
  retryAfterFallbackSeconds: 30,
  providerTimeoutMs: 30000,
  turnTimeoutMs: 60000,
  allowance: { ...DEFAULT_ALLOWANCE, timezone: 'Europe/Madrid' },
};

function stubApi(): GatewayApiClient {
  return {
    listZones: async (): Promise<MyZoneView[]> => [
      {
        id: 'zone-home',
        name: 'Casa',
        myStatus: MembershipStatus.APPROVED,
      } as MyZoneView,
    ],
    listLists: async () => [
      { id: 'list-0', zoneId: 'zone-home', name: 'Piso' } as ListView,
    ],
    listLines: async () => [],
    addLines: async (
      _caller: unknown,
      listId: string,
      items: { content: string }[]
    ) =>
      items.map(
        (item) =>
          ({
            id: `line-${item.content}`,
            listId,
            content: item.content,
            quantity: 1,
          }) as LineView
      ),
  } as unknown as GatewayApiClient;
}

function build(
  provider: FakeModelProvider,
  overrides: Partial<AssistantConfig> = {}
): { service: AssistantService; allowance: FakeAllowance } {
  const config = { ...CONFIG, ...overrides };
  const api = stubApi();
  const allowance = new FakeAllowance();
  const service = new AssistantService(
    { getOrThrow: () => config } as unknown as ConfigService,
    provider,
    new TurnContextFactory(api),
    api,
    allowance.asClient()
  );
  return { service, allowance };
}

function turn(kind?: UserKind): AssistantTurnRequest {
  return {
    userId: 'user-1',
    authorization: 'Bearer token',
    transcript: [],
    message: 'hola',
    ...(kind ? { kind } : {}),
  };
}

function voice(bytes: number): AssistantVoiceRequest {
  return {
    userId: 'user-1',
    authorization: 'Bearer token',
    transcript: [],
    audio: Buffer.alloc(bytes, 7).toString('base64'),
    mimeType: 'audio/webm',
    kind: UserKind.REGISTERED,
  };
}

/** A reply with usage, so the meter prices it: 2,100 in, 120 out, 4,300 cached. */
function says(text: string): ModelReply {
  return {
    text,
    toolCalls: [],
    usage: {
      promptTokens: 2100,
      responseTokens: 120,
      totalTokens: 2220,
      cachedPromptTokens: 4300,
    },
  };
}

function quietly<T>(run: () => Promise<T>): Promise<T> {
  const spies = (['log', 'warn', 'error'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined)
  );
  return run().finally(() => spies.forEach((spy) => spy.mockRestore()));
}

/** Like {@link quietly}, and answers what was logged as an error. */
async function withErrorLog<T>(
  run: () => Promise<T>
): Promise<{ result: T; errors: string[] }> {
  const errors: string[] = [];
  const spies = (['log', 'warn'] as const).map((level) =>
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined)
  );
  spies.push(
    jest.spyOn(Logger.prototype, 'error').mockImplementation((line) => {
      errors.push(String(line));
    })
  );
  try {
    return { result: await run(), errors };
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}

function inLocale<T>(locale: 'en' | 'es', run: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { correlationId: 'allowance-spec', locale } as never,
    run
  );
}

const REFUSED_TODAY = {
  scope: AllowanceScope.USER,
  period: AllowancePeriod.DAY,
  limit: AllowanceLimit.TURNS,
  resetsAt: '2026-10-28T00:00:00+01:00',
};

describe('a turn and the allowance (plan 0234)', () => {
  it('reserves after the per minute limiter and before the first provider call', async () => {
    const provider = new FakeModelProvider([says('Hola.')]);
    const { service, allowance } = build(provider);
    const reservesAtFirstCall: number[] = [];
    const generate = provider.generate.bind(provider);
    provider.generate = async (request) => {
      reservesAtFirstCall.push(allowance.reserves.length);
      return generate(request);
    };

    await quietly(() => service.turn(turn(UserKind.REGISTERED)));

    expect(reservesAtFirstCall[0]).toBe(1);
    expect(allowance.reserves[0]).toMatchObject({
      userId: 'user-1',
      purpose: AllowancePurpose.TURN,
      audioSeconds: 0,
      microUsd: 20_000,
      limits: DEFAULT_ALLOWANCE.registered,
      timezone: 'Europe/Madrid',
      // The turn's deadline plus a minute (section 5.4).
      holdSeconds: 120,
    });
    expect(allowance.log).toEqual(['reserve', 'settle']);
  });

  it('takes the per minute limit first, so a caller over it reserves nothing', async () => {
    const provider = new FakeModelProvider([says('Hola.')]);
    const { service, allowance } = build(provider, { turnsPerMinute: 1 });

    await quietly(() => service.turn(turn()));
    const error = await quietly(() => service.turn(turn())).catch(
      (thrown: unknown) => thrown
    );

    expect((error as { code: string }).code).toBe('rate_limited');
    expect(allowance.reserves).toHaveLength(1);
  });

  it('settles one turn and what the replies cost, the moderation call included', async () => {
    const provider = new FakeModelProvider([says('Hola.')]);
    const { service, allowance } = build(provider);
    // The fake's verdicts report no usage, so script the check's own reply.
    const generate = provider.generate.bind(provider);
    provider.generate = async (request) =>
      request.purpose === 'moderation'
        ? {
            text: 'ok',
            toolCalls: [],
            usage: {
              promptTokens: 610,
              responseTokens: 4,
              totalTokens: 614,
              cachedPromptTokens: 0,
            },
          }
        : generate(request);

    await quietly(() => service.turn(turn()));

    // The turn: 210 + 43 + 60 = 313. The check: 61 + 2 = 63.
    expect(allowance.settles).toEqual([
      {
        reservationId: 'reservation-1',
        userId: 'user-1',
        purpose: AllowancePurpose.TURN,
        timezone: 'Europe/Madrid',
        turns: 1,
        audioSeconds: 0,
        microUsd: 313 + 63,
        promptTokens: 2710,
        responseTokens: 124,
        cachedPromptTokens: 4300,
      },
    ]);
  });

  it('refuses with the allowance code and makes no provider call', async () => {
    const provider = new FakeModelProvider([says('never asked')]);
    const { service, allowance } = build(provider);
    allowance.answer = { refused: REFUSED_TODAY };

    const error = await inLocale('es', () =>
      quietly(() => service.turn(turn()))
    ).catch((thrown: unknown) => thrown);

    expect(isDomainException(error)).toBe(true);
    const refusal = error as {
      code: string;
      details: unknown;
      exposesDetails: boolean;
      messageArgs: Record<string, string>;
    };
    expect(refusal.code).toBe('assistant_allowance_reached');
    expect(refusal.exposesDetails).toBe(true);
    expect(refusal.details).toEqual(REFUSED_TODAY);
    expect(retryAfterSecondsOf(error as never)).toBeUndefined();
    expect(refusal.messageArgs).toEqual({ variant: 'user.day', time: '00:00' });
    expect(
      resolveErrorMessage(
        'assistant_allowance_reached',
        'es',
        refusal.messageArgs
      )
    ).toBe(
      'Has usado el asistente todo lo que permite hoy. Vuelve a estar disponible a las 00:00.'
    );
    expect(provider.requests).toHaveLength(0);
    expect(allowance.settles).toHaveLength(0);
  });

  it('says the assistant is resting, with a date, when the deployment month is reached', async () => {
    const provider = new FakeModelProvider();
    const { service, allowance } = build(provider);
    allowance.answer = {
      refused: {
        scope: AllowanceScope.DEPLOYMENT,
        period: AllowancePeriod.MONTH,
        limit: AllowanceLimit.COST,
        resetsAt: '2026-11-01T00:00:00+01:00',
      },
    };
    const logged: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logged.push(String(message));
      });

    const error = await inLocale('en', () => service.turn(turn())).catch(
      (thrown: unknown) => thrown
    );
    spy.mockRestore();

    const args = (error as { messageArgs: Record<string, string> }).messageArgs;
    expect(args).toEqual({ variant: 'deployment.month', time: 'November 1' });
    expect(resolveErrorMessage('assistant_allowance_reached', 'en', args)).toBe(
      'The assistant is resting for now. It is back on November 1.'
    );
    expect(
      logged.some((line) =>
        line.includes('"event":"assistant.allowance.deploymentReached"')
      )
    ).toBe(true);
  });

  it('answers a turn already in flight with rate_limited and five seconds', async () => {
    const provider = new FakeModelProvider();
    const { service, allowance } = build(provider);
    allowance.answer = { turnInFlight: true };

    const error = await quietly(() => service.turn(turn())).catch(
      (thrown: unknown) => thrown
    );

    expect((error as { code: string }).code).toBe('rate_limited');
    expect(retryAfterSecondsOf(error as never)).toBe(
      TURN_IN_FLIGHT_RETRY_SECONDS
    );
    expect(provider.requests).toHaveLength(0);
  });

  it('refuses the turn when core does not answer, and calls no provider', async () => {
    const provider = new FakeModelProvider([says('never asked')]);
    const { service, allowance } = build(provider);
    allowance.answer = { unavailable: true };

    const error = await quietly(() => service.turn(turn())).catch(
      (thrown: unknown) => thrown
    );

    expect((error as Error).name).toBe('AllowanceUnavailableError');
    expect(provider.requests).toHaveLength(0);
  });

  it('reserves nothing on a deployment with no key, which still answers 501', async () => {
    const provider = new FakeModelProvider();
    provider.configured = false;
    const { service, allowance } = build(provider);

    const error = await service.turn(turn()).catch((thrown: unknown) => thrown);

    expect((error as { code: string }).code).toBe('not_configured');
    expect(allowance.reserves).toHaveLength(0);
  });

  it('settles a turn whose provider failed, at one call worst case', async () => {
    const provider = new FakeModelProvider([
      new ProviderUnavailableError('the model did not answer within 30000ms', {
        cause: new Error('aborted'),
      }),
    ]);
    const { service, allowance } = build(provider);

    await quietly(() => service.turn(turn())).catch(() => undefined);

    expect(allowance.settles).toHaveLength(1);
    expect(allowance.settles[0]).toMatchObject({ turns: 1, microUsd: 2688 });
  });

  it('settles zero for a provider that refused with a status or a 429', async () => {
    const provider = new FakeModelProvider([
      new ProviderUnavailableError('the model provider answered 529'),
    ]);
    const { service, allowance } = build(provider);
    await quietly(() => service.turn(turn())).catch(() => undefined);

    const limited = new FakeModelProvider([
      new ProviderRateLimitedError('slow down', 3),
    ]);
    const second = build(limited);
    await quietly(() => second.service.turn(turn())).catch(() => undefined);

    expect(allowance.settles[0]).toMatchObject({ turns: 0, microUsd: 0 });
    expect(second.allowance.settles[0]).toMatchObject({
      turns: 0,
      microUsd: 0,
    });
  });

  it('charges one call worst case for any other failure, a 200 whose body could not be read included', async () => {
    const provider = new FakeModelProvider([
      new SyntaxError('Unexpected end of JSON input'),
    ]);
    const { service, allowance } = build(provider);

    await quietly(() => service.turn(turn())).catch(() => undefined);

    expect(allowance.settles).toHaveLength(1);
    expect(allowance.settles[0]).toMatchObject({ turns: 1, microUsd: 2688 });
  });

  it('tries a failed settle once more, and counts it when the second answers', async () => {
    const provider = new FakeModelProvider([says('Hola.')]);
    const { service, allowance } = build(provider);
    allowance.settleFailures = 1;

    const { errors } = await withErrorLog(() => service.turn(turn()));

    expect(allowance.settles).toHaveLength(2);
    expect(allowance.settles[1]).toEqual(allowance.settles[0]);
    expect(errors).toEqual([]);
  });

  it('logs the settle as failed only after the retry failed too, and still answers', async () => {
    const provider = new FakeModelProvider([says('Hola.')]);
    const { service, allowance } = build(provider);
    allowance.settleFailures = 2;

    const { result, errors } = await withErrorLog(() => service.turn(turn()));

    expect(result.reply).toBe('Hola.');
    expect(allowance.settles).toHaveLength(2);
    const failed = errors.filter((line) =>
      line.includes('assistant.allowance.settleFailed')
    );
    expect(failed).toHaveLength(1);
    expect(JSON.parse(failed[0])).toMatchObject({
      userId: 'user-1',
      purpose: AllowancePurpose.TURN,
      audioSeconds: 0,
    });
  });

  it('settles a turn that ran out of time', async () => {
    const provider = new FakeModelProvider([
      FakeModelProvider.calls('query_lists', {}),
    ]);
    const { service, allowance } = build(provider, { turnTimeoutMs: 5000 });
    const now = Date.now();
    const clock = jest
      .spyOn(Date, 'now')
      .mockImplementationOnce(() => now)
      .mockImplementation(() => now + 10_000);

    try {
      await quietly(() => service.turn(turn()));
    } finally {
      clock.mockRestore();
    }

    expect(allowance.settles).toHaveLength(1);
    // The scripted reply reported no usage, so the reservation is charged.
    expect(allowance.settles[0]).toMatchObject({ turns: 1, microUsd: 20_000 });
  });

  it('counts a guest, and a request that names no kind, at the guest limits', async () => {
    const provider = new FakeModelProvider([says('Hola.'), says('Hola.')]);
    const { service, allowance } = build(provider);

    await quietly(() => service.turn(turn(UserKind.TEMPORARY)));
    await quietly(() => service.turn(turn()));

    expect(allowance.reserves[0].limits).toEqual(DEFAULT_ALLOWANCE.guest);
    expect(allowance.reserves[1].limits).toEqual(DEFAULT_ALLOWANCE.guest);
    expect(DEFAULT_ALLOWANCE.guest.turnsPerDay).toBe(20);
    expect(DEFAULT_ALLOWANCE.guest.deploymentCostPerDayMicroUsd).toBe(
      DEFAULT_ALLOWANCE.registered.deploymentCostPerDayMicroUsd
    );
  });
});

describe('a spoken turn and the allowance (plan 0234)', () => {
  it('reserves one turn and the byte estimate, and settles the measured seconds', async () => {
    const provider = new FakeModelProvider([says('Hecho.')]).willHear(
      'añade leche'
    );
    const { service, allowance } = build(provider);

    await quietly(() => service.voice(voice(9000)));

    expect(allowance.reserves[0]).toMatchObject({
      purpose: AllowancePurpose.VOICE_TURN,
      audioSeconds: estimateAudioSeconds(9000),
      microUsd: 20_000,
    });
    expect(estimateAudioSeconds(9000)).toBe(5);
    expect(allowance.settles[0]).toMatchObject({
      purpose: AllowancePurpose.VOICE_TURN,
      turns: 1,
      audioSeconds: Math.ceil(FAKE_AUDIO_SECONDS),
    });
  });

  it('keeps the estimate when the transcription failed, and charges no turn', async () => {
    const provider = new FakeModelProvider().willHear(
      new ProviderUnavailableError('the transcriber did not answer')
    );
    const { service, allowance } = build(provider);

    await quietly(() => service.voice(voice(9000))).catch(() => undefined);

    expect(allowance.settles[0]).toMatchObject({
      turns: 0,
      audioSeconds: 5,
      microUsd: 0,
    });
  });

  it('keeps the estimate when the transcriber measured no positive seconds', async () => {
    for (const measured of [0, Number.NaN, -3]) {
      const provider = new FakeModelProvider([says('Hecho.')]);
      jest
        .spyOn(provider, 'transcribe')
        .mockResolvedValue({ text: 'añade leche', audioSeconds: measured });
      const { service, allowance } = build(provider);

      await quietly(() => service.voice(voice(9000)));

      expect(allowance.settles[0]).toMatchObject({
        turns: 1,
        audioSeconds: estimateAudioSeconds(9000),
      });
    }
  });

  it('counts no seconds when the transcriber refused the clip with a full queue', async () => {
    const provider = new FakeModelProvider().willHear(
      new ProviderRateLimitedError('queue full', 10)
    );
    const { service, allowance } = build(provider);

    await quietly(() => service.voice(voice(9000))).catch(() => undefined);

    expect(allowance.settles[0]).toMatchObject({ turns: 0, audioSeconds: 0 });
  });
});

describe('a voice comment and the allowance (plan 0234)', () => {
  const AUDIO = Buffer.alloc(4001, 1).toString('base64');

  it('reserves the comment audio of its author, at no money, and settles the measured seconds', async () => {
    const provider = new FakeModelProvider().willHear('trae pan');
    const { service, allowance } = build(provider);

    await quietly(() =>
      service.transcribe({
        audio: AUDIO,
        mimeType: 'audio/webm',
        locale: 'es',
        purpose: 'comment',
        userId: 'author-1',
        kind: UserKind.TEMPORARY,
      })
    );

    expect(allowance.reserves[0]).toMatchObject({
      userId: 'author-1',
      purpose: AllowancePurpose.TRANSCRIPTION,
      audioSeconds: 3,
      microUsd: 0,
      limits: DEFAULT_ALLOWANCE.guest,
      // The comment lane's own deadline plus a minute.
      holdSeconds: 170,
    });
    expect(allowance.settles[0]).toMatchObject({
      userId: 'author-1',
      turns: 0,
      audioSeconds: 3,
      microUsd: 0,
    });
  });

  it('keeps the estimate when the transcriber reported no seconds', async () => {
    const provider = new FakeModelProvider();
    jest
      .spyOn(provider, 'transcribe')
      .mockResolvedValue({ text: 'trae pan', audioSeconds: 0 });
    const { service, allowance } = build(provider);

    await quietly(() =>
      service.transcribe({
        audio: AUDIO,
        mimeType: 'audio/webm',
        locale: 'es',
        purpose: 'comment',
        userId: 'author-1',
        kind: UserKind.REGISTERED,
      })
    );

    expect(estimateAudioSeconds(4001)).toBe(3);
    expect(allowance.settles[0]).toMatchObject({ turns: 0, audioSeconds: 3 });
  });

  it('refuses a transcription with no author, because the allowance fails closed', async () => {
    const provider = new FakeModelProvider().willHear('trae pan');
    const { service, allowance } = build(provider);

    const error = await service
      .transcribe({ audio: AUDIO, mimeType: 'audio/webm', locale: 'es' })
      .catch((thrown: unknown) => thrown);

    expect((error as { code: string }).code).toBe('validation_failed');
    expect(allowance.reserves).toHaveLength(0);
    expect(provider.transcriptions).toHaveLength(0);
  });

  it('answers the allowance code when the author is over their comment audio', async () => {
    const provider = new FakeModelProvider().willHear('never heard');
    const { service, allowance } = build(provider);
    allowance.answer = {
      refused: { ...REFUSED_TODAY, limit: AllowanceLimit.COMMENT_AUDIO },
    };

    const error = await quietly(() =>
      service.transcribe({
        audio: AUDIO,
        mimeType: 'audio/webm',
        locale: 'es',
        purpose: 'comment',
        userId: 'author-1',
      })
    ).catch((thrown: unknown) => thrown);

    expect((error as { code: string }).code).toBe(
      'assistant_allowance_reached'
    );
    expect(provider.transcriptions).toHaveLength(0);
  });
});

describe('the allowance read (plan 0234, section 8.2)', () => {
  it('asks core with the limits of the caller kind', async () => {
    const { service, allowance } = build(new FakeModelProvider());
    const counter = { used: 0, limit: 60 };
    const period = {
      turns: counter,
      assistantAudioSeconds: counter,
      commentAudioSeconds: counter,
      resetsAt: '2026-10-28T00:00:00+01:00',
    };
    allowance.view = { day: period, month: period, deploymentAvailable: true };

    await expect(
      service.allowanceOf({ userId: 'user-1', kind: UserKind.REGISTERED })
    ).resolves.toEqual(allowance.view);
    expect(allowance.reads[0]).toEqual({
      userId: 'user-1',
      limits: DEFAULT_ALLOWANCE.registered,
      timezone: 'Europe/Madrid',
      turnReserveMicroUsd: 20_000,
    });
  });
});

describe('backAt', () => {
  it('writes the time of day for a day and the date for a month', () => {
    expect(
      backAt(
        '2026-10-28T00:00:00+01:00',
        AllowancePeriod.DAY,
        'es',
        'Europe/Madrid'
      )
    ).toBe('00:00');
    expect(
      backAt(
        '2026-11-01T00:00:00+01:00',
        AllowancePeriod.MONTH,
        'es',
        'Europe/Madrid'
      )
    ).toBe('1 de noviembre');
  });
});
