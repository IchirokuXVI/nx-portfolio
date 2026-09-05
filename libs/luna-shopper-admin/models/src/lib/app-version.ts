import { InjectionToken } from '@angular/core';

/**
 * Which build of the back office this is (backend plan 0080, section 11).
 *
 * The same contract velista has for its own version: the value comes from the
 * app's environment surface, substituted at build time, and is bound to this
 * token by the app layer so no library reaches for an environment file.
 * `clientVersionInterceptor` is the only consumer and it sends it as
 * {@link CLIENT_VERSION_HEADER} on every gateway request, which is what lets a
 * deployment that has set a floor recognise a build too old to serve.
 *
 * The default is the honest answer for anything not built by the app layer,
 * and a version nobody can parse is never compared against a floor, so a spec
 * that leaves it alone gets the "no opinion" path.
 */
export const ADMIN_APP_VERSION = new InjectionToken<string>(
  'ADMIN_APP_VERSION',
  { providedIn: 'root', factory: () => 'unknown' }
);

/**
 * The header the client states its version in (velista plan 0034 D4).
 *
 * Repeated here rather than imported from `@portfolio/luna-shopper/platform`,
 * for the reason velista's models repeat it: that library is the backend's and
 * carries Nest, and a browser bundle must not reach into it for one string.
 * The gateway's `min-client-version.guard.ts` reads the same name.
 */
export const CLIENT_VERSION_HEADER = 'x-client-version';
