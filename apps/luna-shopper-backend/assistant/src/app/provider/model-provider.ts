/**
 * The seam between the assistant and whichever model answers it (plan 0039,
 * section 9).
 *
 * It exists for **rule A4**: no test in this repository may reach a model
 * provider. Everything above this interface is exercised against
 * {@link FakeModelProvider} with no network, which is the only way the suite
 * stays worth running — a test that depends on a rate limited free tier is a test
 * that gets deleted the first week it is flaky.
 *
 * The shape here is deliberately close to what a tool calling chat API actually
 * exchanges (a conversation of typed parts, a catalog of function declarations,
 * a reply that is either text or a request to call something), rather than an
 * abstraction over "an assistant". Swapping Gemini for another provider is a new
 * implementation of this file's interface and nothing else.
 */

/** The injection token, so nothing above this layer names a concrete provider. */
export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');

/** A JSON Schema fragment describing one tool's arguments. Hand written. */
export type ToolParameterSchema = Record<string, unknown>;

export interface ModelToolDeclaration {
  name: string;
  /** What the tool does, in the words the model reads to decide to call it. */
  description: string;
  parameters: ToolParameterSchema;
}

/** One thing the model asked to have done. */
export interface ModelToolCall {
  name: string;
  args: Record<string, unknown>;
  /**
   * The provider's own handle for this call, when it gave one.
   *
   * Carried so that the result of a call can be returned against the call it
   * answers rather than against a name. One turn can ask for the same tool twice
   * ("is there milk, and is there bread on the office list" is two `query_lists`
   * calls), and matching those by name is a coin toss the moment their results
   * differ.
   */
  id?: string;
  /**
   * An opaque token the provider attached to this call and expects to receive
   * back, unread and unchanged, when the call's result is fed in.
   *
   * It is deliberately untyped beyond `string` and this layer never looks inside
   * one. Gemini calls it a thought signature and **rejects the next request with
   * a 400 when a replayed function call arrives without it**, which is what made
   * every turn that actually did something answer 500; another provider may call
   * it something else or nothing at all, which is why it is optional and why the
   * name here describes the job rather than the vendor.
   *
   * Not every call in a turn carries one: with several calls in one reply Gemini
   * signs the first and leaves the rest bare. So this round trips **per call, as
   * it arrived** — never invented, never copied from a sibling.
   */
  signature?: string;
}

/**
 * One entry of the conversation the provider is handed.
 *
 * `TOOL` is the result of a call the model made, fed back so it can answer with
 * it. It is not something a caller can ever put there: the transcript that
 * arrives from the client only carries user and assistant text (rule A2).
 */
export enum ModelTurnRole {
  USER = 'USER',
  MODEL = 'MODEL',
  TOOL = 'TOOL',
}

export interface ModelTurn {
  role: ModelTurnRole;
  /** Present for USER and MODEL turns. */
  text?: string;
  /** Present on a MODEL turn that asked for tools. */
  toolCalls?: ModelToolCall[];
  /** Present on a TOOL turn: what each call returned, in call order. */
  toolResults?: { id?: string; name: string; result: unknown }[];
}

export interface ModelRequest {
  /**
   * The operator prompt. It is separate from the conversation rather than
   * prepended to it, because the two have different trust: this is ours, and
   * everything in `turns` came from a person or from a tool we ran.
   */
  system: string;
  turns: ModelTurn[];
  tools: ModelToolDeclaration[];
  /** BCP 47, from `Accept-Language` (section 7). The reply is in this language. */
  locale: string;
}

/** What the provider reports it spent, when it reports anything (section 10). */
export interface ModelUsage {
  promptTokens: number | null;
  responseTokens: number | null;
  totalTokens: number | null;
}

export interface ModelReply {
  /** Free form text. Empty when the model only asked for tools. */
  text: string;
  toolCalls: ModelToolCall[];
  usage: ModelUsage | null;
}

/**
 * The provider said no, for a reason that is about quota rather than about the
 * request.
 *
 * `retryAfterSeconds` is optional here and mandatory by the time it reaches the
 * client (rule A5): the service fills in a number when the provider gave none,
 * so nothing downstream ever has to parse prose to find one.
 */
export class ProviderRateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ProviderRateLimitedError';
  }
}

/** The provider failed for any other reason: a timeout, a 5xx, a bad payload. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ProviderUnavailableError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * A recording, on its way to being words (plan 0041, section 3.2).
 *
 * Separate from {@link ModelRequest} rather than an audio part on a
 * {@link ModelTurn}, because it is a different job: no tools, no history, and no
 * reply to parse. What comes back is the sentence and nothing else, and there is
 * nothing to carry about who spoke or what list they were looking at — that
 * absence is the contract rather than an omission.
 *
 * **Two callers, one seam.** A spoken assistant turn transcribes before running
 * the turn loop (plan 0041); a voice comment transcribes after the message is
 * already stored (plan 0045, section 4.1). Neither knows about the other, and
 * nothing here distinguishes them.
 */
export interface TranscriptionRequest {
  audio: Uint8Array;
  /** What the browser recorded, checked against the service's whitelist first. */
  mimeType: string;
  /** BCP 47, the same locale the reply will be written in (section 2). */
  locale: string;
}

export interface ModelProvider {
  /**
   * False when the deployment has no key. The service answers 501 rather than
   * pretending, and the pod still boots (plan 0026, applied in section 11).
   */
  readonly configured: boolean;

  /**
   * False when this provider cannot take audio at all (plan 0041, section 3.2).
   *
   * A **field rather than a thrown error**, because "this deployment will never
   * transcribe anything" and "this transcription failed" are different facts
   * with different answers, and both callers need to tell them apart:
   *
   * - a deployment pointed at a provider that does not do audio should lose the
   *   microphone and **keep the assistant**, so the voice route answers 501
   *   while the typed route goes on working;
   * - a voice comment settles to `UNAVAILABLE` at once rather than waiting for a
   *   transcript that is never coming (plan 0045, section 4.2), where a call
   *   that merely failed is worth one bounded retry.
   *
   * Both are facts about the deployment, knowable before a request arrives. A
   * throw would only ever tell somebody after they had spoken.
   */
  readonly transcriptionSupported: boolean;

  generate(request: ModelRequest): Promise<ModelReply>;

  /**
   * The recording, as the words in it, or an empty string when the provider
   * heard nothing.
   *
   * Empty is a real answer and not an error: it means the recording had nothing
   * recognisable in it, which is a thing people genuinely upload. A spoken turn
   * says so and runs no turn; a voice comment records that it has no transcript
   * and stays playable.
   *
   * Throws {@link ProviderRateLimitedError} and {@link ProviderUnavailableError}
   * exactly as {@link generate} does, so rule A5's answer needs no second
   * implementation: a spoken turn rate limited during transcription produces the
   * same problem body, with the same number in it, that a rate limited typed turn
   * produces.
   */
  transcribe(request: TranscriptionRequest): Promise<string>;
}
