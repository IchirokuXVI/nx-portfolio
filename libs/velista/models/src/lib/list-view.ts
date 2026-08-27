import type { LineApprovalStatus, LineStatus, ListRole } from './enums';

/**
 * What the list page draws, as plain data (plan 0012).
 *
 * Rule D1's other half: the container reads the stores and hands these down, so every
 * component on this screen renders from a value and knows nothing about a backend, an
 * overlay or a socket. The two state machines in section 3.4 arrive here already
 * resolved into the things a row actually varies by, because a component deciding
 * "struck through when READY, or when REJECTED, but not when PENDING" is the kind of
 * rule that ends up written twice and differently.
 */

/**
 * How a pending write on this row is going (section 3.3).
 *
 * `none` is the overwhelming majority and is what a confirmed write returns to: the
 * confirmation was the change itself, so there is deliberately no `succeeded` member
 * here for the row to render.
 */
export type LineWriteState = 'none' | 'pending' | 'failed' | 'overwritten';

/**
 * Everything a row can be asked to do, other than being ticked off.
 *
 * Ticking off is deliberately not in here. It is one tap, it is reversible by the same
 * tap, and it is the thing this screen is for, so it is the row's own gesture rather
 * than an entry in a menu (section 4.2).
 *
 * The two move actions are the grip's **keyboard** equivalent and are not drawn in the
 * overflow. They exist as actions rather than as an internal detail of a drag because
 * the container owns the order and a component that reordered its own siblings would
 * be deciding something it cannot see (section 7).
 */
export type LineAction =
  | 'edit'
  | 'markNotAvailable'
  | 'markPending'
  | 'comments'
  | 'delete'
  | 'moveUp'
  | 'moveDown';

/** One line, ready to draw. */
export interface LineRowVm {
  /**
   * The server's id, or the client key an optimistic add is held under until the
   * response returns (section 5.2). Either way it is what `trackBy` follows, so a row
   * is never destroyed and rebuilt on the frame its real id arrives.
   */
  readonly id: string;
  readonly content: string;
  readonly quantity: number;
  readonly status: LineStatus;
  readonly approvalStatus: LineApprovalStatus;
  /**
   * Whether the row draws as done: struck through, muted.
   *
   * Derived rather than compared in a template, because three unrelated things produce
   * it (READY, NOT_AVAILABLE and REJECTED) and only one of them is a tick.
   */
  readonly struck: boolean;
  /**
   * The caption under the row, as a translation key, or null for an ordinary row.
   *
   * Exactly three produce one, per section 4.7, and an ordinary row never grows a
   * second line.
   */
  readonly captionKey: string | null;
  /** How a write in flight on this row is going. Drives the 70% and the notices. */
  readonly write: LineWriteState;
  /**
   * Who overwrote this row, for the notice. Null unless `write` is `overwritten`, and
   * null even then when the name cannot be resolved (section 5.4).
   */
  readonly overwrittenBy: string | null;
  /**
   * How many comments this line has, as far as the client has **seen**.
   *
   * Undefined rather than zero when nothing has been observed, and the row draws
   * nothing in both cases. There is no comment count anywhere on the wire: `LineView`
   * does not carry one, so the only honest sources are a comment page this session
   * loaded and the `comment.added` events it has watched go by. Rendering a confident
   * zero for a line with nine comments on it would be worse than rendering nothing.
   */
  readonly commentCount?: number;
  /** Whether the row responds to a tap at all. False for a reader, and in reorder mode. */
  readonly interactive: boolean;
  /**
   * The overflow's contents, decided by the container from the caller's own facts.
   *
   * An **empty list means no overflow button**, not a disabled one, exactly as
   * `MemberRowVm.actions` does it: a disabled control says "you could do this, later"
   * about something that will never be permitted. A reader's rows carry only
   * `comments`, because commenting is the one thing a reader can actually do
   * (section 3.2).
   */
  readonly actions: readonly LineAction[];
  /**
   * Whether to draw the two decision buttons on this row.
   *
   * Inline rather than in the overflow, because deciding is the whole reason a staff
   * member is looking at a pending line and burying it one tap deeper would make the
   * queue tedious. True only for staff, and only on a line that is actually waiting.
   */
  readonly decidable: boolean;
  /** Whether to offer putting a turned down line back. Staff, on a REJECTED line. */
  readonly restorable: boolean;
}

/**
 * What the caller may do on this list.
 *
 * Three facts rather than one role, because the backend does not grant them together
 * and a screen that collapsed them would draw a control that fails. A zone OWNER can
 * rename and delete a list they cannot add a single line to: `requireWrite` has no
 * manager bypass, while `requireRead` and `requireManage` both do.
 */
export interface ListAbilitiesVm {
  /**
   * Whether the composer and the tick gesture are offered.
   *
   * **Optimistic where it is unknown**, which is most callers. `ListView` carries no
   * role for the caller and there is no `GET /v1/lists/:id/access` yet (section 5.5),
   * so the only person the client can know is a writer is the one who created the
   * list, who was given a WRITER row in the same transaction. Everybody else is
   * offered the composer and, if the first write comes back `forbidden`, the page
   * switches to the read only state in place with the copy section 5.7 gives it.
   *
   * Drawing nothing until a write proved the permission would hide the whole screen
   * from the people who use it, to spare a rare reader one refused request.
   */
  readonly canWrite: boolean;
  /** Whether the caller has been refused a write, so 3.2 is now certain rather than assumed. */
  readonly knownReader: boolean;
  /** Rename, share and delete: the list's creator, a zone admin, or the owner. */
  readonly canManage: boolean;
  /** Approve and turn down: zone OWNER or ADMIN. */
  readonly canDecide: boolean;
}

/** The header: the list, the group it is in, and how far the shop has got. */
export interface ListHeaderVm {
  /** Null while a cold arrival is still finding the name (rule L2). */
  readonly listName: string | null;
  readonly zoneName: string | null;
  readonly readyCount: number;
  readonly lineCount: number;
  /** The list room was refused or the connection dropped (section 3.1). */
  readonly live: boolean;
}

/** Why the page has nothing to draw. */
export type ListGoneReason = 'deleted' | 'unshared';

/**
 * Every state the list page can be in (section 3.1).
 *
 * `loaded` covers the empty list too: the composer is the same composer and the header
 * is the same header, so an empty list is one sentence inside a loaded page rather than
 * a state that has to re-derive both.
 */
export type ListPageState =
  | { readonly kind: 'loading'; readonly header: ListHeaderVm }
  | {
      readonly kind: 'loaded';
      readonly header: ListHeaderVm;
      readonly lines: readonly LineRowVm[];
      readonly abilities: ListAbilitiesVm;
      /** Nothing on the list yet. The composer is focused, per section 3.1. */
      readonly empty: boolean;
      /**
       * Whether dragging is available (rule L4). False while `nextCursor` is non null,
       * because `line.reorder` renumbers only the lines it names.
       */
      readonly canReorder: boolean;
    }
  | {
      readonly kind: 'error';
      readonly messageKey: string;
      readonly correlationId: string | null;
    }
  | { readonly kind: 'gone'; readonly reason: ListGoneReason };

/** One comment, ready to draw. */
export interface CommentRowVm {
  readonly id: string;
  /**
   * The author's name in this zone, or null when it cannot be resolved.
   *
   * Null renders `list.comments.someone`, never an id and never the word Unknown,
   * which reads like an error rather than like a person who left (section 5.4).
   */
  readonly author: string | null;
  readonly body: string;
  readonly createdAt: Date;
  /** Whether this one is the caller's, which the sheet draws differently. */
  readonly mine: boolean;
}

/** One member, as a row in the share sheet. */
export interface ShareRowVm {
  readonly membershipId: string;
  readonly username: string;
  /** Null is no access. The three choices are null, READER and WRITER. */
  readonly role: ListRole | null;
  /**
   * Whether the row can be changed.
   *
   * False for the list's creator, who is a writer that cannot be demoted, and false
   * for zone staff, who can always open the list and are not in the payload at all.
   */
  readonly fixed: boolean;
  /** Why it is fixed, as a translation key. Null when it is not. */
  readonly fixedReasonKey: string | null;
}
