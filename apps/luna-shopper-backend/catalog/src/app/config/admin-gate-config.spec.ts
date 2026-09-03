import { catalogValidationSchema } from './app-config';

/**
 * What catalog needs to decide who may write it (plan 0072, sections 2 and 5).
 *
 * Two of section 7's exit criteria are configuration rather than code, and this
 * is where they are held: `PLATFORM_ADMIN_USER_IDS` is gone rather than defaulted
 * to empty, and the operator public key took its place as a required value. The
 * first is worth a test because deleting a variable is easy to do halfway, and a
 * schema that still accepts the old name is a deploy that still ships it.
 */
describe('catalog admin gate configuration', () => {
  const required = {
    NATS_URL: 'nats://luna-shopper-backend-nats:4222',
    CATALOG_DB_URL:
      'postgres://luna_catalog:pw@luna-shopper-backend-catalog-db:5432/luna_catalog',
    AUTH_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nx\n-----END-----',
    ADMIN_JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\ny\n-----END-----',
  };

  describe('the operator public key', () => {
    it('is required, because without it no write can be accepted', () => {
      const { ADMIN_JWT_PUBLIC_KEY: _key, ...withoutKey } = required;
      expect(catalogValidationSchema.validate(withoutKey).error).toBeDefined();
    });

    it('accepts the file spelling local development uses', () => {
      const { ADMIN_JWT_PUBLIC_KEY: _key, ...rest } = required;
      const { error } = catalogValidationSchema.validate({
        ...rest,
        ADMIN_JWT_PUBLIC_KEY_FILE:
          'apps/luna-shopper-backend/secrets/admin-jwt.pub',
      });
      expect(error).toBeUndefined();
    });

    it('is separate from the auth key, which stays required too', () => {
      const { AUTH_JWT_PUBLIC_KEY: _key, ...withoutAuth } = required;
      expect(catalogValidationSchema.validate(withoutAuth).error).toBeDefined();
    });
  });

  describe('the allowlist that used to be here', () => {
    it('is not a key this schema knows', () => {
      const keys = Object.keys(catalogValidationSchema.describe().keys ?? {});
      expect(keys).not.toContain('PLATFORM_ADMIN_USER_IDS');
    });

    it('was replaced by a list of services, which is optional', () => {
      // Optional on purpose: a catalog with no harvester beside it should refuse
      // every service, and that is the resting state of both clusters.
      const keys = Object.keys(catalogValidationSchema.describe().keys ?? {});
      expect(keys).toContain('SERVICE_ACTOR_IDS');
      expect(catalogValidationSchema.validate(required).error).toBeUndefined();
    });
  });
});
