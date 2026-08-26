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
import { CORRELATION_ID_HEADER } from '@portfolio/velista/models';
import { ConnectionState } from '@portfolio/velista/platform';
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
import { NetworkError, toGatewayError } from './errors';

/**
 * Every outgoing header is decided here. Nothing is set at a call site.
 *
 * In order (plan 0004, section 4.3):
 *
 * 1. Scope check, so a bearer token can never reach a third party URL.
 * 2. `Authorization`, from a token that has been refreshed if it needed it.
 * 3. `Accept-Language`, which is what makes the backend's error catalog translate.
 * 4. `x-correlation-id`, minted client side.
 * 5. `traceparent`, when backend plan `0016` lands. Not built yet.
 * 6. On failure, a typed error, a single 401 retry, and a report to `ConnectionState`.
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
      send(next, decorate(req, token, i18n.getLocale(), correlationId))
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
          req,
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
    })
  );
};

/**
 * One retry, and only one.
 *
 * `ensureFreshToken` already refreshes proactively, so a 401 here means the token was
 * rejected despite looking valid: revoked, or signed by a key that has rotated. The
 * retry is sent with `SKIP_AUTH` semantics for its own error handling, so a second 401
 * ends the request instead of starting another refresh.
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
