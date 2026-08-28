import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AUTH_PATTERNS,
  UserKind,
  type GoogleProfile,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { NatsClient } from '../messaging/nats-client';
import { GoogleCallbackGuard } from './google-auth.guard';
import { GoogleController } from './google.controller';

/**
 * The callback over real HTTP, because its contract is about the response and
 * not about the value the handler returns (plan 0023, section 3.3).
 *
 * Everything else in this folder calls the controller directly, which is where
 * both of this route's shipped regressions hid. A guard that answers by
 * redirecting to Google returns before the controller runs, and a body written
 * by Express on the way out is added after it returns, so a test holding the
 * controller sees neither. Booting the thing and reading the wire does.
 *
 * A stubbed NATS and a stubbed config, so nothing here needs the compose stack;
 * this is the same assertion the e2e suite makes, minus the stack it needs.
 */

const APP_BASE_URL = 'http://app.example/{locale}/velista';

const profile: GoogleProfile = {
  providerUserId: 'g-123',
  email: 'a@b.com',
  displayName: 'A Person',
};

const pair = {
  userId: 'u1',
  kind: UserKind.REGISTERED,
  username: 'Swift Sail',
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
};

/**
 * Boots the controller on a real port. `withProfile` stands in for a completed
 * passport dance, which no test can drive for real: the guard is replaced by one
 * that puts a profile on the request, exactly as passport would.
 */
async function boot(withProfile: boolean) {
  const builder = Test.createTestingModule({
    controllers: [GoogleController],
    providers: [
      {
        provide: NatsClient,
        useValue: {
          send: jest.fn(async (subject: string) =>
            subject === AUTH_PATTERNS.consumeOAuthState
              ? { userId: 'guest-1', locale: 'en' }
              : pair
          ),
        },
      },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: () => ({
            appBaseUrl: APP_BASE_URL,
            google: { enabled: true },
          }),
        },
      },
    ],
  });

  if (withProfile) {
    builder.overrideGuard(GoogleCallbackGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = profile;
        return true;
      },
    });
  }

  const nest = (await builder.compile()).createNestApplication();
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, origin: `http://127.0.0.1:${port}` };
}

describe('GET /auth/google/callback over HTTP', () => {
  it('answers a request Google did not send with a redirect into the app', async () => {
    // The real guard runs. With no code it must not start a flow of its own,
    // which is what put Google's consent screen in this header (section 3.3).
    const { nest, origin } = await boot(false);
    try {
      const res = await fetch(`${origin}/auth/google/callback?state=nope`, {
        redirect: 'manual',
      });

      expect(res.status).toBe(302);
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/auth/callback#');
      expect(location).toContain(`error=${ERROR_CODES.UNAUTHORIZED}`);
      expect(location.startsWith(origin)).toBe(false);
      expect(await res.text()).toBe('');
    } finally {
      await nest.close();
    }
  });

  it('puts the token pair in the header and nowhere else', async () => {
    // The assertion with something to lose. Express writes `Found. Redirecting
    // to <url>` as the body of a redirect, url and all, so the courtesy body was
    // a copy of the refresh token in a response body on this origin.
    const { nest, origin } = await boot(true);
    try {
      const res = await fetch(`${origin}/auth/google/callback?code=c&state=s`, {
        redirect: 'manual',
      });
      const body = await res.text();

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain(pair.refreshToken);
      expect(body).toBe('');
      expect(body).not.toContain(pair.refreshToken);
      expect(body).not.toContain(pair.accessToken);
    } finally {
      await nest.close();
    }
  });
});
