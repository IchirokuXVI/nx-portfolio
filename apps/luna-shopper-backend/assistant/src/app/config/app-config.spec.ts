import {
  assistantConfiguration,
  assistantValidationSchema,
  DEFAULT_ALLOWANCE,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_EMERGENCY_NUMBER,
  DEFAULT_MODERATION_MODEL,
  resolveAllowance,
  resolveAssistantModels,
} from './app-config';

/**
 * The model fallback of plan 0224, section 5, the empty values the chart and
 * the slot script write, and the stale keys plan 0236 leaves behind.
 */
describe('resolveAssistantModels', () => {
  it('resolves an empty ASSISTANT_MODEL to the Claude default', () => {
    expect(resolveAssistantModels({ model: '' }).model).toBe(
      DEFAULT_CLAUDE_MODEL
    );
    expect(resolveAssistantModels({ model: ' ' }).model).toBe(
      DEFAULT_CLAUDE_MODEL
    );
    expect(resolveAssistantModels({ model: 'claude-x' }).model).toBe(
      'claude-x'
    );
  });

  it('resolves an empty ASSISTANT_MODERATION_MODEL to Haiku', () => {
    expect(resolveAssistantModels({}).moderationModel).toBe(
      DEFAULT_MODERATION_MODEL
    );
    expect(DEFAULT_MODERATION_MODEL).toBe('claude-haiku-5-5');
    expect(
      resolveAssistantModels({ moderationModel: 'claude-y' }).moderationModel
    ).toBe('claude-y');
  });
});

describe('assistantValidationSchema', () => {
  const BASE = { NATS_URL: 'nats://x', GATEWAY_INTERNAL_URL: 'http://g' };

  it('accepts the empty values the chart and the slot script write', () => {
    const { error } = assistantValidationSchema.validate(
      {
        ...BASE,
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_BASE_URL: '',
        ASSISTANT_CLAUDE_EFFORT: '',
        ASSISTANT_CLAUDE_THINKING: '',
        ASSISTANT_MODEL: '',
        ASSISTANT_MODERATION: '',
        ASSISTANT_MODERATION_MODEL: '',
        ASSISTANT_EMERGENCY_NUMBER: '',
        TRANSCRIBER_URL: '',
      },
      { allowUnknown: true }
    );

    expect(error).toBeUndefined();
  });

  it('defaults to no transcriber, and to the timeouts of plan 0235', () => {
    const { value } = assistantValidationSchema.validate(BASE, {
      allowUnknown: true,
    });

    expect(value.TRANSCRIBER_URL).toBe('');
    expect(value.TRANSCRIBER_TURN_TIMEOUT_MS).toBe(45000);
    expect(value.TRANSCRIBER_COMMENT_TIMEOUT_MS).toBe(110000);
  });

  it('defaults to no turn text in the logs, and refuses a word that is not a boolean', () => {
    const { value } = assistantValidationSchema.validate(BASE, {
      allowUnknown: true,
    });
    expect(value.ASSISTANT_LOG_TURN_TEXT).toBe(false);

    const { error } = assistantValidationSchema.validate(
      { ...BASE, ASSISTANT_LOG_TURN_TEXT: 'sometimes' },
      { allowUnknown: true }
    );
    expect(error).toBeDefined();
  });

  it('defaults to the Claude settings the evaluation chose and to moderation on', () => {
    const { value } = assistantValidationSchema.validate(BASE, {
      allowUnknown: true,
    });
    expect(value.ASSISTANT_CLAUDE_EFFORT).toBe('low');
    expect(value.ASSISTANT_CLAUDE_THINKING).toBe('adaptive');
    expect(value.ASSISTANT_MODERATION).toBe('on');

    const { error } = assistantValidationSchema.validate(
      { ...BASE, ASSISTANT_MODERATION: 'maybe' },
      { allowUnknown: true }
    );
    expect(error).toBeDefined();
  });

  it('still validates an environment that carries the keys plan 0236 removed', () => {
    // A slot `.env` written before plan 0236 keeps them, and a cluster Secret
    // keeps its key until the next provisioning run (section 6.2). The module
    // validates with `allowUnknown: true`, as here.
    const { error } = assistantValidationSchema.validate(
      {
        ...BASE,
        GEMINI_API_KEY: 'x',
        GEMINI_BASE_URL: 'http://stale.invalid',
        ASSISTANT_PROVIDER: 'gemini',
      },
      { allowUnknown: true, abortEarly: false }
    );

    expect(error).toBeUndefined();
  });
});

describe('assistantConfiguration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads no stale key, and resolves the moderation keys to their defaults', () => {
    process.env = {
      ...saved,
      NATS_URL: 'nats://x',
      GATEWAY_INTERNAL_URL: 'http://g',
      GEMINI_API_KEY: 'x',
      ASSISTANT_PROVIDER: 'gemini',
      ASSISTANT_MODEL: '',
      ASSISTANT_MODERATION: '',
      ASSISTANT_MODERATION_MODEL: '',
      ASSISTANT_EMERGENCY_NUMBER: '',
    };

    const config = assistantConfiguration();

    expect(config.model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(config.moderation).toBe(true);
    expect(config.moderationModel).toBe(DEFAULT_MODERATION_MODEL);
    expect(config.emergencyNumber).toBe(DEFAULT_EMERGENCY_NUMBER);
    expect(Object.keys(config).join(' ')).not.toMatch(/gemini/i);
    expect(config).not.toHaveProperty('provider');
  });

  it('logs no turn text unless ASSISTANT_LOG_TURN_TEXT is true (k8s plan 0018, D3)', () => {
    const base = {
      ...saved,
      NATS_URL: 'nats://x',
      GATEWAY_INTERNAL_URL: 'http://g',
    };

    process.env = { ...base };
    expect(assistantConfiguration().logTurnText).toBe(false);
    process.env = { ...base, ASSISTANT_LOG_TURN_TEXT: 'false' };
    expect(assistantConfiguration().logTurnText).toBe(false);
    process.env = { ...base, ASSISTANT_LOG_TURN_TEXT: 'true' };
    expect(assistantConfiguration().logTurnText).toBe(true);
  });

  it('turns moderation off only on `off`, and takes an operator number', () => {
    process.env = {
      ...saved,
      NATS_URL: 'nats://x',
      GATEWAY_INTERNAL_URL: 'http://g',
      ASSISTANT_MODERATION: 'off',
      ASSISTANT_EMERGENCY_NUMBER: '911',
    };

    const config = assistantConfiguration();

    expect(config.moderation).toBe(false);
    expect(config.emergencyNumber).toBe('911');
  });
});

/** Each person's allowance (plan 0234, sections 7 and 11). */
describe('the allowance keys', () => {
  const BASE = { NATS_URL: 'nats://x', GATEWAY_INTERNAL_URL: 'http://g' };

  it('defaults every limit to the numbers of section 7, guests lower', () => {
    expect(DEFAULT_ALLOWANCE.registered).toEqual({
      turnsPerDay: 60,
      turnsPerMonth: 600,
      assistantAudioSecondsPerDay: 900,
      assistantAudioSecondsPerMonth: 9000,
      commentAudioSecondsPerDay: 1800,
      commentAudioSecondsPerMonth: 18000,
      costPerDayMicroUsd: 100_000,
      costPerMonthMicroUsd: 1_000_000,
      deploymentCostPerDayMicroUsd: 3_000_000,
      deploymentCostPerMonthMicroUsd: 30_000_000,
    });
    expect(DEFAULT_ALLOWANCE.guest).toEqual({
      turnsPerDay: 20,
      turnsPerMonth: 100,
      assistantAudioSecondsPerDay: 300,
      assistantAudioSecondsPerMonth: 1500,
      commentAudioSecondsPerDay: 600,
      commentAudioSecondsPerMonth: 3000,
      costPerDayMicroUsd: 40_000,
      costPerMonthMicroUsd: 200_000,
      // The deployment is one deployment, whoever asks.
      deploymentCostPerDayMicroUsd: 3_000_000,
      deploymentCostPerMonthMicroUsd: 30_000_000,
    });
    expect(DEFAULT_ALLOWANCE.turnReserveMicroUsd).toBe(20_000);
    expect(DEFAULT_ALLOWANCE.timezone).toBe('UTC');
  });

  it('reads a guest key apart from its registered key', () => {
    const allowance = resolveAllowance({
      ASSISTANT_TURNS_PER_DAY: '5',
      ASSISTANT_TURNS_PER_DAY_GUEST: '1',
      ASSISTANT_ALLOWANCE_TIMEZONE: 'Europe/Madrid',
    });
    expect(allowance.registered.turnsPerDay).toBe(5);
    expect(allowance.guest.turnsPerDay).toBe(1);
    expect(allowance.timezone).toBe('Europe/Madrid');
  });

  it('refuses a limit below one, a fraction, and an unknown timezone', () => {
    for (const bad of [
      { ASSISTANT_TURNS_PER_DAY: '0' },
      { COMMENT_AUDIO_SECONDS_PER_DAY_GUEST: '1.5' },
      { ASSISTANT_TURN_RESERVE_MICRO_USD: '-1' },
      { ASSISTANT_ALLOWANCE_TIMEZONE: 'Mars/Olympus' },
    ]) {
      expect(
        assistantValidationSchema.validate({ ...BASE, ...bad }).error
      ).toBeDefined();
    }
    expect(
      assistantValidationSchema.validate({
        ...BASE,
        ASSISTANT_ALLOWANCE_TIMEZONE: 'Europe/Madrid',
        ASSISTANT_DEPLOYMENT_COST_PER_MONTH_MICRO_USD: '30000000',
      }).error
    ).toBeUndefined();
  });

  it('has no guest form of a deployment key', () => {
    expect(
      assistantValidationSchema.describe().keys[
        'ASSISTANT_DEPLOYMENT_COST_PER_DAY_MICRO_USD_GUEST'
      ]
    ).toBeUndefined();
    expect(
      assistantValidationSchema.describe().keys['ASSISTANT_TURNS_PER_DAY_GUEST']
    ).toBeDefined();
  });
});
