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
 * `BOUGHT` and `BUY_REVERTED` are a buy and a taken back buy that moved the
 * quantity of a line (backend `0203`, section 1). This reverses backend `0130`
 * decision 12: a buy made outside this shopping list changes what is left to get
 * here, so it is told. A buy this shopping list made is never marked, and it
 * reaches the changes view only as history, with no {@link BasketChange.origin}.
 * A skip and a reorder are still not changes.
 */
export const BASKET_CHANGE_KINDS = [
  'ADDED',
  'QUANTITY_CHANGED',
  'RENAMED',
  'MERGED',
  'DELETED',
  'APPROVAL_CHANGED',
  'BOUGHT',
  'BUY_REVERTED',
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

/**
 * Where a buy came from, when it was not made through this shopping list
 * (backend `0203`, section 5).
 *
 * `ANOTHER_BASKET` is a buy through another shopping list, and `owner` is the
 * person whose shopping list it was, or null when this reader may not be told.
 * `LIST` is a buy on the zone's list page, made by the change's own actor.
 *
 * **The other shopping list is never named**, and nothing here could name it:
 * the server sends neither its id nor its name.
 */
export type BasketChangeOrigin =
  | {
      readonly kind: 'ANOTHER_BASKET';
      readonly owner: BasketChangeActor | null;
    }
  | { readonly kind: 'LIST' };

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
  /**
   * Where a `BOUGHT` or a `BUY_REVERTED` came from, or null for every other kind
   * and for a buy this shopping list made (backend `0203`, section 5).
   */
  readonly origin: BasketChangeOrigin | null;
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

    case 'BOUGHT':
      // What is left to get, said as a need: the reader asked for this, so the
      // sentence says what they need now rather than what somebody else did.
      // Nothing left gets a sentence of its own, as a quantity of zero does.
      return change.quantityAfter === 0
        ? { key: 'basket.changes.entry.boughtAll', args: { name } }
        : {
            key: 'basket.changes.entry.bought',
            args: { name, after: change.quantityAfter ?? 0 },
          };

    case 'BUY_REVERTED':
      return {
        key: 'basket.changes.entry.buyReverted',
        args: { name, after: change.quantityAfter ?? 0 },
      };

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
 * The reader of the changes sheet, as the two keys a change can name them by.
 */
export interface BasketChangeReader {
  readonly participantId: string | null;
  readonly userId: string | null;
}

/**
 * The line under a buy that says where it came from (velista `0142`, section 4),
 * or null for a change with no {@link BasketChange.origin}, which keeps the
 * "who" and the list of every other kind.
 *
 * It replaces both of them. **No list is named**, for a `LIST` buy either, so the
 * two lines read as one family: the other shopping list is never named because
 * the server does not send it.
 *
 * A person is named by `nameOf`, which the sheet answers from what the client
 * holds. Whoever it cannot name is "someone", and so is a person the server
 * withheld, which is every person a guest is told about.
 */
export function basketChangeOriginLine(
  change: Pick<BasketChange, 'origin' | 'actor'>,
  reader: BasketChangeReader,
  nameOf: (actor: BasketChangeActor) => string | null
): BasketChangeSentence | null {
  const origin = change.origin;
  if (origin === null) {
    return null;
  }

  const person = origin.kind === 'ANOTHER_BASKET' ? origin.owner : change.actor;
  const keys =
    origin.kind === 'ANOTHER_BASKET'
      ? {
          named: 'basket.changes.origin.anotherBasket',
          you: 'basket.changes.origin.anotherBasketYours',
          someone: 'basket.changes.origin.anotherBasketSomeone',
        }
      : {
          named: 'basket.changes.origin.list',
          you: 'basket.changes.origin.listYou',
          someone: 'basket.changes.origin.listSomeone',
        };

  if (person === null) {
    return { key: keys.someone, args: {} };
  }
  if (isReader(person, reader)) {
    return { key: keys.you, args: {} };
  }
  const name = nameOf(person);
  return name === null
    ? { key: keys.someone, args: {} }
    : { key: keys.named, args: { name } };
}

/** Whether a person a change names is the reader, by either key. */
function isReader(
  person: BasketChangeActor,
  reader: BasketChangeReader
): boolean {
  return (
    (reader.participantId !== null &&
      person.participantId === reader.participantId) ||
    (reader.userId !== null && person.userId === reader.userId)
  );
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
