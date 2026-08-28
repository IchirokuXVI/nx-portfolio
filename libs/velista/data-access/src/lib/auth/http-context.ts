import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marks a request that must go out without a bearer token, and whose 401 must not
 * trigger a refresh.
 *
 * Three call sites need it, and the third is the one that matters: login and register
 * have no token to send, and **the refresh call itself would otherwise recurse**,
 * since handling its 401 by refreshing is exactly what it is already doing.
 */
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

/** Names the operation in a `NetworkError`, so a support report says what failed. */
export const OPERATION = new HttpContextToken<string>(() => 'request');

export function anonymous(operation: string): HttpContext {
  return new HttpContext().set(SKIP_AUTH, true).set(OPERATION, operation);
}

export function operation(name: string): HttpContext {
  return new HttpContext().set(OPERATION, name);
}
