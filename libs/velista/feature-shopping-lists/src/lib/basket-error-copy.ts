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
 * **`unauthorized` and `not_a_participant` have no row.** Both are 401s, and
 * `BasketStore._fail` already turns a 401 into the `revoked` or `needsJoin`
 * state, which is a whole screen rather than a sentence, and
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
  /** Giving units of a line to other products, which splits it (velista 0069). */
  | 'basket.split'
  /** Minting the link, revoking it. */
  | 'basket.share'
  /** Removing somebody from the basket. */
  | 'basket.people'
  /** Saying how many are still to get, from the row's own number (velista 0054). */
  | 'basket.outstanding'
  /** The summary: reading every list on a line, and changing what one asked for. */
  | 'basket.origins'
  /**
   * Changing what one list **got**, from the summary's second reel (velista 0073).
   *
   * Apart from `basket.origins` because it is the opposite act on the same rows: that
   * one changes what a household asked for and buys nothing, and this one records a
   * purchase or takes one back. A conflict on it is somebody else finishing the line,
   * which is the settle's sentence and not the generic one.
   */
  | 'basket.originSettled'
  /** Renaming a line, and the zone lines it came from (velista 0084). */
  | 'basket.rename';

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

    case 'basket_finished':
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
        case 'basket.originSettled':
          // Somebody else finished this line between the sheet opening and the tap
          // landing, which luna `0054` section 4 is what makes reachable as a
          // conflict: it used to arrive as `validation_failed`, indistinguishable
          // from a malformed quantity. Two people working one list in a shop is the
          // ordinary case rather than the exotic one, so it gets its own sentence.
          return 'basket.error.alreadyFinished';
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
        default:
          // A refused raise, among others. The units sheet answers this one itself
          // (velista `0068`, section 5): a list that said no to the line and a list
          // another basket has claimed both arrive here, and the honest sentence is
          // whichever of the two the row says about itself once it has been read
          // again, so the sheet re-reads rather than picking one blind.
          return GENERIC;
      }

    case 'forbidden':
      // `basket.origins` sits with the row writes rather than apart: the zone surface
      // refuses a guest and a reader who has lost `WRITE` outright rather than
      // answering an empty sheet, so a 403 on it is the same fact as a 403 on a
      // settle. The comment is above the group and not between two of its labels
      // because `no-fallthrough` reads one there as a case with a body and no break.
      switch (operation) {
        // The last two refuse a guest and a reader who has lost `WRITE` outright
        // rather than answering an empty sheet, so a 403 on one of them is the same
        // fact the first two report.
        case 'basket.settle':
        case 'basket.reopen':
        case 'basket.outstanding':
        case 'basket.origins':
        case 'basket.originSettled':
          // Access to one of the lists behind this line moved since the basket was
          // generated. The line is still on the screen and still readable, so this
          // says what changed rather than taking the basket away.
          return 'basket.error.accessChanged';
        case 'basket.rename':
          // The server asks who may rename per request, against every list behind the
          // line, so a field drawn from the last basket read can be one write stale.
          return 'basket.error.renameForbidden';
        case 'basket.share':
        case 'basket.people':
          // The one thing that stays the owner's, even for a registered participant
          // who passes the all or nothing rule everywhere else (`0044` section 4.1).
          // Neither control is drawn for anybody else, so this is the belt.
          return 'basket.error.ownerOnly';
        default:
          // A refused read or a refused split. Neither has a reading specific
          // enough to be worth its own sentence: the options a split moves units
          // between are catalog data that everybody may use, so a 403 on one is a
          // server side surprise rather than something the reader did.
          return GENERIC;
      }

    case 'line_merge_needs_approval':
      // A pending line renamed onto an approved one on some list (backend 0112). The
      // list is named when the refusal says which; backend 0113 puts that name only in
      // the server's own sentence today, so the unnamed zone sentence stands in.
      return listNameOf(error) === null
        ? 'list.error.mergeNeedsApproval'
        : 'basket.error.mergeNeedsApproval';

    case 'line_merge_too_many_products':
      // Both sentences interpolate the bound, so without one this is the generic
      // failure rather than a sentence with a hole in it.
      if (maxOf(error) === null) {
        return GENERIC;
      }
      return listNameOf(error) === null
        ? 'list.error.mergeTooManyProducts'
        : 'basket.error.mergeTooManyProducts';

    case 'rate_limited':
      // A run of quick taps through an aisle hitting a bucket. Nothing is wrong and
      // nothing is lost, so the sentence says when to try rather than what broke.
      return 'basket.error.tooFast';

    default:
      // Neither 401 code reaches here; see the class comment. Everything else
      // gets the generic sentence with the correlation id beside it.
      return GENERIC;
  }
}

/**
 * What a refusal's sentence interpolates: the list it names and the product bound.
 *
 * Read from `details`, the only machine readable half of a refusal. Absent keys stay
 * absent, and {@link basketErrorKey} only picks a sentence whose arguments are here.
 */
export function basketErrorArgs(
  error: unknown
): Readonly<Record<string, unknown>> {
  const list = listNameOf(error);
  const max = maxOf(error);
  return {
    ...(list === null ? {} : { list }),
    ...(max === null ? {} : { max }),
  };
}

function listNameOf(error: unknown): string | null {
  const name =
    error instanceof GatewayError ? error.details?.['listName'] : undefined;
  return typeof name === 'string' && name !== '' ? name : null;
}

function maxOf(error: unknown): number | null {
  const max =
    error instanceof GatewayError ? error.details?.['max'] : undefined;
  return typeof max === 'number' && Number.isFinite(max) ? max : null;
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
