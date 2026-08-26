import { GatewayError } from '@portfolio/velista/data-access';

/**
 * Which sentence a rejected credential form gets, keyed on the error code **and the
 * operation**.
 *
 * `ERROR_CATALOG` gives every code one message, so the server's `message` reads
 * identically for every 409 in the product and is unusable as copy. Plan 0004 concluded
 * the client keys its own copy on code plus operation, and plan 0009 section 5.5 is
 * that table for these three calls (the same shape `entry-error-copy.ts` is for
 * plan 0008's two).
 */
export type AuthOperation = 'auth.login' | 'auth.register' | 'auth.upgrade';

/** Where a message belongs, which is the only thing the three screens differ on. */
export type AuthErrorPlacement = 'pair' | 'email' | 'password';

export interface AuthErrorCopy {
  /** The translation key of the sentence. Never a string from the server. */
  readonly key: string;
  /** Which field or fields it is about, and therefore what it is described by. */
  readonly placement: AuthErrorPlacement;
  /**
   * A route out of the failure, when there is one.
   *
   * Only `conflict` on register has one: the address already has an account, so the
   * useful answer is a link to sign in carrying the typed email, not a refusal
   * (section 5.5).
   */
  readonly action?: 'signIn';
}

/** The message any failure falls back to, including one with no code at all. */
const GENERIC: AuthErrorCopy = {
  key: 'entry.error.failed',
  placement: 'pair',
};

export function authErrorCopy(
  error: unknown,
  operation: AuthOperation
): AuthErrorCopy {
  if (!(error instanceof GatewayError)) {
    // A `NetworkError`, or something that never reached the transport. The blocking
    // connection screen owns the first of those, so all that is needed here is a
    // sentence that does not claim to know why.
    return GENERIC;
  }

  // Five a minute on login and three on register, and the copy says the same thing
  // either way, so it is answered before the split.
  if (error.code === 'rate_limited') {
    return { key: 'auth.error.tooMany', placement: 'pair' };
  }

  if (error.code === 'validation_failed') {
    return fieldCopy(error);
  }

  switch (operation) {
    case 'auth.login':
      // `login()` throws the same `UnauthorizedException` whether the email is
      // unknown or the password is wrong, with a comment saying this is so the
      // response does not reveal which addresses are registered. So there is one
      // message, under the **pair**, and it never claims the email is unknown:
      // that would be a guess, it would sometimes be wrong, and it would undo a
      // deliberate privacy decision in the service (section 5.4).
      return error.code === 'unauthorized'
        ? { key: 'auth.error.badCredentials', placement: 'pair' }
        : GENERIC;

    case 'auth.register':
      return error.code === 'conflict'
        ? {
            key: 'auth.error.emailTaken',
            placement: 'email',
            action: 'signIn',
          }
        : GENERIC;

    case 'auth.upgrade':
      // Two different things produce this one code: the address is taken, or the
      // caller is already registered. The second only happens if two tabs raced, and
      // the screen treats it as success rather than showing this at all (section
      // 3.2), so what is left here is the first.
      return error.code === 'conflict'
        ? { key: 'auth.error.emailTaken', placement: 'email' }
        : GENERIC;
  }
}

/**
 * A 400, placed against the field it belongs to.
 *
 * The one case where a message is **not** shared between the fields (section 5.5). The
 * problem document's `errors` is used for its **keys** and never for its strings: the
 * strings are the DTO's own untranslated validator output, and the keys are what say
 * which of the two boxes the person needs to look at.
 */
function fieldCopy(error: GatewayError): AuthErrorCopy {
  const fields = Object.keys(error.fieldErrors ?? {});

  if (fields.includes('password')) {
    return { key: 'auth.error.shortPassword', placement: 'password' };
  }

  if (fields.includes('email')) {
    return { key: 'auth.error.badEmail', placement: 'email' };
  }

  // A 400 that named no field. Nothing here knows which box is wrong, so the message
  // goes under the pair rather than accusing one of them at random.
  return { key: 'auth.error.badEmail', placement: 'pair' };
}
