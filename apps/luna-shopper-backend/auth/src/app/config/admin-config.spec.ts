import { authValidationSchema } from './app-config';
import { assertDevAutologinIsSafe, isLocalDbHost } from './local-host';

/**
 * The operator half of the configuration (plan 0071, sections 3 and 8).
 *
 * The exit criterion this file carries is the last one in section 11: auth
 * refuses to start with `ADMIN_DEV_AUTOLOGIN=true` and a non local host. It is a
 * switch that mints an administrator token with no password, so the test is not
 * about a config default, it is about the one arrangement that would hand a
 * cluster away.
 */
describe('admin configuration', () => {
  const required = {
    NATS_URL: 'nats://luna-shopper-backend-nats:4222',
    AUTH_DB_URL:
      'postgres://luna_auth:pw@luna-shopper-backend-auth-db:5432/luna_auth',
    AUTH_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END-----',
    AUTH_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nx\n-----END-----',
    AUTH_JWT_KID: 'prod-1',
    ADMIN_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\ny\n-----END-----',
    ADMIN_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\ny\n-----END-----',
    ADMIN_JWT_KID: 'prod-admin-1',
    MAIL_FROM: 'Luna Shopper <no-reply@ichirokuxvi.com>',
    MAIL_VERIFY_BASE_URL: 'https://ichirokuxvi.com/verify-email',
    MAIL_RESET_BASE_URL: 'https://ichirokuxvi.com/reset-password',
  };

  describe('the admin keypair', () => {
    it('is required, unlike Google and SMTP', () => {
      // Those two are optional because an unconfigured deployment degrades to a
      // feature that is absent. A missing signing key is not a lesser version of
      // the feature, so it fails the boot.
      const {
        ADMIN_JWT_PRIVATE_KEY: _private,
        ADMIN_JWT_PUBLIC_KEY: _public,
        ...withoutKeys
      } = required;

      expect(authValidationSchema.validate(withoutKeys).error).toBeDefined();
    });

    it('accepts the file spelling local development uses', () => {
      const {
        ADMIN_JWT_PRIVATE_KEY: _private,
        ADMIN_JWT_PUBLIC_KEY: _public,
        ...rest
      } = required;
      const { error } = authValidationSchema.validate({
        ...rest,
        ADMIN_JWT_PRIVATE_KEY_FILE:
          'apps/luna-shopper-backend/secrets/admin-jwt.key',
        ADMIN_JWT_PUBLIC_KEY_FILE:
          'apps/luna-shopper-backend/secrets/admin-jwt.pub',
      });

      expect(error).toBeUndefined();
    });

    it('requires a kid, so a verification failure says which key was expected', () => {
      const { ADMIN_JWT_KID: _kid, ...withoutKid } = required;

      expect(authValidationSchema.validate(withoutKid).error).toBeDefined();
    });
  });

  describe('the development autologin', () => {
    it('is off when the variable is absent', () => {
      expect(
        authValidationSchema.validate(required).value.ADMIN_DEV_AUTOLOGIN
      ).toBe(false);
    });

    it('refuses to boot against a non local database', () => {
      // The whole of section 8 in one assertion. Not a warning, a throw: a
      // service that will not start is a failed deploy somebody has to look at,
      // and a service that logs a warning is a compromise nobody read.
      expect(() =>
        assertDevAutologinIsSafe(
          true,
          'postgres://luna_auth:pw@luna-shopper-backend-auth-db:5432/luna_auth'
        )
      ).toThrow(/not a local database/);
    });

    it('allows it against the compose stack and loopback', () => {
      expect(() =>
        assertDevAutologinIsSafe(true, 'postgres://u:p@auth-db:5432/luna_auth')
      ).not.toThrow();
      expect(() =>
        assertDevAutologinIsSafe(
          true,
          'postgres://u:p@localhost:43010/luna_auth'
        )
      ).not.toThrow();
    });

    it('says nothing about a database it cannot parse, and refuses anyway', () => {
      // Answering "not local" for an unreadable URL is the safe way to be wrong:
      // the cost is a development autologin that will not start, and the cost of
      // the other mistake is the whole database.
      expect(isLocalDbHost('not-a-connection-string')).toBe(false);
      expect(isLocalDbHost(undefined)).toBe(false);
      expect(() => assertDevAutologinIsSafe(true, undefined)).toThrow();
    });

    it('leaves a production deployment alone when it is off', () => {
      // The check is about the switch, not about the host: a cluster that never
      // sets the variable is not required to justify its database.
      expect(() =>
        assertDevAutologinIsSafe(
          false,
          'postgres://u:p@luna-shopper-backend-auth-db:5432/luna_auth'
        )
      ).not.toThrow();
    });
  });
});
