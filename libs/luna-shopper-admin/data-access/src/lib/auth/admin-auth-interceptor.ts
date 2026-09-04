import {
  HttpErrorResponse,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { ApiUrl } from '../api-url';
import { SKIP_SESSION_RECOVERY } from './session-http-context';
import { SessionLifecycle } from './session-lifecycle';
import { SessionStore } from './session-store';

/**
 * Attaches the bearer token, and refuses to let a 401 lose anything (plan 0003,
 * section 6).
 *
 * `0002` left this clearing the session on a 401, which was honest for a plan
 * with nothing to renew with and is replaced here. A 401 now **pauses** the
 * request:
 *
 * 1. One refresh is attempted, single-flight, so a screenful of requests that
 *    401 together produce one renewal and not one each.
 * 2. If it succeeds the request is retried against the new token, and nothing
 *    above ever learns that anything happened.
 * 3. If it fails, the re-authentication overlay goes up and the request waits
 *    behind it, retried once a password arrives.
 * 4. If the operator abandons the overlay, the request fails and the app returns
 *    to the login screen. That is the one path that loses work, and it takes a
 *    deliberate act.
 *
 * Without step 3 an operator presses save at the wrong second, re-authenticates,
 * the overlay dismisses, and the save silently never happened — with the form
 * still showing their edits, so nothing looks wrong until much later.
 *
 * **Non-idempotent requests are retried here, and that is safe.** The retry is
 * of a request the guard rejected before any handler ran, so nothing was applied
 * the first time. A 401 is the one status where that is knowable.
 */
export const adminAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const urls = inject(ApiUrl);

  // The interceptor is global, so this is the only thing standing between the
  // app and sending an operator's bearer token to a third party. It comes first
  // and everything else is inside it. `isGateway` is a prefix match on the
  // configured origin with a boundary check, not a substring search: a URL that
  // merely *contains* the gateway origin is not the gateway.
  if (!urls.isGateway(req.url)) {
    return next(req);
  }

  const sessions = inject(SessionStore);
  const lifecycle = inject(SessionLifecycle);

  return next(authorize(req, sessions.token())).pipe(
    catchError((error: unknown) => {
      // Only a real 401 from the gateway. A request that never arrived is status
      // 0, and treating that as a rejected token would raise a password prompt
      // every time an operator's network blinked.
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      // Login and refresh answer their own 401s. Recovering from theirs would
      // mean refreshing from inside a refresh, or covering the login screen with
      // a prompt to sign in again.
      if (req.context.get(SKIP_SESSION_RECOVERY)) {
        return throwError(() => error);
      }

      return from(lifecycle.recover()).pipe(
        switchMap((recovered) =>
          // Re-read the token rather than closing over one: the whole point of
          // waiting was that a different one now exists. Cloned from the
          // original request, so the retry carries no stale header.
          //
          // At most one retry, however this goes. A 401 from this inner call
          // errors the observable `catchError` already returned, and an
          // observable's error handler does not catch its own replacement.
          recovered
            ? next(authorize(req, sessions.token()))
            : throwError(() => error)
        )
      );
    })
  );
};

/** The request with a bearer header, or unchanged when there is no token. */
function authorize(
  req: HttpRequest<unknown>,
  token: string | null
): HttpRequest<unknown> {
  return token === null
    ? req
    : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
