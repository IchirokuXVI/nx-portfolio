import { asInstant, toAdminSession } from './admin-session';

/**
 * The mapper standing between the gateway's login response and everything that
 * believes it holds a session (plan 0002, section 3; rule D4).
 *
 * The bar it enforces is "usable", not "present": a session missing its token,
 * or carrying an expiry that does not parse, produces an app that believes it is
 * signed in and cannot make a single request, which on screen is
 * indistinguishable from the backend being down.
 */

const valid = {
  adminId: 'adm_1',
  username: 'ops',
  displayName: 'Operations',
  accessToken: 'a.b.c',
  expiresAt: '2026-09-03T10:15:00.000Z',
};

describe('toAdminSession', () => {
  it('reads a complete response, with the expiry as an instant', () => {
    const receivedAt = new Date('2026-09-03T10:00:00.000Z');
    const session = toAdminSession(valid, receivedAt);

    expect(session).toEqual({
      adminId: 'adm_1',
      username: 'ops',
      displayName: 'Operations',
      accessToken: 'a.b.c',
      expiresAt: new Date('2026-09-03T10:15:00.000Z'),
      receivedAt,
    });
  });

  /**
   * The wire carries no `issuedAt`, so the arrival is the only thing that can
   * date the token. Defaulted rather than required, because the ordinary caller
   * is mapping a response that has just come back and passing `new Date()` at
   * every call site is one more place to forget (plan 0003).
   */
  it('dates the session from now when the caller names no arrival', () => {
    const before = Date.now();
    const session = toAdminSession(valid);

    expect(session?.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(session?.receivedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  /** An admin who never set one is a normal account, not a broken payload. */
  it.each([null, undefined, 42])(
    'accepts a missing display name (%p) as null',
    (displayName) => {
      expect(toAdminSession({ ...valid, displayName })?.displayName).toBeNull();
    }
  );

  it.each([
    ['no body at all', null],
    ['a string', 'a.b.c'],
    ['no admin id', { ...valid, adminId: undefined }],
    ['an empty admin id', { ...valid, adminId: '' }],
    ['no username', { ...valid, username: undefined }],
    ['no token', { ...valid, accessToken: undefined }],
    ['an empty token', { ...valid, accessToken: '' }],
    ['no expiry', { ...valid, expiresAt: undefined }],
    ['a numeric expiry', { ...valid, expiresAt: 1772400000 }],
  ])('refuses %s', (_case, body) => {
    expect(toAdminSession(body)).toBeNull();
  });

  /**
   * The one that would not announce itself. `new Date('nonsense')` is a `Date`,
   * so a shape check passes and every later comparison against it is false,
   * which reads as a token that never expires rather than one that is obviously
   * wrong.
   */
  it('refuses an expiry that is a string but not a date', () => {
    expect(toAdminSession({ ...valid, expiresAt: 'soon' })).toBeNull();
  });
});

describe('asInstant', () => {
  it('reads an ISO string', () => {
    expect(asInstant('2026-09-03T10:15:00.000Z')).toEqual(
      new Date('2026-09-03T10:15:00.000Z')
    );
  });

  it.each([null, undefined, 0, 'never', {}, new Date()])(
    'answers null for %p',
    (value) => {
      expect(asInstant(value)).toBeNull();
    }
  );
});
