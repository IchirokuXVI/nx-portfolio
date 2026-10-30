import { AuthProvider, UserKind } from '../enums/auth.enums';
import { IDENTITY_EVENTS } from '../events/identity.events';
import { AUTH_PATTERNS } from './auth.messages';

/**
 * These values are the cross service wire contract; the test pins them so a
 * rename that would silently break a polyglot consumer fails here instead.
 */
describe('auth contracts', () => {
  it('pins the enum wire values', () => {
    expect(UserKind.TEMPORARY).toBe('TEMPORARY');
    expect(UserKind.REGISTERED).toBe('REGISTERED');
    expect(AuthProvider.GOOGLE).toBe('GOOGLE');
    expect(AuthProvider.EMAIL).toBe('EMAIL');
  });

  it('pins the message subjects', () => {
    expect(AUTH_PATTERNS.createTemporaryUser).toBe('auth.createTemporaryUser');
    expect(AUTH_PATTERNS.register).toBe('auth.register');
    expect(AUTH_PATTERNS.login).toBe('auth.login');
    expect(AUTH_PATTERNS.refresh).toBe('auth.refresh');
    expect(AUTH_PATTERNS.upgrade).toBe('auth.upgrade');
    expect(AUTH_PATTERNS.forgotPassword).toBe('auth.forgotPassword');
    expect(AUTH_PATTERNS.resetPassword).toBe('auth.resetPassword');
    expect(AUTH_PATTERNS.recoverySignIn).toBe('auth.recoverySignIn');
    expect(AUTH_PATTERNS.mintOAuthState).toBe('auth.mintOAuthState');
    expect(AUTH_PATTERNS.consumeOAuthState).toBe('auth.consumeOAuthState');
    expect(AUTH_PATTERNS.stageGoogleSignIn).toBe('auth.stageGoogleSignIn');
    expect(AUTH_PATTERNS.exchangeGoogleSignIn).toBe(
      'auth.exchangeGoogleSignIn'
    );
    expect(AUTH_PATTERNS.mintGoogleNonce).toBe('auth.mintGoogleNonce');
    expect(AUTH_PATTERNS.signInWithGoogleIdToken).toBe(
      'auth.signInWithGoogleIdToken'
    );
    // Gone with its handler (plan 0230): a pattern that no gateway route sends
    // is a door with no lock.
    expect('googleLogin' in AUTH_PATTERNS).toBe(false);
  });

  it('pins the identity event names', () => {
    expect(IDENTITY_EVENTS.userRegistered).toBe('user.registered');
    expect(IDENTITY_EVENTS.userUpgraded).toBe('user.upgraded');
    expect(IDENTITY_EVENTS.userEmailVerified).toBe('user.emailVerified');
  });
});
