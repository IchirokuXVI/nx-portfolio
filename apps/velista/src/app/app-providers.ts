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
import { provideService } from '@portfolio/shared/data-access';
import {
  AUTH_SERVICE,
  AuthApi,
  ConnectionRecovery,
  gatewayInterceptor,
  LIST_SERVICE,
  ListApi,
  MEMBERSHIP_SERVICE,
  MembershipApi,
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

  // The app's translations are **not** on this list. They are composed by
  // `feature-shell` and installed by its own route table (plan 0006, section 3), which
  // is one injector further down and still above every page. They cannot be named here
  // even though this is where they conceptually belong: `entry.routes.ts` lazy-loads
  // `feature-shell`, so importing anything from it statically is forbidden by
  // `@nx/enforce-module-boundaries`. See the comment on the parent route in
  // `feature-shell`'s `routes.ts`.

  // The real gateway, which is the token's default too, but it still has to be bound
  // **here**: `ZoneApi` needs the `HttpClient` configured a few lines above, and that
  // only exists in this injector, so resolving the token at the root would not work.
  //
  // `provideService`, not `useService`: the first provides the implementation as well
  // as binding it, the second is an alias to one provided elsewhere. Under rule D5
  // `ZoneApi` provides itself nowhere, so an alias would have nothing to point at.
  provideService(ZONE_SERVICE, ZoneApi),

  // The credential flows (plan 0009), bound here for exactly the reasons above:
  // `AuthApi` needs this injector's `HttpClient`, and the token's default being the
  // same class does not provide it.
  provideService(AUTH_SERVICE, AuthApi),

  // The group and its people (plan 0010). Same reasoning a third and fourth time:
  // each reaches this injector's `HttpClient`, so each has to be provided here rather
  // than resolved from its token's default at the root.
  provideService(LIST_SERVICE, ListApi),
  provideService(MEMBERSHIP_SERVICE, MembershipApi),

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
