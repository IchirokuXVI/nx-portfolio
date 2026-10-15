import { GatewayError } from '@portfolio/velista/data-access';
import { accountFailure } from './account-error-copy';

// Velista `0133`, target 8: the refusal of a support session, where the page puts its
// other refusals.
describe('accountFailure in a support session', () => {
  it('says the act cannot be done in a support session, and ends nothing', () => {
    const refused = new GatewayError({
      code: 'impersonation_not_allowed',
      status: 403,
      correlationId: 'c1',
    });

    expect(accountFailure(refused, 'account.delete')).toEqual({
      key: 'support.refused',
      waitSeconds: null,
      endSession: false,
    });
  });
});
