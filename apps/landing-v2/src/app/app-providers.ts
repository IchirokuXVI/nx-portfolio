import { provideHttpClient, withFetch } from '@angular/common/http';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { LANDING_V2_DATA_ACCESS_PROVIDERS } from '@portfolio/landing-v2/data-access';
import { APP_MOUNT_PATH } from '@portfolio/localization/rokutranslator-angular';
import { LANDING_V2_TRANSLATION_PROVIDERS } from './translation-providers';

/**
 * Everything the app layer supplies to its libraries.
 *
 * Attached in **two** places, and both are needed. The shell never runs this remote's
 * `bootstrapApplication`, it only loads the exposed `./Routes`, so providers that
 * lived solely in `appConfig` would be missing in the one mode the app actually runs
 * in today. `entry.routes.ts` therefore attaches these to the exposed route, and
 * `appConfig` attaches them again for the standalone bootstrap.
 */
export const appProviders: (Provider | EnvironmentProviders)[] = [
  // landingV2 is the app at the site root, so its mount contributes no segment and
  // `/{mount}/{locale}/{rest}` degenerates to `/{locale}/{rest}`. Same rule as every
  // other app, no branch — which is exactly why this is stated rather than left
  // implicit: `''` is the value, not the absence of one.
  { provide: APP_MOUNT_PATH, useValue: '' },

  // The app's translations, on **this** injector rather than on the UI module that
  // used to carry them. Written above `provideHttpClient` to say out loud that the
  // ordering matters: a functional `HttpInterceptorFn` resolves its `inject()` calls
  // from the injector that declares `provideHttpClient` (plan 0005 D9).
  ...LANDING_V2_TRANSLATION_PROVIDERS,

  provideHttpClient(withFetch()),

  // The app's own services, which cannot provide themselves.
  ...LANDING_V2_DATA_ACCESS_PROVIDERS,
];
