import {
  assistantConfiguration,
  assistantValidationSchema,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_EMERGENCY_NUMBER,
  DEFAULT_MODERATION_MODEL,
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
