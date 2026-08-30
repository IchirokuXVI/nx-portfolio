import type { ConfigService } from '@nestjs/config';
import {
  ASSISTANT_PATTERNS,
  COMMENT_PATTERNS,
  CommentTranscription,
  type CommentView,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';
import type { NatsClient } from '../messaging/nats-client';
import {
  CommentTranscriptionService,
  RETRY_DELAY_MS,
} from './comment-transcription.service';

/**
 * Store first, transcribe after (plan 0045, sections 4 and 9).
 *
 * The order is the whole feature, so this file drives the orchestration directly
 * rather than through a route: what matters is which calls happen, in what order,
 * and what the comment settles as when the provider is unavailable.
 *
 * **No test here sends a byte of audio to a provider** (rule A4). The assistant is
 * a scripted double on the broker, and the audio is a small buffer nobody decodes.
 */

const AUDIO = Buffer.from('not really audio');

const COMMENT: CommentView = {
  id: 'c-voice',
  lineId: 'li1',
  authorUserId: 'u1',
  body: '',
  recording: {
    contentType: 'audio/webm',
    byteLength: AUDIO.byteLength,
    durationSeconds: 4,
  },
  transcription: CommentTranscription.PENDING,
  createdAt: '2026-08-30T00:00:00.000Z',
};

interface Sent {
  subject: string;
  payload: Record<string, unknown>;
}

/**
 * A broker that records what it was asked and answers from a script.
 *
 * `transcribe` is keyed by subject rather than by call order, because the retry
 * means the number of calls is what several of these tests are about.
 */
function broker(options: {
  transcribe?: (attempt: number) => Promise<{ text: string }>;
  setTranscription?: () => Promise<CommentView>;
}) {
  const sent: Sent[] = [];
  let attempts = 0;

  const nats = {
    send: async <T>(
      subject: string,
      payload: Record<string, unknown>
    ): Promise<T> => {
      sent.push({ subject, payload });

      if (subject === ASSISTANT_PATTERNS.transcribe) {
        attempts += 1;
        const answer = options.transcribe ?? (async () => ({ text: '' }));
        return (await answer(attempts)) as T;
      }

      if (subject === COMMENT_PATTERNS.setTranscription) {
        const answer = options.setTranscription ?? (async () => COMMENT);
        return (await answer()) as T;
      }

      throw new Error(`unexpected subject ${subject}`);
    },
  } as unknown as NatsClient;

  const config = {
    getOrThrow: (): GatewayConfig =>
      ({
        voiceComment: {
          maxBytes: 2 * 1024 * 1024,
          contentTypes: ['audio/webm'],
          // Short, so a test that means to hit the deadline does not wait on it.
          transcribeTimeoutMs: 50,
        },
      }) as GatewayConfig,
  } as unknown as ConfigService;

  return {
    sent,
    service: new CommentTranscriptionService(nats, config),
    /** Every call the service made, in order, by subject. */
    subjects: () => sent.map((entry) => entry.subject),
    /** What `setTranscription` was told, which is the outcome under test. */
    settled: () =>
      sent.find((entry) => entry.subject === COMMENT_PATTERNS.setTranscription)
        ?.payload,
  };
}

/**
 * Let the scheduled work run to completion.
 *
 * `schedule` deliberately returns nothing and is never awaited by a request, so
 * the queue is drained explicitly rather than by guessing at microtasks.
 *
 * The default is short, for the paths that do not retry. `settle({ retried: true })`
 * waits out the real pause, derived from the service's own constant so tuning it
 * cannot leave this file asserting against a number nobody uses any more.
 */
function settle(options: { retried?: boolean } = {}): Promise<void> {
  const ms = options.retried === true ? RETRY_DELAY_MS + 250 : 250;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A rejection shaped like a service's error envelope crossing the broker. */
function remoteError(code: string): unknown {
  return { error: { code, status: 501, message: 'no', correlationId: 'x' } };
}

describe('a transcript is asked for after the comment is stored', () => {
  it('sends the recording, its type and the locale to the assistant', async () => {
    const b = broker({
      transcribe: async () => ({ text: 'Bring the big one' }),
    });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm;codecs=opus');
    await settle();

    const asked = b.sent.find(
      (entry) => entry.subject === ASSISTANT_PATTERNS.transcribe
    );
    expect(asked?.payload['mimeType']).toBe('audio/webm;codecs=opus');
    expect(
      Buffer.from(asked?.payload['audio'] as string, 'base64').toString()
    ).toBe('not really audio');
  });

  it('hands a successful transcript back to core as READY', async () => {
    const b = broker({
      transcribe: async () => ({ text: 'Bring the big one' }),
    });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm');
    await settle();

    expect(b.subjects()).toEqual([
      ASSISTANT_PATTERNS.transcribe,
      COMMENT_PATTERNS.setTranscription,
    ]);
    expect(b.settled()).toMatchObject({
      commentId: 'c-voice',
      userId: 'u1',
      body: 'Bring the big one',
      transcription: CommentTranscription.READY,
    });
  });

  it('records FAILED when the provider heard nothing', async () => {
    const b = broker({ transcribe: async () => ({ text: '' }) });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm');
    await settle();

    // The message is intact and plays; only the reading of it is missing.
    expect(b.settled()).toMatchObject({
      body: '',
      transcription: CommentTranscription.FAILED,
    });
  });

  it('tries twice for a transient failure, then gives up', async () => {
    const b = broker({
      transcribe: async () => {
        throw new Error('the provider is briefly unavailable');
      },
    });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm');
    await settle({ retried: true });

    // A small bounded retry and no queue: a transcription that failed twice is not
    // going to be worth the machinery, and the message is intact without it.
    expect(
      b.subjects().filter((s) => s === ASSISTANT_PATTERNS.transcribe)
    ).toHaveLength(2);
    expect(b.settled()).toMatchObject({
      transcription: CommentTranscription.FAILED,
    });
  });

  it('keeps a transcript that arrives on the second attempt', async () => {
    const b = broker({
      transcribe: async (attempt) => {
        if (attempt === 1) {
          throw new Error('rate limited');
        }
        return { text: 'the sourdough one' };
      },
    });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm');
    await settle({ retried: true });

    expect(b.settled()).toMatchObject({
      body: 'the sourdough one',
      transcription: CommentTranscription.READY,
    });
  });

  it('settles as UNAVAILABLE with no retry where nothing can transcribe', async () => {
    const b = broker({
      transcribe: async () => {
        throw remoteError(ERROR_CODES.NOT_CONFIGURED);
      },
    });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm');
    await settle();

    // No number of retries changes a deployment with no key, and telling the
    // client to wait for a transcript that will never come is exactly the state
    // UNAVAILABLE exists for.
    expect(
      b.subjects().filter((s) => s === ASSISTANT_PATTERNS.transcribe)
    ).toHaveLength(1);
    expect(b.settled()).toMatchObject({
      transcription: CommentTranscription.UNAVAILABLE,
    });
  });

  it('always settles the comment, whatever happened', async () => {
    // The one bad state is a comment left PENDING forever, so every path has to
    // end in a `setTranscription`. This is the case with no provider at all.
    const b = broker({
      transcribe: async () => {
        throw remoteError(ERROR_CODES.NOT_CONFIGURED);
      },
    });

    b.service.schedule(COMMENT, AUDIO, 'audio/webm');
    await settle();

    expect(b.subjects()).toContain(COMMENT_PATTERNS.setTranscription);
  });

  it('never throws at the caller, because nobody is awaiting it', async () => {
    // Even `setTranscription` failing must not become an unhandled rejection: the
    // caller already has their comment and this runs behind an answered request.
    const b = broker({
      transcribe: async () => ({ text: 'words' }),
      setTranscription: async () => {
        throw new Error('core is down');
      },
    });

    expect(() =>
      b.service.schedule(COMMENT, AUDIO, 'audio/webm')
    ).not.toThrow();
    await settle();
  });
});
