import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
  TranscriptionRequest,
} from './model-provider';

/**
 * A provider that answers with one model and hears with another (plan 0224,
 * section 3).
 *
 * It exists because Claude takes no audio. A deployment that answers with Claude
 * still transcribes a spoken turn and a voice comment with Gemini, and
 * `AssistantService` needs no change to know that two providers exist: it keeps
 * reading one object.
 *
 * Nothing here but delegation. The two flags come from the provider that does
 * each job, so a deployment with a Claude key and no Gemini key has an assistant
 * and no microphone: the voice route answers 501, the typed route works, and a
 * voice comment settles `UNAVAILABLE` at once (plan 0045, section 4.2).
 */
export class SplitModelProvider implements ModelProvider {
  constructor(
    private readonly turns: ModelProvider,
    private readonly hearing: ModelProvider
  ) {}

  get configured(): boolean {
    return this.turns.configured;
  }

  get transcriptionSupported(): boolean {
    return this.hearing.configured && this.hearing.transcriptionSupported;
  }

  generate(request: ModelRequest): Promise<ModelReply> {
    return this.turns.generate(request);
  }

  transcribe(request: TranscriptionRequest): Promise<string> {
    return this.hearing.transcribe(request);
  }
}
