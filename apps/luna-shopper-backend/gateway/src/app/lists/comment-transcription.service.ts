import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ASSISTANT_PATTERNS,
  COMMENT_PATTERNS,
  CommentTranscription,
  type AssistantTranscribeResponse,
  type CommentView,
} from '@portfolio/luna-shopper/contracts';
import {
  DEFAULT_LOCALE,
  ERROR_CODES,
  getRequestContext,
} from '@portfolio/luna-shopper/platform';
import type { GatewayConfig } from '../config/app-config';
import { NatsClient } from '../messaging/nats-client';

/**
 * How many times a transcription is attempted before the comment settles as
 * untranscribed.
 *
 * Two, and the plan says why in one sentence: a transcription that failed twice
 * is not going to be worth the machinery. There is no retry queue and no
 * background sweep, because the message is intact without a transcript and the
 * only thing a queue would buy is a second system to operate.
 */
const ATTEMPTS = 2;

/**
 * How long the second attempt waits. One short pause, not a backoff curve.
 *
 * Exported so the spec waits on this number instead of a literal of its own: a
 * test that hard codes the pause passes for the wrong reason the moment somebody
 * tunes it, and fails for a reason that looks like a product bug.
 */
export const RETRY_DELAY_MS = 1500;

/**
 * The gateway's half of "store first, transcribe after" (plan 0045, section 4.1).
 *
 * **The gateway orchestrates** because it already talks to both core and the
 * assistant and is the only thing that talks to both. Core does not gain a model
 * provider and must not: core is the database and the rules, and a dependency
 * from core on the assistant would make the list service unbootable without a
 * credential it has no other use for.
 *
 * ## It runs after the response
 *
 * The caller already has their comment. Nothing here is awaited by a request, and
 * that is the point of section 4's ordering rather than an optimisation: the
 * upload is already seconds of mobile data, and putting a provider round trip in
 * front of the response doubles a wait somebody is watching. When the transcript
 * lands, core emits `comment.updated` to the line's room and the open thread
 * fills in without a refresh.
 *
 * ## Nothing here can lose a message
 *
 * Every path ends in one `comment.setTranscription` call, including the paths
 * where the provider was never asked. A comment that stayed `PENDING` because
 * this service crashed between the two calls is the one bad state, and it is why
 * `UNAVAILABLE` is decided **before** the provider is called rather than inferred
 * from a failure: a deployment with no key settles every voice comment in the
 * same tick it was created.
 */
@Injectable()
export class CommentTranscriptionService {
  private readonly logger = new Logger(CommentTranscriptionService.name);
  private readonly voice: GatewayConfig['voiceComment'];

  constructor(
    private readonly nats: NatsClient,
    @Inject(ConfigService) configService: ConfigService
  ) {
    this.voice =
      configService.getOrThrow<GatewayConfig>('gateway').voiceComment;
  }

  /**
   * Transcribe a comment that has just been stored, and hand the result back.
   *
   * Deliberately returns nothing and never throws: it is started and not awaited,
   * so a rejection here would be an unhandled promise rejection rather than an
   * error anybody sees. Everything it could report is either on the comment
   * afterwards or in one log line.
   */
  schedule(comment: CommentView, audio: Buffer, mimeType: string): void {
    // The locale is read here, while the request's async context is still live,
    // and carried as a plain string from then on. Reading it inside the
    // background work would find no context at all.
    const locale = getRequestContext()?.locale ?? DEFAULT_LOCALE;

    void this.run(comment, audio, mimeType, locale).catch((error: unknown) => {
      // The last resort. Reaching here means even `setTranscription` failed, so
      // the comment is left PENDING; it still plays, which is the property the
      // whole plan protects.
      this.logger.warn(
        `voice comment ${comment.id} could not be settled: ${describe(error)}`
      );
    });
  }

  private async run(
    comment: CommentView,
    audio: Buffer,
    mimeType: string,
    locale: string
  ): Promise<void> {
    const outcome = await this.transcribe(audio, mimeType, locale);

    await this.nats.send<CommentView>(COMMENT_PATTERNS.setTranscription, {
      userId: comment.authorUserId,
      commentId: comment.id,
      body: outcome.text,
      transcription: outcome.state,
    });
  }

  /**
   * The provider round trip, with the four outcomes plan 0045 section 4.2 lists
   * collapsed into the two things core stores.
   *
   * A rate limit or a brief outage is worth one more attempt; a deployment that
   * cannot transcribe at all is not, and `not_configured` is exactly that answer.
   * Nothing distinguishes "the provider returned nothing" from "it succeeded with
   * an empty string", because they are the same fact.
   */
  private async transcribe(
    audio: Buffer,
    mimeType: string,
    locale: string
  ): Promise<{ state: CommentTranscription; text: string }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const answer = await withTimeout(
          this.nats.send<AssistantTranscribeResponse>(
            ASSISTANT_PATTERNS.transcribe,
            {
              audio: audio.toString('base64'),
              mimeType,
              // The locale the caller's request carried. It is a field as well as
              // a NATS header because the assistant reads this one first: by the
              // time this runs the request that carried the header is answered.
              locale,
            }
          ),
          this.voice.transcribeTimeoutMs
        );

        const text = (answer?.text ?? '').trim();
        return text.length > 0
          ? { state: CommentTranscription.READY, text }
          : { state: CommentTranscription.FAILED, text: '' };
      } catch (error) {
        lastError = error;

        // The deployment has no provider, or the provider cannot take audio. No
        // number of retries changes that, and telling the client to wait for a
        // transcript that will never come is the state `UNAVAILABLE` exists for.
        if (isNotConfigured(error)) {
          return { state: CommentTranscription.UNAVAILABLE, text: '' };
        }

        if (attempt < ATTEMPTS) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    // Logged rather than surfaced, and without the recording or anything about
    // it: plan 0041 section 6 keeps audio out of the logs at every level, and the
    // caller has nothing to do with this information anyway.
    this.logger.warn(`transcription gave up: ${describe(lastError)}`);
    return { state: CommentTranscription.FAILED, text: '' };
  }
}

/**
 * Is this the assistant saying this deployment cannot transcribe at all?
 *
 * Both shapes are checked because NATS nests a service's error envelope under
 * `error` and the client sometimes rejects with the envelope itself; the global
 * filter reads both for the same reason.
 */
function isNotConfigured(error: unknown): boolean {
  const candidates = [error, (error as { error?: unknown })?.error];
  return candidates.some(
    (candidate) =>
      (candidate as { code?: unknown })?.code === ERROR_CODES.NOT_CONFIGURED
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A deadline of the gateway's own, because nobody is waiting on this and a hung
 * provider must not hold a task open behind a request that was already answered.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no transcript within ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** An error as one short line, with nothing from the request in it. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string') {
    return code;
  }
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' ? message : 'unknown error';
}
