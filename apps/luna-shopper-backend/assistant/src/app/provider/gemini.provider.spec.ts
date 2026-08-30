import {
  readReply,
  readRetryDelaySeconds,
  toGeminiRequest,
} from './gemini.provider';
import { ModelTurnRole } from './model-provider';

/**
 * The wire mapping, which is the one part of this service that a test cannot
 * prove against the real thing: rule A4 forbids reaching a provider, so what is
 * checked here is that the shape we build is the shape the API documents, and
 * that what we read back survives the payloads it actually sends.
 *
 * Everything else about Gemini lives above the {@link ModelProvider} interface
 * and is tested against the fake.
 */
describe('toGeminiRequest', () => {
  it('sends the operator prompt as systemInstruction, not as a turn', () => {
    // The prompt is ours and the conversation is not; keeping them apart on the
    // wire is what stops a caller contributing to the former (section 4).
    const request = toGeminiRequest({
      system: 'you are the assistant',
      turns: [{ role: ModelTurnRole.USER, text: 'hola' }],
      tools: [],
      locale: 'es',
    });

    expect(request['systemInstruction']).toEqual({
      parts: [{ text: 'you are the assistant' }],
    });
    expect(request['contents']).toEqual([
      { role: 'user', parts: [{ text: 'hola' }] },
    ]);
  });

  it('declares the tools in one functionDeclarations block', () => {
    const request = toGeminiRequest({
      system: 's',
      turns: [],
      tools: [
        {
          name: 'upsert_line',
          description: 'add something',
          parameters: { type: 'object', properties: {} },
        },
      ],
      locale: 'en',
    });

    expect(request['tools']).toEqual([
      {
        functionDeclarations: [
          {
            name: 'upsert_line',
            description: 'add something',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ]);
  });

  it('omits tools entirely when there are none', () => {
    const request = toGeminiRequest({
      system: 's',
      turns: [],
      tools: [],
      locale: 'en',
    });

    expect(request['tools']).toBeUndefined();
  });

  it('wraps a tool result in an object, because the API rejects a bare array', () => {
    const request = toGeminiRequest({
      system: 's',
      turns: [
        {
          role: ModelTurnRole.TOOL,
          toolResults: [{ name: 'query_lists', result: [1, 2, 3] }],
        },
      ],
      tools: [],
      locale: 'en',
    });

    expect(request['contents']).toEqual([
      {
        // Gemini has no separate tool role on the wire; the distinction is kept
        // above this line because the loop needs it and the wire does not.
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'query_lists',
              response: { result: [1, 2, 3] },
            },
          },
        ],
      },
    ]);
  });

  it('never emits a content with no parts', () => {
    // Reachable: a model turn that was only tool calls, replayed. The API
    // rejects an empty parts array outright.
    const request = toGeminiRequest({
      system: 's',
      turns: [{ role: ModelTurnRole.MODEL }],
      tools: [],
      locale: 'en',
    });

    expect(request['contents']).toEqual([
      { role: 'model', parts: [{ text: '' }] },
    ]);
  });
});

describe('readReply', () => {
  it('reads text and tool calls out of one candidate', () => {
    const reply = readReply({
      candidates: [
        {
          content: {
            parts: [
              { text: 'un momento' },
              {
                functionCall: { name: 'query_lists', args: { item: 'leche' } },
              },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 8,
        totalTokenCount: 128,
      },
    });

    expect(reply).toEqual({
      text: 'un momento',
      toolCalls: [{ name: 'query_lists', args: { item: 'leche' } }],
      usage: { promptTokens: 120, responseTokens: 8, totalTokens: 128 },
    });
  });

  it('treats a function call with no args as a call with empty args', () => {
    const reply = readReply({
      candidates: [
        { content: { parts: [{ functionCall: { name: 'query_lists' } }] } },
      ],
    });

    expect(reply.toolCalls).toEqual([{ name: 'query_lists', args: {} }]);
    expect(reply.usage).toBeNull();
  });

  it('answers empty rather than throwing on a payload with no candidates', () => {
    // A safety block or a filtered response arrives this way, and the loop's
    // answer to "no tool calls and no text" is already correct.
    expect(readReply({})).toEqual({ text: '', toolCalls: [], usage: null });
  });
});

describe('readRetryDelaySeconds', () => {
  // Rule A5's first and authoritative source: Google's own RetryInfo.
  it('reads a whole second delay out of the error payload', () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '27s',
          },
        ],
      },
    });

    expect(readRetryDelaySeconds(body)).toBe(27);
  });

  it('rounds a fractional delay up', () => {
    // Answering a second early spends the next slot and extends the outage,
    // which is the failure rule A5 exists to prevent.
    expect(readRetryDelaySeconds('{"retryDelay":"27.2s"}')).toBe(28);
  });

  it('returns undefined when the payload carries no hint, so the caller supplies one', () => {
    expect(readRetryDelaySeconds('{"error":{"code":429}}')).toBeUndefined();
  });
});
