import { RECONCILIATION_PATTERNS } from './reconciliation.messages';

describe('RECONCILIATION_PATTERNS', () => {
  it('pins the wire subject for the memberless-users reconciliation query', () => {
    expect(RECONCILIATION_PATTERNS.usersWithoutMemberships).toBe(
      'core.usersWithoutMemberships'
    );
  });
});
