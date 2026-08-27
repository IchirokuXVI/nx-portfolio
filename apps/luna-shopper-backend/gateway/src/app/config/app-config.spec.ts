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
  AUTH_JWT_PUBLIC_KEY: 'a-public-key',
};

const validate = (env: Record<string, string>) =>
  gatewayValidationSchema.validate({ ...base, ...env });

describe('gateway configuration', () => {
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
