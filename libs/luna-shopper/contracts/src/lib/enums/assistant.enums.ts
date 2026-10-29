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

/**
 * What a reservation of a person's assistant allowance is for (plan 0234,
 * section 5.2). A typed turn and a spoken turn each count one turn; a voice
 * comment's transcription counts no turn and its seconds go to comment audio.
 */
export enum AllowancePurpose {
  TURN = 'TURN',
  VOICE_TURN = 'VOICE_TURN',
  TRANSCRIPTION = 'TRANSCRIPTION',
}

/**
 * How core answered a reservation (plan 0234, section 5.1). `TURN_IN_FLIGHT`
 * is the one turn in flight rule, which the assistant answers with an ordinary
 * `rate_limited`, because waiting does fix it.
 */
export enum AllowanceReserveOutcome {
  RESERVED = 'RESERVED',
  REFUSED = 'REFUSED',
  TURN_IN_FLIGHT = 'TURN_IN_FLIGHT',
}

/**
 * Whose limit refused a reservation (plan 0234, section 8.1). Lower case,
 * because these are the values of the problem body's `details`.
 */
export enum AllowanceScope {
  USER = 'user',
  DEPLOYMENT = 'deployment',
}

/** The period of the limit that refused (plan 0234, section 8.1). */
export enum AllowancePeriod {
  DAY = 'day',
  MONTH = 'month',
}

/** Which counter refused (plan 0234, section 8.1). */
export enum AllowanceLimit {
  TURNS = 'turns',
  ASSISTANT_AUDIO = 'assistantAudio',
  COMMENT_AUDIO = 'commentAudio',
  COST = 'cost',
}
