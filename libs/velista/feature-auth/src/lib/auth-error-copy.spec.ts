import { GatewayError } from '@portfolio/velista/data-access';
import { authErrorCopy, termsRefusalCopy } from './auth-error-copy';

// Velista `0133`, target 8: the refusal of a support session, where the page puts its
// other refusals.
describe('authErrorCopy in a support session', () => {
  it('says the act cannot be done in a support session', () => {
    const refused = new GatewayError({
      code: 'impersonation_not_allowed',
      status: 403,
      correlationId: 'c1',
    });

    expect(authErrorCopy(refused, 'auth.upgrade')).toEqual({
      key: 'support.refused',
      placement: 'pair',
    });
  });
});

// Velista `0173`, target 7: a refusal about the terms, on every operation.
describe('authErrorCopy about the terms', () => {
  const stale = new GatewayError({
    code: 'terms_version_stale',
    status: 409,
    correlationId: 'c2',
    details: { currentVersion: '2026-10-29+2026-12-01' },
  });
  const missing = new GatewayError({
    code: 'terms_acceptance_missing',
    status: 400,
    correlationId: 'c3',
    details: { currentVersion: '2026-10-29' },
  });

  it('says the terms changed, on the checkbox, with a link', () => {
    for (const operation of [
      'auth.register',
      'auth.upgrade',
      'auth.google',
    ] as const) {
      expect(authErrorCopy(stale, operation)).toEqual({
        key: 'legal.accept.stale',
        placement: 'terms',
        link: 'terms',
      });
    }
  });

  it('says the same without "changed" for a missing version', () => {
    expect(authErrorCopy(missing, 'auth.register')).toEqual({
      key: 'legal.accept.missing',
      placement: 'terms',
      link: 'terms',
    });
  });

  it('is null for anything else', () => {
    expect(
      termsRefusalCopy(
        new GatewayError({ code: 'conflict', status: 409, correlationId: 'c4' })
      )
    ).toBeNull();
    expect(termsRefusalCopy(new Error('offline'))).toBeNull();
  });
});
