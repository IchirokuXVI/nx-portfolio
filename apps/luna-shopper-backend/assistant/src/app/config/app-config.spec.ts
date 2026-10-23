import {
  assistantValidationSchema,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_GEMINI_MODEL,
  resolveAssistantModels,
} from './app-config';

/**
 * The two model fallbacks of plan 0224, section 5, and the empty values the
 * chart and the slot script write.
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

  it("transcribes with the turn's model when Gemini answers", () => {
    expect(
      resolveAssistantModels({ provider: 'gemini', model: 'gemini-x' })
        .transcriptionModel
    ).toBe('gemini-x');
  });

  it('transcribes with the default Gemini model when Claude answers', () => {
    // A Claude name sent to the Gemini endpoint is a 404 on every spoken turn.
    expect(
      resolveAssistantModels({ provider: 'claude', model: 'claude-x' })
        .transcriptionModel
    ).toBe(DEFAULT_GEMINI_MODEL);
    expect(
      resolveAssistantModels({
        provider: 'claude',
        transcriptionModel: 'gemini-y',
      }).transcriptionModel
    ).toBe('gemini-y');
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
      },
      { allowUnknown: true }
    );

    expect(error).toBeUndefined();
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
