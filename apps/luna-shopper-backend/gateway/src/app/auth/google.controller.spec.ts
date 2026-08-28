import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_PATTERNS, UserKind } from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import {
  GoogleAuthGuard,
  GoogleCallbackGuard,
  hasAuthorizationCode,
  stateOf,
} from './google-auth.guard';
import { GoogleController } from './google.controller';
import { OptionalJwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy, type CurrentUser } from './jwt.strategy';

/**
 * Google sign in end to end at the gateway (plan 0023, section 7).
 *
 * Two things used to be wrong here and the second one destroyed data: the
 * callback answered with a page of the user's own tokens as JSON on the API's
 * origin, and it sent no `linkUserId`, so a guest who tapped Continue with Google
 * got a brand new account and silently lost every zone they owned. Both are what
 * these tests are about.
 */

const APP_BASE_URL = 'https://app.example/{locale}/velista';

const configService = {
  // Configured, which is what every test below exercises. The unconfigured
  // callback is its own test at the bottom of this file (plan 0026).
  getOrThrow: () => ({
    appBaseUrl: APP_BASE_URL,
    google: { enabled: true },
  }),
} as never;

/** The same controller with Google unset, for the one test that needs it. */
const unconfiguredConfigService = {
  getOrThrow: () => ({
    appBaseUrl: APP_BASE_URL,
    google: { enabled: false },
  }),
} as never;

const profile = {
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

/** A rejected NATS call carries the house envelope a service already produced. */
const problem = (code: string) => ({
  code,
  status: 400,
  message: 'Invalid or expired sign in request',
  correlationId: 'c1',
});

/**
 * Wires the controller to a NATS double that answers the two subjects the
 * callback uses. `state` is what `consumeOAuthState` resolves to; pass an Error
 * to make it reject instead.
 */
function build(state: unknown) {
  const send = jest.fn(async (subject: string) => {
    if (subject === AUTH_PATTERNS.consumeOAuthState) {
      if (state instanceof Error) {
        throw state;
      }
      return state;
    }
    if (subject === AUTH_PATTERNS.googleLogin) {
      return pair;
    }
    if (subject === AUTH_PATTERNS.mintOAuthState) {
      return { state: 'minted-state' };
    }
    throw new Error(`unexpected subject ${subject}`);
  });
  const controller = new GoogleController({ send } as never, configService);
  return { controller, send };
}

/** The `#...` half of a Location, parsed. */
const fragmentOf = (url: string) =>
  Object.fromEntries(new URLSearchParams(url.split('#')[1] ?? ''));

describe('GET /v1/auth/google/callback', () => {
  it('links the guest the state was carrying, so they keep their userId', async () => {
    // The whole point of the plan. `linkUserId` is what routes googleLogin into
    // `upgrade()` and converts the caller in place instead of minting a stranger.
    const { controller, send } = build({ userId: 'guest-1', locale: 'en' });

    await controller.callback({ user: profile, query: { state: 's' } });

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.googleLogin, {
      ...profile,
      linkUserId: 'guest-1',
    });
  });

  it('links nobody when the state carried nobody', async () => {
    const { controller, send } = build({ locale: 'en' });

    await controller.callback({ user: profile, query: { state: 's' } });

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.googleLogin, {
      ...profile,
      linkUserId: undefined,
    });
  });

  it('redirects to the app with the pair in the fragment, never a JSON body', async () => {
    const { controller } = build({ userId: 'guest-1', locale: 'es' });

    const result = await controller.callback({
      user: profile,
      query: { state: 's' },
    });

    expect(result.statusCode).toBe(HttpStatus.FOUND);
    // Built from APP_BASE_URL and the locale the state carried, and from nothing
    // the client supplied: that is what keeps it from being an open redirect.
    expect(result.url.split('#')[0]).toBe(
      'https://app.example/es/velista/auth/callback'
    );
    expect(fragmentOf(result.url)).toEqual({
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      userId: pair.userId,
      kind: pair.kind,
      username: pair.username,
    });
  });

  it('puts neither token in the query string', async () => {
    // Section 3.1, asserted explicitly because it is the property that section
    // exists to guarantee. A fragment is never sent to a server; a query string
    // is, which would write the refresh token into the gateway's access log,
    // every proxy log in front of it, and the next request's `Referer`.
    const { controller } = build({ userId: 'guest-1', locale: 'en' });

    const { url } = await controller.callback({
      user: profile,
      query: { state: 's' },
    });

    const beforeFragment = url.split('#')[0];
    expect(beforeFragment).not.toContain('?');
    expect(beforeFragment).not.toContain(pair.accessToken);
    expect(beforeFragment).not.toContain(pair.refreshToken);
  });

  it('falls back to the default locale when the state carried none', async () => {
    const { controller } = build({ userId: 'guest-1' });

    const { url } = await controller.callback({
      user: profile,
      query: { state: 's' },
    });

    expect(url.split('#')[0]).toBe(
      'https://app.example/en/velista/auth/callback'
    );
  });

  it('ignores a locale outside the supported set rather than interpolating it', async () => {
    // The locale reaches us from auth rather than from a query parameter, and it
    // is still narrowed before it is put into a URL. Both halves of "built from
    // nothing the client supplied" have to hold for the first half to mean
    // anything.
    const { controller } = build({ userId: 'guest-1', locale: '../../evil' });

    const { url } = await controller.callback({
      user: profile,
      query: { state: 's' },
    });

    expect(url.split('#')[0]).toBe(
      'https://app.example/en/velista/auth/callback'
    );
  });

  describe('a state that does not hold up', () => {
    it('does not call googleLogin at all, and redirects with an error', async () => {
      const { controller, send } = build(
        Object.assign(
          new Error('rejected'),
          problem(ERROR_CODES.VALIDATION_FAILED)
        )
      );

      const result = await controller.callback({
        user: profile,
        query: { state: 'replayed' },
      });

      // Not "sign in without linking" (section 4.4): that is the account loss,
      // reached from a different direction, and it would depend on a race
      // between a token's expiry and a user's typing speed.
      expect(send).not.toHaveBeenCalledWith(
        AUTH_PATTERNS.googleLogin,
        expect.anything()
      );
      expect(result.statusCode).toBe(HttpStatus.FOUND);
      expect(fragmentOf(result.url)).toEqual({
        error: ERROR_CODES.VALIDATION_FAILED,
      });
    });

    it('answers the same way when the state is absent entirely', async () => {
      const { controller, send } = build(
        Object.assign(
          new Error('rejected'),
          problem(ERROR_CODES.VALIDATION_FAILED)
        )
      );

      const result = await controller.callback({ user: profile, query: {} });

      expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.consumeOAuthState, {
        state: '',
      });
      expect(fragmentOf(result.url)).toEqual({
        error: ERROR_CODES.VALIDATION_FAILED,
      });
    });

    it('reports an unrecognisable failure as internal rather than leaking it', async () => {
      const { controller } = build(new Error('ECONNREFUSED nats:4222'));

      const { url } = await controller.callback({
        user: profile,
        query: { state: 's' },
      });

      expect(fragmentOf(url)).toEqual({ error: ERROR_CODES.INTERNAL });
    });
  });

  it('redirects rather than erroring when passport resolved no profile', async () => {
    // A refused consent, a bad code, or Google being unreachable. An error page
    // on the API's origin is the one thing this route must never produce: the
    // user has no way back from there and the app never learns the flow ended.
    const { controller, send } = build({ userId: 'guest-1', locale: 'en' });

    const result = await controller.callback({ query: { state: 's' } });

    expect(send).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(HttpStatus.FOUND);
    expect(fragmentOf(result.url)).toEqual({
      error: ERROR_CODES.UNAUTHORIZED,
    });
  });
});

describe('GET /v1/auth/google', () => {
  const guard = new GoogleAuthGuard();

  const contextFor = (query: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ query }) }),
    }) as unknown as ExecutionContext;

  it('hands the state to passport, which appends it to the authorization URL', () => {
    expect(guard.getAuthenticateOptions(contextFor({ state: 'abc' }))).toEqual({
      state: 'abc',
    });
  });

  it('sends no state when the caller supplied none', () => {
    // It still goes to Google and fails at the callback. One wasted trip in a
    // case that should not occur, against an orphaned account (section 4.4).
    expect(guard.getAuthenticateOptions(contextFor({}))).toEqual({});
  });

  it('ignores a repeated state parameter, which arrives as an array', () => {
    expect(
      guard.getAuthenticateOptions(contextFor({ state: ['a', 'b'] }))
    ).toEqual({});
    expect(stateOf({ query: { state: ['a', 'b'] } })).toBe('');
  });
});

/**
 * The guard on the mint route, and the regression test section 4.2 is for.
 *
 * Under the pre-0020 optional guard, a guest whose access token had expired would
 * mint a state carrying nobody, sail through the Google flow, and land on a fresh
 * account with every zone orphaned: the exact bug this plan fixes, reintroduced
 * one layer up and much harder to see. So the real guard runs against a real
 * RS256 key pair, and the handler is called with whatever the guard established.
 */
describe('POST /v1/auth/google/state', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwt = new JwtService();
  const sign = (expiresIn: string) =>
    jwt.sign(
      { sub: 'guest-1', kind: UserKind.TEMPORARY },
      { privateKey, algorithm: 'RS256', expiresIn }
    );

  new JwtStrategy({
    getOrThrow: () => ({
      authJwtPublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    }),
  } as never);

  const guard = new OptionalJwtAuthGuard();

  function contextFor(headers: Record<string, string>) {
    const request: { headers: Record<string, string>; user?: CurrentUser } = {
      headers,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: () => undefined,
          end: () => undefined,
        }),
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('mints a state carrying nobody for a caller with no token', async () => {
    const { controller, send } = build(undefined);
    const { context, request } = contextFor({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await controller.mintState(request.user);

    expect(send).toHaveBeenCalledWith(AUTH_PATTERNS.mintOAuthState, {
      userId: undefined,
      locale: undefined,
    });
  });

  it('mints a state carrying the caller when the token is good', async () => {
    const { controller, send } = build(undefined);
    const { context, request } = contextFor({
      authorization: `Bearer ${sign('15m')}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(controller.mintState(request.user)).resolves.toEqual({
      state: 'minted-state',
    });

    expect(send).toHaveBeenCalledWith(
      AUTH_PATTERNS.mintOAuthState,
      expect.objectContaining({ userId: 'guest-1' })
    );
  });

  it('refuses an expired token instead of minting an anonymous state', async () => {
    const { controller, send } = build(undefined);
    const { context } = contextFor({ authorization: `Bearer ${sign('-1s')}` });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    // The handler never runs, so the client refreshes and tries again rather
    // than starting a flow that would end on somebody else's account.
    expect(send).not.toHaveBeenCalled();
    expect(controller).toBeDefined();
  });
});

describe('the callback with Google unconfigured (plan 0026)', () => {
  it('redirects with not_configured rather than rendering an error', async () => {
    // The one rule this route has: never leave the user on the API's origin.
    // So the unconfigured case is reported the same way every other failure
    // here is — as a fragment on a redirect back to the app — rather than as
    // the 501 the two interactive routes answer with.
    const send = jest.fn();
    const controller = new GoogleController(
      { send } as never,
      unconfiguredConfigService
    );

    const result = await controller.callback({ query: {} });

    expect(result.url.startsWith('https://app.example/')).toBe(true);
    expect(fragmentOf(result.url)).toEqual({
      error: ERROR_CODES.NOT_CONFIGURED,
    });
    // Nothing was asked of auth: there is no flow to complete.
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * The guard on the callback, and the reason a bare hit on the route used to end
 * at Google (plan 0023, section 3.3).
 *
 * `passport-oauth2` has one `authenticate` for both halves of the dance and
 * picks by looking for a code on the request. With none it starts the flow,
 * so the callback answered a request Google never sent with a 302 to the consent
 * screen: an accidental second `GET /v1/auth/google` that skips the state mint,
 * and a `Location` on Google's origin where the app expects its own. Worse, that
 * redirect happens inside `canActivate`, so nothing below it runs and none of
 * the tests above could see it.
 */
describe('the callback guard, on a request Google did not send', () => {
  const contextFor = (query: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ query }) }),
    }) as unknown as ExecutionContext;

  /** `AuthGuard('google')`, the mixin class both Google guards extend. */
  const passportGuard = Object.getPrototypeOf(GoogleCallbackGuard.prototype);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not start a flow for a request carrying no code', () => {
    const dance = jest.spyOn(passportGuard, 'canActivate');
    const guard = new GoogleCallbackGuard(configService);

    expect(guard.canActivate(contextFor({ state: 'never-minted' }))).toBe(true);
    // Never asked. Asking is what produced the redirect to Google.
    expect(dance).not.toHaveBeenCalled();
  });

  it('treats a refusal at the consent screen the same way', () => {
    // `error` and no code. Passport would fail the request and `handleRequest`
    // would turn that into no user, so this is the same answer one step shorter.
    const dance = jest.spyOn(passportGuard, 'canActivate');
    const guard = new GoogleCallbackGuard(configService);

    expect(guard.canActivate(contextFor({ error: 'access_denied' }))).toBe(
      true
    );
    expect(dance).not.toHaveBeenCalled();
  });

  it('runs the dance once there is a code to exchange', () => {
    const dance = jest
      .spyOn(passportGuard, 'canActivate')
      .mockReturnValue(true);
    const guard = new GoogleCallbackGuard(configService);

    expect(
      guard.canActivate(contextFor({ code: 'from-google', state: 's' }))
    ).toBe(true);
    expect(dance).toHaveBeenCalled();
  });

  it('skips the dance with Google unset, whatever the request carries', () => {
    // Plan 0026: there is no strategy registered under `'google'` at all, so
    // the dance would throw and the filter would render a 500 on this origin.
    const dance = jest.spyOn(passportGuard, 'canActivate');
    const guard = new GoogleCallbackGuard(unconfiguredConfigService);

    expect(guard.canActivate(contextFor({ code: 'from-google' }))).toBe(true);
    expect(dance).not.toHaveBeenCalled();
  });

  it('reads a repeated code parameter, which arrives as an array, as none', () => {
    expect(hasAuthorizationCode({ query: { code: ['a', 'b'] } })).toBe(false);
    expect(hasAuthorizationCode({ query: { code: 'a' } })).toBe(true);
    expect(hasAuthorizationCode(undefined)).toBe(false);
  });
});

/**
 * What the handler makes of the request the guard just let through, which is the
 * assertion the e2e suite makes over HTTP.
 */
describe('the callback, on a request Google did not send', () => {
  it('redirects into the app with an error rather than off to Google', async () => {
    const send = jest.fn();
    const controller = new GoogleController({ send } as never, configService);

    const result = await controller.callback({
      query: { state: 'never-minted' },
    });

    expect(result.statusCode).toBe(HttpStatus.FOUND);
    expect(result.url.startsWith('https://app.example/')).toBe(true);
    expect(result.url.split('#')[0].endsWith('/auth/callback')).toBe(true);
    expect(fragmentOf(result.url)).toEqual({
      error: ERROR_CODES.UNAUTHORIZED,
    });
    // No state was ever minted, so there is nothing to consume and no login to
    // attempt. The flow ends here, in the app.
    expect(send).not.toHaveBeenCalled();
  });
});
