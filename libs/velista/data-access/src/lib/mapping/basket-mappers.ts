import {
  BASKET_CHANGE_MARKS,
  BASKET_KIND_FALLBACK,
  BASKET_KINDS,
  BASKET_ROW_NOTES,
  BASKET_ROW_STATE_FALLBACK,
  BASKET_ROW_STATES,
  BASKET_STATUS_FALLBACK,
  BASKET_STATUSES,
  PARTICIPANT_KIND_FALLBACK,
  PARTICIPANT_KINDS,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_FALLBACK,
  type Basket,
  type BasketLinkPreview,
  type BasketListRef,
  type BasketMergeRequired,
  type BasketMergeRequiredBasket,
  type BasketMergeRequiredList,
  type BasketParticipant,
  type BasketPresenceEntry,
  type BasketPriceScope,
  type BasketProduct,
  type BasketProgress,
  type BasketRenameResult,
  type BasketRow,
  type BasketRowEntry,
  type BasketRowResult,
  type BasketSession,
  type BasketShareLink,
  type LiveBasketSummary,
  type ScopeLocation,
} from '@portfolio/velista/models';
import { toLocalizedName, toProductOffer } from './mappers';
import {
  date,
  isRecord,
  mapArray,
  nullableNum,
  nullableStr,
  numOr,
  oneOf,
  oneOfOrNull,
  str,
  strOr,
} from './primitives';

/**
 * The basket, from the wire (velista `0044`; backend `0050` and `0051`).
 *
 * A file of its own rather than more of `mappers.ts`, which is already long, and
 * because everything here shares one rule that applies nowhere else in the app.
 *
 * ## Redaction is a list the reader was served
 *
 * Backend `0051` redacted **by omission**, key by key, and these mappers kept the
 * difference between absent, empty and null with `in` checks. Backend `0136`
 * replaced the whole of that with one collection: {@link Basket.lists} holds the
 * covered lists this reader holds `WRITE` on, and an entry naming a list that is
 * not in it is one this reader may not place. So there is one question here and
 * one answer, and {@link toBasketRowEntry} drops an unserved list id to null
 * rather than leaving a name the rest of the client would have to gate again.
 *
 * `userAgent` is the one field still redacted by omission, on a participant, and
 * it keeps its `in` check.
 *
 * ## Nothing here counts
 *
 * `left`, `bought`, `asked`, the state, the note and the progress are all read
 * (backend `0130`, section 4). No mapper derives one from another, and a basket
 * whose `progress` will not map is **refused**: the alternative is to recount,
 * and recounting is what velista `0090` removed.
 *
 * Rule D4 applies as everywhere else: every parameter is `unknown`, nothing
 * throws, and a row that will not map is dropped rather than costing the page.
 */

/**
 * From `BasketParticipantView`.
 *
 * `userAgent` becomes `device`, which is what the sheet calls it, and stays
 * absent when the wire omits it. That is the difference between "guests do not
 * inspect each other" and "this person's device is unknown", and the sheet draws
 * no row for the first and an unknown row for the second.
 */
export function toBasketParticipant(raw: unknown): BasketParticipant | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  if (id === null) {
    return null;
  }

  const participant: BasketParticipant = {
    id,
    kind: oneOf(raw['kind'], PARTICIPANT_KINDS, PARTICIPANT_KIND_FALLBACK),
    displayName: nullableStr(raw['displayName']),
    // Absent on a basket served by a backend before luna `0054`, and absent for a
    // guest, who has no account. Both read as null and both fall through to the same
    // place, which is what lets the two sides ship in either order.
    username: nullableStr(raw['username']),
    guestNumber:
      typeof raw['guestNumber'] === 'number' ? raw['guestNumber'] : null,
    userId: nullableStr(raw['userId']),
    joinedAt: date(raw['joinedAt']),
    lastSeenAt: date(raw['lastSeenAt']),
    shareLinkId: nullableStr(raw['shareLinkId']),
  };

  return 'userAgent' in raw
    ? { ...participant, device: nullableStr(raw['userAgent']) }
    : participant;
}

/**
 * From `ParticipantPresenceEntry`: one person **connected right now**.
 *
 * Not {@link toBasketParticipant} with fewer fields, though it looks like it. The key
 * is `participantId` rather than `id`, and there is deliberately no device and no join
 * time on the wire at all: presence says somebody is here and never what they are
 * holding (backend `0051`, section 7).
 *
 * The id is the only thing required. A kind this build does not know falls back rather
 * than dropping the entry, because a face missing from a shop is a worse answer than a
 * face whose badge is wrong.
 */
export function toBasketPresenceEntry(
  raw: unknown
): BasketPresenceEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const participantId = str(raw['participantId']);
  if (participantId === null) {
    return null;
  }

  return {
    participantId,
    kind: oneOf(raw['kind'], PARTICIPANT_KINDS, PARTICIPANT_KIND_FALLBACK),
    displayName: nullableStr(raw['displayName']),
    guestNumber:
      typeof raw['guestNumber'] === 'number' ? raw['guestNumber'] : null,
    userId: nullableStr(raw['userId']),
  };
}

/**
 * From `BasketRowEntryView`: one covered list line inside a row.
 *
 * `listId` is whatever the server sent. {@link restrictRowToServedLists} is what
 * drops one the basket served no ref for, and it is applied once per row by
 * whoever holds the refs: {@link toBasket} as it reads them, and the store as it
 * folds a write's answer.
 *
 * The numbers are clamped at zero. A negative `left` is a server defect this
 * client does not draw, and zero is the state that offers nothing rather than the
 * state that offers the wrong thing.
 */
function toBasketRowEntry(raw: unknown): BasketRowEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const lineId = str(raw['lineId']);
  if (lineId === null) {
    return null;
  }

  const bought = atLeastZero(raw['bought']);
  const left = atLeastZero(raw['left']);

  return {
    lineId,
    listId: str(raw['listId']),
    left,
    bought,
    // Not on the wire: the entry view carries `left` and `bought` and backend
    // `0130` section 4 defines the sum. It is stated once here rather than at the
    // reel that needs a ceiling, which is the one arithmetic this file does and
    // the only one the plan leaves it.
    asked: bought + left,
    state: oneOf(raw['state'], BASKET_ROW_STATES, BASKET_ROW_STATE_FALLBACK),
    // `APPROVED` or `PENDING`, and never `REJECTED`: a rejected line is not
    // covered, so it is never an entry. Anything else reads as approved, which is
    // the quiet direction — an unreadable value costs a caption rather than
    // putting one under a row the household already agreed to.
    awaitingApproval: raw['approvalStatus'] === 'PENDING',
    // False on anything but an explicit true. The server owns this rule and asks
    // it of the basket's owner, so a value this client cannot read means it has
    // not been told the control is allowed, and velista `0092` draws none.
    demandEditable: raw['demandEditable'] === true,
  };
}

/**
 * From `BasketRowView`: one thing to buy, however many households asked for it.
 *
 * Refused without a `rowKey`, without a `content` and without an `entries` array,
 * because each of the three is something the screen cannot draw a row without: no
 * key means no sheet and no write, no content means a blank row, and no entries
 * array means the wire sent something this build does not understand.
 *
 * **A row with no entry is refused, unless its state is `REMOVED`.** Every entry
 * of such a row left the coverage, which is exactly what that state means, so an
 * empty `entries` there is the truth rather than a failure to read one.
 */
export function toBasketRow(raw: unknown): BasketRow | null {
  if (!isRecord(raw)) {
    return null;
  }

  const rowKey = str(raw['rowKey']);
  const content = str(raw['content']);
  if (rowKey === null || content === null || !Array.isArray(raw['entries'])) {
    return null;
  }

  const state = oneOf(
    raw['state'],
    BASKET_ROW_STATES,
    BASKET_ROW_STATE_FALLBACK
  );
  const entries = mapArray(raw['entries'], toBasketRowEntry);
  if (entries.length === 0 && state !== 'REMOVED') {
    return null;
  }

  const note = oneOfOrNull(raw['note'], BASKET_ROW_NOTES);
  const bought = atLeastZero(raw['bought']);
  const left = atLeastZero(raw['left']);

  return {
    rowKey,
    content,
    left,
    bought,
    // Read where the wire states it, and the sum where it does not, which is the
    // same arithmetic backend `0130` section 4 defines it by. Never `bought`
    // plus something this client worked out.
    asked: 'asked' in raw ? atLeastZero(raw['asked']) : bought + left,
    state,
    note,
    // Null exactly when the note is, which the server promises and this enforces:
    // a time with no fact behind it is a caption with nothing to say.
    noteAt: note === null ? null : date(raw['noteAt']),
    // Null on every row until backend `0138` produces one, and null for a value
    // this build does not know. Velista `0093` draws it; nothing draws it yet.
    mark: oneOfOrNull(raw['mark'], BASKET_CHANGE_MARKS),
    awaitingApproval: raw['awaitingApproval'] === true,
    optionIds: mapArray(raw['optionIds'], str),
    touchedBy: nullableStr(raw['touchedBy']),
    touchedAt: date(raw['touchedAt']),
    entries,
  };
}

/**
 * From `BasketListRef`: a covered list this reader holds `WRITE` on.
 *
 * Every field is required. A ref exists to head a section and to caption an
 * entry, and half of one renders as a heading with no words in it.
 */
/**
 * Drop every entry's list id the reader was not served a ref for.
 *
 * **The whole of this scope's redaction rule, in one function.** A guest is served
 * no refs, so every entry they hold is unplaceable; a co shopper is served their
 * own. Doing it here rather than at each call site is what stops the filter, the
 * grouping and the entries pane from answering "may I name this list" three ways.
 *
 * By identity when nothing is dropped, which is the ordinary case: the server
 * redacts consistently per reader, so a row whose ids all have refs comes back as
 * the same object and nothing above it re-renders.
 */
export function restrictRowToServedLists(
  row: BasketRow,
  served: ReadonlySet<string>
): BasketRow {
  const unserved = row.entries.some(
    (entry) => entry.listId !== null && !served.has(entry.listId)
  );
  if (!unserved) {
    return row;
  }

  return {
    ...row,
    entries: row.entries.map((entry) =>
      entry.listId !== null && !served.has(entry.listId)
        ? { ...entry, listId: null }
        : entry
    ),
  };
}

function toBasketListRef(raw: unknown): BasketListRef | null {
  if (!isRecord(raw)) {
    return null;
  }

  const listId = str(raw['listId']);
  const name = str(raw['name']);
  const zoneId = str(raw['zoneId']);
  const zoneName = str(raw['zoneName']);

  if (
    listId === null ||
    name === null ||
    zoneId === null ||
    zoneName === null
  ) {
    return null;
  }

  return { listId, name, zoneId, zoneName };
}

/**
 * From `BasketProgress`: what the basket comes to, by the server.
 *
 * Null rather than a zeroed default when it cannot be read, and the two callers
 * both refuse on that null. Counting the rows instead would be a second
 * arithmetic, and a second arithmetic is what velista `0090` exists to remove.
 *
 * `pending` is lifted out by the caller rather than kept here, because a
 * {@link BasketProgress} is also what `basketRowsProgress` answers for a section,
 * and a section has no honest pending to state.
 */
function toBasketProgress(raw: unknown): BasketProgress | null {
  if (!isRecord(raw)) {
    return null;
  }

  return {
    done: atLeastZero(raw['done']),
    unavailable: atLeastZero(raw['unavailable']),
    total: atLeastZero(raw['total']),
  };
}

/** A count off the wire, floored at zero. A negative is a defect, not a number. */
function atLeastZero(raw: unknown): number {
  return Math.max(0, numOr(raw, 0));
}

/**
 * From `BasketRowResult`: what every write on a row answers.
 *
 * Refused when the row or the progress cannot be read, and both refusals mean the
 * same thing: the store folds the answer whole and patches nothing, so an answer
 * it cannot fold is one it must not half apply. The caller reads the basket again
 * instead.
 *
 * ## The row the write emptied
 *
 * `row` is never null **on the wire**: the server answers a row carrying the
 * requested key, an empty `entries` array and zeros where the write took the row
 * out of the basket, which only a demand lowered to zero can do (velista `0092`,
 * section 6.2). {@link toBasketRow} already refuses an entryless row that is not
 * `REMOVED`, so that answer is read here as `row: null` rather than as an answer
 * this build could not read.
 *
 * The two are told apart by whether the wire held a row shaped record at all:
 * a record with an `entries` array is an answer, and its emptiness is the
 * server's way of saying the row is gone. Anything else is a body this build
 * cannot fold, and the caller reads the basket again instead.
 *
 * `replacedRowKey` and `skippedCount` are absent on the wire when nothing
 * happened, and null and zero here, so a caller asks one question rather than
 * two.
 *
 * The row's list ids are **not** gated here, because there are no refs in this
 * answer to gate them against. The store applies
 * {@link restrictRowToServedLists} with the basket's own refs as it folds.
 */
export function toBasketRowResult(raw: unknown): BasketRowResult | null {
  if (!isRecord(raw)) {
    return null;
  }

  const progress = toBasketProgress(raw['progress']);
  if (progress === null) {
    return null;
  }

  const row = toBasketRow(raw['row']);
  if (row === null && !isEmptiedRow(raw['row'])) {
    return null;
  }

  return {
    row,
    progress,
    // Lifted out of the wire's progress exactly as `Basket.pending` is, because
    // the store puts it back on the basket after every write and nothing in this
    // scope subtracts one count from another.
    pending: isRecord(raw['progress'])
      ? atLeastZero(raw['progress']['pending'])
      : 0,
    replacedRowKey: str(raw['replacedRowKey']),
    skippedCount: atLeastZero(raw['skippedCount']),
  };
}

/**
 * Whether the wire's `row` is the server's "this row is gone" answer.
 *
 * A record with an `entries` array holding nothing. That is the shape
 * `BasketWriteContext.result` answers when the lines a write touched left the
 * view, and it is deliberately not a missing key: the server states the row it
 * was asked about and says it is empty, so a build that reads neither the
 * emptiness nor the key is a build that misread the body rather than one that
 * met a gone row.
 *
 * Nothing else about the record is checked. `toBasketRow` has already refused
 * it, so this only has to tell "the row went away" from "this is not a row".
 */
function isEmptiedRow(raw: unknown): boolean {
  return (
    isRecord(raw) && Array.isArray(raw['entries']) && raw['entries'].length === 0
  );
}

/**
 * A rename's answer (velista `0084`, backend `0113`, section 7).
 *
 * The same shape every write on a row answers, read once, with the wire's
 * `replacedRowKey` named for what a rename does with it: the earliest line
 * survives a merge, so the row the request addressed can be the one that went
 * away, and the sheet reads this to know whether its own row survived.
 */
export function toBasketRenameResult(raw: unknown): BasketRenameResult | null {
  const result = toBasketRowResult(raw);
  return result === null
    ? null
    : { ...result, absorbedRowKey: result.replacedRowKey };
}

/**
 * Every place a rename's name is taken, from a `line_merge_required` refusal's
 * `details` (backend `0113`, section 4). Null when the details cannot be read.
 *
 * **All or nothing, unlike `mapArray`.** A row dropped here is a merge the reader
 * would confirm without being shown it, so one unreadable row refuses the whole
 * question, and the sheet says the save failed instead of asking half of it.
 */
export function toBasketMergeRequired(
  details: unknown
): BasketMergeRequired | null {
  if (!isRecord(details) || !Array.isArray(details['lists'])) {
    return null;
  }

  const lists: BasketMergeRequiredList[] = [];
  for (const raw of details['lists']) {
    const row = toMergeRequiredList(raw);
    if (row === null) {
      return null;
    }
    lists.push(row);
  }

  let basket: BasketMergeRequiredBasket | null = null;
  if (details['basket'] !== null && details['basket'] !== undefined) {
    basket = toMergeRequiredBasket(details['basket']);
    if (basket === null) {
      return null;
    }
  }

  // A refusal that names no place at all asks nothing, so it is not a question.
  return lists.length === 0 && basket === null ? null : { lists, basket };
}

function toMergeRequiredList(raw: unknown): BasketMergeRequiredList | null {
  if (!isRecord(raw)) {
    return null;
  }
  const listId = str(raw['listId']);
  const listName = str(raw['listName']);
  const otherQuantity = nullableNum(raw['otherQuantity']);
  return listId === null || listName === null || otherQuantity === null
    ? null
    : {
        listId,
        listName,
        // The zone is the second line of a row, so a missing one costs a line of
        // text rather than the whole question.
        zoneName: strOr(raw['zoneName'], ''),
        otherQuantity,
      };
}

function toMergeRequiredBasket(raw: unknown): BasketMergeRequiredBasket | null {
  if (!isRecord(raw)) {
    return null;
  }
  // The line id the refusal names is the other row's anchor, which is that row's
  // key: the refusal is about a line on a list, and a row is keyed by one.
  const otherRowKey = str(raw['otherLineId']);
  const otherQuantity = nullableNum(raw['otherQuantity']);
  return otherRowKey === null || otherQuantity === null
    ? null
    : { otherRowKey, otherQuantity };
}

/**
 * From catalog's `ItemView`, kept to what a row and the swap sheet draw.
 *
 * `bestOffer` is read since velista `0062`: the cheapest price at the run's
 * scopes, or null. What is still **not** read into anything is a claim about the
 * pick, which backend `0050` resolves to the first option added rather than the
 * cheapest; the sheet marks the cheapest option and leaves the pick alone.
 */
function toBasketProduct(raw: unknown): BasketProduct | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  return id === null
    ? null
    : {
        id,
        name: toLocalizedName(raw['name']),
        brand: nullableStr(raw['brand']),
        size: typeof raw['unitSize'] === 'number' ? raw['unitSize'] : null,
        unit: nullableStr(raw['defaultUnit']),
        offer: toProductOffer(raw['bestOffer']),
        // Every scope's offer (velista `0078`, section 2). Absent for every caller
        // but the basket read, which is the only one that asks backend `0109` for
        // `offers: 'all'`, and absent from an older gateway; both map to an empty
        // list, which draws as a basket nobody has priced rather than as a basket
        // nothing is listed in. An entry with no scope id is dropped by
        // `toProductOffer`, since a price nothing can be attributed to is a price no
        // shop charges.
        offers: mapArray(raw['offers'], toProductOffer),
        // One wire value into a one element list (velista `0077`, section 2). The
        // field is required on `ItemView` and has been since the catalog existed, so
        // the fallback covers a thirteenth category rather than an older backend,
        // and it folds onto `OTHER` rather than dropping the product: a line whose
        // aisle this build cannot name is still a line to buy.
        categories: [
          oneOf(raw['category'], PRODUCT_CATEGORIES, PRODUCT_CATEGORY_FALLBACK),
        ],
      };
}

/** From `BasketScopeLocationView`: one shop, as much of it as the sheet draws. */
function toScopeLocation(raw: unknown): ScopeLocation | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['supermarketLocationId']);
  return id === null
    ? null
    : {
        id,
        label: isRecord(raw['label']) ? toLocalizedName(raw['label']) : null,
        address: nullableStr(raw['address']),
        city: nullableStr(raw['city']),
        postalCode: nullableStr(raw['postalCode']),
      };
}

/**
 * From `BasketPriceScopeView` (velista `0062`, section 3).
 *
 * `locations` degrades to empty rather than absent, and that is the model's
 * own rule and not a mapper's shortcut: a reader the server withheld the shops
 * from and a scope catalog cannot place both draw the chain alone, and nothing
 * anywhere branches on which it was.
 */
function toBasketPriceScope(raw: unknown): BasketPriceScope | null {
  if (!isRecord(raw)) {
    return null;
  }

  const priceScopeId = str(raw['priceScopeId']);
  return priceScopeId === null
    ? null
    : {
        priceScopeId,
        supermarketName: toLocalizedName(raw['supermarketName']),
        locations: mapArray(raw['locations'], toScopeLocation),
      };
}

/**
 * From the gateway's `GET /v1/baskets/:id`.
 *
 * Null when there is no reader and null when there is no progress, and the two
 * refusals are the same kind of refusal. `me` is what every attribution on the
 * screen resolves against, so a basket that cannot say who is holding it cannot
 * be drawn. `progress` is what the sentence above the rows says, and the only
 * other way to answer it is to count the rows, which is the arithmetic backend
 * `0130` took over.
 *
 * Everything else degrades rather than failing, which is what a person standing
 * in an aisle needs: a row that will not map is dropped, and a catalog that was
 * unreachable costs the product captions and not the page.
 *
 * ## The lists are read first, and that is the order
 *
 * {@link toBasketRowEntry} drops a list id the basket served no ref for, so the
 * refs have to exist before a single row is read. That is the whole of this
 * scope's redaction, done once here rather than at every reader of an entry.
 */
export function toBasket(raw: unknown): Basket | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const me = toBasketParticipant(raw['me']);
  const progress = toBasketProgress(raw['progress']);
  if (id === null || me === null || progress === null) {
    return null;
  }

  const lists = mapArray(raw['lists'], toBasketListRef);
  const served = new Set(lists.map((list) => list.listId));

  return {
    id,
    kind: oneOf(raw['kind'], BASKET_KINDS, BASKET_KIND_FALLBACK),
    name: nullableStr(raw['name']),
    status: oneOf(raw['status'], BASKET_STATUSES, BASKET_STATUS_FALLBACK),
    createdAt: date(raw['createdAt']),
    rows: mapArray(raw['rows'], (row) => {
      const mapped = toBasketRow(row);
      return mapped === null ? null : restrictRowToServedLists(mapped, served);
    }),
    lists,
    participants: mapArray(raw['participants'], toBasketParticipant),
    me,
    products: new Map(
      mapArray(raw['products'], toBasketProduct).map((product) => [
        product.id,
        product,
      ])
    ),
    // Empty when the key is missing, which is a gateway that priced the read and
    // could not name the scopes. An offer whose scope is not in here resolves to
    // no place and is still a price.
    scopes: new Map(
      mapArray(raw['scopes'], toBasketPriceScope).map((scope) => [
        scope.priceScopeId,
        scope,
      ])
    ),
    progress,
    // Lifted out of the wire's progress because the finish sheet and the home
    // card read it on its own, and the alternative is for one of them to
    // subtract three numbers the server already subtracted.
    pending: isRecord(raw['progress'])
      ? atLeastZero(raw['progress']['pending'])
      : 0,
  };
}

/**
 * From the gateway's `GET /v1/baskets/live/summary` (velista `0091`).
 *
 * Null when there is no id and null when there is no progress, for
 * {@link toBasket}'s reason: the card's whole content is the sentence those
 * numbers make, and a card drawn from defaults would say "0 to buy" to somebody
 * with a full basket. The dashboard draws the card with its title and no
 * sentence instead, which is what a failed read already produces.
 *
 * `pending` is lifted out of the wire's `progress` exactly as {@link Basket}'s
 * is, so the two reads of one number cannot drift.
 */
export function toLiveBasketSummary(raw: unknown): LiveBasketSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const progress = toBasketProgress(raw['progress']);
  if (id === null || progress === null) {
    return null;
  }

  return {
    id,
    progress,
    pending: isRecord(raw['progress'])
      ? atLeastZero(raw['progress']['pending'])
      : 0,
  };
}

/**
 * From `BasketLinkPreview` (`GET /v1/share-links/:secret`).
 *
 * **Never null**, because the route never fails by design: a link that never
 * existed, one revoked, one expired and one whose basket is finished all answer
 * the same way, which is what keeps the four indistinguishable (plan 0051,
 * section 3.1).
 *
 * A body this build cannot read is therefore also "not joinable". The one thing
 * this screen must never do is offer a Continue button it cannot honour, and
 * defaulting the other way would do exactly that on a malformed response.
 */
export function toBasketLinkPreview(raw: unknown): BasketLinkPreview {
  if (!isRecord(raw) || raw['joinable'] !== true) {
    return { joinable: false };
  }

  return {
    joinable: true,
    name: nullableStr(raw['name']),
    participantCount: numOr(raw['participantCount'], 0),
  };
}

/**
 * From `BasketJoinResult` (`POST /v1/share-links/:secret/join`).
 *
 * All three of the basket id, the participant and the socket token are required.
 * Without the first there is nowhere to store the credential, without the second
 * there is nobody to attribute an edit to, and without the third the basket is
 * not live, which is most of what sharing one is for.
 */
export function toBasketSession(raw: unknown): BasketSession | null {
  if (!isRecord(raw)) {
    return null;
  }

  const basketId = str(raw['basketId']);
  const participant = toBasketParticipant(raw['participant']);
  const socketToken = str(raw['socketToken']);

  if (basketId === null || participant === null || socketToken === null) {
    return null;
  }

  return {
    basketId,
    participantId: participant.id,
    // Null for a registered participant and for the owner, who authenticate with
    // their account token and are given no second credential.
    secret: nullableStr(raw['sessionSecret']),
    socketToken,
    socketTokenExpiresAt: date(raw['socketTokenExpiresAt']),
  };
}

/**
 * From `BasketShareLinkResult` or `BasketShareLinkView`.
 *
 * The `GET` wraps an optional link and the `PUT` answers the view itself, so the
 * wrapper is unwrapped here rather than at both call sites. Null means the basket
 * is not shared right now, which is an ordinary state and not a failure: a basket
 * has zero links or one.
 */
export function toBasketShareLink(raw: unknown): BasketShareLink | null {
  if (!isRecord(raw)) {
    return null;
  }

  const link = isRecord(raw['link']) ? raw['link'] : raw;

  const id = str(link['id']);
  const secret = str(link['secret']);
  return id === null || secret === null
    ? null
    : {
        id,
        secret,
        createdAt: date(link['createdAt']),
        expiresAt: date(link['expiresAt']),
        participantCount: numOr(link['participantCount'], 0),
      };
}
