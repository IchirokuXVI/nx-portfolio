import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  ConnectionRecovery,
  gatewayInterceptor,
  VELISTA_DATA_ACCESS_PROVIDERS,
  ZONE_SERVICE,
  ZoneApi,
} from '@portfolio/velista/data-access';
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  APP_BRAND,
  AppBrand,
} from '@portfolio/velista/models';
import { VELISTA_PLATFORM_PROVIDERS } from '@portfolio/velista/platform';
import { VELISTA_TRANSLATION_PROVIDERS } from '@portfolio/velista/ui';
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
 *
 * **This injector is a child of the root one, and that is the whole reason rule D5
 * exists** (plan 0004, section 9; plan 0005). Under the shell the root injector belongs
 * to the portfolio, and everything here sits one level below it. A `providedIn: 'root'`
 * service is created up there and resolves its own dependencies from up there, so it
 * cannot see anything on this list. That is why the app's services are named here
 * rather than providing themselves, and why nothing on this list may be assumed to
 * reach a service that is still root scoped.
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

  // The app's own services, which cannot provide themselves (rule D5). Each array
  // is owned by the library it belongs to, so a service that moves is added in one
  // place and both the app and every spec pick it up from there.
  ...VELISTA_PLATFORM_PROVIDERS,
  ...VELISTA_DATA_ACCESS_PROVIDERS,

  // The app's translation namespace. Here rather than on `AppUiModule`, for the same
  // reason as everything above it: a module imported by a standalone component
  // provides that component's injector only, so `AppLayout` could use the `| rokuT`
  // pipe while every lazily loaded page under it threw. See `translation-providers.ts`.
  ...VELISTA_TRANSLATION_PROVIDERS,

  // The real gateway, which is the token's default too, but it still has to be bound
  // **here**: `ZoneApi` needs the `HttpClient` configured a few lines above, and that
  // only exists in this injector, so resolving the token at the root would not work.
  //
  // `useClass` rather than `provideService`, which is `useExisting`. An alias only
  // says where to look; it never creates the thing, so it needs the implementation to
  // be provided somewhere already. That helper is built for a `providedIn: 'root'`
  // implementation, which under rule D5 this is not. `useClass` provides and binds in
  // one entry, and nothing injects `ZoneApi` directly, so there is no second instance
  // to worry about.
  { provide: ZONE_SERVICE, useClass: ZoneApi },

  // Start the connection listener. Nothing injects it, so without this nothing would
  // ever construct it: it is a listener, not a dependency. It probes the backend while
  // the connection screen is up and reloads once something answers (plan 0004, section 8).
  // The class itself is installed by `VELISTA_DATA_ACCESS_PROVIDERS`; being available
  // is the library's business, being *running* is the app's, which is the split here.
  //
  // An **environment** initializer, not `provideAppInitializer`. `APP_INITIALIZER` is
  // read once by `ApplicationInitStatus` at bootstrap from the root injector, and
  // nothing ever asks a route injector for it, so as an app initializer this listener
  // was simply never constructed. `ENVIRONMENT_INITIALIZER` runs when the injector it
  // is declared on is created, which is true in both the mounted and standalone cases.
  provideEnvironmentInitializer(() => void inject(ConnectionRecovery)),
];
