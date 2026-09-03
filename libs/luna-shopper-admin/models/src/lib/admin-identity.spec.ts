import { toAdminIdentity, toAdminMe } from './admin-identity';

/**
 * `GET /v1/admin/auth/me`, mapped into this app's own types (plan 0002,
 * section 6; rule D4).
 *
 * The distinction worth asserting is between an identity that is unusable and an
 * environment that is merely unrecognised. They are different failures with
 * different answers, and `0001` already settled the second one: an environment
 * this app cannot name is a state it draws, not a reason to reject the operator
 * it arrived with.
 */

const me = {
  admin: {
    adminId: 'adm_1',
    username: 'ops',
    displayName: 'Operations',
    lastLoginAt: '2026-09-01T08:00:00.000Z',
    disabledAt: null,
  },
  environment: 'staging',
};

describe('toAdminMe', () => {
  it('reads the operator and the deployment', () => {
    expect(toAdminMe(me)).toEqual({
      admin: {
        adminId: 'adm_1',
        username: 'ops',
        displayName: 'Operations',
        lastLoginAt: new Date('2026-09-01T08:00:00.000Z'),
      },
      deployment: 'staging',
    });
  });

  /**
   * An environment name nobody has thought of does not cost the operator their
   * session. It costs the accent colour, which is exactly what `0001` decided:
   * say "unknown" rather than pick one.
   */
  it('keeps the operator when the environment is one it does not know', () => {
    const read = toAdminMe({ ...me, environment: 'preview-7' });

    expect(read?.deployment).toBeNull();
    expect(read?.admin.username).toBe('ops');
  });

  it('answers null when there is no usable operator in it', () => {
    expect(toAdminMe({ environment: 'staging' })).toBeNull();
    expect(toAdminMe({ ...me, admin: { username: 'ops' } })).toBeNull();
    expect(toAdminMe(null)).toBeNull();
  });
});

describe('toAdminIdentity', () => {
  it('reads an account that has never signed in', () => {
    const identity = toAdminIdentity({
      adminId: 'adm_2',
      username: 'ops2',
      displayName: null,
      lastLoginAt: null,
    });

    expect(identity).toEqual({
      adminId: 'adm_2',
      username: 'ops2',
      displayName: null,
      lastLoginAt: null,
    });
  });

  /**
   * The hash is not in the shape auth answers with at all, so this is a guard
   * against the mapper widening rather than against the server. It stays because
   * a mapper that copies unknown keys through is how one gets onto a screen.
   */
  it('carries nothing the interface does not name', () => {
    const identity = toAdminIdentity({
      adminId: 'adm_2',
      username: 'ops2',
      passwordHash: 'argon2id$...',
    });

    expect(identity).not.toHaveProperty('passwordHash');
  });
});
