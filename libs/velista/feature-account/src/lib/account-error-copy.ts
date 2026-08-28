import { GatewayError } from '@portfolio/velista/data-access';

/**
 * Which sentence a failure gets, keyed on the error code **and the operation**
 * (plan 0015, section 5.9).
 *
 * The same shape as `zone-error-copy.ts` and for the same reason plan 0004 settled: the
 * gateway's `ERROR_CATALOG` gives every code one message, so the server's `message`
 * reads identically for every 429 in the product and is unusable as copy. Only one
 * thing produces each code on each of these routes, so the mapping is a fact rather
 * than a guess.
 */
export type AccountOperation =
  /** Reading the caller's own profile. */
  | 'account.me'
  /** Changing the global username. */
  | 'account.rename'
  /** Asking for a password reset link. */
  | 'auth.forgotPassword'
  /** Deleting the account. */
  | 'account.delete';

/** The message any failure falls back to, including one with no code at all. */
const GENERIC = 'account.error.failed';

/**
 * What a failure means, and how the screen should answer it.
 *
 * `key` is the copy. `endSession` is the one thing this table decides that a key
 * cannot: a `not_found` on either account route means the **caller themselves** is
 * gone, because every route here resolves the caller from their own token and cannot
 * be asked about anybody else. Deleted in another tab, or reaped. An error panel
 * offering a retry would retry forever, so the honest handling is to clear the session
 * and go to the front door.
 */
export interface AccountFailure {
  readonly key: string;
  /** The server's own wait, in seconds, for the two keys that interpolate one. */
  readonly waitSeconds: number | null;
  readonly endSession: boolean;
}

export function accountFailure(
  error: unknown,
  operation: AccountOperation
): AccountFailure {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport. The blocking
    // connection screen owns the first of those, so all that is needed here is a
    // sentence that does not claim to know why.
    return { key: GENERIC, waitSeconds: null, endSession: false };
  }

  switch (error.code) {
    case 'not_found':
      // See {@link AccountFailure.endSession}. This is the row worth arguing for.
      return {
        key: 'account.error.gone',
        waitSeconds: null,
        endSession: true,
      };

    case 'rate_limited':
      // Two buckets an order of magnitude apart, which is exactly why the key depends
      // on the operation: the rename is five per **hour** and the reset is one per
      // minute (rule A4). Both render the server's own number and never a hardcoded
      // sixty, which is what the wait travelling alongside the key is for.
      return {
        key:
          operation === 'account.rename'
            ? 'account.error.tooManyRenames'
            : 'account.error.tooManyResets',
        waitSeconds: error.retryAfterSeconds ?? null,
        endSession: false,
      };

    case 'validation_failed':
      // Length, characters, or the reserved `former member` prefix. The copy states
      // the rule rather than echoing the server, which answers one message for every
      // 400 in the product.
      return {
        key: 'account.error.badName',
        waitSeconds: null,
        endSession: false,
      };

    default:
      // `unauthorized` never reaches a page: `TokenStore` clears and the app is signed
      // out before this is called. `internal` gets the generic sentence with the
      // correlation id beside it, which is how `0003` renders one.
      return { key: GENERIC, waitSeconds: null, endSession: false };
  }
}

/** The support reference to show beside a generic failure, when there is one. */
export function accountCorrelationId(error: unknown): string | null {
  return error instanceof GatewayError ? error.correlationId : null;
}

/**
 * A wait in seconds as `m:ss`.
 *
 * Re-exported rather than written here, so this library's three call sites and
 * `feature-zones`' member rename sheet format the same number the same way. See
 * `retryClock` for why minutes are not capped at sixty, which is the whole of rule A4.
 */
export { retryClock as asClock } from '@portfolio/velista/platform';
