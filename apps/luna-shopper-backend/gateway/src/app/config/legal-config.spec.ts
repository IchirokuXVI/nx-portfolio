import { LEGAL_TEMPLATES } from '@portfolio/luna-shopper/contracts';
import { gatewayValidationSchema } from './app-config';
import { durationDays, legalConfig } from './legal-config';

/**
 * What the gateway accepts at boot about its legal settings (plan 0231,
 * section 5.1). Every key defaults; the one refusal is acceptance required of
 * terms nobody published.
 */

const base = {
  NATS_URL: 'nats://localhost:4222',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWT_PUBLIC_KEY: 'a-public-key',
  ADMIN_JWT_PUBLIC_KEY: 'an-admin-public-key',
};

const validate = (env: Record<string, string>) =>
  gatewayValidationSchema.validate({ ...base, ...env });

describe('legal configuration at boot', () => {
  it('boots with none of the keys set', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    expect(value.TERMS_ACCEPTANCE_REQUIRED).toBe(false);
    expect(value.RETENTION_AUDIT).toBe('180d');
  });

  it.each([
    ['no controller', { LEGAL_CONTACT_EMAIL: 'privacy@example.invalid' }],
    ['no contact', { LEGAL_CONTROLLER_NAME: 'Jane Example' }],
    ['neither', {}],
  ])(
    'refuses acceptance required with %s',
    (_name, published: Record<string, string>) => {
      const { error } = validate({
        TERMS_ACCEPTANCE_REQUIRED: 'true',
        ...published,
      });
      expect(error?.message).toMatch(
        /LEGAL_CONTROLLER_NAME|LEGAL_CONTACT_EMAIL/
      );
    }
  );

  it('boots with acceptance required once both are set', () => {
    const { error } = validate({
      TERMS_ACCEPTANCE_REQUIRED: 'true',
      LEGAL_CONTROLLER_NAME: 'Jane Example',
      LEGAL_CONTACT_EMAIL: 'privacy@example.invalid',
    });
    expect(error).toBeUndefined();
  });

  it('refuses a contact that is not an address, and a revision that is not a date', () => {
    expect(
      validate({ LEGAL_CONTACT_EMAIL: 'nobody' }).error?.message
    ).toContain('LEGAL_CONTACT_EMAIL');
    expect(
      validate({ LEGAL_TERMS_REVISION: '15 December' }).error?.message
    ).toContain('LEGAL_TERMS_REVISION');
  });
});

describe('legalConfig', () => {
  it('reads empty as null and falls back to the product name', () => {
    const legal = legalConfig({ LEGAL_APP_NAME: '  ' });
    expect(legal.appName).toBe('Luna Shopper');
    expect(legal.controllerName).toBeNull();
    expect(legal.emailProvider).toBeNull();
    expect(legal.terms.version).toBe(LEGAL_TEMPLATES.terms.version);
  });

  it('builds the effective version from the operator revision', () => {
    const legal = legalConfig({ LEGAL_TERMS_REVISION: '2099-12-15' });
    expect(legal.terms.version).toBe(
      `${LEGAL_TEMPLATES.terms.version}+2099-12-15`
    );
    expect(legal.terms.updatedOn).toBe('2099-12-15');
  });

  it('reports the retention keys in whole days', () => {
    expect(durationDays('180d')).toBe(180);
    expect(durationDays('2w')).toBe(14);
    expect(durationDays('36h')).toBe(1);
    expect(legalConfig({}).retention).toEqual({
      auditTrailDays: 180,
      adminLoginFailureDays: 90,
      expiredGrantDays: 14,
      applicationLogDays: 30,
      assistantLogDays: 7,
      backupDays: 14,
    });
  });
});
