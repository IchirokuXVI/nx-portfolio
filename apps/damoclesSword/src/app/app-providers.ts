import { provideHttpClient, withFetch } from '@angular/common/http';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { DAMOCLES_DATA_ACCESS_PROVIDERS } from '@portfolio/damoclesSword/data-access';
import { APP_MOUNT_PATH } from '@portfolio/localization/rokutranslator-angular';
import { DAMOCLES_TRANSLATION_PROVIDERS } from './translation-providers';

/**
 * Everything the app layer supplies to its libraries.
 *
 * Attached in **two** places, and both are needed. The shell never runs this remote's
 * `bootstrapApplication`, it only loads the exposed `./Routes`, so providers that
 * lived solely in `appConfig` would be missing in the one mode the app actually runs
 * in today. `entry.routes.ts` therefore attaches these to the exposed route, and
 * `appConfig` attaches them again for the standalone bootstrap.
 *
 * **This injector is a child of the root one**, which is why nothing here may be
 * `providedIn: 'root'`. Under the shell the root injector belongs to the portfolio,
 * and everything on this list sits one level below it.
 */
export const appProviders: (Provider | EnvironmentProviders)[] = [
  // Where the app is mounted while it runs as a remote of the portfolio shell. The
  // locale is the segment immediately after it, which is what the language selector
  // rewrites. A standalone build provides '' and the app's URLs become
  // `/{locale}/...` with nothing else changing.
  { provide: APP_MOUNT_PATH, useValue: '/damoclesSword' },

  // The app's translations, on **this** injector rather than on the UI module that
  // used to carry them. Written above `provideHttpClient` to say out loud that the
  // ordering matters: a functional `HttpInterceptorFn` resolves its `inject()` calls
  // from the injector that declares `provideHttpClient`, so an interceptor that ever
  // reads the locale for an `Accept-Language` header needs the translator reachable
  // from here (plan 0005 D9).
  ...DAMOCLES_TRANSLATION_PROVIDERS,

  provideHttpClient(withFetch()),

  // The app's own services, which cannot provide themselves.
  ...DAMOCLES_DATA_ACCESS_PROVIDERS,
];
