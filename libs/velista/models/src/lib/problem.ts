/**
 * The backend's RFC 7807 problem document, re-declared.
 *
 * **This duplication is forced, not chosen.** The real definition lives in
 * `@portfolio/luna-shopper/platform`, which pulls NestJS, pino and `node:crypto`, so
 * it is never safe in a browser bundle. It is the one place in this app where copying
 * a backend type is the correct answer rather than a shortcut (plan 0004, section 4.4).
 *
 * Kept in sync by hand with
 * `libs/luna-shopper/platform/src/lib/errors/problem-details.ts` and
 * `libs/luna-shopper/platform/src/lib/errors/error-codes.ts`.
 */

/** Every error code the gateway can return, mapping one to one onto a status. */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  /**
   * The deployment does not have this feature configured (backend plan 0026), as a
   * 501.
   *
   * **A statement about the server, not about the caller.** Nobody did anything wrong
   * and retrying will not help, which is the whole reason it is not `internal`: an
   * install with no `GEMINI_API_KEY` answers this on `/v1/assistant`, and one with no
   * OAuth credentials answers it on Google sign in.
   *
   * It was missing from this list, which is the cost of the hand sync this file admits
   * to at the top: it has existed on the backend since `0026` and every client that
   * met it read it as `internal` and said "try again". Backend `0039` is what made it
   * reachable often enough to notice.
   */
  'not_configured',
  /**
   * This build predates the oldest one the deployment serves (plan 0034 D9).
   *
   * The only code here that is about the app rather than about the request, and the
   * only one the app answers by acting on its own: `gatewayInterceptor` asks
   * `AppUpdates` for a new version, and in the normal case the page has reloaded
   * into it before the user finishes reading whatever was shown.
   */
  'client_too_old',
  /**
   * The caller's shopping profile says nothing about where they shop, so a catalog
   * read that would have quoted prices refuses instead (backend plan 0049, section 3),
   * as a 400.
   *
   * Neither "there is nothing" nor "here is everything": a profile holding no postal
   * code and no included chain has not said where it is, and both of those answers
   * would be a lie about the catalog rather than a statement about the profile. The
   * app answers it by sending somebody to the profiles page (plan 0046, section 3.1),
   * which is the one screen that can turn it into a real answer.
   */
  'catalog_scope_required',
  /**
   * The basket is `COMPLETED` or `ARCHIVED` and the write asked to change it
   * (backend plan 0055, section 3.3), as a 409.
   *
   * A state the screen can explain rather than a failure it cannot: the trip is over,
   * nothing about the request was malformed, and no field of it is at fault. Without
   * this member it read as a plain `conflict`, which on the settle path is a
   * different sentence entirely: "somebody already finished this line".
   */
  'generated_list_finished',
  /**
   * The number this write was moving is not where the caller believed it started
   * (backend plans 0056 and 0057), as a 409.
   *
   * The one code on this screen the app **acts** on rather than only reporting: two
   * phones in one shop dragging one line is the ordinary case, so the store refetches
   * and the control redraws at the number as it now stands, with a sentence naming
   * it. Read as a plain `conflict` it drew "somebody already finished this line" over
   * a line nobody had finished.
   */
  'stale_quantity',
  /**
   * A contribution was set below what this basket has already bought against it
   * (backend plan 0057, section 5.2), as a 409.
   *
   * Distinct from `stale_quantity` because nothing moved underneath the caller. Two
   * units of the flat's milk having been bought means the flat cannot retroactively
   * have wanted one, and the honest sentence names the floor rather than saying the
   * save failed.
   */
  'below_settled',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * An unrecognised code reads as `internal`: something went wrong and the app has no
 * specific handling for it, which is exactly what a code from a newer backend means.
 */
export const ERROR_CODE_FALLBACK: ErrorCode = 'internal';

/**
 * The wire shape of a problem document.
 *
 * Note what is **not** useful here. `message` is localized but generic: the backend's
 * catalog holds exactly one message per code, so every 409 in the product reads "That
 * request conflicts with the current state". `detail` carries the specific reason and
 * is untranslated developer text. Neither is what the user should read; the app keys
 * its own copy per code and operation (plan 0004, section 4.5).
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  /** Untranslated developer detail. Goes in the support blob, never on screen. */
  readonly detail?: string;
  /** Localized but generic. A fallback for copy, not the copy. */
  readonly message: string;
  readonly correlationId: string;
  /** Present only for `validation_failed`. Used for its keys, not its strings. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  /**
   * How long the caller must wait, in seconds, on a `rate_limited`.
   *
   * **In the body rather than in a `Retry-After` header, and that is forced.**
   * `main.ts` calls `enableCors({ origin, credentials: true })` with no
   * `exposedHeaders`, so a browser reading this API cross origin can see only the
   * CORS safelisted response headers, and `Retry-After` is not one of them. It is the
   * same reasoning that already puts the correlation id in the body (plan 0004,
   * section 4.6).
   *
   * Optional, because most throttled routes do not need the client to render a clock
   * and only the resend flow does (plan 0009, rule C3). Absent means "we were not
   * told", which is a state the UI has to have an answer for rather than a number it
   * may invent.
   */
  readonly retryAfterSeconds?: number;
}

/**
 * The header the gateway reads an inbound correlation id from.
 *
 * The client mints and sends this rather than waiting for one back, because the
 * gateway returns the id in the **body** of a problem document and in no response
 * header at all, and a request that never arrived has no body. `0003` promises a
 * copyable reference on its error state, and this is what makes that keepable in the
 * case the user is most likely to be reporting (plan 0004, section 4.6).
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';
