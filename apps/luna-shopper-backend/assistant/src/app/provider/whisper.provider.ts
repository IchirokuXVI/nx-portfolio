import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { AssistantConfig } from '../config/app-config';
import {
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type ModelProvider,
  type ModelReply,
  type Transcription,
  type TranscriptionRequest,
} from './model-provider';

/**
 * The deployment's own transcriber, over HTTP (plan 0235, section 7).
 *
 * A provider that only hears. It is the hearing half of the split the module
 * always binds, so no recording leaves the cluster: the transcriber is a pod
 * beside this one, with no route from outside, and it answers `{ text,
 * audioSeconds }` for a multipart upload.
 *
 * `configured` and `transcriptionSupported` are one fact, `TRANSCRIBER_URL` is
 * set, because the chart writes that value exactly when it runs the transcriber
 * (section 9). That is also what makes `hears` follow the same switch.
 *
 * Nothing about a recording is logged here, and neither is the body of an error:
 * it could echo nothing useful, and the rule is no audio near a log line (plan
 * 0041, section 6). An unexpected status is logged as a number.
 */
@Injectable()
export class WhisperProvider implements ModelProvider {
  private readonly logger = new Logger(WhisperProvider.name);
  private readonly config: AssistantConfig;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.config = configService.getOrThrow<AssistantConfig>('assistant');
  }

  get configured(): boolean {
    return this.config.transcriberUrl.length > 0;
  }

  get transcriptionSupported(): boolean {
    return this.configured;
  }

  /** Never reached: the split sends a turn to the text provider. */
  async generate(): Promise<ModelReply> {
    throw new ProviderUnavailableError('the transcriber does not answer turns');
  }

  /**
   * One upload, with the caller's patience on it.
   *
   * `X-Deadline-Ms` is this call's own timeout, so a clip still waiting in the
   * transcriber's queue when the caller gives up is dropped there and never
   * costs the next caller its turn of the worker (section 4).
   */
  async transcribe(request: TranscriptionRequest): Promise<Transcription> {
    const timeoutMs =
      request.purpose === 'comment'
        ? this.config.transcriberCommentTimeoutMs
        : this.config.transcriberTurnTimeoutMs;

    const form = new FormData();
    form.append(
      'audio',
      // A copy, because a Blob takes only a view over a plain ArrayBuffer and
      // the caller's bytes may sit in a pooled Buffer.
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
      'recording'
    );
    form.append('purpose', request.purpose);
    form.append('language', languageOf(request.locale));

    // One deadline over the whole exchange, the body included: the headers can
    // arrive in time and the body never end, and a read with no deadline would
    // hold the caller past its own timeout.
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), timeoutMs);
    const unavailable = (error: unknown, otherwise: string) =>
      new ProviderUnavailableError(
        abort.signal.aborted
          ? `the transcriber did not answer within ${timeoutMs}ms`
          : otherwise,
        { cause: error }
      );

    try {
      let response: Response;
      try {
        response = await fetch(`${this.config.transcriberUrl}/v1/transcribe`, {
          method: 'POST',
          signal: abort.signal,
          headers: { 'x-deadline-ms': String(timeoutMs) },
          body: form,
        });
      } catch (error) {
        throw unavailable(error, 'the transcriber could not be reached');
      }

      if (!response.ok) {
        throw await this.readError(response);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw unavailable(error, 'the transcriber answered no JSON');
      }
      return readTranscription(payload);
    } finally {
      clearTimeout(deadline);
    }
  }

  /**
   * A refusal, as the exception the service already answers.
   *
   * 400 and 413 are about the recording, so they are the caller's sentence. 503
   * is the queue being full, which is a rate limit with a number of seconds in
   * it (rule A5). Anything else, a 504 included, is the transcriber being
   * unavailable, which the comment path tries once more and a spoken turn answers
   * the way it answers any unavailable provider.
   */
  private async readError(response: Response): Promise<Error> {
    const body = await readJson(response);

    if (response.status === 400) {
      return new ValidationException('that recording could not be read');
    }
    if (response.status === 413) {
      const maxSeconds =
        typeof body['maxSeconds'] === 'number' ? body['maxSeconds'] : null;
      return maxSeconds === null
        ? new ValidationException(
            'that recording is longer than this service transcribes'
          )
        : new ValidationException(
            `that recording is longer than the ${maxSeconds} seconds this service transcribes`,
            { messageArgs: { limit: `${maxSeconds} s` } }
          );
    }
    if (response.status === 503) {
      const retry = body['retryAfterSeconds'];
      return new ProviderRateLimitedError(
        'the transcriber is busy',
        typeof retry === 'number' && retry > 0 ? Math.ceil(retry) : undefined
      );
    }

    this.logger.warn(`the transcriber responded ${response.status}`);
    return new ProviderUnavailableError(
      `the transcriber answered ${response.status}`
    );
  }
}

/**
 * The language the transcriber is told to expect: the first two letters of the
 * locale, which are the ISO 639-1 code whisper knows (`es-ES` is `es`). An empty
 * locale lets whisper detect it.
 */
export function languageOf(locale: string): string {
  const code = locale.trim().slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : 'auto';
}

/** The words and the length out of a 200, refusing a body that has neither. */
export function readTranscription(payload: unknown): Transcription {
  const body = (payload ?? {}) as Record<string, unknown>;
  if (typeof body['text'] !== 'string') {
    throw new ProviderUnavailableError('the transcriber answered no text');
  }
  return {
    text: body['text'].trim(),
    audioSeconds:
      typeof body['audioSeconds'] === 'number' ? body['audioSeconds'] : 0,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = (await response.json()) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
