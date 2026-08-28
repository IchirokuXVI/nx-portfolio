import { provideHttpClient, withFetch } from '@angular/common/http';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { APP_MOUNT_PATH } from '@portfolio/localization/rokutranslator-angular';
import { ODONTOGRAM_DATA_ACCESS_PROVIDERS } from '@portfolio/odontogram/data-access';
import { ODONTOGRAM_TRANSLATION_PROVIDERS } from './translation-providers';

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
 * and everything on this list sits one level below it; a root scoped service is
 * created up there and resolves its own dependencies from up there, so it cannot see
 * anything here.
 */
export const appProviders: (Provider | EnvironmentProviders)[] = [
  // Where the app is mounted while it runs as a remote of the portfolio shell. The
  // locale is the segment immediately after it, so this is what tells the locale
  // guard which segment to read. A standalone build provides '' and the app's URLs
  // become `/{locale}/...` with nothing else changing.
  { provide: APP_MOUNT_PATH, useValue: '/odontogram' },

  // The app's translations, on **this** injector rather than on the UI module that
  // used to carry them. Written above `provideHttpClient` to say out loud that the
  // ordering matters: a functional `HttpInterceptorFn` resolves its `inject()` calls
  // from the injector that declares `provideHttpClient`, so an interceptor that ever
  // reads the locale for an `Accept-Language` header needs the translator reachable
  // from here. Injector membership is what actually decides it, not array position,
  // but a reader who moves it below has no way to tell the constraint exists
  // (plan 0005 D9).
  ...ODONTOGRAM_TRANSLATION_PROVIDERS,

  provideHttpClient(withFetch()),

  // The app's own services, which cannot provide themselves. The array is owned by
  // the library they belong to, so a service that moves is added in one place and
  // both the app and every spec pick it up from there.
  ...ODONTOGRAM_DATA_ACCESS_PROVIDERS,
];
