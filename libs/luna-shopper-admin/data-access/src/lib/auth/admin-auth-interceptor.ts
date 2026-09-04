import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { ADMIN_REACHABILITY_POLICY } from '@portfolio/luna-shopper-admin/models';
import {
  catchError,
  from,
  switchMap,
  throwError,
  timeout,
  TimeoutError,
  type Observable,
} from 'rxjs';
import { ApiUrl } from '../api-url';
import { SKIP_REACHABILITY_PROBE } from '../health/probe-http-context';
import { ServerReachability } from '../health/server-reachability';
import { SKIP_SESSION_RECOVERY } from './session-http-context';
import { SessionLifecycle } from './session-lifecycle';
import { SessionStore } from './session-store';

/**
 * Attaches the bearer token, refuses to let a 401 lose anything (plan 0003,
 * section 6), and notices when the gateway stops answering at all (plan 0008,
 * section 2).
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
 *
 * ## And a request that never arrived (plan 0008)
 *
 * This is the only place in the app that tells "the server is gone" apart from
 * "that request failed", so no service has to remember to. Two things reach it,
 * and both mean no response at all: a transport failure, which Angular reports
 * as status 0, and the timeout below.
 *
 * A 4xx or a 5xx is deliberately **not** among them. Those prove the server
 * answered, and the screen that made the request has copy for them already.
 *
 * The failure is reported and then rethrown unchanged. The request is never
 * retried: a timeout says nothing about whether the server received it, so a
 * `POST` that timed out can be applied in full before the timeout and a replay
 * then creates the row twice. A 401 is retried because it is the one status that
 * proves the opposite.
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
  const reachability = inject(ServerReachability);
  const policy = inject(ADMIN_REACHABILITY_POLICY);

  /**
   * The request, with a clock on it.
   *
   * `fetch` has no timeout of its own, so without this a gateway that accepts
   * the connection and never answers hangs forever: the request never fails,
   * nothing notices the outage, and the screen waits for a response that is not
   * coming. Unsubscribing also aborts the request rather than leaving it open.
   *
   * The `TimeoutError` is turned into a status 0 response, so that everything
   * downstream has one thing to recognise: "no response" is status 0, whether
   * the connection was refused or the answer never came.
   */
  const send = (
    request: HttpRequest<unknown>
  ): Observable<HttpEvent<unknown>> =>
    dispatch(request, next, policy.requestTimeoutMs);

  return send(authorize(req, sessions.token())).pipe(
    catchError((error: unknown) => {
      // The request produced no response. Ask whether anything is there, once
      // for however many requests fail together, and let the answer raise the
      // cover. The probe is not awaited: this request has already failed, and
      // making it wait for a health check would add the probe's timeout to a
      // failure the caller is entitled to hear about now.
      if (
        error instanceof HttpErrorResponse &&
        error.status === 0 &&
        !req.context.get(SKIP_REACHABILITY_PROBE)
      ) {
        void reachability.check();
        return throwError(() => error);
      }

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
            ? send(authorize(req, sessions.token()))
            : throwError(() => error)
        )
      );
    })
  );
};

/** The request, timed, with a timeout reported the way a dead socket is. */
function dispatch(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  timeoutMs: number
): Observable<HttpEvent<unknown>> {
  return next(req).pipe(
    timeout({ each: timeoutMs }),
    catchError((error: unknown) =>
      throwError(() =>
        error instanceof TimeoutError
          ? new HttpErrorResponse({
              status: 0,
              statusText: 'Timeout',
              url: req.url,
              error,
            })
          : error
      )
    )
  );
}

/** The request with a bearer header, or unchanged when there is no token. */
function authorize(
  req: HttpRequest<unknown>,
  token: string | null
): HttpRequest<unknown> {
  return token === null
    ? req
    : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
