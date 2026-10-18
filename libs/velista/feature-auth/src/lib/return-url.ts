/**
 * The query parameter that carries a page to come back to (velista `0154`).
 *
 * Written as a literal by whoever sends somebody to sign in (the share link page,
 * the basket page, `authenticatedGuard`), because none of them may import this
 * lazily loaded library.
 */
export const RETURN_URL_PARAM = 'returnUrl';

/**
 * The page to go to after signing in, or null when the parameter is not one to
 * trust (velista `0154`, constraint 1).
 *
 * Only a relative path inside the app passes. It starts with one `/`, so it can
 * carry no scheme, and it is not `//host` or `/\host`, which a browser reads as
 * another site. The decoded value is held to the same rule, so `%2F%2Fhost` does
 * not slip through. Anything else is null, and the caller goes home.
 */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return [value, decodeSafely(value)].every(isInAppPath) ? value : null;
}

function isInAppPath(candidate: string): boolean {
  return (
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    // A backslash or a control character has no place in a path this app
    // writes, and both are ways a crafted value hides a host.
    // eslint-disable-next-line no-control-regex
    !/[\\\u0000-\u001f\u007f]/.test(candidate)
  );
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape cannot decode to a host. The raw value is checked.
    return value;
  }
}
