import type {
  AssistantReferenceKind,
  AssistantRole,
  ListResolutionBranch,
} from '../enums/assistant.enums';

/**
 * The assistant service (plan 0039).
 *
 * One subject, because the assistant has one thing to do: take a conversation and
 * answer it. Everything the bot can *act* on happens over HTTP, against the
 * gateway, carrying the caller's own token (rule A1), so nothing in this file
 * describes an action. What crosses the broker is the turn and its answer.
 *
 * The transcript rides on the request because the service stores nothing between
 * turns (rule A2). That makes it **client supplied and therefore untrusted**: the
 * service caps it on arrival rather than believing the client capped it, and a
 * transcript entry is never treated as an instruction from the operator.
 */
export const ASSISTANT_PATTERNS = {
  /** One conversation turn: transcript in, reply and references out. */
  turn: 'assistant.turn',
  /**
   * Words out of a recording, and nothing else (plan 0041, section 3.2).
   *
   * A second subject rather than an audio part on a turn, because it is a
   * different job: no tools, no history, no reply to parse, and nothing for rule
   * A1 to enforce because nothing is being read. It carries no list, no line and
   * nothing about who spoke; it is a transcription, not a turn.
   *
   * The assistant owns it because the assistant holds the provider credential.
   * Core does not gain a model provider and must not: core is the database and
   * the rules, and a dependency from core on a provider key would make the list
   * service unbootable without a credential it has no other use for (plan 0045,
   * section 4.1).
   */
  transcribe: 'assistant.transcribe',
} as const;

/**
 * A recording to write down (plan 0041, section 3.2).
 *
 * The audio is held for the length of the call and never written anywhere: no
 * disk, no database, no cache, and never a log line, not even a hash (plan 0041,
 * section 6). That is rule A2 rather than an exception to it.
 */
export interface AssistantTranscribeRequest {
  /** Base64, because this crosses the broker (plan 0041, section 4.2). */
  audio: string;
  /** What the browser recorded in. The service refuses what it cannot read. */
  mimeType: string;
  /** BCP 47, the same locale a reply would be written in. */
  locale: string;
}

/**
 * What was heard.
 *
 * `text` is empty when the provider returned nothing, which is a real answer and
 * not an error: the caller records that no transcript exists rather than retrying
 * forever, and the recording is intact either way.
 */
export interface AssistantTranscribeResponse {
  text: string;
}

/** One entry of the transcript the client holds and resends every turn. */
export interface AssistantMessage {
  role: AssistantRole;
  content: string;
}

/**
 * Something the answer genuinely touched, for the client to draw a link to
 * (rule A3, section 8).
 *
 * Every reference here came back from a gateway call **in this turn**, so the id
 * exists, the caller can see it, and the link cannot 404. Ids are never parsed
 * out of the reply text, and the model is never asked to write one.
 */
export interface AssistantReference {
  kind: AssistantReferenceKind;
  zoneId: string;
  /** Set for LIST and LINE references, null for a zone. */
  listId: string | null;
  /** Set for LINE references only. */
  lineId: string | null;
  /** The name the gateway returned, for the link's text. */
  label: string;
}

/**
 * What the gateway sends the assistant.
 *
 * `authorization` is the caller's own `Authorization` header, verbatim, and it is
 * the only credential the service ever holds (rule A1). The service mints no
 * token, carries no service account, and opens no database connection: it is an
 * API client that happens to talk to a model.
 */
export interface AssistantTurnRequest {
  /** The caller, for the structured turn record (section 10) and nothing else. */
  userId: string;
  /** The caller's `Authorization` header, forwarded to the gateway verbatim. */
  authorization: string;
  /** The conversation so far, oldest first. Capped by the service on arrival. */
  transcript: AssistantMessage[];
  /** What the caller just said. */
  message: string;
}

/**
 * The answer: free form text, plus the references the turn actually earned.
 *
 * `references` is empty for a redirect, a refusal or a turn that called no tool,
 * which is exactly right — there was nothing to link to.
 */
export interface AssistantTurnResponse {
  reply: string;
  references: AssistantReference[];
  /**
   * Present when the turn resolved a list for a write, absent otherwise. It rides
   * on the response rather than living only in a log line because the client's
   * own behaviour differs between a write and a question (velista 0032).
   */
  listResolution?: ListResolutionBranch;
}
