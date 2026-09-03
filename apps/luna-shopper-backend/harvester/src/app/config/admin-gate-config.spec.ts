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
});
