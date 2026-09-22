import {
  BASKET_CHANGE_KIND_FALLBACK,
  BASKET_CHANGE_KINDS,
  LINE_APPROVAL_STATUSES,
  type BasketChange,
  type BasketChangeActor,
  type BasketChangePage,
  type BasketListRef,
} from '@portfolio/velista/models';
import {
  date,
  isRecord,
  mapArray,
  nullableNum,
  nullableStr,
  oneOf,
  oneOfOrNull,
  str,
} from './primitives';

/**
 * What the change mappers need from the basket on screen, and nothing else.
 *
 * Three lookups rather than the whole {@link Basket}, so the mapper stays a
 * function of its inputs and a spec can hand it three maps. The store builds one
 * from the basket it holds at the moment the page is mapped, which is what
 * velista `0093` section 2 means by "read from the store when the change is
 * mapped".
 *
 * Every lookup answers **null** rather than a guess. A person this build cannot
 * name draws "Someone", a list this reader was not served draws nothing, and a
 * merge whose survivor has left the basket names the line the server named.
 */
export interface BasketChangeContext {
  /**
   * The display name for a participant id or an account id, or null.
   *
   * Core serves no name anywhere, so this is resolved from what the client
   * already holds. In practice that is `Basket.participants`, which carries both
   * keys: a participant's own id, and the `userId` of a registered one. An
   * account that is on no participant row answers null, which is honest rather
   * than unfortunate.
   */
  readonly nameFor: (
    participantId: string | null,
    userId: string | null
  ) => string | null;
  /** One covered list this reader holds `WRITE` on, by id, or null. */
  readonly listFor: (listId: string) => BasketListRef | null;
  /** The text of a row in the basket, by row key, or null when it is gone. */
  readonly contentFor: (rowKey: string) => string | null;
}

/**
 * From `BasketChangeView`: one change to a covered list (backend `0138`,
 * section 8).
 *
 * **Refused without an id, without a date, and without a name from anywhere.**
 * Each of the three is something a sentence cannot be written without: no id
 * means nothing to acknowledge through, no date means an entry with no second
 * line, and no name at all means a sentence with a pair of empty quotes in it.
 *
 * The **name is not simply `contentAfter`**, and that is the thing to know
 * before editing this. Backend `0138` fills only the columns that moved, so a
 * `QUANTITY_CHANGED` arrives with both content columns null and two numbers,
 * and an `APPROVAL_CHANGED` with both null and two statuses. Requiring content
 * here dropped every one of them and the sheet drew its empty state over a
 * basket full of changes. The row's own text is the third source, and for those
 * two kinds it is the only one.
 *
 * The wire carries no line id, so `rowKey` stands in for one, and it is
 * legitimately null for a line that is gone.
 *
 * A kind this build has not heard of maps to `UNKNOWN` and **never throws**: a
 * change it cannot name is still a change worth saying happened.
 */
export function toBasketChange(
  raw: unknown,
  context: BasketChangeContext
): BasketChange | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const at = date(raw['at']);
  if (id === null || at === null) {
    return null;
  }

  const rowKey = nullableStr(raw['rowKey']);
  const contentBefore = nullableStr(raw['contentBefore']);
  const contentAfter = nullableStr(raw['contentAfter']);
  // The row's own text, which is what a quantity or an approval change is named
  // by: the wire sends neither of those any content at all.
  const rowContent = rowKey === null ? null : context.contentFor(rowKey);
  if (contentBefore === null && contentAfter === null && rowContent === null) {
    return null;
  }

  const listId = nullableStr(raw['listId']);

  return {
    id,
    kind: oneOf(raw['kind'], BASKET_CHANGE_KINDS, BASKET_CHANGE_KIND_FALLBACK),
    rowKey,
    contentBefore,
    contentAfter,
    quantityBefore: nullableNum(raw['quantityBefore']),
    quantityAfter: nullableNum(raw['quantityAfter']),
    approvalBefore: oneOfOrNull(raw['approvalBefore'], LINE_APPROVAL_STATUSES),
    approvalAfter: oneOfOrNull(raw['approvalAfter'], LINE_APPROVAL_STATUSES),
    rowContent,
    actor: toBasketChangeActor(raw['actor'], context),
    // Absent rather than null for a list this reader may not see (backend
    // `0130`, section 6), and resolved against the refs the basket served, so a
    // list id with no ref behind it names nothing. That is the same redaction
    // rule `restrictRowToServedLists` applies to a row's entries.
    list: listId === null ? null : context.listFor(listId),
    at,
    // The **server's** answer, read and never computed. There is no clock on
    // this side deciding what is new (velista `0093`, section 2).
    unseen: raw['unseen'] === true,
  };
}

/**
 * A page of changes, newest first.
 *
 * One bad entry is **dropped rather than failing the page**, which is
 * `mapArray`'s behaviour everywhere in this scope: a sheet that refused to open
 * because one row of twenty was unreadable would hide nineteen readable ones.
 */
export function toBasketChangePage(
  raw: unknown,
  context: BasketChangeContext
): BasketChangePage {
  if (!isRecord(raw)) {
    return { items: [], nextCursor: null };
  }

  return {
    items: mapArray(raw['items'], (item) => toBasketChange(item, context)),
    nextCursor: nullableStr(raw['nextCursor']),
  };
}

/**
 * Whoever made a change, named the one way this reader is allowed to see them.
 *
 * Null for an actor the wire withheld **and** for one carrying neither key,
 * which are the same nothing to draw: the sheet says "Someone" either way, and a
 * row with an empty name where a person should be is worse than a word.
 */
function toBasketChangeActor(
  raw: unknown,
  context: BasketChangeContext
): BasketChangeActor | null {
  if (!isRecord(raw)) {
    return null;
  }

  const participantId = nullableStr(raw['participantId']);
  const userId = nullableStr(raw['userId']);
  if (participantId === null && userId === null) {
    return null;
  }

  return {
    participantId,
    userId,
    name: context.nameFor(participantId, userId),
  };
}
