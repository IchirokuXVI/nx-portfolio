import { coreValidationSchema } from '../config/app-config';
import { retentionConfig } from './retention-config';

/**
 * The retention settings of core (plan 0233, section 3): the owner's number
 * as the default, and a floor under the period that refuses boot with a
 * message naming the key.
 */
describe('the retention settings of core', () => {
  const required = {
    NATS_URL: 'nats://luna-shopper-backend-nats:4222',
    CORE_DB_URL:
      'postgres://luna_core:pw@luna-shopper-backend-core-db:5432/luna_core',
    AUTH_JWT_PUBLIC_KEY: 'x',
    ADMIN_JWT_PUBLIC_KEY: 'y',
  };
  const DAY = 24 * 60 * 60 * 1000;

  function validate(extra: Record<string, string>) {
    return coreValidationSchema.validate(
      { ...required, ...extra },
      { abortEarly: false }
    );
  }

  it('defaults to six months when nothing is set', () => {
    const { error, value } = validate({});

    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      RETENTION_AUDIT: '180d',
      RETENTION_SWEEP_ENABLED: true,
      RETENTION_SWEEP_INTERVAL: '1h',
      RETENTION_SWEEP_BATCH: 1000,
      RETENTION_SWEEP_MAX_BATCHES: 50,
    });
  });

  it('accepts the period at its floor', () => {
    const { error } = validate({
      RETENTION_AUDIT: '1w',
      RETENTION_SWEEP_INTERVAL: '1m',
      RETENTION_SWEEP_BATCH: '1',
      RETENTION_SWEEP_MAX_BATCHES: '1',
    });

    expect(error).toBeUndefined();
  });

  it.each([
    ['RETENTION_AUDIT', '6d', 'must be at least 7d'],
    ['RETENTION_AUDIT', '180', 'must be a duration such as 180d'],
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

  it('reads the values into milliseconds, with the defaults for the rest', () => {
    expect(retentionConfig({ RETENTION_AUDIT: '30d' })).toEqual({
      auditMs: 30 * DAY,
      sweep: {
        enabled: true,
        intervalMs: 60 * 60 * 1000,
        batchSize: 1000,
        maxBatches: 50,
      },
    });
  });
});
