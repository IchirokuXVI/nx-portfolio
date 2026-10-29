import {
  assistantValidationSchema,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  resolveAssistantModels,
} from './app-config';

/**
 * The model fallback of plan 0224, section 5, and the empty values the chart and
 * the slot script write.
 */
describe('resolveAssistantModels', () => {
  it('gives each provider its own default when ASSISTANT_MODEL is empty', () => {
    expect(
      resolveAssistantModels({ provider: 'gemini', model: '' }).model
    ).toBe(DEFAULT_GEMINI_MODEL);
    expect(
      resolveAssistantModels({ provider: 'claude', model: ' ' }).model
    ).toBe(DEFAULT_CLAUDE_MODEL);
    expect(
      resolveAssistantModels({ provider: 'claude', model: 'claude-x' }).model
    ).toBe('claude-x');
  });
});

describe('assistantValidationSchema', () => {
  const BASE = { NATS_URL: 'nats://x', GATEWAY_INTERNAL_URL: 'http://g' };

  it('accepts the empty values the chart and the slot script write', () => {
    const { error } = assistantValidationSchema.validate(
      {
        ...BASE,
        ASSISTANT_PROVIDER: '',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_BASE_URL: '',
        ASSISTANT_CLAUDE_EFFORT: '',
        ASSISTANT_CLAUDE_THINKING: '',
        ASSISTANT_MODEL: '',
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

  it('defaults to Gemini, and refuses a provider it does not know', () => {
    const { value } = assistantValidationSchema.validate(BASE, {
      allowUnknown: true,
    });
    expect(value.ASSISTANT_PROVIDER).toBe('gemini');
    expect(value.ASSISTANT_CLAUDE_EFFORT).toBe('low');
    expect(value.ASSISTANT_CLAUDE_THINKING).toBe('adaptive');

    const { error } = assistantValidationSchema.validate(
      { ...BASE, ASSISTANT_PROVIDER: 'openai' },
      { allowUnknown: true }
    );
    expect(error).toBeDefined();
  });
});
