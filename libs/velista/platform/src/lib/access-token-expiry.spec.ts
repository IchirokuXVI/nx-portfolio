import {
  isAccessTokenExpired,
  readAccessTokenExpiry,
} from './access-token-expiry';

/** Builds a token with the given payload. Only the payload segment is ever read. */
function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
}

describe('readAccessTokenExpiry', () => {
  it('reads exp as seconds since the epoch, not milliseconds', () => {
    const expSeconds = 1_800_000_000;

    expect(readAccessTokenExpiry(tokenWith({ exp: expSeconds }))).toEqual(
      new Date(expSeconds * 1000)
    );
  });

  it('decodes a payload containing multi-byte characters', () => {
    // `atob` yields Latin-1, so a name with an accent comes back mangled unless the
    // bytes are run through a UTF-8 decoder.
    const token = tokenWith({ exp: 1, name: 'Inés' });

    expect(readAccessTokenExpiry(token)).toEqual(new Date(1000));
  });

  it.each([
    ['not a jwt', 'abc'],
    ['too few segments', 'a.b'],
    ['payload that is not base64', 'a.!!!.c'],
    ['payload that is not JSON', `a.${btoa('nope')}.c`],
    ['payload with no exp', tokenWith({ sub: 'user-1' })],
    ['exp that is not a number', tokenWith({ exp: 'soon' })],
  ])('returns null for %s', (_case, token) => {
    expect(readAccessTokenExpiry(token)).toBeNull();
  });
});

describe('isAccessTokenExpired', () => {
  const now = 1_000_000_000_000;

  it('is false for a token comfortably in the future', () => {
    const token = tokenWith({ exp: (now + 600_000) / 1000 });

    expect(isAccessTokenExpired(token, 60_000, now)).toBe(false);
  });

  it('is true once the token is past its expiry', () => {
    const token = tokenWith({ exp: (now - 1000) / 1000 });

    expect(isAccessTokenExpired(token, 60_000, now)).toBe(true);
  });

  it('treats a token inside the skew window as already expired', () => {
    // Rule D3 depends on this: a token with two seconds left must not be sent to an
    // optional-auth route, because arriving expired mints a second guest account.
    const token = tokenWith({ exp: (now + 2000) / 1000 });

    expect(isAccessTokenExpired(token, 60_000, now)).toBe(true);
  });

  it('treats an unreadable token as expired so the caller refreshes', () => {
    expect(isAccessTokenExpired('garbage', 60_000, now)).toBe(true);
  });
});
