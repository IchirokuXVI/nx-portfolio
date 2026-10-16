import { GatewayError } from '@portfolio/velista/data-access';
import { authErrorCopy } from './auth-error-copy';

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
