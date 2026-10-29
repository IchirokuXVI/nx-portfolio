import { ConfigService } from '@nestjs/config';
import type { AssistantConfig } from '../config/app-config';
import {
  ClaudeProvider,
  MODERATION_MAX_TOKENS,
  moderationOptions,
  readClaudeReply,
  readRetryAfterSeconds,
  toClaudeRequest,
  type ClaudeRequestOptions,
} from './claude.provider';
import {
  MODERATION_TIMEOUT_MS,
  ModelTurnRole,
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type ModelRequest,
} from './model-provider';

/**
 * The Claude wire mapping (plan 0224, section 9).
 *
 * Rule A4 holds here as everywhere: nothing reaches the API. What is
 * checked is that the request we build is the shape the Messages API documents,
 * that what we read back survives the payloads it sends, and that the raw content
 * of a reply makes the round trip the API requires of it. `fetch` is stubbed
 * where the class itself is exercised.
 */

const OPTIONS: ClaudeRequestOptions = {
  model: 'claude-haiku-5-5',
  effort: 'low',
  thinking: 'adaptive',
};

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    system: 'you are the assistant',
    turns: [],
    tools: [],
    locale: 'es',
    ...overrides,
  };
}

/** A reply as the API sends it: thinking first, then prose, then two calls. */
const TOOL_REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  stop_reason: 'tool_use',
  content: [
    { type: 'thinking', thinking: '', signature: 'opaque-thinking' },
    { type: 'text', text: 'Un momento.' },
    {
      type: 'tool_use',
      id: 'toolu_1',
      name: 'query_lists',
      input: { item: 'leche' },
    },
    {
      type: 'tool_use',
      id: 'toolu_2',
      name: 'query_lists',
      input: { item: 'pan' },
    },
  ],
  usage: {
    input_tokens: 2100,
    output_tokens: 80,
    cache_read_input_tokens: 4300,
    cache_creation_input_tokens: 0,
  },
};

describe('toClaudeRequest', () => {
  it('sends the operator prompt as system, not as a turn', () => {
    const body = toClaudeRequest(
      request({ turns: [{ role: ModelTurnRole.USER, text: 'hola' }] }),
      OPTIONS
    );

    expect(body['system']).toEqual([
      { type: 'text', text: 'you are the assistant' },
    ]);
    expect(body['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hola' }] },
    ]);
  });

  it('sends the model, the ceiling, the thinking and the effort, and no sampling knobs', () => {
    const body = toClaudeRequest(request(), OPTIONS);

    expect(body['model']).toBe('claude-haiku-5-5');
    expect(body['max_tokens']).toBe(4096);
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['output_config']).toEqual({ effort: 'low' });
    // The current models reject every one of these.
    for (const key of ['temperature', 'top_p', 'top_k', 'tool_choice']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('sends thinking disabled when the operator turned it off', () => {
    const body = toClaudeRequest(request(), {
      ...OPTIONS,
      thinking: 'off',
      effort: 'medium',
    });

    expect(body['thinking']).toEqual({ type: 'disabled' });
    expect(body['output_config']).toEqual({ effort: 'medium' });
  });

  it('declares the tools as input_schema, with the cache breakpoint on the last one only', () => {
    const body = toClaudeRequest(
      request({
        tools: [
          {
            name: 'query_lists',
            description: 'read the lists',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'upsert_lines',
            description: 'add something',
            parameters: { type: 'object', properties: { a: {} } },
          },
        ],
      }),
      OPTIONS
    );

    expect(body['tools']).toEqual([
      {
        name: 'query_lists',
        description: 'read the lists',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'upsert_lines',
        description: 'add something',
        input_schema: { type: 'object', properties: { a: {} } },
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('omits tools entirely when there are none', () => {
    expect(toClaudeRequest(request(), OPTIONS)['tools']).toBeUndefined();
  });

  it('sends a round of results as one user message of tool_result blocks keyed by call id', () => {
    // Results split across messages teach the model to stop calling tools in
    // parallel, so a round is one message however many calls it answered.
    const body = toClaudeRequest(
      request({
        turns: [
          {
            role: ModelTurnRole.TOOL,
            toolResults: [
              { id: 'toolu_1', name: 'query_lists', result: [1, 2] },
              { id: 'toolu_2', name: 'query_lists', result: { ok: true } },
            ],
          },
        ],
      }),
      OPTIONS
    );

    expect(body['messages']).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '[1,2]' },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            content: '{"ok":true}',
          },
        ],
      },
    ]);
  });

  it('replays a model turn that carries a signature as the raw content, unchanged', () => {
    // The defect the round trip exists for: a replayed assistant message that
    // lost its thinking block breaks the turn on its second round.
    const reply = readClaudeReply(TOOL_REPLY);
    const body = toClaudeRequest(
      request({
        turns: [
          { role: ModelTurnRole.USER, text: 'hay leche y pan?' },
          {
            role: ModelTurnRole.MODEL,
            text: reply.text,
            toolCalls: reply.toolCalls,
          },
        ],
      }),
      OPTIONS
    );

    expect((body['messages'] as unknown[])[1]).toEqual({
      role: 'assistant',
      content: TOOL_REPLY.content,
    });
  });

  it("sends a model turn from the client's transcript as a text block", () => {
    const body = toClaudeRequest(
      request({
        turns: [
          { role: ModelTurnRole.USER, text: 'apunta pan' },
          { role: ModelTurnRole.MODEL, text: 'Hecho.' },
        ],
      }),
      OPTIONS
    );

    expect(body['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'apunta pan' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hecho.' }] },
    ]);
  });

  it('builds tool_use blocks for calls that carry no signature', () => {
    const body = toClaudeRequest(
      request({
        turns: [
          { role: ModelTurnRole.USER, text: 'renombra' },
          {
            role: ModelTurnRole.MODEL,
            toolCalls: [{ id: 'toolu_9', name: 'rename_me', args: { a: 1 } }],
          },
        ],
      }),
      OPTIONS
    );

    expect(body['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'renombra' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_9',
            name: 'rename_me',
            input: { a: 1 },
          },
        ],
      },
    ]);
  });

  it('leaves out a model turn with nothing in it, because the API rejects an empty block', () => {
    const body = toClaudeRequest(
      request({
        turns: [
          { role: ModelTurnRole.USER, text: 'a' },
          { role: ModelTurnRole.MODEL, text: '' },
          { role: ModelTurnRole.USER, text: 'b' },
        ],
      }),
      OPTIONS
    );

    expect(body['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] },
    ]);
  });
  it('leaves out a transcript turn whose text is empty or only whitespace', () => {
    const body = toClaudeRequest(
      request({
        turns: [
          { role: ModelTurnRole.USER, text: 'a' },
          { role: ModelTurnRole.MODEL, text: ' ' },
          { role: ModelTurnRole.USER, text: ' ' },
          { role: ModelTurnRole.MODEL, text: '' },
          { role: ModelTurnRole.USER, text: '' },
          { role: ModelTurnRole.USER, text: 'b' },
        ],
      }),
      OPTIONS
    );

    expect(body['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] },
    ]);
  });
  it('drops the assistant turns a transcript cut left before the first question', () => {
    const body = toClaudeRequest(
      request({
        turns: [
          { role: ModelTurnRole.MODEL, text: 'Apuntado.' },
          { role: ModelTurnRole.USER, text: 'y leche' },
          { role: ModelTurnRole.MODEL, text: 'Hecho.' },
          { role: ModelTurnRole.USER, text: 'gracias' },
        ],
      }),
      OPTIONS
    );

    expect(body['messages']).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'y leche' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hecho.' }] },
      { role: 'user', content: [{ type: 'text', text: 'gracias' }] },
    ]);
  });
});

describe('readClaudeReply', () => {
  it('reads the text, the calls with their ids, and the usage with the cache read', () => {
    const reply = readClaudeReply(TOOL_REPLY);

    expect(reply.text).toBe('Un momento.');
    expect(
      reply.toolCalls.map(({ id, name, args }) => ({ id, name, args }))
    ).toEqual([
      { id: 'toolu_1', name: 'query_lists', args: { item: 'leche' } },
      { id: 'toolu_2', name: 'query_lists', args: { item: 'pan' } },
    ]);
    expect(reply.usage).toEqual({
      promptTokens: 2100,
      responseTokens: 80,
      totalTokens: 2180,
      cachedPromptTokens: 4300,
    });
  });

  it('attaches the raw content to the first call only', () => {
    const reply = readClaudeReply(TOOL_REPLY);

    expect(JSON.parse(reply.toolCalls[0].signature as string)).toEqual(
      TOOL_REPLY.content
    );
    // One copy is the whole message; a second would be replayed twice.
    expect(reply.toolCalls[1]).not.toHaveProperty('signature');
  });

  it('puts no signature on a reply that called nothing', () => {
    const reply = readClaudeReply({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: ' Hecho. ' }],
    });

    expect(reply).toEqual({ text: 'Hecho.', toolCalls: [], usage: null });
  });

  it('reads a refusal as an empty reply', () => {
    // The service answers it with the "got stuck" sentence rather than an
    // empty bubble (plan 0224, section 2.2).
    const reply = readClaudeReply({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'partial' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });

    expect(reply.text).toBe('');
    expect(reply.toolCalls).toEqual([]);
    expect(reply.usage?.totalTokens).toBe(12);
  });

  it('answers empty rather than throwing on a payload with no content', () => {
    expect(readClaudeReply({})).toEqual({
      text: '',
      toolCalls: [],
      usage: null,
    });
  });
});

describe('readRetryAfterSeconds', () => {
  it('reads a number of seconds, rounded up', () => {
    expect(readRetryAfterSeconds('27')).toBe(27);
    expect(readRetryAfterSeconds('2.1')).toBe(3);
  });

  it('ignores a date, a zero and an absent header', () => {
    expect(
      readRetryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')
    ).toBeUndefined();
    expect(readRetryAfterSeconds('0')).toBeUndefined();
    expect(readRetryAfterSeconds(null)).toBeUndefined();
  });
});

describe('ClaudeProvider', () => {
  const KEY = 'test-key';
  const CONFIG = {
    anthropicApiKey: KEY,
    anthropicBaseUrl: 'http://provider.invalid/v1',
    model: 'claude-haiku-5-5',
    claudeEffort: 'low',
    claudeThinking: 'adaptive',
    providerTimeoutMs: 50,
  } as AssistantConfig;

  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  function provider(overrides: Partial<AssistantConfig> = {}): ClaudeProvider {
    const config = { ...CONFIG, ...overrides };
    return new ClaudeProvider({
      getOrThrow: () => config,
    } as unknown as ConfigService);
  }

  function respond(status: number, body: unknown, headers = {}): void {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers })
    );
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to /messages with the key in x-api-key and nowhere else', async () => {
    respond(200, TOOL_REPLY);

    const reply = await provider().generate(request());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('http://provider.invalid/v1/messages');
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
    expect(
      Object.entries(headers).filter(([, value]) => value.includes(KEY))
    ).toHaveLength(1);
    expect(reply.toolCalls).toHaveLength(2);
  });

  it("turns a 429 into a rate limited error carrying the header's number", async () => {
    respond(
      429,
      { type: 'error', error: { type: 'rate_limit_error' } },
      { 'retry-after': '12' }
    );

    const error = await provider()
      .generate(request())
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderRateLimitedError);
    expect(error.retryAfterSeconds).toBe(12);
  });

  it('turns a 529 into an unavailable error that does not echo the body', async () => {
    respond(529, {
      type: 'error',
      error: { type: 'overloaded_error', message: 'hay leche' },
    });

    const error = await provider()
      .generate(request())
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error.message).toContain('529');
    expect(error.message).not.toContain('leche');
  });

  it('turns a timeout into an unavailable error that names the deadline', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    );

    const error = await provider()
      .generate(request())
      .catch((e) => e);

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error.message).toContain('50ms');
  });

  it('is configured only with a key', () => {
    expect(provider().configured).toBe(true);
    expect(provider({ anthropicApiKey: '' }).configured).toBe(false);
  });

  it('cannot transcribe, and says so through the flag first', async () => {
    const claude = provider();

    expect(claude.transcriptionSupported).toBe(false);
    await expect(claude.transcribe()).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a moderation request to the moderation model with thinking off and a one word ceiling', async () => {
    respond(200, {
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
    });

    const reply = await provider({
      moderationModel: 'claude-haiku-5-5',
      model: 'claude-sonnet-5-5',
      claudeThinking: 'adaptive',
      claudeEffort: 'high',
    }).generate(request({ purpose: 'moderation', system: 'classify' }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['model']).toBe('claude-haiku-5-5');
    expect(body['max_tokens']).toBe(MODERATION_MAX_TOKENS);
    expect(body['thinking']).toEqual({ type: 'disabled' });
    expect(body['output_config']).toEqual({ effort: 'low' });
    expect(body).not.toHaveProperty('tools');
    expect(reply.text).toBe('ok');
  });

  it('gives a moderation request its own eight second deadline', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new Error('aborted'))
            );
          })
      );

      const pending = provider({ providerTimeoutMs: 30000 })
        .generate(request({ purpose: 'moderation' }))
        .catch((e) => e);
      await jest.advanceTimersByTimeAsync(MODERATION_TIMEOUT_MS);

      const error = await pending;
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(error.message).toContain(`${MODERATION_TIMEOUT_MS}ms`);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('moderationOptions', () => {
  it('is the moderation model, thinking off, effort low and sixteen tokens', () => {
    expect(moderationOptions({ moderationModel: 'claude-haiku-5-5' })).toEqual({
      model: 'claude-haiku-5-5',
      effort: 'low',
      thinking: 'off',
      maxTokens: 16,
    });
  });
});
