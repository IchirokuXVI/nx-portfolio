import type {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  ZoneRole,
} from './enums';

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

/**
 * The two modes of the one edit sheet (plan 0030, section 4).
 *
 * `full` makes every field live: `WRITE` on a line that is `PENDING` or `REJECTED`, or
 * `MANAGE` on any line at all. `quantity` shows the content and lets only the number be
 * changed: `DECIDE` on an `APPROVED` line, which is the single field a person in the
 * aisle learns that the list did not know.
 *
 * Two modes of one sheet rather than two sheets, because they are the same gesture from
 * the same row and the only difference is which fields are live. Naming the **scope** of
 * the edit rather than the permission behind it is deliberate: three different
 * permission combinations produce `full`, and a sheet that switched on a role would have
 * to learn all three.
 */
export type LineEditScope = 'full' | 'quantity';

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
  /**
   * Whether the row responds to a tap at all. False without `DECIDE`, and in reorder
   * mode.
   *
   * It follows `canDecide` and no longer `canWrite`, because the tap **is** ticking off
   * and ticking off is `DECIDE` now (section 4). So a `WRITE`-only caller has a full
   * composer and rows that do not answer a tap, which is correct and is the one case on
   * this screen that needs a caption to say who does the ticking, or it reads as broken.
   */
  readonly interactive: boolean;
  /**
   * The overflow's contents, decided by the container from the caller's own facts.
   *
   * An **empty list means no overflow button**, not a disabled one, exactly as
   * `MemberRowVm.actions` does it: a disabled control says "you could do this, later"
   * about something that will never be permitted.
   *
   * A read-only caller's rows keep exactly `['comments']`, and that survives plan 0030
   * for a reason worth stating, because the plan can be read both ways. Commenting does
   * now follow `WRITE` or `DECIDE`, so a reader may not say anything; what they may
   * still do is **read** the conversation, and section 3.1 asks for exactly that, with
   * the sheet opening for everybody who holds `READ` and the read-only note standing
   * where the composer would be. The overflow is the only way into that sheet, so an
   * empty list here would take away the reading as well as the writing. Acceptance item
   * 1's "no overflow on any row" is the checklist disagreeing with the passage that
   * reasoned it out, and the passage is the one that was thought about.
   */
  readonly actions: readonly LineAction[];
  /**
   * Which fields the edit sheet may make live on this row, or null when it may not be
   * opened at all.
   *
   * The mode is a function of the caller's permissions **and** the line's approval
   * together (section 4), so it cannot be a fact about the person: a `MANAGE` holder
   * gets the full sheet on every row, while a caller holding only `DECIDE` gets no edit
   * on a pending row and the quantity stepper on an approved one. Deriving it per row is
   * what keeps those two answers from being written down separately.
   *
   * Nullable, and that null is the **same decision** as `actions` not containing `edit`.
   * The container derives both from one expression, so they cannot disagree; two fields
   * exist because they are read by two different components and neither should have to
   * search a menu array to find out what a sheet is for. The invariant to preserve when
   * either is changed: `editScope` is non-null exactly when `actions` includes `edit`.
   */
  readonly editScope: LineEditScope | null;
  /**
   * Whether to draw the two decision buttons on this row.
   *
   * Inline rather than in the overflow, because deciding is the whole reason somebody is
   * looking at a pending line and burying it one tap deeper would make the queue
   * tedious. True for `canDecide`, and only on a line that is actually waiting.
   *
   * It used to read "true only for staff", which was the client re-deriving an
   * authorization rule from a zone role. `DECIDE` is a list permission the server sends,
   * and group staff hold it on every list in the zone anyway, so there is nothing left
   * to special-case here (plan 0030, section 4).
   */
  readonly decidable: boolean;
  /**
   * Whether to offer putting a turned down line back. `canDecide`, on a REJECTED line.
   *
   * Restoring is the third outcome of the same decision the two buttons above make, so
   * it follows the same permission and, for the same reason as `decidable`, no longer
   * mentions staff.
   */
  readonly restorable: boolean;
  /**
   * Who is editing this line right now, or null. Never the reader themselves.
   *
   * Advisory and nothing more (plan 0022, section 3): the row stays tappable, the edit
   * sheet still opens over it, and a simultaneous edit resolves exactly as `0012` says
   * it does. Null when nobody is editing and null when the editor's name could not be
   * resolved, because an id is not a person to the one reading the row.
   */
  readonly editor: string | null;
}

/**
 * What the caller may do on this list.
 *
 * Derived booleans rather than the permission set itself, and that is the point of the
 * type: every component downstream renders from these and none of them has to learn what
 * a permission is. What changed in plan 0030 is where the booleans come from. They used
 * to be three guesses assembled from a zone role, with `canWrite` frankly optimistic,
 * because `ListView` carried no permission for the caller and there was no
 * `GET /v1/lists/:id/access`. The server sends the answer now (backend plan 0036,
 * section 7), so these are four membership tests on a set and a summary of it.
 *
 * `isStaff` is **not** an input any more. A zone `OWNER` or `ADMIN` holds all four
 * permissions on every list in their zone and the server sends them all four, so the
 * client has nothing left to special-case. That was the last place this screen
 * re-derived an authorization rule the server had already applied.
 *
 * `knownReader` is gone with it. It existed to record that a write had been refused, so
 * the page could stop guessing; there is nothing left to infer, and an inference kept
 * beside a fact is a second answer that will eventually disagree with the first.
 */
export interface ListAbilitiesVm {
  /** Add a line, edit or delete an unapproved one, reorder. `WRITE`. */
  readonly canWrite: boolean;
  /** Tick off, mark unavailable, approve, reject, change an approved quantity. `DECIDE`. */
  readonly canDecide: boolean;
  /** Comment. `WRITE` or `DECIDE`; a read-only caller may not. */
  readonly canComment: boolean;
  /** Rename, configure, share and delete the list. `MANAGE`. */
  readonly canManage: boolean;
  /**
   * Nothing but `READ`, the empty set included. Drives the one banner that explains it.
   *
   * A summary of the four above rather than a fifth fact, so the banner is decided once
   * instead of by each surface asking "and none of the others either?". It is true for
   * an absent or unreadable `myPermissions` too, which is the deliberate inversion of
   * the old optimism: with four permissions there are eight or nine controls to be wrong
   * about, and guessing them all and correcting from refusals would be a screen that
   * rearranges itself as the user works (plan 0030, section 3.2).
   */
  readonly readOnly: boolean;
}

/**
 * One person who has this list open, as the header's presence row draws them.
 *
 * Richer than the bare name every other presence surface takes, because this is the
 * only one that opens: a card says "Ana and Marc are here" and stops there, while this
 * screen also answers who they are and how long they have been in the aisle.
 *
 * The reader is already gone by the time one of these exists, and so is anybody whose
 * name would not resolve, exactly as `presenceNames` has always decided it: presence
 * under reports by design (plan 0004, section 6.7) and an id is not a person.
 */
export interface ListViewerVm {
  readonly userId: string;
  /** Their name **in this group**, which is the only human readable name the API has. */
  readonly name: string;
  /**
   * Their role in the group, or null when the members have not arrived yet.
   *
   * The zone role rather than their permissions on this list, and it stays that way now
   * that `GET /v1/lists/:id/access` exists. The reason is no longer that the answer is
   * unavailable, it is that **the answer is not everybody's to see**: the access table
   * is `MANAGE` only (backend plan 0036, section 4.3), so a chip sourced from it would
   * say different things to two people standing in the same aisle looking at the same
   * sheet, which is worse than a chip that says less. The question this sheet asks is
   * also a question about the group, and the group's answer is the one that does not
   * change per list (plan 0029, and plan 0030 section 6.4).
   *
   * Null draws no chip rather than guessing MEMBER, which would demote an owner for as
   * long as one request is in flight.
   */
  readonly role: ZoneRole | null;
  /**
   * When this client first saw them here, or null.
   *
   * Not "when they opened the list": no presence payload carries a timestamp, so the
   * only honest instant available is the first snapshot **this** session saw them in.
   * Somebody who was already shopping when the reader arrived therefore reads as having
   * arrived with them, and a dropped socket restarts every clock, because
   * `PresenceStore` empties on a disconnect and nothing it held is true afterwards.
   */
  readonly since: Date | null;
}

/** The header: the list, the group it is in, and how far the shop has got. */
export interface ListHeaderVm {
  /** Null while a cold arrival is still finding the name (rule L2). */
  readonly listName: string | null;
  readonly zoneName: string | null;
  readonly readyCount: number;
  readonly lineCount: number;
  /**
   * Who else has this list open right now, named and without the reader.
   *
   * It can only be filled because this page announces itself with `viewList`; while it
   * merely subscribed, the server's viewer set was empty forever and nobody ever saw
   * this row anywhere (plan 0022, section 2.1).
   *
   * Whole people rather than the bare names the resume card takes: this row opens, and
   * what it opens onto needs a role and an arrival time for each of them.
   */
  readonly viewers: readonly ListViewerVm[];
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
      /**
       * Whether this list approves new lines by itself (backend plan 0037, section 3).
       *
       * A list fact rather than an ability, so it sits beside `abilities` and not inside
       * it. The page needs it in two places that both sit above a row: the optimistic
       * add, which has to construct its placeholder with the approval the server is
       * about to give it (plan 0030, section 5), and the edit sheet's warning, which is
       * absent on an auto-approving list because the split it warns about does not
       * happen there (section 4.1).
       */
      readonly autoApproveLines: boolean;
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
  /**
   * What this member may do on the list. Empty is no access at all.
   *
   * A set drawn as four checkboxes, where a role was drawn as a segmented control. The
   * segmented control was right for three mutually exclusive states and cannot express a
   * set in which `WRITE` and `DECIDE` are independent (plan 0030, section 6.1).
   *
   * `READ` is ticked by the checkbox handler the moment any other box is ticked, which
   * matches what the server does to a non-empty set. That duplicates the feedback and
   * not the rule: the server enforces, and the sheet explains before the save rather
   * than after it.
   */
  readonly permissions: readonly ListPermission[];
  /**
   * The members of the set this row's checkboxes may **not** change, in either
   * direction.
   *
   * Not an ability, and deliberately not on `ListAbilitiesVm`. Whether the caller may
   * set `MANAGE` is a fact about the caller's zone role, which `MembershipStore` already
   * holds; nothing else on the list page needs it, and an ability only one sheet reads
   * would be a fact stored twice (plan 0030, section 6.1.1).
   *
   * One field covers both rules that produce it. A group staff row locks all four,
   * because staff hold everything on every list in the zone and it is not revocable.
   * Every other row locks `MANAGE` when the caller is not group staff, and nothing at
   * all when they are, because only the group appoints list admins.
   *
   * A locked box is drawn in its current state and **disabled**, which is the opposite
   * of what `LineRowVm.actions` does for a row menu, and the difference is deliberate:
   * an absent menu entry hides a capability that will never exist and needs no
   * explanation, while a locked List admin box is the answer to "why can Marc change who
   * uses this list?" and is visible in every other row of the same table. So it is
   * drawn, with `fixedReasonKey` drawn beside it.
   */
  readonly lockedPermissions: readonly ListPermission[];
  /**
   * Whether the whole row is beyond changing, checkboxes and all.
   *
   * True only for zone staff, who hold all four permissions on every list in the zone by
   * derivation and have no stored row to rewrite (backend plan 0036, section 2.4). Their
   * row is shown and fixed rather than hidden, because a hidden row invites the question
   * "why can Marc still edit this?" and this sheet is the only place that answers it.
   *
   * The list's **creator is no longer fixed**. Their power is an ordinary `list_access`
   * row now (backend plan 0036, section 2.5), so a group admin can rewrite it, `MANAGE`
   * included. To a list admin who is not staff the creator's row is an ordinary row with
   * its `MANAGE` box locked, like every other row, which is the asymmetry rendered: the
   * group appoints and unappoints, the list admin runs the list. What the creator keeps
   * is a label beside their name saying they made it.
   */
  readonly fixed: boolean;
  /**
   * Why it is fixed or partly locked, as a translation key. Null when it is neither.
   *
   * It explains `lockedPermissions` as well as `fixed`, because both need the same kind
   * of sentence in the same place: group admins always have full access to every list in
   * the group, or only group admins appoint list admins.
   */
  readonly fixedReasonKey: string | null;
}
