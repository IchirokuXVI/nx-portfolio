/**
 * Reads the `exp` claim out of an access token.
 *
 * The gateway returns no expiry alongside the token: `AuthTokens` is
 * `{ userId, kind, accessToken, refreshToken }` and carries no `expiresIn`, no
 * `expiresAt` and no `tokenType` (plan 0004, section 5.2). The access token is an
 * RS256 JWT with a default 15 minute TTL, so the only way for the client to schedule
 * a refresh before the server starts rejecting requests is to read `exp` itself.
 *
 * > This is used **to schedule a refresh, and for nothing else.** The signature is
 * > not verified here and must never be treated as if it were: the client decides
 * > nothing about authorization from a token it did not verify. The server verifies
 * > every request, so a tampered `exp` buys an attacker a failed request and no more.
 *
 * Returns `null` for anything it cannot read, which callers treat as "expired" so an
 * unreadable token triggers a refresh rather than being sent hopefully.
 */
export function readAccessTokenExpiry(token: string): Date | null {
  const payload = decodePayload(token);
  if (!payload) {
    return null;
  }

  const exp = payload['exp'];
  // `exp` is seconds since the epoch per RFC 7519, not milliseconds. Getting this
  // wrong yields a date in 1970, which reads as "always expired" and produces a
  // refresh on every single request.
  return typeof exp === 'number' && Number.isFinite(exp)
    ? new Date(exp * 1000)
    : null;
}

/**
 * Whether the token is expired, or close enough that a request sent now could arrive
 * after it lapses.
 *
 * The skew is what makes rule D3 workable: a token that expires in two seconds is
 * treated as already gone, so the optional-auth routes never see a stale one and
 * never silently mint a second guest account (plan 0004, section 5.5).
 */
export function isAccessTokenExpired(
  token: string,
  skewMs = 60_000,
  now: number = Date.now()
): boolean {
  const expiry = readAccessTokenExpiry(token);
  return expiry === null || expiry.getTime() - skewMs <= now;
}

function decodePayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }

  try {
    const json = base64UrlDecode(segments[1]);
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // A malformed token is not an exceptional condition here. It is what a cleared
    // or half-written storage entry looks like, and the caller's answer is the same
    // either way: treat it as expired and refresh.
    return null;
  }
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '='
  );

  const binary = atob(padded);
  // The payload is UTF-8, and `atob` yields Latin-1, so a display name with an
  // accent in it would otherwise come back mangled. Nothing reads a name from here
  // today, but decoding correctly costs one line.
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
