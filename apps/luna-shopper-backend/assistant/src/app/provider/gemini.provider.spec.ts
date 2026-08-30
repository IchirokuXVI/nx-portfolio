import {
  readReply,
  readRetryDelaySeconds,
  readTranscription,
  toGeminiRequest,
  toTranscriptionRequest,
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

  it('puts a signed tool call back on the wire with its signature', () => {
    // The defect this whole seam exists for. Gemini 3 answers 400
    // INVALID_ARGUMENT to a replayed `functionCall` part whose thought signature
    // has gone missing, so a turn that called a tool used to fail on its second
    // round and reach the caller as a bare 500. Round tripping the token unread
    // is the fix, and this is the assertion that keeps it.
    const request = toGeminiRequest({
      system: 's',
      turns: [
        {
          role: ModelTurnRole.MODEL,
          toolCalls: [
            {
              name: 'upsert_line',
              args: { product: 'leche' },
              id: 'call_1',
              signature: 'opaque-token',
            },
          ],
        },
      ],
      tools: [],
      locale: 'en',
    });

    expect(request['contents']).toEqual([
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'call_1',
              name: 'upsert_line',
              args: { product: 'leche' },
            },
            thoughtSignature: 'opaque-token',
          },
        ],
      },
    ]);
  });

  it('leaves an unsigned call bare rather than inventing a signature', () => {
    // A reply that asks for two things signs the first call and leaves the second
    // without one. A bare part is accepted; a borrowed signature is not, so the
    // absence has to survive as an absence.
    const request = toGeminiRequest({
      system: 's',
      turns: [
        {
          role: ModelTurnRole.MODEL,
          toolCalls: [
            { name: 'upsert_line', args: {}, id: 'a', signature: 'signed' },
            { name: 'upsert_line', args: {}, id: 'b' },
          ],
        },
      ],
      tools: [],
      locale: 'en',
    });

    const parts = (
      request['contents'] as { parts: Record<string, unknown>[] }[]
    )[0].parts;

    expect(parts[0]['thoughtSignature']).toBe('signed');
    expect(parts[1]).not.toHaveProperty('thoughtSignature');
  });

  it('returns a result against the id of the call it answers', () => {
    // One turn can ask for the same tool twice ("add milk and bread"), and by the
    // time the results are a list of names there is nothing left to match on.
    const request = toGeminiRequest({
      system: 's',
      turns: [
        {
          role: ModelTurnRole.TOOL,
          toolResults: [
            { id: 'call_2', name: 'upsert_line', result: { ok: true } },
          ],
        },
      ],
      tools: [],
      locale: 'en',
    });

    expect(request['contents']).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_2',
              name: 'upsert_line',
              response: { result: { ok: true } },
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

  it('keeps the id and the thought signature the part arrived with', () => {
    // The signature belongs to the part rather than to the call inside it, and it
    // has to come back out of here or the next request cannot carry it.
    const reply = readReply({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: 'call_9',
                  name: 'upsert_line',
                  args: { product: 'pan' },
                },
                thoughtSignature: 'opaque-token',
              },
            ],
          },
        },
      ],
    });

    expect(reply.toolCalls).toEqual([
      {
        name: 'upsert_line',
        args: { product: 'pan' },
        id: 'call_9',
        signature: 'opaque-token',
      },
    ]);
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

/**
 * The transcription call's wire shape (plan 0041, section 3.1).
 *
 * Rule A4 again: no audio is sent anywhere here, and the bytes below are a
 * handful of numbers. What is checked is that the request carries no tools and no
 * history, because those two absences are the whole reason transcription is a
 * call of its own rather than the turn with a recording bolted on.
 */
describe('toTranscriptionRequest', () => {
  const audio = new Uint8Array([1, 2, 3, 4]);

  it('sends the audio inline, base64, under the type it was given', () => {
    const request = toTranscriptionRequest({
      audio,
      mimeType: 'audio/webm;codecs=opus',
      locale: 'es',
    });

    expect(request['contents']).toEqual([
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'audio/webm;codecs=opus',
              data: Buffer.from(audio).toString('base64'),
            },
          },
        ],
      },
    ]);
  });

  it('declares no tools and carries no conversation', () => {
    const request = toTranscriptionRequest({
      audio,
      mimeType: 'audio/webm',
      locale: 'en',
    });

    // An absent capability is a much harder boundary than an instruction, and a
    // transcription that called a tool would be a turn nobody asked for.
    expect(request['tools']).toBeUndefined();
    expect(request['contents']).toHaveLength(1);
  });

  it("names the caller's language in the instruction", () => {
    const request = toTranscriptionRequest({
      audio,
      mimeType: 'audio/webm',
      locale: 'es',
    });

    const instruction = (
      request['systemInstruction'] as { parts: { text: string }[] }
    ).parts[0].text;

    expect(instruction).toContain('es');
    expect(instruction).toContain('return only the transcription');
  });
});

describe('readTranscription', () => {
  it('joins the text parts and trims', () => {
    expect(
      readTranscription({
        candidates: [
          { content: { parts: [{ text: ' añade ' }, { text: 'leche ' }] } },
        ],
      })
    ).toBe('añade leche');
  });

  it('reads text and only text', () => {
    // A transcription that came back with a function call on it is a bug worth
    // noticing rather than a field to ignore, which is why this does not reuse
    // `readReply`.
    expect(
      readTranscription({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'upsert_line', args: {} } },
                { text: 'añade leche' },
              ],
            },
          },
        ],
      })
    ).toBe('añade leche');
  });

  it('reads a reply with nothing in it as an empty string', () => {
    // The honest failure, and the one the service answers "I did not catch
    // that" to rather than running a turn against nothing.
    expect(readTranscription({ candidates: [] })).toBe('');
    expect(readTranscription({})).toBe('');
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
