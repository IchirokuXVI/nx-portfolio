import { authValidationSchema } from '../config/app-config';
import { retentionConfig } from './retention-config';

/**
 * The retention settings (plan 0233, section 3): the owner's numbers as
 * defaults, and a floor under each period that refuses boot with a message
 * naming the key.
 */
describe('the retention settings of auth', () => {
  const required = {
    NATS_URL: 'nats://luna-shopper-backend-nats:4222',
    AUTH_DB_URL:
      'postgres://luna_auth:pw@luna-shopper-backend-auth-db:5432/luna_auth',
    AUTH_JWT_PRIVATE_KEY: 'x',
    AUTH_JWT_PUBLIC_KEY: 'x',
    AUTH_JWT_KID: 'prod-1',
    ADMIN_JWT_PRIVATE_KEY: 'y',
    ADMIN_JWT_PUBLIC_KEY: 'y',
    ADMIN_JWT_KID: 'prod-admin-1',
    MAIL_FROM: 'Luna Shopper <no-reply@ichirokuxvi.com>',
    MAIL_VERIFY_BASE_URL: 'https://ichirokuxvi.com/verify-email',
    MAIL_RESET_BASE_URL: 'https://ichirokuxvi.com/reset-password',
  };
  const DAY = 24 * 60 * 60 * 1000;

  function validate(extra: Record<string, string>) {
    return authValidationSchema.validate(
      { ...required, ...extra },
      { abortEarly: false }
    );
  }

  it('defaults to the owner numbers when nothing is set', () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      RETENTION_AUDIT: '180d',
      RETENTION_ADMIN_LOGIN_FAILURES: '90d',
      RETENTION_EXPIRED_GRANTS: '14d',
      RETENTION_SWEEP_ENABLED: true,
      RETENTION_SWEEP_INTERVAL: '1h',
      RETENTION_SWEEP_BATCH: 1000,
      RETENTION_SWEEP_MAX_BATCHES: 50,
    });
  });

  it('accepts each period at its floor', () => {
    const { error } = validate({
      RETENTION_AUDIT: '7d',
      RETENTION_ADMIN_LOGIN_FAILURES: '24h',
      RETENTION_EXPIRED_GRANTS: '1d',
      RETENTION_SWEEP_INTERVAL: '60s',
      RETENTION_SWEEP_BATCH: '1',
      RETENTION_SWEEP_MAX_BATCHES: '1',
    });

    expect(error).toBeUndefined();
  });

  it.each([
    ['RETENTION_AUDIT', '6d', 'must be at least 7d'],
    ['RETENTION_AUDIT', '0d', 'must be at least 7d'],
    ['RETENTION_AUDIT', '180', 'must be a duration such as 180d'],
    ['RETENTION_ADMIN_LOGIN_FAILURES', '23h', 'must be at least 1d'],
    ['RETENTION_EXPIRED_GRANTS', '0d', 'must be at least 1d'],
    ['RETENTION_SWEEP_INTERVAL', '59s', 'must be at least 1m'],
  ])('refuses %s=%s naming the key', (key, raw, message) => {
    const { error } = validate({ [key]: raw });

    expect(error?.message).toContain(`"${key}" ${message}`);
  });

  it.each(['RETENTION_SWEEP_BATCH', 'RETENTION_SWEEP_MAX_BATCHES'])(
    'refuses %s=0 naming the key',
    (key) => {
      const { error } = validate({ [key]: '0' });

      expect(error?.message).toContain(`"${key}"`);
    }
  );

  it('reads the validated values into milliseconds', () => {
    expect(
      retentionConfig({
        RETENTION_AUDIT: '30d',
        RETENTION_ADMIN_LOGIN_FAILURES: '2w',
        RETENTION_EXPIRED_GRANTS: '3d',
        RETENTION_SWEEP_ENABLED: 'false',
        RETENTION_SWEEP_INTERVAL: '5m',
        RETENTION_SWEEP_BATCH: '200',
        RETENTION_SWEEP_MAX_BATCHES: '7',
      })
    ).toEqual({
      auditMs: 30 * DAY,
      adminLoginFailuresMs: 14 * DAY,
      expiredGrantsMs: 3 * DAY,
      sweep: {
        enabled: false,
        intervalMs: 5 * 60 * 1000,
        batchSize: 200,
        maxBatches: 7,
      },
    });
  });

  it('reads the defaults when the environment is empty', () => {
    expect(retentionConfig({})).toEqual({
      auditMs: 180 * DAY,
      adminLoginFailuresMs: 90 * DAY,
      expiredGrantsMs: 14 * DAY,
      sweep: {
        enabled: true,
        intervalMs: 60 * 60 * 1000,
        batchSize: 1000,
        maxBatches: 50,
      },
    });
  });
});
