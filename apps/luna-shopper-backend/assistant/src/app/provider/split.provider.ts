import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
  Transcription,
  TranscriptionRequest,
} from './model-provider';

/**
 * A provider that answers with one model and hears with another (plan 0224,
 * section 3; plan 0235, section 7).
 *
 * Every deployment is one of these since plan 0235. The text provider (Gemini
 * or Claude) answers, and the hearing is the self hosted transcriber
 * (`WhisperProvider`) or, where none runs, `NoHearing`. No audio goes to a model
 * provider any more, and `AssistantService` needs no change to know that two
 * providers exist: it keeps reading one object.
 *
 * Nothing here but delegation. The two flags come from the provider that does
 * each job, so a deployment with a text key and no transcriber has an assistant
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

  transcribe(request: TranscriptionRequest): Promise<Transcription> {
    return this.hearing.transcribe(request);
  }
}
