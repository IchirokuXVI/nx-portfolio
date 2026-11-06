import { harvesterValidationSchema } from './app-config';

/**
 * What the harvester needs to decide who may reach it (plan 0072, sections 2
 * and 5).
 *
 * The stakes differ from catalog's by more than a service: **every** subject
 * here is gated, not only the writes, so this key is not the difference between
 * an editable harvester and a read only one. It is the difference between a
 * harvester and a service that answers nothing.
 */
describe('harvester admin gate configuration', () => {
  const required = {
    NATS_URL: 'nats://luna-shopper-backend-nats:4222',
    HARVESTER_DB_URL:
      'postgres://luna_harvester:pw@luna-shopper-backend-harvester-db:5432/luna_harvester',
    AUTH_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nx\n-----END-----',
    ADMIN_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\ny\n-----END-----',
    // Required since plan 0216: the refresh cooldowns are counted in Redis.
    REDIS_URL: 'redis://luna-shopper-backend-redis:6379',
  };

  describe('the operator public key', () => {
    it('is required, because every subject is gated on it', () => {
      const { ADMIN_JWT_PUBLIC_KEY: _key, ...withoutKey } = required;
      expect(
        harvesterValidationSchema.validate(withoutKey).error
      ).toBeDefined();
    });

    it('accepts the file spelling local development uses', () => {
      const { ADMIN_JWT_PUBLIC_KEY: _key, ...rest } = required;
      const { error } = harvesterValidationSchema.validate({
        ...rest,
        ADMIN_JWT_PUBLIC_KEY_FILE:
          'apps/luna-shopper-backend/secrets/admin-jwt.pub',
      });
      expect(error).toBeUndefined();
    });
  });

  describe('the allowlist that used to be here', () => {
    it('is not a key this schema knows', () => {
      const keys = Object.keys(harvesterValidationSchema.describe().keys ?? {});
      expect(keys).not.toContain('PLATFORM_ADMIN_USER_IDS');
    });

    it('did not become a service list, because nothing calls the harvester', () => {
      // Catalog gained `SERVICE_ACTOR_IDS` because the harvester writes to it.
      // The harvester has no such caller, and inventing one here would be a
      // second door on a service whose whole point is having one.
      const keys = Object.keys(harvesterValidationSchema.describe().keys ?? {});
      expect(keys).not.toContain('SERVICE_ACTOR_IDS');
    });

    it('leaves the actor id alone, which names this service to catalog', () => {
      const keys = Object.keys(harvesterValidationSchema.describe().keys ?? {});
      expect(keys).toContain('HARVESTER_ACTOR_ID');
    });
  });

  describe('the price refresh (plan 0216, section 9)', () => {
    it('requires Redis, where the cooldowns are counted', () => {
      const { REDIS_URL: _url, ...withoutRedis } = required;
      expect(
        harvesterValidationSchema.validate(withoutRedis).error
      ).toBeDefined();
    });

    it('is off by default, with the section 5 numbers', () => {
      const { value } = harvesterValidationSchema.validate(required);
      expect(value).toMatchObject({
        HARVEST_REFRESH_ENABLED: false,
        HARVEST_REFRESH_CHAIN_SECONDS: 30,
        HARVEST_REFRESH_PRODUCT_MINUTES: 30,
        HARVEST_REFRESH_BLOCKED_MINUTES: 30,
      });
    });
  });
});
