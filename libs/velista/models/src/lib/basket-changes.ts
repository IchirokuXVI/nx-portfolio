import type { BasketListRef } from './basket-view';
import type { LineApprovalStatus } from './enums';

/**
 * What changed on the lists a basket covers (velista `0093`; backend `0138`).
 *
 * ## The client holds no clock, and this file is where that is settled
 *
 * A basket follows its lists since backend `0136`, so a line can appear, ask for
 * a different amount, take another name or leave while somebody is halfway down
 * an aisle. What counts as **new to this viewer** is the server's answer on the
 * server's clock: {@link BasketChange.unseen} is read and never computed, and
 * nothing here is compared to `Date.now()`. A phone that spent the change in a
 * pocket still shows it, and a phone with a wrong clock shows it for the right
 * length of time.
 *
 * {@link BasketChange.at} is for **display only**. The acknowledgement carries
 * the id of the newest change the screen drew, never a moment.
 *
 * ## A change is about a row, because a client acts on rows
 *
 * The wire serves no line id (backend `0138`, section 8): a line a reader cannot
 * reach is not a line they should be told the id of. What they get is
 * {@link BasketChange.rowKey}, the row the line is in **now**, which a merge
 * resolves through the surviving line.
 */

/**
 * The kinds this build has a sentence for, plus the fallback.
 *
 * Six of them are backend `0138`'s `LineChangeKind`. `UNKNOWN` is this build's
 * own, and it is why the mapper never throws on a kind it has not heard of: a
 * change it cannot name is still a change worth saying happened, and
 * `basket.changes.entry.unknown` says exactly that much.
 *
 * A purchase, a revert, a skip and a reorder are **not** here and never will be
 * (backend `0130`, section 11, decision 12): a shopper buying a thing is not the
 * household changing what it asked for.
 */
export const BASKET_CHANGE_KINDS = [
  'ADDED',
  'QUANTITY_CHANGED',
  'RENAMED',
  'MERGED',
  'DELETED',
  'APPROVAL_CHANGED',
  'UNKNOWN',
] as const;
export type BasketChangeKind = (typeof BASKET_CHANGE_KINDS)[number];
export const BASKET_CHANGE_KIND_FALLBACK: BasketChangeKind = 'UNKNOWN';

/**
 * Who made a change, as much of them as this reader may know.
 *
 * Backend `0138` section 8 serves a participant of this basket as an id, and an
 * account that is not on the basket as a user id beside a served list, because a
 * reader who can write that list is in its zone and already resolves the person.
 * Core serves **no name**, as everywhere else in this app.
 *
 * {@link name} is resolved on this side, from what the client already holds,
 * which in practice is `Basket.participants`. Null means "this build cannot name
 * them", which the sheet draws as "Someone" rather than as a blank.
 */
export interface BasketChangeActor {
  readonly participantId: string | null;
  readonly userId: string | null;
  readonly name: string | null;
}

/** One change to a covered list, as the changes sheet reads it. */
export interface BasketChange {
  readonly id: string;
  readonly kind: BasketChangeKind;
  /** The row this line is in now, or null when it is gone. The wire serves no line id. */
  readonly rowKey: string | null;
  readonly contentBefore: string | null;
  readonly contentAfter: string | null;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly approvalBefore: LineApprovalStatus | null;
  readonly approvalAfter: LineApprovalStatus | null;
  /**
   * The text of the row {@link rowKey} names, as the basket holds it **now**.
   *
   * Not on the wire, and it is what most entries are named by. Backend `0138`
   * fills only the columns that **moved**: a quantity change carries two
   * numbers and no text at all, and an approval change carries two statuses and
   * no text. So the name in "&ldquo;Milk&rdquo; asks for 3 instead of 2" comes
   * from the row, read from the basket when the change is mapped.
   *
   * It doubles as the survivor's name on a `MERGED` change, because `rowKey`
   * resolves through the surviving line: the row the folded line is in now is
   * the row it was folded into.
   *
   * Null when the row is not in the basket any more, which is the ordinary case
   * for a deletion, and then the name comes off `contentBefore`.
   */
  readonly rowContent: string | null;
  /** Null when the reader is not entitled to know (backend `0130`, section 6). */
  readonly actor: BasketChangeActor | null;
  /** Served only to a reader who holds `WRITE` there. Resolved against `Basket.lists`. */
  readonly list: BasketListRef | null;
  /** The server's clock, for display. Never compared to anything. */
  readonly at: Date;
  /** The server's answer to "is this new to this viewer". Never computed here. */
  readonly unseen: boolean;
}

/** A page of changes, newest first. */
export interface BasketChangePage {
  readonly items: readonly BasketChange[];
  readonly nextCursor: string | null;
}

/**
 * Which sentence one change reads as, as a key and its arguments.
 *
 * In `models` rather than in the component for the reason every view model in
 * this scope is: the table of velista `0093` section 6 is a rule about the
 * product, and a template holding seven branches of it is a template two people
 * change differently. The component renders what this answers and decides
 * nothing.
 *
 * The name printed is {@link basketChangeName}, which is not simply
 * `contentAfter`: backend `0138` fills only the columns that moved, so a
 * quantity change carries no text at all and is named by its row.
 */
export interface BasketChangeSentence {
  readonly key: string;
  readonly args: Record<string, string | number>;
}

/**
 * The line's name, from whichever of the three sources has one.
 *
 * In this order, and the order is the point. `contentAfter` is what the line is
 * called now, which is what a reader should be shown. `contentBefore` covers a
 * deletion, whose row is gone. The row's own text covers everything backend
 * `0138` sent no text for at all, which is every quantity and approval change.
 *
 * The empty string is reachable only for a change with no name from any of the
 * three, which the mapper refuses rather than passing on: a sentence with a
 * pair of empty quotes in it says nothing.
 */
export function basketChangeName(change: BasketChange): string {
  return change.contentAfter ?? change.contentBefore ?? change.rowContent ?? '';
}

export function basketChangeSentence(
  change: BasketChange
): BasketChangeSentence {
  const name = basketChangeName(change);

  switch (change.kind) {
    case 'ADDED':
      return {
        key: 'basket.changes.entry.added',
        args: { name, count: change.quantityAfter ?? 0 },
      };

    case 'QUANTITY_CHANGED':
      // "asks for 0 instead of 2" is a number nobody says out loud, so zero
      // gets a sentence of its own. It is still a change to the demand and
      // never a deletion: the line stays on the list saying it is stocked.
      return change.quantityAfter === 0
        ? { key: 'basket.changes.entry.notNeeded', args: { name } }
        : {
            key: 'basket.changes.entry.quantity',
            args: {
              name,
              after: change.quantityAfter ?? 0,
              before: change.quantityBefore ?? 0,
            },
          };

    case 'RENAMED':
      return {
        key: 'basket.changes.entry.renamed',
        args: { name, before: change.contentBefore ?? '' },
      };

    case 'MERGED':
      // The survivor's text, read off the row the merge resolved to. Falling
      // back to `contentAfter` rather than to nothing: a merge whose survivor
      // has left the basket still happened, and "was merged into" with a blank
      // is worse than naming the line the server named.
      return {
        key: 'basket.changes.entry.merged',
        args: {
          // The survivor, which is the row this line resolves to now.
          name: change.rowContent ?? change.contentAfter ?? '',
          before: change.contentBefore ?? name,
        },
      };

    case 'DELETED':
      return { key: 'basket.changes.entry.deleted', args: { name } };

    case 'APPROVAL_CHANGED':
      // From `approvalAfter` and never from `approvalBefore`: the sentence says
      // where the line has got to, and a reader who missed three moves wants
      // the one that stands.
      return {
        key: approvalKey(change.approvalAfter),
        args: { name },
      };

    default:
      return { key: 'basket.changes.entry.unknown', args: { name } };
  }
}

/**
 * The sentence for one approval status.
 *
 * An unreadable status falls to the unknown sentence rather than to a guess:
 * "was approved" under a line nobody approved is the one wrong thing to say.
 */
function approvalKey(after: LineApprovalStatus | null): string {
  switch (after) {
    case 'APPROVED':
      return 'basket.changes.entry.approved';
    case 'REJECTED':
      return 'basket.changes.entry.rejected';
    case 'PENDING':
      return 'basket.changes.entry.pendingAgain';
    default:
      return 'basket.changes.entry.unknown';
  }
}
