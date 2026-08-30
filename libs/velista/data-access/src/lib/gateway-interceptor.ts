import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  APP_VERSION,
  CLIENT_VERSION_HEADER,
  CORRELATION_ID_HEADER,
  isOlderThan,
  MIN_CLIENT_VERSION_HEADER,
} from '@portfolio/velista/models';
import { AppUpdates, ConnectionState } from '@portfolio/velista/platform';
import {
  catchError,
  from,
  type Observable,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { ApiUrl } from './api-url';
import { OPERATION, SKIP_AUTH } from './auth/http-context';
import { TokenStore } from './auth/token-store';
import { newCorrelationId } from './correlation-id';
import { GatewayError, NetworkError, toGatewayError } from './errors';

/**
 * Every outgoing header is decided here. Nothing is set at a call site.
 *
 * In order (plan 0004, section 4.3):
 *
 * 1. Scope check, so a bearer token can never reach a third party URL.
 * 2. `Authorization`, from a token that has been refreshed if it needed it.
 * 3. `Accept-Language`, which is what makes the backend's error catalog translate.
 * 4. `x-correlation-id`, minted client side.
 * 5. `x-client-version`, so the deployment can tell how old this build is.
 * 6. `traceparent`, when backend plan `0016` lands. Not built yet.
 * 7. On failure, a typed error, a single 401 retry, and a report to `ConnectionState`.
 *
 * It is also where the gateway's answer about *this build* is read (velista plan
 * 0034, section 5): an advertised floor above this version, or a `client_too_old`
 * refusal, asks `AppUpdates` for a new version. Both reactions are that call and
 * nothing more. The interceptor never reloads, per D7, because a reload taken on the
 * server's word alone would repeat forever in the window between a deployment moving
 * its floor and the new bundle being reachable.
 */
export const gatewayInterceptor: HttpInterceptorFn = (req, next) => {
  const urls = inject(ApiUrl);

  // 1. The interceptor is global. This is the only thing standing between the app and
  // sending its bearer token somewhere it does not belong, so it comes first and
  // everything else is inside it.
  if (!urls.isGateway(req.url)) {
    return next(req);
  }

  const tokens = inject(TokenStore);
  const i18n = inject(RokuTranslatorService);
  const connection = inject(ConnectionState);
  const updates = inject(AppUpdates);
  const version = inject(APP_VERSION);

  // Stamped here rather than in `decorate`, and that is the one header that is.
  // `retryAfterRefresh` builds the second attempt from this request, so a header put
  // on it survives into the retry without threading the value through a function that
  // already takes seven arguments. Everything `decorate` sets is per attempt; this is
  // a property of the build and is the same on both.
  const stamped = req.clone({
    setHeaders: { [CLIENT_VERSION_HEADER]: version },
  });

  const correlationId = newCorrelationId();
  const operation = req.context.get(OPERATION);
  const skipAuth = req.context.get(SKIP_AUTH);

  // A request that must go out anonymously never asks for a token, because the refresh
  // call is itself one of them and would otherwise recurse.
  //
  // The synchronous branch is not an optimisation for its own sake: making every
  // request in the app wait a microtask for a token that was already valid changes the
  // ordering of every caller for no benefit.
  const ready = skipAuth ? null : tokens.accessTokenIfFresh();
  const needsRefresh = !skipAuth && ready === null && tokens.hasSession();

  const accessToken$ = needsRefresh
    ? from(tokens.ensureFreshToken())
    : of(ready);

  return accessToken$.pipe(
    switchMap((token) =>
      send(next, decorate(stamped, token, i18n.getLocale(), correlationId))
    ),
    // Any response at all, including a 500 or a 503, proves the network works.
    tap({ next: (event) => reportIfResponse(event, connection) }),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      if (error.status === 0) {
        // No response. Distinct from a 5xx, which means the server is there and
        // answering, and this is the case where the client minted id is the only one
        // that exists because there is no body to read one from.
        connection.reportNetworkFailure();
        return throwError(() => new NetworkError(correlationId, operation));
      }

      connection.reportReachable();

      if (error.status === 401 && !skipAuth) {
        return retryAfterRefresh(
          stamped,
          next,
          tokens,
          i18n.getLocale(),
          correlationId,
          operation,
          connection
        );
      }

      return throwError(() =>
        toGatewayError(error.error, error.status, correlationId)
      );
    }),
    // **After** the `catchError`, so both the first attempt and the refreshed retry
    // pass through it and neither `retryAfterRefresh` nor `decorate` grows an
    // argument for it. `tap` re-throws, so the error a caller sees is unchanged.
    tap({
      next: (event) => noticeAdvertisedFloor(event, updates, version),
      error: (error: unknown) => noticeRefusal(error, updates),
    })
  );
};

/**
 * The deployment advertises the oldest build it serves on every response
 * (plan 0034 D8). When this one is older, ask for a new version.
 *
 * This is the reaction that does the work in practice: a client learns it is behind
 * from whatever it happened to request, within one round trip of the deploy, rather
 * than waiting for the next resume or the next half hour.
 *
 * Readable at all only because the gateway names the header in `exposedHeaders`. A
 * cross origin response exposes nothing else, so before that it was there and
 * invisible, which is the failure this would have had with no symptom.
 */
function noticeAdvertisedFloor(
  event: HttpEvent<unknown>,
  updates: AppUpdates,
  version: string
): void {
  if (!(event instanceof HttpResponse)) {
    return;
  }

  // False whenever either side fails to parse, so a development build and a staging
  // one never act on this (plan 0034 D6).
  if (isOlderThan(version, event.headers.get(MIN_CLIENT_VERSION_HEADER))) {
    updates.checkNow();
  }
}

/**
 * A refusal aimed at the build rather than at the request or the user.
 *
 * The same reaction as an advertised floor, and no more than that: `checkNow` may
 * find nothing, in which case the app keeps running on what it has and the error
 * travels on to the caller to be rendered like any other.
 */
function noticeRefusal(error: unknown, updates: AppUpdates): void {
  if (error instanceof GatewayError && error.code === 'client_too_old') {
    updates.checkNow();
  }
}

/**
 * One retry, and only one.
 *
 * `ensureFreshToken` already refreshes proactively, so a 401 here means the token was
 * rejected despite looking valid: revoked, signed by a key that has rotated, or naming
 * an account that no longer exists. The retry is sent with `SKIP_AUTH` semantics for
 * its own error handling, so a second 401 ends the request instead of starting another
 * refresh.
 *
 * **Either way out of here that is still a 401 deletes the stored pair**, which is the
 * invariant the whole path exists for: a session the server will not accept must not
 * survive in the browser, or the next attempt fails identically and so does every one
 * after it. A failed refresh clears in `TokenStore`; a refresh that succeeded and was
 * *still* refused is cleared here, because a token minted a moment ago and rejected on
 * the same tick says the identity behind it is gone rather than that the credential
 * was stale.
 */
function retryAfterRefresh(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  tokens: TokenStore,
  locale: string,
  correlationId: string,
  operation: string,
  connection: ConnectionState
): Observable<HttpEvent<unknown>> {
  return from(tokens.refresh()).pipe(
    switchMap((refreshed) => {
      if (refreshed === null) {
        // The session is already cleared by the store. Report the original 401 so the
        // page shows "signed out" rather than a generic failure.
        return throwError(() => toGatewayError(null, 401, correlationId));
      }

      return send(
        next,
        decorate(req, refreshed.accessToken, locale, correlationId)
      );
    }),
    tap({ next: (event) => reportIfResponse(event, connection) }),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => error);
      }

      if (error.status === 0) {
        connection.reportNetworkFailure();
        return throwError(() => new NetworkError(correlationId, operation));
      }

      connection.reportReachable();

      if (error.status === 401) {
        // Refused twice, the second time holding a pair issued between the two. See
        // the note above: nothing about this session is usable, so it is deleted here
        // rather than left to be presented again.
        tokens.clear();
      }

      return throwError(() =>
        toGatewayError(error.error, error.status, correlationId)
      );
    })
  );
}

function decorate(
  req: HttpRequest<unknown>,
  token: string | null,
  locale: string,
  correlationId: string
): HttpRequest<unknown> {
  const headers: Record<string, string> = {
    // The backend resolves this with q weighting and keeps only the primary subtag,
    // so a plain locale code is exactly what it wants.
    'Accept-Language': locale,
    [CORRELATION_ID_HEADER]: correlationId,
  };

  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return req.clone({ setHeaders: headers });
}

function send(
  next: HttpHandlerFn,
  req: HttpRequest<unknown>
): Observable<HttpEvent<unknown>> {
  return next(req);
}

function reportIfResponse(
  event: HttpEvent<unknown>,
  connection: ConnectionState
): void {
  if (event instanceof HttpResponse) {
    connection.reportReachable();
  }
}
