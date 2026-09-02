import { GatewayError } from '@portfolio/velista/data-access';

/**
 * Which sentence a failure gets on the basket, keyed on the code **and the operation**
 * (plan 0052, section 7.2).
 *
 * In the shape of `list-error-copy.ts`, for the reason `zone-error-copy.ts` sets out at
 * length: the gateway's catalog holds exactly one message per code, so
 * `GatewayError.serverMessage` reads identically for every conflict in the product and
 * is a fallback rather than copy. This screen writes its own.
 *
 * ## Why the operation is part of the key here
 *
 * `forbidden` and `conflict` each mean several things on this one screen. A refused
 * settle is somebody whose access to a source list moved since the basket was
 * generated; a refused revoke is somebody who is not the owner. They are different
 * sentences to the person reading them, and one message for both would be no sentence
 * at all.
 *
 * ## What is deliberately absent
 *
 * **`unauthorized` has no row.** `BasketStore._fail` already turns a 401 into the
 * `revoked` or `needsJoin` state, which is a whole screen rather than a sentence, and
 * that stays where it is. Reaching a row here for one would mean drawing a sentence
 * over a screen that has already said something better.
 */
export type BasketOperation =
  /** Loading the basket, refreshing it. */
  | 'basket.read'
  /** Settle all, settle some, allocate, they had none. */
  | 'basket.settle'
  /** Taking a finished line back to outstanding (section 6). */
  | 'basket.reopen'
  /** Swapping the line's pick to another of its options. */
  | 'basket.pick'
  /** Minting the link, revoking it. */
  | 'basket.share'
  /** Removing somebody from the basket. */
  | 'basket.people'
  /** Saying how many are still to get, from the row's own number (velista 0054). */
  | 'basket.outstanding'
  /** The units sheet: reading the lists on a line, and changing what one asked for. */
  | 'basket.origins'
  /** The send sheet: reading where a line may go, and sending it there. */
  | 'basket.bind';

/** The message any failure falls back to, including one with no code at all. */
const GENERIC = 'basket.error.failed';

/**
 * The key to render for a failure on this screen. Never null and never empty.
 *
 * Unlike `listErrorKey` there is no silent outcome. Every act on this screen is one
 * somebody in a shop performed on purpose and is waiting on, so a failure that said
 * nothing would leave them believing a line was settled that was not.
 */
export function basketErrorKey(
  error: unknown,
  operation: BasketOperation
): string {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport. The blocking
    // connection screen owns the first of those.
    return GENERIC;
  }

  switch (error.code) {
    case 'stale_quantity':
      // The number this write was moving is not where the control believed it
      // started, which is two phones in one shop working one line. The store has
      // already refetched by the time this is read, so the sentence names the number
      // as it now stands rather than saying the save failed.
      //
      // Every operation, and deliberately not keyed on one: it means exactly the
      // same thing to somebody dragging a row's number and to somebody typing a
      // household's share.
      return 'basket.error.staleLine';

    case 'below_settled':
      // A contribution set under what this basket has already bought against that
      // list. Nothing moved underneath the caller, so this is not the sentence
      // above: two of the flat's milk having been bought means the flat cannot
      // retroactively have wanted one.
      return 'basket.error.belowSettled';

    case 'generated_list_finished':
      // The trip is over. Its own code on the backend since luna `0055`, and its own
      // member here since velista `0054`, because read as a plain conflict it drew
      // "somebody already finished this line" over a line nobody had finished.
      return 'basket.error.basketFinished';

    case 'not_found':
      // The basket, or the line on it. Either way there is nothing left to act on,
      // and the two are indistinguishable to whoever is holding the phone.
      return 'basket.error.gone';

    case 'conflict':
      switch (operation) {
        case 'basket.settle':
        case 'basket.outstanding':
          // Somebody else finished this line between the sheet opening and the tap
          // landing, which luna `0054` section 4 is what makes reachable as a
          // conflict: it used to arrive as `validation_failed`, indistinguishable
          // from a malformed quantity. Two people working one list in a shop is the
          // ordinary case rather than the exotic one, so it gets its own sentence.
          return 'basket.error.alreadyFinished';
        case 'basket.bind':
          // A line can be sent to one list and only once. This is the person who
          // pressed send twice, or two phones that both did, and it is not a failure
          // so much as an answer: it has already gone.
          return 'basket.error.alreadySent';
        default:
          return GENERIC;
      }

    case 'validation_failed':
      switch (operation) {
        case 'basket.settle':
          // The same sentence as the conflict above, for a backend **before** luna
          // `0054`, where an already finished line raised a validation failure.
          // Caught in the sheet before the request in every other case, so this is
          // the belt on top of the braces.
          return 'basket.error.alreadyFinished';
        case 'basket.bind':
          // The one thing a bind refuses on the shape of the line rather than on its
          // state: only a line somebody typed here can be sent to a list, because a
          // derived one already has the lists it came from. The control is not drawn
          // over one, so this is the belt.
          return 'basket.error.notSendable';
        default:
          return GENERIC;
      }

    case 'forbidden':
      // `basket.origins` and `basket.bind` sit with the row writes rather than apart:
      // the three zone surfaces refuse a guest and a reader who has lost `WRITE`
      // outright rather than answering an empty sheet, so a 403 on one of them is the
      // same fact as a 403 on a settle. The comment is above the group and not between
      // two of its labels because `no-fallthrough` reads one there as a case with a
      // body and no break.
      switch (operation) {
        case 'basket.settle':
        case 'basket.reopen':
        case 'basket.outstanding':
        case 'basket.origins':
        case 'basket.bind':
          // Access to one of the lists behind this line moved since the basket was
          // generated. The line is still on the screen and still readable, so this
          // says what changed rather than taking the basket away.
          return 'basket.error.accessChanged';
        case 'basket.share':
        case 'basket.people':
          // The one thing that stays the owner's, even for a registered participant
          // who passes the all or nothing rule everywhere else (`0044` section 4.1).
          // Neither control is drawn for anybody else, so this is the belt.
          return 'basket.error.ownerOnly';
        default:
          // A refused read or a refused pick. Neither has a reading specific enough
          // to be worth its own sentence: the options behind a pick are catalog data
          // that everybody may swap, so a 403 on one is a server side surprise rather
          // than something the reader did.
          return GENERIC;
      }

    case 'rate_limited':
      // A run of quick taps through an aisle hitting a bucket. Nothing is wrong and
      // nothing is lost, so the sentence says when to try rather than what broke.
      return 'basket.error.tooFast';

    default:
      // `unauthorized` never reaches here; see the class comment. Everything else
      // gets the generic sentence with the correlation id beside it.
      return GENERIC;
  }
}

/**
 * The support reference to show beside a generic failure, when there is one.
 *
 * Plan 0052 section 7.2 asks for this to be reused from `list-error-copy.ts` rather
 * than copied, and it is **not**, for a reason the plan could not see: the only way to
 * reach that one is `@portfolio/velista/feature-lists`, whose barrel is a feature
 * library's worth of routed components. Importing it would put an edge from one
 * feature library to another into a module federation app to reuse three lines, and
 * pull the list page's chunk into the basket's.
 *
 * `zone-error-copy.ts` already answered the same question the same way, so this is the
 * house pattern rather than a new one: three identical copies, one per feature
 * library, none of which depends on another. The real deduplication is a home for it
 * beside `GatewayError` in `data-access`, which is its own change and touches two
 * libraries this plan does not.
 */
export function correlationIdOf(error: unknown): string | null {
  return error instanceof GatewayError ? error.correlationId : null;
}
