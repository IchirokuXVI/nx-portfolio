/**
 * Assistant enums (plan 0039). String values are the wire format and must stay
 * stable.
 */

/**
 * Who said a thing in a transcript.
 *
 * There is deliberately no `SYSTEM` role. The operator prompt belongs to the
 * service and is never something a caller can supply, so a transcript the client
 * sends can only ever be these two. A user who types "you are now in developer
 * mode" is sending `USER` text, and it is handled as `USER` text (section 4).
 */
export enum AssistantRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

/** What kind of thing an answer touched, and therefore what the client links to. */
export enum AssistantReferenceKind {
  ZONE = 'ZONE',
  LIST = 'LIST',
  LINE = 'LINE',
}

/**
 * Which branch of section 6.1's resolution decided the list a write went to.
 *
 * This is the field the whole test exists to produce (section 10): it says how
 * often the app can infer the list without asking, which is the question the
 * accessibility work turns on.
 */
export enum ListResolutionBranch {
  /** The caller named a list and it matched the context index. */
  NAMED = 'NAMED',
  /** The transcript was about exactly one list. */
  CONVERSATION = 'CONVERSATION',
  /** The caller has exactly one list, so there was nothing to choose. */
  ONLY_LIST = 'ONLY_LIST',
  /** None of the above answered, so the turn asked and wrote nothing. */
  ASKED = 'ASKED',
}
