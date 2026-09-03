import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_TOKEN_AUDIENCE,
} from './admin-auth.messages';
import { AUTH_PATTERNS } from './auth.messages';

/**
 * The operator wire contract, pinned (plan 0071). The audience string is the one
 * value in here a reader might think is cosmetic: it is what `AdminJwtGuard`
 * requires and what keeps a future key consolidation from silently merging the
 * two principals, so a rename of it is a security change and fails here.
 */
describe('admin auth contracts', () => {
  it('pins the message subjects', () => {
    expect(ADMIN_AUTH_PATTERNS.login).toBe('adminAuth.login');
    expect(ADMIN_AUTH_PATTERNS.refresh).toBe('adminAuth.refresh');
    expect(ADMIN_AUTH_PATTERNS.getAdmin).toBe('adminAuth.getAdmin');
    expect(ADMIN_AUTH_PATTERNS.devAutologin).toBe('adminAuth.devAutologin');
  });

  it('pins the token audience', () => {
    expect(ADMIN_TOKEN_AUDIENCE).toBe('platform-admin');
  });

  it('shares no subject with the user facing auth namespace', () => {
    const userSubjects = new Set<string>(Object.values(AUTH_PATTERNS));
    for (const subject of Object.values(ADMIN_AUTH_PATTERNS)) {
      expect(userSubjects.has(subject)).toBe(false);
    }
  });
});
