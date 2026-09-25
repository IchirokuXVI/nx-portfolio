import { ERROR_CODES, type ErrorCode } from './error-codes';

/**
 * The domain exception hierarchy (plan 0004, section 2).
 *
 * A service throws one of these to signal a *deliberately handled* domain outcome
 * (not found, permission denied, a conflict). They carry a stable {@link ErrorCode}
 * and optional structured details, and the exception filter turns them into the
 * house error envelope with the right HTTP status and a localized message. Because
 * the code, not the class, crosses the broker, auth/core can raise these and the
 * gateway reproduces them for the client without sharing a stack.
 *
 * Anything that is *not* one of these is treated as unexpected: logged at `error`
 * with full reproduction context and returned as a generic 500 (section 1).
 */
export abstract class DomainException extends Error {
  abstract readonly code: ErrorCode;

  /**
   * Optional machine details. For a validation error this is the per field map;
   * for others it can carry the offending id or key. Never contains secrets.
   */
  readonly details?: Record<string, unknown>;

  /**
   * Message arguments for the error catalog (for example the resource name), so
   * the localized message can be parameterized without embedding user text here.
   */
  readonly messageArgs?: Record<string, string | number>;

  /**
   * Whether {@link details} reaches the client on the error envelope (plan 0112,
   * section 2).
   *
   * Off unless a class turns it on, because the bag was written for logs and
   * for the thrower's own tests long before anything published it: most of what
   * it carries today is a field message nobody reviewed as a public contract. A
   * class that turns it on is stating that its details are part of the API.
   */
  readonly exposesDetails: boolean = false;

  constructor(
    message: string,
    options?: {
      details?: Record<string, unknown>;
      messageArgs?: Record<string, string | number>;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = new.target.name;
    this.details = options?.details;
    this.messageArgs = options?.messageArgs;
    if (options?.cause !== undefined) {
      // `Error`'s `cause` option needs the ES2022 lib; assign it directly so the
      // chain is preserved regardless of the compile target.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** The request body failed DTO validation, or a domain invariant on input. */
export class ValidationException extends DomainException {
  readonly code = ERROR_CODES.VALIDATION_FAILED;
}

/** No credentials, or the token could not be verified. */
export class UnauthorizedException extends DomainException {
  readonly code = ERROR_CODES.UNAUTHORIZED;
}

/**
 * The credential names no live participant of the basket addressed (plan 0051,
 * section 3.3). A 401 that says nothing about the account behind it, so a client
 * must not answer it by refreshing or ending the session. See
 * `ERROR_CODES.NOT_A_PARTICIPANT`.
 */
export class NotAParticipantException extends DomainException {
  readonly code = ERROR_CODES.NOT_A_PARTICIPANT;
}

/**
 * The credential named a participant of this basket whose access ran out (plan
 * 0140, section 8).
 *
 * Raised only after the ordinary lookup found nothing live, and only for a
 * caller whose own row ended by the clock. Everybody else keeps
 * {@link NotAParticipantException}. See `ERROR_CODES.PARTICIPANT_EXPIRED`.
 */
export class ParticipantExpiredException extends DomainException {
  readonly code = ERROR_CODES.PARTICIPANT_EXPIRED;
}

/** Authenticated, but not allowed to perform this action (or on this zone). */
export class ForbiddenException extends DomainException {
  readonly code = ERROR_CODES.FORBIDDEN;
}

/** The addressed resource does not exist (or is not visible to the caller). */
export class NotFoundException extends DomainException {
  readonly code = ERROR_CODES.NOT_FOUND;
}

/** The request conflicts with current state (duplicate, version clash). */
export class ConflictException extends DomainException {
  readonly code = ERROR_CODES.CONFLICT;
}

/**
 * The feature exists in the code but is not configured on this deployment (plan
 * 0026): Google sign in with no OAuth credentials, registration with no SMTP
 * host.
 *
 * Renders as 501, and the distinction from every other code here is that it is a
 * statement about the server. Nothing the caller changes will make the request
 * succeed, and nothing is broken — the operator chose not to configure it.
 */
export class NotConfiguredException extends DomainException {
  readonly code = ERROR_CODES.NOT_CONFIGURED;
}

/**
 * The caller's build is older than the oldest this deployment serves (velista plan
 * 0034, D9).
 *
 * Renders as 426. Thrown only by `MinClientVersionGuard`, and only when the caller
 * identified itself with a version that parses *and* sorts below the configured
 * floor: an unrecognisable version, or no version at all, is never refused.
 */
export class ClientTooOldException extends DomainException {
  readonly code = ERROR_CODES.CLIENT_TOO_OLD;
}

/**
 * The basket is over, and the write asked to change it (plan 0055, section 3.3).
 *
 * A `COMPLETED` or `ARCHIVED` basket takes no new lines. Kept apart from
 * `conflict` and from `validation_failed` by its own code for the reason plan
 * 0054 section 4 gives: a client that cannot tell a state it can explain from a
 * bug it cannot will show the wrong sentence for both, and "this basket is
 * finished" is a sentence the shopper can act on.
 */
export class BasketFinishedException extends DomainException {
  readonly code = ERROR_CODES.BASKET_FINISHED;
}

/**
 * The basket has its own shop, and the request named a different one (plan
 * 0163).
 *
 * Renders as 409. A basket created with a shop keeps it for life and for every
 * participant, so a read or a settle at another shop is refused rather than
 * answered at the basket's own, which the caller did not ask for.
 */
export class BasketShopLockedException extends DomainException {
  readonly code = ERROR_CODES.BASKET_SHOP_LOCKED;
}

/**
 * The number being moved is not where the caller believed it started (plan 0057,
 * section 5).
 *
 * Renders as 409 beside {@link ConflictException} and stays apart from it by
 * code, because the client's reaction is not "that failed" but "refetch and
 * redraw the control where the number actually is". The message names the
 * current value through `messageArgs.current`, so the person is told what
 * happened rather than that something did.
 */
export class StaleQuantityException extends DomainException {
  readonly code = ERROR_CODES.STALE_QUANTITY;
}

/**
 * Too many attempts. Carries the wait so the client can count it down (plan 0021,
 * section 2.2). The seconds travel in {@link DomainException.details} under
 * {@link RETRY_AFTER_SECONDS_DETAIL}, and the exception filter lifts them onto the
 * envelope; the class exists so the throttler guard has something to throw that
 * the filter already knows how to render.
 */
export class RateLimitedException extends DomainException {
  readonly code = ERROR_CODES.RATE_LIMITED;
}

/**
 * The account has failed too many times in a row and is refusing attempts (plan
 * 0071, section 7).
 *
 * Renders as 423 beside {@link RateLimitedException}'s 429 and stays apart from
 * it by code, because the two protect different things and resolve differently:
 * throttling limits a source, so another address or another minute gets through,
 * while this protects one account, so neither does. The client's reaction is a
 * different sentence rather than a different wait, which is why it cannot be a
 * detail on the rate limit.
 *
 * It carries its wait the same way, under {@link RETRY_AFTER_SECONDS_DETAIL}, so
 * the screen can say when the window passes.
 */
export class AccountLockedException extends DomainException {
  readonly code = ERROR_CODES.ACCOUNT_LOCKED;
}

/**
 * The postal code is not one catalog holds (plan 0097, section 6.1).
 *
 * Thrown before the queue row is written, so a refused add leaves nothing
 * behind: the gateway asks catalog once, and a code the shipped national table
 * does not have is a typo rather than a coverage gap worth queueing.
 */
export class PostalCodeUnknownException extends DomainException {
  readonly code = ERROR_CODES.POSTAL_CODE_UNKNOWN;
}

/**
 * The queue row is `RUNNING`, and the write asked to change it (plan 0097,
 * section 6.2).
 *
 * Its own class beside {@link ConflictException} so the screen can say "wait for
 * the run" rather than the generic sentence. Requeueing a running row would
 * clear the attempt count of an attempt that is still in progress.
 */
export class RunInProgressException extends DomainException {
  readonly code = ERROR_CODES.RUN_IN_PROGRESS;
}

/**
 * The new name belongs to another line of the list, and the rename did not
 * confirm the merge (plan 0112, section 2).
 *
 * The one class that publishes its details, because the client cannot ask the
 * question without them: `otherLineId`, `otherContent` and `otherQuantity` name
 * the line the rename collided with. Nothing was written when this is thrown.
 */
export class LineMergeRequiredException extends DomainException {
  readonly code = ERROR_CODES.LINE_MERGE_REQUIRED;
  override readonly exposesDetails = true;
}

/**
 * A pending or rejected line was renamed onto an approved one by somebody who
 * holds neither `DECIDE` nor `MANAGE`, on a list that does not auto approve
 * (plan 0112, section 2).
 */
export class LineMergeNeedsApprovalException extends DomainException {
  readonly code = ERROR_CODES.LINE_MERGE_NEEDS_APPROVAL;
}

/**
 * The merged product set would pass the bound a line is held to (plan 0112,
 * section 2). The bound travels in `messageArgs.max` for the server's own
 * sentence, and in `details` as `{ max, offered }` for a client that writes its
 * own (velista plan 0083). It publishes its details because the bound is not a
 * constant the client could read: a line already past the cap raises it.
 */
export class LineMergeTooManyProductsException extends DomainException {
  readonly code = ERROR_CODES.LINE_MERGE_TOO_MANY_PRODUCTS;
  override readonly exposesDetails = true;
}

/**
 * A brand label made of punctuation, which makes no key (plan 0115,
 * section 5.3).
 *
 * Refused rather than stored, because a brand with no key cannot meet any
 * spelling of itself, which is the only thing the registry is for. LIDL's `-`
 * and `---` are the real cases.
 */
export class BrandLabelEmptyException extends DomainException {
  readonly code = ERROR_CODES.BRAND_LABEL_EMPTY;
}

/**
 * Another brand already holds this key (plan 0115, section 5.3).
 *
 * It publishes its details, for the same reason
 * {@link LineMergeRequiredException} does: the back office's next act is to open
 * the brand that holds the key, and it cannot without the id. The id travels
 * under {@link BRAND_KEY_HOLDER_DETAIL}.
 */
export class BrandKeyTakenException extends DomainException {
  readonly code = ERROR_CODES.BRAND_KEY_TAKEN;
  override readonly exposesDetails = true;
}

/**
 * The `details` key a {@link BrandKeyTakenException} names the holding brand
 * under.
 */
export const BRAND_KEY_HOLDER_DETAIL = 'brandId';

/**
 * A brand pointed at itself (plan 0124, section 3).
 *
 * Refused rather than ignored, because the two readings of a self link are a
 * brand that is linked and a brand that is not, and the column cannot hold both.
 */
export class BrandLinkToSelfException extends DomainException {
  readonly code = ERROR_CODES.BRAND_LINK_TO_SELF;
}

/**
 * The link would make a chain of links (plan 0124, section 3).
 *
 * It publishes its details for the same reason {@link BrandKeyTakenException}
 * does: the back office's next act is to open the brand that breaks the rule,
 * which is either the target that is itself a spelling or one of the brands
 * already pointing at this one. That id travels under
 * {@link BRAND_LINK_BLOCKER_DETAIL}.
 */
export class BrandLinkTooDeepException extends DomainException {
  readonly code = ERROR_CODES.BRAND_LINK_TOO_DEEP;
  override readonly exposesDetails = true;
}

/**
 * A brand was given both a private label chain and a link (plan 0124,
 * section 2).
 *
 * The canonical brand's chain is the one that counts, so a linked row holding a
 * chain of its own would be a second answer to which chain owns the label.
 */
export class BrandLinkOwnsNoChainException extends DomainException {
  readonly code = ERROR_CODES.BRAND_LINK_OWNS_NO_CHAIN;
}

/**
 * A linked brand was renamed onto a different key (plan 0124, section 4).
 *
 * No details: the brand the client was editing is the brand it already has on
 * screen, and there is nothing else to open. What it does next is either keep
 * the key or register the new spelling as a brand of its own.
 */
export class BrandLinkKeepsKeyException extends DomainException {
  readonly code = ERROR_CODES.BRAND_LINK_KEEPS_KEY;
}

/**
 * A brand that is nobody's spelling cannot be deleted (plan 0124).
 *
 * No details: the brand is the one the client asked about, and what it does
 * next is either link it to the brand it spells, or leave it alone.
 */
export class BrandNotLinkedException extends DomainException {
  readonly code = ERROR_CODES.BRAND_NOT_LINKED;
}

/**
 * The discovered place is already imported (plan 0152, section 5). No details:
 * the place is the one the client asked about.
 */
export class PlaceAlreadyImportedException extends DomainException {
  readonly code = ERROR_CODES.PLACE_ALREADY_IMPORTED;
}

/**
 * The catalog already holds a shop the place may be (plan 0152, section 2).
 *
 * It publishes its details, because the back office cannot offer a link
 * without them: the candidates travel under {@link PLACE_CANDIDATES_DETAIL}.
 * Nothing was written when this is thrown.
 */
export class PlaceMatchesLocationException extends DomainException {
  readonly code = ERROR_CODES.PLACE_MATCHES_LOCATION;
  override readonly exposesDetails = true;
}

/** The `details` key a {@link PlaceMatchesLocationException} lists its candidates under. */
export const PLACE_CANDIDATES_DETAIL = 'candidates';

/**
 * The run declared a price scope the chain does not hold (plan 0152, section
 * 1). It publishes the key under {@link SCOPE_KEY_DETAIL}, which is what the
 * operator types when they create the scope.
 */
export class ScopeNotFoundException extends DomainException {
  readonly code = ERROR_CODES.SCOPE_NOT_FOUND;
  override readonly exposesDetails = true;
}

/** The `details` key a {@link ScopeNotFoundException} names the key under. */
export const SCOPE_KEY_DETAIL = 'scopeKey';

/**
 * The `details` key a {@link BrandLinkTooDeepException} names the brand that
 * breaks the one level rule under.
 *
 * The same spelling as {@link BRAND_KEY_HOLDER_DETAIL} and a different fact: one
 * names the brand holding a key, the other the brand holding a link. A client
 * reads `details.brandId` either way, which is what lets one panel open
 * whichever brand a refusal is about.
 */
export const BRAND_LINK_BLOCKER_DETAIL = 'brandId';

/**
 * The `details` key a {@link RateLimitedException} or an
 * {@link AccountLockedException} carries its wait under.
 */
export const RETRY_AFTER_SECONDS_DETAIL = 'retryAfterSeconds';

/**
 * Reads a whole second wait out of a domain exception's details bag. Returns
 * undefined for every exception that does not carry one, which is all of them
 * except {@link RateLimitedException} and {@link AccountLockedException}.
 */
export function retryAfterSecondsOf(
  exception: DomainException
): number | undefined {
  const value = exception.details?.[RETRY_AFTER_SECONDS_DETAIL];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Type guard: is this a deliberately handled domain outcome? */
export function isDomainException(error: unknown): error is DomainException {
  return error instanceof DomainException;
}
