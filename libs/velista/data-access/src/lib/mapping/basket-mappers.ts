import {
  BASKET_LINE_KINDS,
  BASKET_ORIGIN_UNAVAILABLE_REASONS,
  PARTICIPANT_KIND_FALLBACK,
  PARTICIPANT_KINDS,
  type BasketBindResult,
  type BasketLine,
  type BasketLineOrigin,
  type BasketLineOriginDetail,
  type BasketLineOrigins,
  type BasketLineTarget,
  type BasketLinkPreview,
  type BasketOriginCandidate,
  type BasketOriginQuantityResult,
  type BasketParticipant,
  type BasketPresenceEntry,
  type BasketProduct,
  type BasketSession,
  type BasketSettleResult,
  type BasketShareLink,
  type BasketView,
} from '@portfolio/velista/models';
import { toLocalizedName } from './mappers';
import {
  date,
  isRecord,
  mapArray,
  nullableStr,
  numOr,
  oneOf,
  str,
  strOr,
} from './primitives';

/**
 * The basket, from the wire (velista `0044`; backend `0050` and `0051`).
 *
 * A file of its own rather than more of `mappers.ts`, which is already long, and
 * because everything here shares one rule that applies nowhere else in the app.
 *
 * ## Absent is not empty, and it is not null
 *
 * Backend `0051` section 5.2 redacts **by omission**: a reader who does not hold
 * `WRITE` on every source list of the run receives no `origins` key, no
 * `targetListId`, no `sourceSnapshot`, no `userAgent` and no `skipped`, rather
 * than receiving them empty. These mappers preserve that distinction with `in`
 * checks rather than collapsing everything to a default, because the screen draws
 * three genuinely different things:
 *
 * - **absent** — you may not see this, so no caption is drawn at all
 * - **empty** — you may see it and there is nothing, so an empty state is drawn
 * - **null** — you may see it and it is unset
 *
 * Flattening the first two is the bug that would show a guest a "from" caption
 * with nothing after it, or show a privileged reader nothing where a household
 * name belongs. Rule D4 applies as everywhere else: every parameter is `unknown`,
 * nothing throws, and a row that will not map is dropped rather than costing the
 * page.
 */

/**
 * From `GeneratedListParticipantView`.
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
 * From `GeneratedListLineOriginView`.
 *
 * Every id is required rather than defaulted: an origin exists to caption a row
 * with the household it came from, and half of one renders as "from " with
 * nothing after it.
 */
function toBasketLineOrigin(raw: unknown): BasketLineOrigin | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const zoneId = str(raw['zoneId']);
  const listId = str(raw['listId']);
  const lineId = str(raw['lineId']);

  return id === null || zoneId === null || listId === null || lineId === null
    ? null
    : { id, zoneId, listId, lineId, quantity: numOr(raw['quantity'], 0) };
}

/** From `GeneratedListBasketLineView`. */
export function toBasketLine(raw: unknown): BasketLine | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  if (id === null) {
    return null;
  }

  const line: BasketLine = {
    id,
    content: strOr(raw['content'], ''),
    quantity: numOr(raw['quantity'], 0),
    settled: numOr(raw['settledQuantity'], 0),
    pickId: nullableStr(raw['itemId']),
    optionIds: mapArray(raw['options'], str),
    position: numOr(raw['position'], 0),
    // Absent on a basket served by a backend from before luna `0055`, and null on
    // every line a run composed. Both read as null and draw the same nothing,
    // which is what lets the two sides ship in either order.
    createdBy: nullableStr(raw['createdByParticipantId']),
    touchedBy: nullableStr(raw['lastEditedByParticipantId']),
    touchedAt: date(raw['lastEditedAt']),
    // No fallback: null is a real value here, meaning nobody has settled this
    // line yet, and guessing either outcome would put a sentence on the row
    // about a purchase that has not happened.
    lastOutcome:
      raw['lastOutcome'] === 'BOUGHT' || raw['lastOutcome'] === 'NOT_AVAILABLE'
        ? raw['lastOutcome']
        : null,
    // Absent on a basket served by a backend from before luna `0055`, where every
    // line was composed by a run, so `DERIVED` is both the fallback for a value this
    // build does not know and the truth for an older server. Not gated by the all or
    // nothing rule, unlike the two fields below it: every reader is told what kind of
    // line they are looking at, and what is withheld is which household it touches.
    kind: oneOf(raw['origin'], BASKET_LINE_KINDS, 'DERIVED'),
  };

  const withOrigins =
    'origins' in raw
      ? { ...line, origins: mapArray(raw['origins'], toBasketLineOrigin) }
      : line;

  // An `in` check for `origins`' reason and not for its convenience. Absent is a
  // reader who may not have it, and null is a line that has been sent nowhere; the
  // send control is offered over the second and never over the first, so collapsing
  // them would draw it for a guest.
  return 'targetListId' in raw
    ? { ...withOrigins, targetListId: nullableStr(raw['targetListId']) }
    : withOrigins;
}

/**
 * From `LineOriginDetail`: one list already on a line, with everything the units
 * sheet draws (velista `0055`).
 *
 * The four ids are required and the two names are not, which is the same split
 * {@link toBasketLineOrigin} makes and for the same reason: a row with half an
 * identity cannot be written back to, while a row with no name is a list deleted
 * since the run and still has a number worth showing.
 */
function toBasketLineOriginDetail(raw: unknown): BasketLineOriginDetail | null {
  if (!isRecord(raw)) {
    return null;
  }

  const originId = str(raw['originId']);
  const listId = str(raw['listId']);
  const lineId = str(raw['lineId']);
  const zoneId = str(raw['zoneId']);

  if (
    originId === null ||
    listId === null ||
    lineId === null ||
    zoneId === null
  ) {
    return null;
  }

  return {
    originId,
    listId,
    lineId,
    zoneId,
    listName: nullableStr(raw['listName']),
    zoneName: nullableStr(raw['zoneName']),
    contributed: numOr(raw['contributed'], 0),
    listQuantity: numOr(raw['listQuantity'], 0),
    settledHere: numOr(raw['settledHere'], 0),
    // False unless the server said otherwise, which is the safe direction: a row
    // this build could not read the flag on draws no editor rather than one whose
    // every write the gateway refuses.
    writable: raw['writable'] === true,
  };
}

/**
 * From `OriginCandidate`: a list holding the same thing that is not on the line.
 *
 * **`unavailable` is absent when the candidate is adoptable**, which is the one
 * place in this file where absence is folded onto null rather than kept apart from
 * it. There are only two answers here, "you may take this" and a reason you may not,
 * and the wire spends a key on the first rather than a value; the model spends a
 * value, so the sheet has one field to branch on.
 */
function toBasketOriginCandidate(raw: unknown): BasketOriginCandidate | null {
  if (!isRecord(raw)) {
    return null;
  }

  const listId = str(raw['listId']);
  const lineId = str(raw['lineId']);
  const zoneId = str(raw['zoneId']);

  if (listId === null || lineId === null || zoneId === null) {
    return null;
  }

  const unavailable = raw['unavailable'];

  return {
    listId,
    lineId,
    zoneId,
    listName: nullableStr(raw['listName']),
    zoneName: nullableStr(raw['zoneName']),
    listQuantity: numOr(raw['listQuantity'], 0),
    content: strOr(raw['content'], ''),
    matchedOnText: raw['matchedOnText'] === true,
    // A reason this build has never heard of still means "not adoptable", so it
    // reads as `CLAIMED`, the one that says least about why. Offering the row anyway
    // would be a control the server refuses.
    unavailable:
      unavailable === null || unavailable === undefined
        ? null
        : oneOf(unavailable, BASKET_ORIGIN_UNAVAILABLE_REASONS, 'CLAIMED'),
  };
}

/**
 * From `msg.generatedList.lineOrigins.response` (`GET .../lines/:lineId/origins`).
 *
 * Null only when the line id is unreadable, because the sheet is about one line and
 * a report that cannot say which is not one. Both arrays degrade to empty, which is a
 * real state on both sides: a line whose lists were all taken off it, and a basket
 * whose zones hold nothing else like it.
 */
export function toBasketLineOrigins(raw: unknown): BasketLineOrigins | null {
  if (!isRecord(raw)) {
    return null;
  }

  const lineId = str(raw['lineId']);
  return lineId === null
    ? null
    : {
        lineId,
        origins: mapArray(raw['origins'], toBasketLineOriginDetail),
        candidates: mapArray(raw['candidates'], toBasketOriginCandidate),
      };
}

/**
 * From `msg.generatedList.setOriginQuantity.response` (`POST .../origins`).
 *
 * `origin` is **null on purpose** rather than dropped: a contribution set to zero
 * takes the list off the line, and the sheet has to remove the row rather than leave
 * it drawn at its old number. So a null answer is applied and only an unreadable
 * line refuses the whole result.
 */
export function toBasketOriginQuantityResult(
  raw: unknown
): BasketOriginQuantityResult | null {
  if (!isRecord(raw)) {
    return null;
  }

  const line = toBasketLine(raw['line']);
  return line === null
    ? null
    : {
        line,
        origin: toBasketLineOriginDetail(raw['origin']),
        listQuantity: numOr(raw['listQuantity'], 0),
      };
}

/**
 * From `LineTarget`: one list this line could be sent to (velista `0056`).
 *
 * `fromRun` defaults to false, which only costs the picker its ordering: a list the
 * run drew from that this build failed to read the flag on falls in with the rest
 * rather than disappearing from the picker altogether.
 */
export function toBasketLineTarget(raw: unknown): BasketLineTarget | null {
  if (!isRecord(raw)) {
    return null;
  }

  const listId = str(raw['listId']);
  const zoneId = str(raw['zoneId']);

  return listId === null || zoneId === null
    ? null
    : {
        listId,
        zoneId,
        listName: nullableStr(raw['listName']),
        zoneName: nullableStr(raw['zoneName']),
        fromRun: raw['fromRun'] === true,
      };
}

/**
 * From `msg.generatedList.bindLine.response` (`POST .../lines/:lineId/target`).
 *
 * The line, the list it went to, and whether it is waiting. `pendingApproval` reads
 * as false unless the server said true, and that is the direction that costs least:
 * a row that fails to say "waiting for that list to approve it" is quieter than one
 * that says it about a line already on the household's list.
 */
export function toBasketBindResult(raw: unknown): BasketBindResult | null {
  if (!isRecord(raw)) {
    return null;
  }

  const line = toBasketLine(raw['line']);
  const listId = str(raw['listId']);
  const zoneId = str(raw['zoneId']);
  const createdLineId = str(raw['createdLineId']);

  if (
    line === null ||
    listId === null ||
    zoneId === null ||
    createdLineId === null
  ) {
    return null;
  }

  return {
    line,
    listId,
    zoneId,
    createdLineId,
    quantity: numOr(raw['quantity'], 0),
    pendingApproval: raw['pendingApproval'] === true,
  };
}

/**
 * From catalog's `ItemView`, kept to what a row and the swap sheet draw.
 *
 * `bestOffer` is deliberately not read. Backend `0050` resolves a pick to the
 * first option added rather than the cheapest, and `0044` section 9 keeps prices
 * out of scope until a second chain is harvested, so a price on this screen would
 * be a number nothing behind it computed.
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
      };
}

/**
 * From the gateway's `GET /v1/generated-lists/:id/basket`.
 *
 * Null only when there is no reader: `me` is what every attribution on the screen
 * resolves against, and a basket that cannot say who is holding it cannot be
 * drawn at all. Everything else degrades rather than failing, which is what a
 * person standing in an aisle needs: a line that will not map is dropped, and a
 * catalog that was unreachable costs the product captions and not the page.
 */
export function toBasketView(raw: unknown): BasketView | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = str(raw['id']);
  const me = toBasketParticipant(raw['me']);
  if (id === null || me === null) {
    return null;
  }

  const view: BasketView = {
    id,
    name: nullableStr(raw['name']),
    status: strOr(raw['status'], 'UNKNOWN'),
    generatedAt: date(raw['generatedAt']),
    lines: mapArray(raw['lines'], toBasketLine),
    participants: mapArray(raw['participants'], toBasketParticipant),
    me,
    seesZoneData: raw['seesZoneData'] === true,
    products: new Map(
      mapArray(raw['products'], toBasketProduct).map((product) => [
        product.id,
        product,
      ])
    ),
    // Empty rather than absent, because a Map has no third state and the caption
    // is already gated by the line's own `origins` being absent. A reader who may
    // not see origins never reaches a lookup in here.
    listNames: new Map(
      mapArray(raw['sourceNames'], (entry) => {
        if (!isRecord(entry)) {
          return null;
        }
        const listId = str(entry['listId']);
        const name = str(entry['name']);
        if (listId === null || name === null) {
          return null;
        }
        const zoneName = nullableStr(entry['zoneName']);
        // "Weekly shop · Flat 3B", which is what the mock draws: the list alone
        // is ambiguous when two households both keep one called "Groceries".
        return [listId, zoneName ? `${name} · ${zoneName}` : name] as const;
      })
    ),
  };

  const snapshot = raw['sourceSnapshot'];
  if (!isRecord(snapshot)) {
    // Absent, which is the redacted case. `sources` stays undefined rather than
    // becoming an empty array, so "you may not see this" and "the run drew from
    // nothing" remain different answers.
    return view;
  }

  return {
    ...view,
    sources: mapArray(snapshot['sources'], (entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const zoneId = str(entry['zoneId']);
      const listId = str(entry['listId']);
      return zoneId === null || listId === null ? null : { zoneId, listId };
    }),
  };
}

/**
 * From `GeneratedListLinkPreview` (`GET /v1/share-links/:secret`).
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
 * From `GeneratedListJoinResult` (`POST /v1/share-links/:secret/join`).
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

  const generatedListId = str(raw['generatedListId']);
  const participant = toBasketParticipant(raw['participant']);
  const socketToken = str(raw['socketToken']);

  if (
    generatedListId === null ||
    participant === null ||
    socketToken === null
  ) {
    return null;
  }

  return {
    generatedListId,
    participantId: participant.id,
    // Null for a registered participant and for the owner, who authenticate with
    // their account token and are given no second credential.
    secret: nullableStr(raw['sessionSecret']),
    socketToken,
    socketTokenExpiresAt: date(raw['socketTokenExpiresAt']),
  };
}

/**
 * From `GeneratedListShareLinkResult` or `GeneratedListShareLinkView`.
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

/**
 * From `GeneratedListSettleResult` (`POST .../lines/:lineId/settle`).
 *
 * `skippedCount` is always a number and `skipped` stays absent for a reader who
 * may not have it, which is how backend `0051` sections 6.4 and 5.2 both hold:
 * everybody is told that an origin was missed, and only a reader who passes the
 * rule is told whose it was.
 */
export function toBasketSettleResult(raw: unknown): BasketSettleResult | null {
  if (!isRecord(raw)) {
    return null;
  }

  const line = toBasketLine(raw['line']);
  if (line === null) {
    return null;
  }

  const result: BasketSettleResult = {
    line,
    skippedCount: numOr(raw['skippedCount'], 0),
  };

  if (!('skipped' in raw)) {
    return result;
  }

  return {
    ...result,
    skipped: mapArray(raw['skipped'], (entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const listId = str(entry['listId']);
      // The names come off the report and are never looked up (plan 0049,
      // section 1.2). `str` answers null for an absent or non string field,
      // which is the same answer the wire gives for a list deleted since the
      // run, and the screen draws the bare count for both.
      return listId === null
        ? null
        : {
            listId,
            reason: strOr(entry['reason'], 'ACCESS_GONE'),
            listName: str(entry['listName']),
            zoneName: str(entry['zoneName']),
          };
    }),
  };
}
