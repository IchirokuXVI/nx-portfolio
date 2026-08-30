import type {
  ModelProvider,
  ModelReply,
  ModelRequest,
  TranscriptionRequest,
} from './model-provider';

/**
 * The provider the suite runs against (rule A4).
 *
 * It exists so that everything above {@link ModelProvider} — the turn loop, the
 * three tools, list resolution, references, the limiters, the error mapping — is
 * tested exhaustively and offline, while the one thing that genuinely needs a
 * network is a single class with no logic in it.
 *
 * Scripted rather than clever: hand it the replies you want in order, and it
 * hands them back one per call, recording what it was asked. A test that runs out
 * of scripted replies fails loudly, because silently repeating the last one turns
 * a loop bug into a passing test.
 */
export class FakeModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  configured = true;
  transcriptionSupported = true;

  /**
   * What {@link transcribe} was asked, so a test can assert the mime type and
   * locale reached the provider without ever producing a byte of real audio
   * (rule A4).
   */
  readonly transcriptions: TranscriptionRequest[] = [];

  private readonly replies: (ModelReply | Error)[];
  private readonly heard: (string | Error)[] = [];

  constructor(replies: (ModelReply | Error)[] = []) {
    this.replies = [...replies];
  }

  /**
   * Script what the next transcription answers, or throws.
   *
   * A separate queue from the reply script rather than sharing one, because the
   * two calls happen at different moments for different reasons and a test that
   * had to interleave them would be asserting the order of the implementation
   * rather than of the feature.
   */
  willHear(...results: (string | Error)[]): this {
    this.heard.push(...results);
    return this;
  }

  async transcribe(request: TranscriptionRequest): Promise<string> {
    this.transcriptions.push(request);
    const next = this.heard.shift();
    if (next === undefined) {
      // Silence rather than a throw, unlike `generate` below. A provider that
      // heard nothing is a real answer this feature has to handle, and it is the
      // one a test that scripted nothing most likely means.
      return '';
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }

  /** A reply that is only text: what an off topic redirect or an answer looks like. */
  static says(text: string): ModelReply {
    return { text, toolCalls: [], usage: null };
  }

  /**
   * A reply that asks for one tool and says nothing yet.
   *
   * `handles` is what a real provider attaches to the call and expects back on
   * the next request: an id, and an opaque continuity token. They are optional
   * here because most tests do not care, and they exist because one test very
   * much does — the loop has to replay them unread, and a fake that could not
   * carry them could not prove it.
   */
  static calls(
    name: string,
    args: Record<string, unknown>,
    handles: { id?: string; signature?: string } = {}
  ): ModelReply {
    return { text: '', toolCalls: [{ name, args, ...handles }], usage: null };
  }

  async generate(request: ModelRequest): Promise<ModelReply> {
    this.requests.push(request);
    const next = this.replies.shift();
    if (next === undefined) {
      throw new Error(
        `FakeModelProvider ran out of scripted replies (call ${this.requests.length})`
      );
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
