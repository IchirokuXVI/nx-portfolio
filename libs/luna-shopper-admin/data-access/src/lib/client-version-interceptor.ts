import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject, InjectionToken } from '@angular/core';
import {
  ADMIN_APP_VERSION,
  CLIENT_VERSION_HEADER,
} from '@portfolio/luna-shopper-admin/models';
import { catchError, throwError } from 'rxjs';
import { ApiUrl } from './api-url';

/** The status the gateway answers a build below its floor with. */
const CLIENT_TOO_OLD = 426;

/** So a refusal reloads the page once and not on every request afterwards. */
const RELOADED_KEY = 'luna-admin:reloaded-for-version';

/**
 * How the page is reloaded. A token so a spec can watch it: `location` is not
 * something a test environment lets a spec replace.
 */
export const PAGE_RELOAD = new InjectionToken<() => void>('PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => () => globalThis.location?.reload(),
});

/**
 * Says which build this is on every gateway request, and reloads when the
 * gateway refuses it (backend plan 0080, section 11).
 *
 * Until plan 0080 the back office sent no version, so the deployment's floor
 * (`MIN_CLIENT_VERSION`) covered velista only, and a back office built before
 * a wire change kept reading a renamed field as absent. This is the second
 * half of velista's guarantee, applied here: the version goes out as
 * `x-client-version`, and a `client_too_old` refusal reloads the page, which
 * fetches the bundle the deployment is actually serving.
 *
 * One reload per session, guarded in `sessionStorage`. A reload taken on the
 * server's word alone would repeat forever in the window between a deployment
 * moving its floor and the new bundle being reachable, and an operator with a
 * tab that reloads every second cannot read the error that would tell them.
 *
 * Beside `adminAuthInterceptor` and after it, so the token is already on the
 * request and the same origin check applies: nothing here sends a header to a
 * URL that is not the gateway.
 */
export const clientVersionInterceptor: HttpInterceptorFn = (req, next) => {
  const urls = inject(ApiUrl);
  if (!urls.isGateway(req.url)) {
    return next(req);
  }

  const version = inject(ADMIN_APP_VERSION);
  const reload = inject(PAGE_RELOAD);
  const stamped = req.clone({
    setHeaders: { [CLIENT_VERSION_HEADER]: version },
  });

  return next(stamped).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === CLIENT_TOO_OLD
      ) {
        reloadOnce(reload);
      }
      return throwError(() => error);
    })
  );
};

function reloadOnce(reload: () => void): void {
  try {
    if (sessionStorage.getItem(RELOADED_KEY) === '1') {
      return;
    }
    sessionStorage.setItem(RELOADED_KEY, '1');
  } catch {
    // Storage can be unavailable. A reload with no guard is still better than
    // serving a build the gateway refuses, and the guard is best effort.
  }
  reload();
}
