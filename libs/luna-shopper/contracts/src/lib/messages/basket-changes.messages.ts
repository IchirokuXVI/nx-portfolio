import type { LineApprovalStatus } from '../enums/list.enums';

/**
 * What changed on the lists a basket covers, and what one viewer has seen of it
 * (plan 0138).
 *
 * A basket follows its lists since plan 0136, so a shopper looks away and the
 * basket is different when they look back. These are the shapes that say how it
 * is different: one row per change of what a list asks for, a mark on the basket
 * rows the changes touched, and a count of the ones this viewer has not seen.
 *
 * ## Every time here is the server's, and none of them is compared to a clock
 *
 * `at` is for display. The acknowledgement carries the **id** of the newest
 * change the client drew, never a timestamp, and answers a **duration** rather
 * than a moment. A phone with a wrong clock therefore shows a mark for the right
 * length of time, and a phone that spent the change in a pocket still shows it.
 *
 * ## The record is keyed by list, never by basket
 *
 * One write to a list serves every basket that covers it, which is why nothing
 * here has a basket column behind it. What a **basket** contributes is the
 * coverage the changes are read through and the participant whose cursor decides
 * what is still marked.
 */

/**
 * What a change to a list line was.
 *
 * One row per line per write, and the kind names the most significant thing that
 * moved, in this order: `MERGED`, `DELETED`, `RENAMED`, `QUANTITY_CHANGED`,
 * `APPROVAL_CHANGED`. The before and after columns carry **everything** that
 * moved, so an edit that renames a line, sets its quantity and sends it back to
 * `PENDING` is one `RENAMED` change with all six values filled.
 *
 * A purchase, a revert, a skip and a reorder are **not** changes here (plan
 * 0130, section 11, decision 12): a shopper buying a thing is not the household
 * changing what it asked for.
 */
export enum LineChangeKind {
  /** A line the list did not hold before. Only the `after` values are filled. */
  ADDED = 'ADDED',
  /** How many the household asks for moved. */
  QUANTITY_CHANGED = 'QUANTITY_CHANGED',
  /** The text moved, as typed: a respelling is a rename too. */
  RENAMED = 'RENAMED',
  /** Two lines became one. The change names the line that went. */
  MERGED = 'MERGED',
  /** The line was taken off the list (plan 0132's soft delete). */
  DELETED = 'DELETED',
  /** Approved, rejected or put back to pending. */
  APPROVAL_CHANGED = 'APPROVAL_CHANGED',
}

/**
 * The bounds the change reads hold themselves to.
 *
 * `countCap` is what a count answers at most, so somebody back from three weeks
 * away costs a bounded read rather than a count over everything. A count that
 * reaches the cap means "this many or more", which the client draws as "99+".
 */
export const BASKET_CHANGE_LIMITS = {
  /** The most `unseenChangeCount` ever says. At the cap it means "or more". */
  countCap: 99,
  /** Changes one read folds into marks. The newest, since the order is newest first. */
  marksCap: 100,
  /** The changes view's default page. */
  pageSize: 20,
  /** The changes view's largest page. */
  maxPageSize: 100,
} as const;

/**
 * One change, as a reader of a basket is served it (plan 0138, section 8).
 *
 * `lineId` and `mergedIntoLineId` are never on the wire. A client acts on rows,
 * so {@link rowKey} is the address it is given, and a line it cannot reach is
 * not a line it should be told the id of.
 */
export interface BasketChangeView {
  id: string;
  kind: LineChangeKind;
  /** For display, on the server's clock. Never compared to anything. */
  at: string;
  /** This viewer has not acknowledged it. */
  unseen: boolean;
  /**
   * The anchor of the basket row this line is in now, or null when it is gone.
   *
   * A merge resolves through the surviving line, because that is the row the
   * change is about now. A deleted line whose name a covered row still carries
   * resolves to that row.
   */
  rowKey: string | null;
  contentBefore: string | null;
  contentAfter: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  approvalBefore: LineApprovalStatus | null;
  approvalAfter: LineApprovalStatus | null;
  /**
   * The list, served only where the reader holds `WRITE` on it (plan 0130,
   * section 6). Absent rather than null, so a reader cannot tell "a list you may
   * not see" from "no list", and a guest never receives one.
   */
  listId?: string;
  /**
   * Who made it, as much of them as this reader may know.
   *
   * A participant of this basket is served as `{ participantId }`, because
   * everybody on a basket already sees its people. An account that is not on the
   * basket is served as `{ userId }` beside a served `listId` alone, since a
   * reader who can write the list is in its zone and already resolves that
   * person. Otherwise null. Core serves no name, as everywhere else.
   */
  actor: BasketChangeActorView | null;
}

/** Whoever made a change, named the one way this reader is allowed to see them. */
export type BasketChangeActorView =
  | { participantId: string; userId?: undefined }
  | { userId: string; participantId?: undefined };

/** A page of changes, newest first. */
export interface BasketChangePage {
  items: BasketChangeView[];
  nextCursor: string | null;
}

/** Read what changed on the lists this basket covers, newest first. */
export interface ListBasketChangesRequest {
  basketId: string;
  participantId: string;
  cursor?: string;
  limit?: number;
}

/**
 * Say which changes this viewer has drawn (plan 0138, section 6).
 *
 * `through` is the id of the **newest change the client drew**, not "everything
 * up to now": a change that arrives between the read and this call stays unseen.
 *
 * The client sends it only while the marked rows, or the changes view, were on
 * screen with the document visible. A background refetch acknowledges nothing.
 * This route cannot tell the difference and does not try to: the rule is the
 * client's to keep.
 */
export interface AcknowledgeBasketChangesRequest {
  basketId: string;
  participantId: string;
  through: string;
}

/** What an acknowledgement answers. */
export interface BasketChangesAcknowledged {
  /** The count as it now stands, capped at {@link BASKET_CHANGE_LIMITS.countCap}. */
  unseenChangeCount: number;
  /**
   * How long the marks just acknowledged stay drawn.
   *
   * A duration, never a time. The client may run a timer for it and read the
   * basket again when it fires; it never compares its own clock to a moment the
   * server sent.
   */
  marksLapseInMs: number;
}
