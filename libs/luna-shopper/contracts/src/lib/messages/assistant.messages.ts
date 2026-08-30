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
   * The same turn, spoken (plan 0041): a recording in, the same answer out plus
   * what was heard.
   *
   * A second subject rather than an optional audio field on {@link turn},
   * because the two requests carry different things and only one of them can be
   * megabytes. Everything after the transcription is the same code, which is the
   * point of the plan: a spoken turn becomes a typed turn as early as possible.
   */
  voice: 'assistant.voice',
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
 * A spoken turn (plan 0041).
 *
 * Everything {@link AssistantTurnRequest} carries except `message`, which is the
 * one thing this request does not have: what the caller said is inside `audio`
 * and is not known to anybody until the service has transcribed it.
 *
 * The recording travels **base64 over the broker**, which is why `max_payload`
 * is raised to 8 MB in both the compose stack and the chart (section 4.2). The
 * alternative was a second transport for one service pair, and one transport per
 * pair is worth more than a third of a megabyte inside the cluster.
 */
export interface AssistantVoiceRequest {
  /** The caller, for the structured turn record (section 10) and nothing else. */
  userId: string;
  /** The caller's `Authorization` header, forwarded to the gateway verbatim. */
  authorization: string;
  /** The conversation so far, oldest first. Capped by the service on arrival. */
  transcript: AssistantMessage[];
  /** The recording, base64 encoded. Capped on arrival, in bytes, not in base64. */
  audio: string;
  /** What the browser said it recorded. Checked against a whitelist, then sent on. */
  mimeType: string;
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
  /**
   * What the service heard, on a spoken turn only (plan 0041, section 3.1).
   *
   * The reason transcription is a call of its own rather than audio dropped into
   * the tool loop: mishearing is the characteristic failure of a voice interface,
   * so an answer the caller cannot check against the words it answered is an
   * answer they cannot check at all. The client puts this in the caller's own
   * bubble.
   *
   * Optional, and absent on every typed turn. A client that receives no `heard`
   * shows a neutral placeholder rather than inventing the words, because a guess
   * at what somebody said is worse than saying nothing.
   */
  heard?: string;
}
