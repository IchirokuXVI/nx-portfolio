import { HttpStatus } from '@nestjs/common';

/**
 * Stable, transport neutral error codes (plan 0004, sections 2 and 10).
 *
 * A code is the contract between services and the client: broker errors carry the
 * code and the gateway maps it to an HTTP status rather than leaking a raw stack,
 * and the client shows a message the {@link ERROR_CATALOG} already translated. The
 * string values are the wire format and must stay stable; add new codes rather
 * than renaming existing ones.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  /**
   * The credential names no live participant of this basket: removed, left,
   * revoked with the link, or never joined (plan 0051, section 3.3).
   *
   * A 401 like {@link UNAUTHORIZED}, because to the basket surface the credential
   * is refused, but its own code because it says nothing about the account. A
   * signed in member removed from a basket still holds a perfectly good token,
   * and a client that read this as `unauthorized` refreshed that token, was
   * refused again, and signed the person out of the whole app.
   */
  NOT_A_PARTICIPANT: 'not_a_participant',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  /**
   * The deployment does not have this feature configured (plan 0026).
   *
   * A statement about the server, not about the caller: Google sign in with no
   * OAuth credentials, or registration with no SMTP host. Distinct from the
   * others because the caller did nothing wrong and retrying will not help.
   */
  NOT_CONFIGURED: 'not_configured',
  /**
   * The caller's build predates the oldest one this deployment serves (velista
   * plan 0034, D9).
   *
   * Like {@link NOT_CONFIGURED} this is not the caller's fault, but unlike it the
   * caller can fix it, and in the normal case already has: the client reacts by
   * asking its service worker for a new version and reloading into it. Distinct
   * from every other code because it says nothing about *this* request, which may
   * have been perfectly well formed. It says the client that sent it is retired.
   */
  CLIENT_TOO_OLD: 'client_too_old',
  /**
   * The basket is `COMPLETED` or `ARCHIVED`, and the write asked to change it
   * (plan 0055, section 3.3).
   *
   * Its own code rather than a `validation_failed` for the reason plan 0054
   * section 4 gives: a client that cannot tell a state it can explain from a bug
   * it cannot will show the wrong sentence for both. Nothing about the request
   * was malformed, and no field of it is at fault; the trip is over.
   */
  GENERATED_LIST_FINISHED: 'generated_list_finished',
  /**
   * The number this write was moving is not where the caller believed it started
   * (plan 0057, section 5; plan 0056, section 3.2).
   *
   * Its own code and not a `conflict`, because the client's reaction is
   * particular: refetch and redraw the control at the number as it now stands,
   * rather than show a failure. Two phones in one shop dragging one line is the
   * ordinary case this exists for, and a gesture whose meaning depends on where
   * it started must be refused rather than reinterpreted.
   */
  STALE_QUANTITY: 'stale_quantity',
  /**
   * A contribution was set below what this basket has already bought against it
   * (plan 0057, section 5.2).
   *
   * The message names the floor, so the client can say the number rather than
   * only that it failed. Distinct from {@link STALE_QUANTITY} because nothing
   * moved underneath the caller: the number they sent is simply lower than a
   * purchase that has already happened, and two units of the flat's milk having
   * been bought means the flat cannot retroactively have wanted one.
   */
  BELOW_SETTLED: 'below_settled',
  /**
   * The account itself is refusing attempts, having failed too many times in a
   * row (plan 0071, section 7; `apps/luna-shopper-admin/plans/0002`, section 2).
   *
   * Its own code rather than a {@link RATE_LIMITED}, because the two are
   * different mechanisms that resolve differently and the operator has to be
   * able to tell them apart. Throttling limits a *source*: another address, or
   * the same one a minute later, gets through. A lockout protects an *account*:
   * changing network does nothing, and it clears when the window passes or when
   * somebody with the server clears it. Answering both with one code makes the
   * lockout invisible, and the lockout is the one an operator most needs to
   * understand.
   *
   * It confirms nothing. The count is kept by username whether or not that
   * username exists, so a caller only ever meets this for a name they have
   * already failed against themselves.
   */
  ACCOUNT_LOCKED: 'account_locked',
  /**
   * The postal code named is not one catalog holds (plan 0097, section 6.1).
   *
   * Its own code rather than a plain {@link VALIDATION_FAILED}, because the
   * operator's next step is particular and the screen has to be able to say it:
   * the centroid table is the whole national list, so a code missing from it is
   * a typo rather than a gap in our coverage. Accepting one would buy four
   * failed Nominatim attempts and a `FAILED` queue row that reads like an
   * outage.
   */
  POSTAL_CODE_UNKNOWN: 'postal_code_unknown',
  /**
   * The row is already being worked on (plan 0097, section 6.2).
   *
   * Its own code rather than a plain {@link CONFLICT}, because the screen says
   * something specific and useful: wait for the run that is happening, rather
   * than change anything about the request. It is refused rather than queued
   * because a `RUNNING` row has a run against it and requeueing would clear the
   * attempt count of an attempt still in progress.
   */
  RUN_IN_PROGRESS: 'run_in_progress',
  /**
   * The new name belongs to another line of the same list, and the request did
   * not say to merge the two (plan 0112, section 2).
   *
   * Its own code rather than a plain {@link CONFLICT}, because the client's
   * reaction is particular: ask the person, then send the same request again
   * with `confirmMerge`. The envelope's `details` name the other line, so the
   * question can say which line it is and how many it holds.
   */
  LINE_MERGE_REQUIRED: 'line_merge_required',
  /**
   * A pending or rejected line was renamed onto an approved one by somebody who
   * cannot approve lines (plan 0112, section 2).
   *
   * Refused rather than merged, because the merge would leave one approved line
   * holding a request nobody with the right to approve it agreed to.
   */
  LINE_MERGE_NEEDS_APPROVAL: 'line_merge_needs_approval',
  /**
   * The two lines together would hold more products than one line may (plan
   * 0112, section 2). The bound travels in `messageArgs.max`.
   */
  LINE_MERGE_TOO_MANY_PRODUCTS: 'line_merge_too_many_products',
  /**
   * The brand label has no letters and no digits, so it makes no key (plan
   * 0115, section 5.3).
   *
   * Its own code rather than a plain {@link VALIDATION_FAILED}, because the
   * sentence the back office shows is particular and short: "The label needs at
   * least one letter or digit." `-` and `---` are the real cases, and they
   * arrive from a suggestion row the operator pressed Register on.
   */
  BRAND_LABEL_EMPTY: 'brand_label_empty',
  /**
   * Another brand already holds the key this label makes (plan 0115,
   * section 5.3).
   *
   * Its own code rather than a plain {@link CONFLICT}, because the client's
   * reaction is to link to the brand that holds it: the holder's id travels in
   * the envelope's `details`, so the panel can offer to open it rather than only
   * say no.
   */
  BRAND_KEY_TAKEN: 'brand_key_taken',
  /**
   * A brand was pointed at itself (plan 0124, section 3).
   *
   * Its own code rather than a plain {@link VALIDATION_FAILED}, because the
   * sentence is particular and the fix is obvious once it is said: a brand is
   * already itself, so there is nothing to link.
   */
  BRAND_LINK_TO_SELF: 'brand_link_to_self',
  /**
   * The link would make a chain of links, which is refused (plan 0124,
   * section 3).
   *
   * Either the target is itself a spelling of some third brand, or brands
   * already point at the one being linked. The brand that breaks the rule
   * travels in the envelope's `details` as `brandId`, so the back office can
   * offer to open it rather than only say no.
   */
  BRAND_LINK_TOO_DEEP: 'brand_link_too_deep',
  /**
   * A brand was given both a private label chain and a link (plan 0124,
   * section 2).
   *
   * A linked brand owns no chain: the canonical brand's chain is the one that
   * counts, so holding a second answer on the linked row would be two answers
   * to one question.
   */
  BRAND_LINK_OWNS_NO_CHAIN: 'brand_link_owns_no_chain',
  /**
   * A brand that is a spelling of another was renamed onto a different key
   * (plan 0124, section 4).
   *
   * Its key is what the products printed with it carry, and it is the only
   * thing that can bring them back when the link is undone. Renaming a linked
   * brand from `DEBORAH 48H` to `Deborah 72H` is therefore not a correction of
   * one spelling but the claim that a second spelling exists, and a second
   * spelling is a second brand. Capitals and spacing keep the key, so they are
   * still allowed.
   */
  BRAND_LINK_KEEPS_KEY: 'brand_link_keeps_key',
  /**
   * A brand that is nobody's spelling was asked to be deleted (plan 0124).
   *
   * A spelling can go away, because deleting it puts its products back exactly
   * where they were before it was registered and its key returns to the
   * suggestions list by itself. Every other brand still cannot be removed, by
   * section 9 of plan 0115: there is nowhere for its products to go.
   */
  BRAND_NOT_LINKED: 'brand_not_linked',
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * 426 Upgrade Required, named here because Nest does not name it.
 *
 * `HttpStatus` stops at 424 Failed Dependency and resumes at 428 Precondition
 * Required, so the enum has no member for 426 to import. Reaching for one is
 * worse than a missing constant: it fails the type check, and wherever the type
 * check is skipped it reads as `undefined` at runtime, which would leave a
 * refused client with whatever status the response layer makes of nothing.
 *
 * The cast keeps the map below typed as statuses rather than widening it to
 * `number`, which is the property that stops an unrelated integer landing there.
 */
const UPGRADE_REQUIRED = 426 as HttpStatus;

/**
 * The single source of truth mapping each code to its HTTP status. The gateway
 * uses it to translate a broker error into a response status; the exception
 * filter uses it for locally thrown domain exceptions.
 */
export const ERROR_STATUS: Record<ErrorCode, HttpStatus> = {
  [ERROR_CODES.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  // 401 and not 403, so a client that has read "refused" from a 401 since plan
  // 0051 keeps reading it. The code is what tells it the account is not at fault.
  [ERROR_CODES.NOT_A_PARTICIPANT]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODES.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ERROR_CODES.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ERROR_CODES.CONFLICT]: HttpStatus.CONFLICT,
  [ERROR_CODES.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  // 501 rather than 503 or 404. 503 says "try again later", which is wrong for a
  // deployment that will never have Google. 404 says the route does not exist,
  // which contradicts keeping it in the published document. 501 is exactly "this
  // server does not implement that", which is the truth.
  [ERROR_CODES.NOT_CONFIGURED]: HttpStatus.NOT_IMPLEMENTED,
  // 426 rather than 400 or 403. The request may have been valid and the caller may
  // be perfectly authorised; what is wrong is the software that sent it, and
  // "Upgrade Required" is the one status that says exactly that.
  [ERROR_CODES.CLIENT_TOO_OLD]: UPGRADE_REQUIRED,
  // 409 rather than 400. The request was well formed and the caller is allowed
  // to make it; what refuses it is the state of the basket, which is what a
  // conflict is. It stays distinguishable from a plain `conflict` by its code,
  // which is what lets velista say "this basket is finished".
  [ERROR_CODES.GENERATED_LIST_FINISHED]: HttpStatus.CONFLICT,
  // Both are 409 for the same reason and stay apart from it, and from each
  // other, by code: the request was well formed, and what it conflicts with is
  // state that moved or state that has already happened.
  [ERROR_CODES.STALE_QUANTITY]: HttpStatus.CONFLICT,
  [ERROR_CODES.BELOW_SETTLED]: HttpStatus.CONFLICT,
  // 423 rather than 429. A 429 is a statement about how fast the caller is
  // going, and slowing down fixes it; this one is a statement about the state
  // the account is in, which no amount of waiting between requests changes. It
  // stays apart from `rate_limited` at the status level as well as the code
  // level so a proxy or a log reader sees the difference too.
  [ERROR_CODES.ACCOUNT_LOCKED]: HttpStatus.LOCKED,
  // 400 rather than 404. A 404 on a create route reads as "no such route", and
  // what is wrong here is a value in the body: the code does not exist in the
  // shipped national table, which is a typo (plan 0097, section 6.1).
  [ERROR_CODES.POSTAL_CODE_UNKNOWN]: HttpStatus.BAD_REQUEST,
  // 409 for the ordinary reason: the request was well formed and the caller is
  // allowed to make it, and what refuses it is the state of the row.
  [ERROR_CODES.RUN_IN_PROGRESS]: HttpStatus.CONFLICT,
  // All three 409 for the ordinary reason, and told apart by code because the
  // client does three different things with them: ask, explain, or explain with
  // a number (plan 0112, section 7).
  [ERROR_CODES.LINE_MERGE_REQUIRED]: HttpStatus.CONFLICT,
  [ERROR_CODES.LINE_MERGE_NEEDS_APPROVAL]: HttpStatus.CONFLICT,
  [ERROR_CODES.LINE_MERGE_TOO_MANY_PRODUCTS]: HttpStatus.CONFLICT,
  // 400, because what is wrong is a value in the body: a label of punctuation
  // makes no key, so there is nothing to register (plan 0115, section 5.3).
  [ERROR_CODES.BRAND_LABEL_EMPTY]: HttpStatus.BAD_REQUEST,
  // 409 for the ordinary reason: the request was well formed and the caller is
  // allowed to make it, and what refuses it is a row that already exists.
  [ERROR_CODES.BRAND_KEY_TAKEN]: HttpStatus.CONFLICT,
  // 400 for both of these, because what is wrong is a value in the body: a
  // brand cannot be its own spelling, and a linked brand cannot also carry a
  // chain (plan 0124, sections 2 and 3).
  [ERROR_CODES.BRAND_LINK_TO_SELF]: HttpStatus.BAD_REQUEST,
  [ERROR_CODES.BRAND_LINK_OWNS_NO_CHAIN]: HttpStatus.BAD_REQUEST,
  // 409 rather than 400, because the request is well formed and what refuses it
  // is a link some other row already holds.
  [ERROR_CODES.BRAND_LINK_TOO_DEEP]: HttpStatus.CONFLICT,
  // 409 for the same reason: the label is a perfectly good label, and what
  // refuses it is that this row is a spelling of another brand.
  [ERROR_CODES.BRAND_LINK_KEEPS_KEY]: HttpStatus.CONFLICT,
  // 409 again: the request is well formed and the caller may make it, and what
  // refuses it is that this brand is not a spelling of anything.
  [ERROR_CODES.BRAND_NOT_LINKED]: HttpStatus.CONFLICT,
  [ERROR_CODES.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};
