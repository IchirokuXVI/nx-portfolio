import {
  ProviderUnavailableError,
  type ModelProvider,
  type ModelReply,
  type Transcription,
} from './model-provider';

/**
 * The hearing of a deployment that runs no transcriber (plan 0235, section 7).
 *
 * Both flags are false, so the split reports `transcriptionSupported` false and
 * a deployment without `TRANSCRIBER_URL` reads as "voice is off", never as
 * "voice is broken": the voice route answers 501 `not_configured`, a voice
 * comment settles `UNAVAILABLE` at once, and `hears` is false in the
 * capabilities the privacy policy is written from (plan 0231, section 3).
 *
 * Neither method is reached, because both callers read the flags first. They
 * throw rather than answer, because an empty transcript means "the recording
 * had nothing in it", which would be a lie here.
 */
export class NoHearing implements ModelProvider {
  readonly configured = false;
  readonly transcriptionSupported = false;

  async generate(): Promise<ModelReply> {
    throw new ProviderUnavailableError('this provider answers nothing');
  }

  async transcribe(): Promise<Transcription> {
    throw new ProviderUnavailableError('this deployment runs no transcriber');
  }
}
