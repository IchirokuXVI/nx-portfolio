import { HttpErrorResponse } from '@angular/common/http';
import { GatewayError, toGatewayError, toSignInFailure } from './gateway-error';

/**
 * Section 2 of plan 0002, which is the whole reason this file exists: the four
 * outcomes of a failed sign in have to reach the screen as four different things,
 * because collapsing them makes the lockout invisible and the lockout is the one
 * an operator most needs to understand.
 *
 * The mapping is asserted from the wire inward — a real `HttpErrorResponse`
 * carrying a real house envelope — rather than from a hand built `GatewayError`,
 * so a change to either end of the translation is caught here.
 */

function refusal(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

const envelope = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  message: 'ignored: the screen chooses its own words',
  correlationId: 'cid-1',
  ...extra,
});

describe('toSignInFailure', () => {
  it('reads a wrong password as invalid credentials', () => {
    expect(toSignInFailure(refusal(401, envelope('unauthorized')))).toEqual({
      reason: 'invalid-credentials',
    });
  });

  /**
   * The one that costs a backend error code to get right. Both of these are "too
   * many attempts" and they are not the same state: a throttle limits a source, so
   * another minute clears it; a lockout protects an account, so a different
   * network does nothing. They resolve differently, so they read differently.
   */
  it('tells a lockout apart from a throttle', () => {
    const locked = toSignInFailure(
      refusal(423, envelope('account_locked', { retryAfterSeconds: 900 }))
    );
    const throttled = toSignInFailure(
      refusal(429, envelope('rate_limited', { retryAfterSeconds: 60 }))
    );

    expect(locked).toEqual({ reason: 'locked-out', retryAfterSeconds: 900 });
    expect(throttled).toEqual({ reason: 'throttled', retryAfterSeconds: 60 });
  });

  it('reads a deployment that cannot do this as not available', () => {
    expect(toSignInFailure(refusal(501, envelope('not_configured')))).toEqual({
      reason: 'not-available',
    });
  });

  /**
   * A disabled account is deliberately **not** in this list. Plan 0071 answers a
   * disabled admin with the same 401 as a wrong password, so that a disabled
   * account cannot be told from a typo by whoever is guessing usernames. This
   * asserts the collapse rather than the distinction, so that anyone reading the
   * plan's four outcome table finds out here why there are three.
   */
  it('cannot tell a disabled account from a wrong password, by design', () => {
    const disabled = toSignInFailure(refusal(401, envelope('unauthorized')));
    const wrongPassword = toSignInFailure(
      refusal(401, envelope('unauthorized'))
    );

    expect(disabled).toEqual(wrongPassword);
  });

  describe('when the body never arrived intact', () => {
    /** A proxy's HTML error page, or a CORS failure: status only, no envelope. */
    it.each([
      [401, 'invalid-credentials'],
      [423, 'locked-out'],
      [429, 'throttled'],
      [501, 'not-available'],
      [500, 'unknown'],
      [502, 'unknown'],
    ])('falls back to the status: %i is %s', (status, reason) => {
      expect(toSignInFailure(refusal(status, '<html>nope</html>')).reason).toBe(
        reason
      );
    });

    /**
     * No response at all. Angular reports it as status 0, and it has to become a
     * sentence rather than an empty error area.
     */
    it('reads a request that never arrived as unknown', () => {
      expect(toSignInFailure(refusal(0, null)).reason).toBe('unknown');
    });

    it('reads something that is not an http error at all as unknown', () => {
      expect(toSignInFailure(new TypeError('boom')).reason).toBe('unknown');
    });
  });

  describe('the wait', () => {
    /**
     * Never invented. Telling an operator to wait sixty seconds when nobody said
     * sixty is worse than saying nothing, because it will be believed.
     */
    it('is absent when the server named none', () => {
      const failure = toSignInFailure(refusal(429, envelope('rate_limited')));

      expect(failure.retryAfterSeconds).toBeUndefined();
    });

    it.each([
      ['a string', '60'],
      ['zero', 0],
      ['a negative', -5],
      ['NaN', NaN],
    ])('is absent when the server named %s', (_case, retryAfterSeconds) => {
      const failure = toSignInFailure(
        refusal(429, envelope('rate_limited', { retryAfterSeconds }))
      );

      expect(failure.retryAfterSeconds).toBeUndefined();
    });

    it('is rounded up to a whole second', () => {
      const failure = toSignInFailure(
        refusal(429, envelope('rate_limited', { retryAfterSeconds: 30.2 }))
      );

      expect(failure.retryAfterSeconds).toBe(31);
    });
  });

  it('passes a GatewayError through rather than re-wrapping it', () => {
    const error = new GatewayError({
      code: 'account_locked',
      status: 423,
      correlationId: 'cid-2',
      retryAfterSeconds: 120,
    });

    expect(toSignInFailure(error)).toEqual({
      reason: 'locked-out',
      retryAfterSeconds: 120,
    });
  });
});

describe('toGatewayError', () => {
  it('reads the house envelope', () => {
    const error = toGatewayError(refusal(423, envelope('account_locked')));

    expect(error.code).toBe('account_locked');
    expect(error.status).toBe(423);
    expect(error.correlationId).toBe('cid-1');
  });

  /**
   * Rule D4 on the path most likely to be malformed. Nothing here reads a
   * property off an unvalidated object, so an array, a string or a null body
   * produces an error rather than a throw inside the error handler.
   */
  it.each([
    ['a string body', '<html>'],
    ['an array body', []],
    ['a null body', null],
    ['no response at all', undefined],
  ])('survives %s', (_case, body) => {
    const error = toGatewayError(refusal(500, body));

    expect(error.code).toBe('');
    expect(error.correlationId).toBe('');
  });

  /** For a log line, never for a screen. Every operator facing string is a key. */
  it('carries a message for a log, naming the code and the correlation id', () => {
    const error = toGatewayError(refusal(401, envelope('unauthorized')));

    expect(error.message).toContain('unauthorized');
    expect(error.message).toContain('cid-1');
  });
});
