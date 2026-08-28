import { authValidationSchema } from './app-config';

/**
 * Auth boots with Google and SMTP unset (plan 0026, section 4).
 *
 * This is the assertion no existing test made, and the one that matters: the
 * chart ships `googleClientId: ''` and `smtpHost: ''`, and those keys were
 * `Joi.string().required()`, which rejects an empty string. So the auth pod
 * failed validation and died during boot, before it reached the database, in
 * exactly the deployment the gateway was carefully written to support.
 *
 * The environment below is what `_env.tpl` actually sends, empty strings and
 * all, rather than a convenient subset.
 */
describe('authValidationSchema', () => {
  /** Everything the chart supplies unconditionally, with real-shaped values. */
  const required = {
    NATS_URL: 'nats://luna-shopper-backend-nats:4222',
    AUTH_DB_URL:
      'postgres://luna_auth:pw@luna-shopper-backend-auth-db:5432/luna_auth',
    AUTH_JWT_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
    AUTH_JWT_PUBLIC_KEY:
      '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----',
    AUTH_JWT_KID: 'prod-1',
    MAIL_FROM: 'Luna Shopper <no-reply@ichirokuxvi.com>',
    MAIL_VERIFY_BASE_URL: 'https://ichirokuxvi.com/verify-email',
    MAIL_RESET_BASE_URL: 'https://ichirokuxvi.com/reset-password',
  };

  it('accepts the empty Google and SMTP values the chart sends', () => {
    const { error } = authValidationSchema.validate({
      ...required,
      // Verbatim what the ConfigMap renders from an unconfigured cluster.
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_CALLBACK_URL: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_PORT: '587',
    });

    expect(error).toBeUndefined();
  });

  it('accepts them being absent entirely', () => {
    // A local `.env` simply omits the keys rather than setting them empty, and
    // both spellings have to mean the same thing.
    const { error } = authValidationSchema.validate(required);

    expect(error).toBeUndefined();
  });

  it('still accepts a fully configured Google and SMTP setup', () => {
    // Nothing in plan 0026 changes the configured path.
    const { error } = authValidationSchema.validate({
      ...required,
      GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_CALLBACK_URL:
        'https://api.ichirokuxvi.com/v1/auth/google/callback',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'pw',
    });

    expect(error).toBeUndefined();
  });

  it('still rejects a malformed Google callback URL', () => {
    // Optional is not unvalidated: a non empty value must still be a URI, or a
    // typo would reach Google as a redirect_uri mismatch at sign in time.
    const { error } = authValidationSchema.validate({
      ...required,
      GOOGLE_CALLBACK_URL: 'not-a-url',
    });

    expect(error).toBeDefined();
  });

  it('still requires what the service genuinely cannot start without', () => {
    // The point of the change is narrow. Dropping AUTH_DB_URL is still fatal.
    const { AUTH_DB_URL: _omitted, ...withoutDbUrl } = required;
    const { error } = authValidationSchema.validate(withoutDbUrl);

    expect(error).toBeDefined();
  });
});
