import type {
  SignInFailure,
  SignInFailureReason,
} from '@portfolio/luna-shopper-admin/models';
import { signInMessage } from './sign-in-copy';

/**
 * The table of section 2, asserted as a table (plan 0002).
 *
 * The property that matters is not what any one key says but that **no two
 * outcomes share one**. Collapsing them makes the lockout invisible, and the
 * lockout is the one an operator most needs to understand, so the distinctness
 * check below is the real test and the individual cases are documentation.
 */

const reasons: SignInFailureReason[] = [
  'invalid-credentials',
  'throttled',
  'locked-out',
  'not-available',
  'unknown',
];

describe('signInMessage', () => {
  it('gives every outcome its own message', () => {
    const keys = reasons.map((reason) => signInMessage({ reason }).key);

    expect(new Set(keys).size).toBe(reasons.length);
  });

  it('says nothing about which half of the credentials was wrong', () => {
    expect(signInMessage({ reason: 'invalid-credentials' })).toEqual({
      key: 'signIn.error.invalidCredentials',
    });
  });

  describe('a throttle and a lockout', () => {
    /**
     * Different mechanisms that resolve differently: one limits a source, so
     * another minute clears it; the other protects an account, so a different
     * network does nothing and somebody with the server is the other way out.
     */
    it('never share a message, with or without a wait', () => {
      expect(signInMessage({ reason: 'throttled' }).key).not.toBe(
        signInMessage({ reason: 'locked-out' }).key
      );
      expect(
        signInMessage({ reason: 'throttled', retryAfterSeconds: 60 }).key
      ).not.toBe(
        signInMessage({ reason: 'locked-out', retryAfterSeconds: 60 }).key
      );
    });

    it.each<[SignInFailureReason, string, string]>([
      ['throttled', 'signIn.error.throttled', 'signIn.error.throttledFor'],
      ['locked-out', 'signIn.error.lockedOut', 'signIn.error.lockedOutFor'],
    ])(
      'names the wait for %s only when the server named one',
      (reason, untimed, timed) => {
        expect(signInMessage({ reason })).toEqual({ key: untimed });
        expect(signInMessage({ reason, retryAfterSeconds: 90 })).toEqual({
          key: timed,
          args: { seconds: 90 },
        });
      }
    );

    /**
     * A separate key rather than an optional interpolation, because a sentence
     * with a number in it and the same sentence without one are different
     * sentences in every language. A key carrying `{{seconds}}` and no argument
     * is how a placeholder reaches an operator verbatim.
     */
    it('never carries an argument on the key that has no placeholder', () => {
      expect(signInMessage({ reason: 'throttled' }).args).toBeUndefined();
      expect(signInMessage({ reason: 'locked-out' }).args).toBeUndefined();
    });
  });

  it('does not invite a retry the server cannot honour', () => {
    expect(signInMessage({ reason: 'not-available' })).toEqual({
      key: 'signIn.error.notAvailable',
    });
  });

  /** Total, so an unanticipated failure is still a sentence. */
  it('has a message for every reason there is', () => {
    for (const reason of reasons) {
      const failure: SignInFailure = { reason };

      expect(signInMessage(failure).key).toMatch(/^signIn\.error\./);
    }
  });
});
