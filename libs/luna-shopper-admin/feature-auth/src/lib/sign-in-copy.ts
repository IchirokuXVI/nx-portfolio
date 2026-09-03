import type { SignInFailure } from '@portfolio/luna-shopper-admin/models';

/**
 * What the screen says about a refusal (plan 0002, section 2).
 *
 * A pure function from the failure to a translation key and its arguments, so
 * the table of four outcomes is one readable thing rather than four branches
 * spread through a template. It is also what makes the copy testable without
 * rendering anything.
 *
 * The wait is a separate key rather than an optional interpolation, because a
 * sentence with a number in it and the same sentence without one are different
 * sentences in every language, and a placeholder left unfilled is how "wait
 * {seconds} seconds" reaches an operator verbatim.
 */
export interface SignInMessage {
  /** The translation key for the sentence to show. */
  readonly key: string;
  /** Interpolation arguments, when the key names any. */
  readonly args?: Readonly<Record<string, string | number>>;
}

export function signInMessage(failure: SignInFailure): SignInMessage {
  const { retryAfterSeconds } = failure;
  const timed = retryAfterSeconds !== undefined;

  switch (failure.reason) {
    // One message for a wrong password, an unknown username and a disabled
    // account, because plan 0071 answers all three identically on purpose: a
    // different sentence for any of them tells whoever is guessing which
    // usernames are real.
    case 'invalid-credentials':
      return { key: 'signIn.error.invalidCredentials' };

    // Limits a source. Waiting is what clears it, so the copy is about waiting.
    case 'throttled':
      return timed
        ? {
            key: 'signIn.error.throttledFor',
            args: { seconds: retryAfterSeconds },
          }
        : { key: 'signIn.error.throttled' };

    // Protects an account. Waiting clears it too, but so does somebody with the
    // server, and an operator who cannot wait needs to be told the second half.
    case 'locked-out':
      return timed
        ? {
            key: 'signIn.error.lockedOutFor',
            args: { seconds: retryAfterSeconds },
          }
        : { key: 'signIn.error.lockedOut' };

    // A statement about the deployment. Retrying will not help, and the copy
    // must not suggest it might.
    case 'not-available':
      return { key: 'signIn.error.notAvailable' };

    case 'unknown':
      return { key: 'signIn.error.unknown' };
  }
}
