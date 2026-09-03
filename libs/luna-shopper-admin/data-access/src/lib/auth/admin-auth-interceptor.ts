import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ApiUrl } from '../api-url';
import { SessionStore } from './session-store';

/**
 * Attaches the bearer token, and does nothing else (plan 0002, section 4).
 *
 * It does not retry, does not queue, and does not refresh, because there is
 * nothing to refresh with: the session is one short lived token and no refresh
 * token exists anywhere in this design. A 401 clears the session, and the route
 * guard sends the operator to the login screen on the next navigation.
 *
 * **This shape is temporary and `0003` replaces the 401 branch entirely.** It is
 * written this way so that this plan ends in a coherent app rather than in half
 * of the next one.
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
  const token = sessions.token();

  const outgoing =
    token === null
      ? req
      : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      // Only a real 401 from the gateway. A request that never arrived is status
      // 0, and treating that as a rejected token would sign an operator out
      // every time their network blinked.
      if (error instanceof HttpErrorResponse && error.status === 401) {
        sessions.signOut();
      }
      return throwError(() => error);
    })
  );
};
