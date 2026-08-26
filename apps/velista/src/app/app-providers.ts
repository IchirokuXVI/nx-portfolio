import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  inject,
  provideAppInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { provideService } from '@portfolio/shared/data-access';
import {
  ConnectionRecovery,
  gatewayInterceptor,
  ZONE_SERVICE,
  ZoneApi,
} from '@portfolio/velista/data-access';
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  APP_BRAND,
  AppBrand,
} from '@portfolio/velista/models';
import { environment } from '../environments/environment';

/**
 * Product identity, as **values** in one place (rule N1, plan 0001). A rename is a
 * change to this object, the two asset files, and the product name in the
 * translation JSON. Nothing else — no component, no route, no CSS token.
 *
 * The asset entries are filenames rather than resolved URLs on purpose: how a
 * filename becomes a URL is the design system's business (plan 0002, section 5).
 */
const brand: AppBrand = {
  name: 'Velista',
  shortName: 'Velista',
  wordmarkSrc: 'velista-mark.svg',
  iconSrc: 'velista-app-icon.svg',
};

/**
 * Everything the app layer supplies to its libraries.
 *
 * Attached in **two** places, and both are needed. The shell never runs this
 * remote's `bootstrapApplication`, it only loads the exposed `./Routes`, so
 * providers that live solely in `appConfig` would be missing in the one mode the
 * app actually runs in today. `entry.routes.ts` therefore attaches these to the
 * exposed route, and `appConfig` attaches them again for the standalone bootstrap
 * that the extraction phase will use.
 */
export const appProviders: (Provider | EnvironmentProviders)[] = [
  { provide: APP_BRAND, useValue: brand },
  // Where the app is mounted while it runs as a remote of the portfolio shell.
  // The standalone build provides '' and nothing else changes (extraction
  // contract, item 5).
  { provide: APP_BASE_PATH, useValue: '/velista' },
  // The app's own backend configuration, not the portfolio's (item 6).
  { provide: APP_API_CONFIG, useValue: environment.api },

  // HTTP, with the one interceptor that decides every outgoing header
  // (plan 0004, section 4.3). `withFetch` because the standalone phase wants it
  // and it costs nothing now.
  provideHttpClient(withFetch(), withInterceptors([gatewayInterceptor])),

  // The real gateway, bound here at the **app** injector rather than by changing
  // the token's default (plan 0004, section 9). The default stays the in-memory
  // implementation, so every test and every backend-less run keeps working while
  // the running app talks to the real thing.
  provideService(ZONE_SERVICE, ZoneApi),

  // Not injected by anything, so nothing would construct it: it is a listener, not
  // a dependency. It probes the backend while the connection screen is up and
  // reloads the page once something answers (plan 0004, section 8).
  provideAppInitializer(() => void inject(ConnectionRecovery)),
];
