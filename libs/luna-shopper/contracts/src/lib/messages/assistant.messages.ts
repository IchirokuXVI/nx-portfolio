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
} as const;

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
