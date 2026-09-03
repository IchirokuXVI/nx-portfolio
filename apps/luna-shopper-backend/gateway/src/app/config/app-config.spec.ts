import { gatewayValidationSchema } from './app-config';

/**
 * What the gateway insists on at boot (plan 0023, section 3.4).
 *
 * `APP_BASE_URL` is the one source the Google callback's redirect is built from,
 * so a deployment that switches Google on without it would send users to a URL
 * assembled from an empty origin. Making it conditional rather than always
 * required is what keeps the other half true: with the OAuth variables unset
 * there is nothing new to configure and boot is unaffected.
 */

/** The variables every gateway needs whatever else is switched on. */
const base = {
  NATS_URL: 'nats://localhost:4222',
  // Required since plan 0028: the throttler counts in Redis and fails closed, so
  // a gateway that started without it would be an open registration and password
  // reset endpoint that looked healthy.
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWT_PUBLIC_KEY: 'a-public-key',
  // The operator trust root (plan 0071, section 3). Required for the same reason
  // the one above it is: a missing signing key is not a lesser version of a
  // feature, it is tokens verified against nothing.
  ADMIN_JWT_PUBLIC_KEY: 'an-admin-public-key',
};

const validate = (env: Record<string, string>) =>
  gatewayValidationSchema.validate({ ...base, ...env });

describe('gateway configuration', () => {
  /**
   * Required rather than optional, and deliberately so (plan 0028, section 5).
   * The throttler counts in Redis and fails closed, so a gateway that started
   * without a connection string would be an open registration and password reset
   * endpoint reporting itself perfectly healthy. Failing at boot is the loud
   * version of a failure that is otherwise entirely silent.
   */
  it('refuses to boot with no Redis to count rate limits in', () => {
    const { error } = gatewayValidationSchema.validate({
      NATS_URL: 'nats://localhost:4222',
      AUTH_JWT_PUBLIC_KEY: 'a-public-key',
    });

    expect(error?.message).toContain('REDIS_URL');
  });

  it('refuses a REDIS_URL that is not a redis URL', () => {
    const { error } = validate({ REDIS_URL: 'localhost:6379' });

    expect(error?.message).toContain('REDIS_URL');
  });

  /**
   * The minimum client version (velista plan 0034, D5). Empty is the resting value
   * and switches the whole mechanism off, so the assertion that matters is that a
   * deployment which sets nothing keeps behaving exactly as it did.
   */
  it('serves every client version when no floor is set', () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value.MIN_CLIENT_VERSION).toBe('');
  });

  it('accepts a semantic version as the floor', () => {
    expect(validate({ MIN_CLIENT_VERSION: '1.4.0' }).error).toBeUndefined();
    expect(
      validate({ MIN_CLIENT_VERSION: 'v2.0.0-rc.1' }).error
    ).toBeUndefined();
  });

  it.each(['staging', 'latest', '1.4', 'newest'])(
    'refuses to boot with a floor that is not a version: %s',
    (floor) => {
      // The quiet failure of this variable is a safety net that is not there, and
      // nothing observes that until the day it was needed. A typo has to be loud.
      const { error } = validate({ MIN_CLIENT_VERSION: floor });

      expect(error?.message).toContain('MIN_CLIENT_VERSION');
    }
  );

  it('boots with Google unset and nothing else to supply', () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value.APP_BASE_URL).toBe('');
    expect(value.GOOGLE_CLIENT_ID).toBe('');
  });

  it('refuses to boot with Google switched on and no app URL to return to', () => {
    const { error } = validate({
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_CALLBACK_URL: 'https://api.example/v1/auth/google/callback',
    });

    // Failing here is the point: the alternative is a running gateway that
    // redirects every completed sign in to a URL built on an empty origin.
    expect(error?.message).toContain('APP_BASE_URL');
  });

  it('accepts Google switched on with an app URL', () => {
    const { error, value } = validate({
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_CALLBACK_URL: 'https://api.example/v1/auth/google/callback',
      APP_BASE_URL: 'https://app.example/{locale}/velista',
    });

    expect(error).toBeUndefined();
    expect(value.APP_BASE_URL).toBe('https://app.example/{locale}/velista');
  });

  it('rejects an app URL that is not absolute', () => {
    // A relative value would make the `Location` relative to the API's origin,
    // which is the one origin this redirect exists to get the user off.
    const { error } = validate({
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_CALLBACK_URL: 'https://api.example/v1/auth/google/callback',
      APP_BASE_URL: '/velista',
    });

    expect(error?.message).toContain('APP_BASE_URL');
  });
});
