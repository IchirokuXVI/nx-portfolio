import { ADMIN_AUTH_PATTERNS } from '@portfolio/luna-shopper/contracts';
import type { Request } from 'express';
import { AdminAuthController } from './admin-auth.controller';

/**
 * The gateway half of operator sign in (plan 0071, sections 5 and 8).
 *
 * Two things happen here that happen nowhere else: the caller's address and user
 * agent are read off the request (auth is behind the broker and has none), and
 * the development autologin decides which subject to send.
 */
function build(
  admin: { devAutologin: boolean; devAutologinUsername: string },
  environmentName = 'development'
) {
  const nats = { send: jest.fn(async () => ({ adminId: 'a1' })) };
  const config = {
    getOrThrow: () => ({ admin, environmentName }),
  };
  return {
    nats,
    controller: new AdminAuthController(nats as never, config as never),
  };
}

const request = {
  ip: '203.0.113.9',
  get: (header: string) => (header === 'user-agent' ? 'Firefox' : undefined),
} as unknown as Request;

describe('AdminAuthController', () => {
  describe('login', () => {
    it('passes the credentials, the address and the agent to auth', () => {
      // The address and agent are recorded against a failed attempt and nothing
      // else, and only the gateway can see them.
      const { controller, nats } = build({
        devAutologin: false,
        devAutologinUsername: '',
      });

      controller.login({ username: 'ops', password: 'pw' }, request);

      expect(nats.send).toHaveBeenCalledWith(ADMIN_AUTH_PATTERNS.login, {
        username: 'ops',
        password: 'pw',
        ip: '203.0.113.9',
        userAgent: 'Firefox',
      });
    });

    it('sends the autologin subject and no password when the switch is on', () => {
      // The body is ignored entirely: a development sign in is not a login with a
      // known password, it is a different request. Auth refuses to boot with the
      // switch on against a non local database, so a deployment where this branch
      // could do harm cannot start.
      const { controller, nats } = build({
        devAutologin: true,
        devAutologinUsername: 'dev-admin',
      });

      controller.login({ username: 'anything', password: 'wrong' }, request);

      expect(nats.send).toHaveBeenCalledWith(ADMIN_AUTH_PATTERNS.devAutologin, {
        username: 'dev-admin',
      });
      expect(JSON.stringify(nats.send.mock.calls)).not.toContain('wrong');
    });
  });

  describe('me', () => {
    it('answers with the operator and the environment the server reports', async () => {
      // The colour the back office renders comes from here rather than from its
      // own bundle, because the failure being guarded against is believing you
      // are in staging when you are in production.
      const { controller, nats } = build(
        { devAutologin: false, devAutologinUsername: '' },
        'production'
      );

      const result = await controller.me({ adminId: 'a1' });

      expect(nats.send).toHaveBeenCalledWith(ADMIN_AUTH_PATTERNS.getAdmin, {
        adminId: 'a1',
      });
      expect(result.environment).toBe('production');
      expect(result.admin).toEqual({ adminId: 'a1' });
    });
  });

  describe('refresh', () => {
    it('names the admin from the verified token, never from a body', () => {
      const { controller, nats } = build({
        devAutologin: false,
        devAutologinUsername: '',
      });

      controller.refresh({ adminId: 'a1' });

      expect(nats.send).toHaveBeenCalledWith(ADMIN_AUTH_PATTERNS.refresh, {
        adminId: 'a1',
      });
    });
  });
});
