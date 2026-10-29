import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { AssistantConfig } from '../config/app-config';
import {
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type TranscriptionRequest,
} from './model-provider';
import { languageOf, WhisperProvider } from './whisper.provider';

/**
 * The assistant's half of the transcriber's contract (plan 0235, sections 3, 6.2
 * and 7), against a stubbed `fetch`. No byte goes anywhere (rule A4): the
 * transcriber's own tests run against a fake model in its image build.
 */

const URL_BASE = 'http://transcriber.invalid:3007';

function provider(
  transcriberUrl = URL_BASE,
  turnTimeoutMs = 45000
): WhisperProvider {
  const config = {
    transcriberUrl,
    transcriberTurnTimeoutMs: turnTimeoutMs,
    transcriberCommentTimeoutMs: 110000,
  } as AssistantConfig;
  return new WhisperProvider({
    getOrThrow: () => config,
  } as unknown as ConfigService);
}

const RECORDING: TranscriptionRequest = {
  audio: new Uint8Array([1, 2, 3, 4]),
  mimeType: 'audio/webm;codecs=opus',
  locale: 'es-ES',
  purpose: 'turn',
};

interface Sent {
  url: string;
  init: RequestInit;
}

function stubFetch(answer: (init: RequestInit) => Promise<Response>): Sent[] {
  const sent: Sent[] = [];
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url: string | URL | Request, init) => {
      sent.push({ url: String(url), init: init ?? {} });
      return answer(init ?? {});
    });
  return sent;
}

/**
 * Headers in time and a body that never ends, as a stalled transcriber sends
 * it. The stream errors when the request's signal aborts, which is what
 * `fetch` does to a body still being read.
 */
function endless(status: number, init: RequestInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"text":'));
      init.signal?.addEventListener('abort', () =>
        controller.error(new DOMException('aborted', 'AbortError'))
      );
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => jest.restoreAllMocks());

describe('WhisperProvider', () => {
  it('hears exactly when TRANSCRIBER_URL is set', () => {
    expect(provider().configured).toBe(true);
    expect(provider().transcriptionSupported).toBe(true);
    expect(provider('').configured).toBe(false);
    expect(provider('').transcriptionSupported).toBe(false);
  });

  it('posts the recording, the purpose and the language as multipart', async () => {
    const sent = stubFetch(async () =>
      json(200, { text: ' añade leche ', audioSeconds: 2.4, model: 'small' })
    );

    const heard = await provider().transcribe(RECORDING);

    expect(heard).toEqual({ text: 'añade leche', audioSeconds: 2.4 });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${URL_BASE}/v1/transcribe`);
    expect(sent[0].init.method).toBe('POST');
    const form = sent[0].init.body as FormData;
    expect(form.get('purpose')).toBe('turn');
    expect(form.get('language')).toBe('es');
    const audio = form.get('audio') as Blob;
    expect(audio.type).toBe('audio/webm;codecs=opus');
    expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("sends each purpose's own timeout as the deadline", async () => {
    const sent = stubFetch(async () =>
      json(200, { text: 'hola', audioSeconds: 1 })
    );

    await provider().transcribe(RECORDING);
    await provider().transcribe({ ...RECORDING, purpose: 'comment' });

    const deadline = (entry: Sent) =>
      (entry.init.headers as Record<string, string>)['x-deadline-ms'];
    expect(deadline(sent[0])).toBe('45000');
    expect(deadline(sent[1])).toBe('110000');
    expect((sent[1].init.body as FormData).get('purpose')).toBe('comment');
  });

  it('answers an empty transcript as a real answer', async () => {
    stubFetch(async () => json(200, { text: '', audioSeconds: 3 }));

    await expect(provider().transcribe(RECORDING)).resolves.toEqual({
      text: '',
      audioSeconds: 3,
    });
  });

  it('maps an unreadable recording to a validation error', async () => {
    stubFetch(async () => json(400, { code: 'unreadable' }));

    await expect(provider().transcribe(RECORDING)).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('maps a recording that is too long to a validation error with the limit', async () => {
    stubFetch(async () => json(413, { code: 'too_long', maxSeconds: 300 }));

    const error = await provider()
      .transcribe(RECORDING)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ValidationException);
    expect((error as Error).message).toContain('300 seconds');
  });

  it('maps a full queue to a rate limit with its seconds (rule A5)', async () => {
    stubFetch(async () => json(503, { code: 'busy', retryAfterSeconds: 10 }));

    const error = await provider()
      .transcribe(RECORDING)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ProviderRateLimitedError);
    expect((error as ProviderRateLimitedError).retryAfterSeconds).toBe(10);
  });

  it.each([504, 500, 502])(
    'maps %i to an unavailable transcriber',
    async (status) => {
      stubFetch(async () => json(status, { code: 'expired' }));

      await expect(provider().transcribe(RECORDING)).rejects.toBeInstanceOf(
        ProviderUnavailableError
      );
    }
  );

  it('maps a socket error to an unavailable transcriber', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(provider().transcribe(RECORDING)).rejects.toThrow(
      'the transcriber could not be reached'
    );
  });

  it('aborts a body that never ends at the deadline', async () => {
    stubFetch(async (init) => endless(200, init));

    const error = await provider(URL_BASE, 50)
      .transcribe(RECORDING)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).message).toBe(
      'the transcriber did not answer within 50ms'
    );
  });

  it('aborts an error body that never ends, and still maps the status', async () => {
    stubFetch(async (init) => endless(503, init));

    await expect(
      provider(URL_BASE, 50).transcribe(RECORDING)
    ).rejects.toBeInstanceOf(ProviderRateLimitedError);
  });

  it('refuses a 200 that carries no text', async () => {
    stubFetch(async () => json(200, { audioSeconds: 1 }));

    await expect(provider().transcribe(RECORDING)).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
  });

  it('never logs the body of an error', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    stubFetch(async () => json(500, { detail: 'añade leche y pan' }));

    await provider()
      .transcribe(RECORDING)
      .catch(() => undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('leche');
  });
});

describe('languageOf', () => {
  it('sends the two letter code of the locale', () => {
    expect(languageOf('es')).toBe('es');
    expect(languageOf('en-GB')).toBe('en');
    expect(languageOf('ES-es')).toBe('es');
  });

  it('lets whisper detect the language when the locale says nothing', () => {
    expect(languageOf('')).toBe('auto');
    expect(languageOf('*')).toBe('auto');
  });
});
