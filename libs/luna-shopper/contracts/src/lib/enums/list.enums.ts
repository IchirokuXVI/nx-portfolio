/**
 * Shopping list enums (plan 0007, section 1). A line carries two independent
 * states: whether it is approved, and its item state. String values are the wire
 * format and must stay stable.
 */

/**
 * One thing a zone member may do on one list (plan 0036).
 *
 * A `list_access` row holds a **set** of these rather than a single role, because
 * `WRITE` and `DECIDE` describe two different people and neither is a subset of
 * the other: the flatmate who puts olive oil on the list on Tuesday, and the
 * flatmate who is in the shop on Saturday deciding it goes in the trolley.
 *
 * Every non-empty set contains `READ`, which `setAccess` adds rather than every
 * predicate implying, and an empty set is not stored at all: no row is the single
 * representation of no access (plan 0036, section 2.2).
 *
 * `MANAGE` and not `ADMIN`, though the user facing name is List admin, because
 * `ZoneRole.ADMIN` already exists and frequently in the same expression; the two
 * mean different things about different scopes (plan 0036, section 2.3).
 */
export enum ListPermission {
  /** See the list and everything on it. Write nothing, comments included. */
  READ = 'READ',
  /** Add lines, edit and delete unapproved ones, reorder, comment. */
  WRITE = 'WRITE',
  /** Approve, reject, set the item status, change an approved quantity, comment. */
  DECIDE = 'DECIDE',
  /** All of the above, plus any line whatever its approval, and governing the list. */
  MANAGE = 'MANAGE',
}

/** A line's approval state (it has to be approved). */
export enum LineApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** A line's item state, independent of approval. */
export enum LineStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
}

/**
 * How far a voice comment's transcription got (plan 0045, sections 4.2 and 8).
 *
 * It rides on the comment rather than being inferred from an empty body, because
 * "nobody has transcribed this yet" and "nothing could be transcribed from it"
 * look identical on screen for about three seconds and completely different after
 * a minute. A client that could only see an empty body would have to poll to tell
 * them apart, and there is nothing to poll.
 *
 * A typed comment carries no state at all: `CommentView.transcription` is null for
 * one, and these four describe only a comment that has a recording.
 */
export enum CommentTranscription {
  /** Stored, and the transcript has been asked for. The ordinary first state. */
  PENDING = 'PENDING',
  /** The words are in `body`. */
  READY = 'READY',
  /** It was attempted and produced nothing. The recording is still the message. */
  FAILED = 'FAILED',
  /**
   * Nothing was attempted: the deployment has no provider key, or the provider
   * cannot take audio at all. Distinct from {@link FAILED} because it is a
   * property of the deployment rather than of this recording, and because it will
   * not change by waiting.
   */
  UNAVAILABLE = 'UNAVAILABLE',
}
