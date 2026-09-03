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
  /** Approve, reject, settle a line, change an approved quantity, comment. */
  DECIDE = 'DECIDE',
  /** All of the above, plus any line whatever its approval, and governing the list. */
  MANAGE = 'MANAGE',
}

/**
 * Who put one product on a line (plan 0070, section 2).
 *
 * A column on `list_line_items` and never a field on the wire: `LineView` says
 * the same thing as `groupItemIds`, a subset of `itemIds`, because there are
 * exactly two sources and one subset therefore determines the other. It lives
 * here rather than in core because it is the vocabulary the view's doc comments
 * are written in, beside the approval state the same rows carry.
 *
 * **Provenance moves one way** (section 3): `GROUP` may become `USER` and never
 * back. Said once, in one sentence, the app never takes ownership of something a
 * person touched, and the four cases that would otherwise each need an argument
 * answer themselves.
 */
export enum LineItemSource {
  /** The line's product group put it there and nobody has adopted it. */
  GROUP = 'GROUP',
  /** A person did: typed it, or adopted what the group offered. */
  USER = 'USER',
}

/** A line's approval state (it has to be approved). */
export enum LineApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Where one thing has got to on **one shopping trip**.
 *
 * It is no longer a column on a zone line (plan 0047, section 2). A zone list is
 * a record of what a household keeps, its quantity is the only thing that says
 * whether it is wanted now, and a fact about one trip written onto a record that
 * outlives every trip is what made a shared list rot into a screen people stopped
 * opening.
 *
 * The enum survives because a basket line is exactly the scope it was always
 * right for, which is what plan 0051 builds on it. Nothing in core stores it
 * today, and a settlement says which of two things happened with
 * {@link SettlementOutcome} instead.
 */
export enum LineStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
}

/**
 * What one settling act said about one line (plan 0047, section 3).
 *
 * Two outcomes and not three: **skipping writes nothing at all**. "I decided not
 * to buy this today" has to leave the line exactly as it was and must not look
 * like it was dealt with, so there is no row for it and therefore no value here.
 *
 * A row saying the shop did not have it is not a purchase, which is why the
 * enum names the outcome rather than the happy case: {@link NOT_AVAILABLE} would
 * otherwise read as a special kind of buying.
 */
export enum SettlementOutcome {
  /** It was bought, and `quantity` is how many. Decrements the line. */
  BOUGHT = 'BOUGHT',
  /** The shop did not have it. `quantity` is 0 and the line does not move. */
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
