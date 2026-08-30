import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { baseContentType } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { Request } from 'express';
// A default import, unlike the `import * as Joi` next door, because `@types/multer`
// is `export =` a callable and this workspace compiles with `esModuleInterop`.
import multer from 'multer';
import type { Observable } from 'rxjs';
import type { GatewayConfig } from '../config/app-config';

/** The form field the recording arrives on. */
export const VOICE_RECORDING_FIELD = 'recording';

/** What a parsed recording looks like once it is on the request. */
export interface VoiceRecording {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * The one multipart route in this backend (plan 0045, section 3; plan 0041,
 * section 4.1).
 *
 * ## Why it is written out rather than being `FileInterceptor`
 *
 * Nest's `FileInterceptor` is a mixin built at decoration time, so its `limits`
 * would have to be a literal or a `process.env` read at module load. The cap is
 * configuration, and configuration in this service is validated by Joi and read
 * through `ConfigService`; a second, unvalidated path to the same number is
 * exactly how the two come to disagree.
 *
 * The second reason is the message. `FileInterceptor` lets multer's
 * `LIMIT_FILE_SIZE` become a bare 413 reading "File too large", and plan 0041
 * section 5 is explicit that the refusal has to say the number: "That recording
 * was too long to send" is an answer and a 413 with an empty body is not.
 *
 * ## What it enforces, and why here
 *
 * **The byte cap**, on the stream, which is the only place it is a cap at all.
 * The global `ValidationPipe` never sees a file and Express's own body limits do
 * not apply to a multipart stream, so a check made after the upload has been
 * buffered has already paid for the thing it was refusing. Core checks the same
 * number again on the far side of the broker, and that is the second half of the
 * same rule rather than a duplication.
 *
 * **One file, on one field, and no others.** A request carrying two recordings,
 * or a file on a field nothing reads, is refused rather than silently having its
 * extra parts dropped.
 *
 * **The content type**, against the configured allowlist, refused with a sentence
 * naming what was sent and what is accepted. `audio/webm;codecs=opus` is
 * `audio/webm` here: matching the parameters would refuse every real recording,
 * and the codec inside the container is not something a header can prove anyway.
 *
 * Memory storage, deliberately: the bytes go straight onto the broker as base64
 * and there is no path in this backend that writes a file to a disk. A temp file
 * would be a new thing to clean up after every failure mode.
 */
@Injectable()
export class VoiceRecordingInterceptor implements NestInterceptor {
  private readonly voice: GatewayConfig['voiceComment'];
  private readonly upload: ReturnType<typeof multer>;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.voice =
      configService.getOrThrow<GatewayConfig>('gateway').voiceComment;
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: this.voice.maxBytes,
        files: 1,
        // A recording, a duration and nothing else. The cap is generous enough
        // for a client that sends a couple of extra hints and small enough that
        // a form with a thousand fields is refused rather than parsed.
        fields: 8,
      },
    });
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();

    await new Promise<void>((resolve, reject) => {
      this.upload.single(VOICE_RECORDING_FIELD)(
        request,
        response,
        (error: unknown) => {
          if (error) {
            reject(this.explain(error));
            return;
          }
          resolve();
        }
      );
    });

    const file = (request as { file?: VoiceRecording }).file;
    if (!file || file.size === 0) {
      throw new ValidationException(
        `Send the recording as a \`${VOICE_RECORDING_FIELD}\` part of a multipart/form-data body`
      );
    }

    const contentType = baseContentType(file.mimetype);
    if (!this.voice.contentTypes.includes(contentType)) {
      throw new ValidationException(
        `That recording is in a format this server cannot read (${contentType}). ` +
          `Accepted: ${this.voice.contentTypes.join(', ')}`
      );
    }

    return next.handle();
  }

  /**
   * Multer's own errors, said in words with the number in them.
   *
   * `LIMIT_FILE_SIZE` is the one that matters and the one plan 0041 section 5
   * names: somebody has just spoken for a minute and needs to know what to do
   * about it, which "File too large" does not tell them.
   */
  private explain(error: unknown): Error {
    const code = (error as { code?: string }).code;

    if (code === 'LIMIT_FILE_SIZE') {
      return new ValidationException(
        `That recording is too long to send. The limit is ${describeBytes(this.voice.maxBytes)}`
      );
    }
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
      return new ValidationException(
        `Send one recording, on a \`${VOICE_RECORDING_FIELD}\` part`
      );
    }
    if (error instanceof Error) {
      return new ValidationException(
        `That upload could not be read as multipart/form-data: ${error.message}`
      );
    }
    return new ValidationException(
      'That upload could not be read as multipart/form-data'
    );
  }
}

/**
 * A byte count as somebody would say it. Whole megabytes to one decimal, because
 * "2097152 bytes" is a number nobody can compare against the recording they just
 * made.
 */
function describeBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
