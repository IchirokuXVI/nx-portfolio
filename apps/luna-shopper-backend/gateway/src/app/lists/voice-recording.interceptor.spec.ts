import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { isDomainException } from '@portfolio/luna-shopper/platform';
import { Readable } from 'node:stream';
import { of } from 'rxjs';
import type { GatewayConfig } from '../config/app-config';
import {
  VOICE_RECORDING_FIELD,
  VoiceRecordingInterceptor,
} from './voice-recording.interceptor';

/**
 * The one multipart route in this backend (plan 0045, sections 6 and 9).
 *
 * The interceptor is driven against a real `multipart/form-data` body, built by
 * hand, because the thing under test is what `multer` does with a stream and a
 * limit: a fake that handed the interceptor an already parsed file would test
 * nothing but the two `if`s after it.
 *
 * **The byte cap is the assertion that matters.** The global `ValidationPipe`
 * never sees a file and Express's own body limits do not apply to a multipart
 * stream, so a cap that is not on the interceptor is a cap that is not enforced
 * (plan 0041, section 5).
 */

const MAX_BYTES = 4096;
const BOUNDARY = 'test-boundary-0045';

/** A multipart body with one file part, and optionally some fields beside it. */
function multipart(options: {
  field?: string;
  contentType?: string;
  bytes: number;
  extra?: Record<string, string>;
}): Buffer {
  const field = options.field ?? VOICE_RECORDING_FIELD;
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(options.extra ?? {})) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      )
    );
  }

  parts.push(
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="${field}"; filename="comment"\r\n` +
        `Content-Type: ${options.contentType ?? 'audio/webm;codecs=opus'}\r\n\r\n`
    ),
    Buffer.alloc(options.bytes, 7),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`)
  );

  return Buffer.concat(parts);
}

/**
 * A request the interceptor can read, and a response it can write nothing to.
 *
 * `multer` reads the body off the request as a stream, so this is a real readable
 * carrying the bytes rather than an object with a `body` property.
 */
function contextFor(body: Buffer): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request = Object.assign(new Readable(), {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(body.byteLength),
    },
  }) as Record<string, unknown> & { push(chunk: unknown): void };

  request['_read'] = () => {
    request.push(body);
    request.push(null);
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

function interceptor(): VoiceRecordingInterceptor {
  const config = {
    getOrThrow: (): GatewayConfig =>
      ({
        voiceComment: {
          maxBytes: MAX_BYTES,
          contentTypes: ['audio/webm', 'audio/ogg', 'audio/mp4'],
          transcribeTimeoutMs: 1000,
        },
      }) as GatewayConfig,
  } as unknown as ConfigService;

  return new VoiceRecordingInterceptor(config);
}

const passThrough: CallHandler = { handle: () => of(null) };

async function run(body: Buffer): Promise<Record<string, unknown>> {
  const { context, request } = contextFor(body);
  await interceptor().intercept(context, passThrough);
  return request;
}

describe('the voice upload interceptor', () => {
  it('parses a recording off the multipart body', async () => {
    const request = await run(multipart({ bytes: 512 }));

    const file = request['file'] as { buffer: Buffer; mimetype: string };
    expect(file.buffer.byteLength).toBe(512);
    // **`multer` drops the parameters**, so what reaches the route is the bare
    // container even though the browser sent `;codecs=opus`. That is pinned here
    // rather than left to be discovered, because two comments elsewhere used to
    // claim the negotiated string travelled on to the provider and it does not.
    //
    // It costs nothing: the codec inside a container is not something a header
    // could prove anyway, and every consumer downstream matches on the base type.
    expect(file.mimetype).toBe('audio/webm');
  });

  it('carries the fields beside the file through untouched', async () => {
    const request = await run(
      multipart({ bytes: 128, extra: { durationSeconds: '13' } })
    );

    // The DTO validates this afterwards; what matters here is that a file part on
    // the same body does not swallow the ordinary fields.
    expect((request['body'] as Record<string, string>)['durationSeconds']).toBe(
      '13'
    );
  });

  it('refuses a recording over the cap, and says the limit in words', async () => {
    const error = await run(multipart({ bytes: MAX_BYTES + 1 })).catch(
      (thrown: unknown) => thrown
    );

    // "That recording was too long to send" is an answer; a 413 with an empty
    // body is not (plan 0041, section 5).
    expect(isDomainException(error)).toBe(true);
    expect((error as Error).message).toMatch(/too long to send/);
    expect((error as Error).message).toMatch(/4 KB/);
  });

  it('accepts a recording exactly at the cap', async () => {
    // The boundary itself, because an off by one here is a message somebody
    // recorded and cannot send for no reason they can see.
    const request = await run(multipart({ bytes: MAX_BYTES }));

    expect((request['file'] as { buffer: Buffer }).buffer.byteLength).toBe(
      MAX_BYTES
    );
  });

  it('refuses a format it cannot read, with a sentence naming both sides', async () => {
    const error = await run(
      multipart({ bytes: 256, contentType: 'video/mp4' })
    ).catch((thrown: unknown) => thrown);

    expect(isDomainException(error)).toBe(true);
    expect((error as Error).message).toMatch(/video\/mp4/);
    expect((error as Error).message).toMatch(/audio\/webm/);
  });

  it('accepts every container a browser actually records in', async () => {
    // Chrome gives WebM/Opus and will not negotiate Ogg, Firefox gives Ogg/Opus,
    // Safari gives MP4/AAC. Losing any one of the three loses a whole browser.
    for (const type of [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ]) {
      const request = await run(multipart({ bytes: 64, contentType: type }));
      expect(request['file']).toBeDefined();
    }
  });

  it('says where the recording goes when the part is on another field', async () => {
    const error = await run(multipart({ bytes: 128, field: 'audio' })).catch(
      (thrown: unknown) => thrown
    );

    expect(isDomainException(error)).toBe(true);
    expect((error as Error).message).toMatch(/recording/);
  });
});
