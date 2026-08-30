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
import { APP_MOUNT_PATH } from '@portfolio/localization/rokutranslator-angular';
import { provideService } from '@portfolio/shared/data-access';
import {
  ACCOUNT_SERVICE,
  AccountApi,
  AUTH_SERVICE,
  AuthApi,
  COMMENT_SERVICE,
  CommentApi,
  ConnectionRecovery,
  gatewayInterceptor,
  LINE_SERVICE,
  LineApi,
  LIST_SERVICE,
  ListApi,
  MEMBERSHIP_SERVICE,
  MembershipApi,
  REALTIME_CLIENT,
  RealtimeSocket,
  VELISTA_DATA_ACCESS_PROVIDERS,
  ZONE_SERVICE,
  ZoneApi,
} from '@portfolio/velista/data-access';
import {
  APP_API_CONFIG,
  APP_BASE_PATH,
  APP_BRAND,
  APP_STANDALONE_ORIGIN,
  APP_VERSION,
  AppBrand,
} from '@portfolio/velista/models';
import {
  AppUpdates,
  InstallStore,
  VELISTA_PLATFORM_PROVIDERS,
} from '@portfolio/velista/platform';
import { environment } from '../environments/environment';
import { VELISTA_TRANSLATION_PROVIDERS } from './translation-providers';

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
 * providers that live solely in `appConfig` would be missing in the mode the app
 * runs in under the portfolio. `appRootRoute` therefore spreads these onto the route
 * it builds, which is what both `entry.routes.ts` and `app.routes.ts` mount, and
 * `appConfig` attaches them again for the standalone bootstrap on velista's own
 * origin (plan 0013).
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
  // The mount itself is **not** here. It is the one value the two run modes disagree
  // about — `/velista` under the shell, `''` on velista's own origin — and a list
  // shared by both cannot hold it. `appRootRoute(mount)` binds `APP_BASE_PATH`
  // alongside this list, from the argument it was given (plan 0013 D2).
  //
  // This alias stays, because it costs nothing and follows for free: `useExisting`
  // resolves at injection time, in the same injector the route builds, so it picks up
  // whichever mount that route was created with. The localization layer knows the
  // value by this name, and the locale switcher reads it to rewrite the segment
  // *after* the mount rather than the mount itself (plan 0005 D7). One mount, written
  // once, and now written once per mode instead of once per file.
  { provide: APP_MOUNT_PATH, useExisting: APP_BASE_PATH },
  // The app's own backend configuration, not the portfolio's (item 6).
  { provide: APP_API_CONFIG, useValue: environment.api },

  // Which build this is (plan 0034 D4), from the same environment surface and for
  // the same reason: the app layer reads the environment file so no library has to.
  // `gateway-interceptor.ts` sends it on every request, which is what lets a
  // deployment recognise a client too old to serve.
  //
  // Bound in both run modes on purpose. Under the shell there is no service worker
  // and so no way for this app to update itself, but the requests still go to the
  // same gateway and are still worth identifying.
  { provide: APP_VERSION, useValue: environment.version },

  // Where this app answers on its own origin (plan 0033 D10). Read by the three
  // surfaces that have to point at it when they are running as the portfolio's
  // mounted copy, where an install would install the portfolio.
  //
  // On this list rather than beside the mount in `appRootRoute`, because unlike the
  // mount it is the **same value in both run modes**: it is velista's address, not a
  // statement about where this particular copy is.
  { provide: APP_STANDALONE_ORIGIN, useValue: environment.appUrl },

  // The app's translations, on **this** injector rather than on the route table that
  // owns every page, which is where plan 0006 section 3 put them and where they lived
  // until the gateway interceptor started reading the locale.
  //
  // A functional interceptor resolves its `inject()` calls from the injector that
  // declares `provideHttpClient`, which is this one. `gatewayInterceptor` injects
  // `RokuTranslatorService` for the `Accept-Language` header (plan 0004, section 4.3),
  // so the service has to be reachable from here. Route providers sit one level below
  // and are invisible looking up, so every gateway request threw `NG0201` instead of
  // being sent. Providing it here fixes that for both run modes at once.
  //
  // It is written above `provideHttpClient` to say that out loud. Injector membership
  // is what actually decides this, not position in the array, but a reader who moves
  // it below has no way to tell the constraint exists.
  //
  // The import is an ordinary local one now. It used to reach into `feature-shell` by
  // relative path, with an `@nx/enforce-module-boundaries` suppression, because that
  // library is lazy-loaded and a static import of its barrel is forbidden (and would
  // pull the whole library into the entry chunk besides). Plan 0005 D11 moved the file
  // into the app, which is the only place this line can import from without either
  // problem, and the suppression came out with it.
  ...VELISTA_TRANSLATION_PROVIDERS,

  // HTTP, with the one interceptor that decides every outgoing header
  // (plan 0004, section 4.3). `withFetch` because the standalone phase wants it
  // and it costs nothing now.
  provideHttpClient(withFetch(), withInterceptors([gatewayInterceptor])),

  // The app's own services, which cannot provide themselves (rule D5). Each array
  // is owned by the library it belongs to, so a service that moves is added in one
  // place and both the app and every spec pick it up from there.
  ...VELISTA_PLATFORM_PROVIDERS,
  ...VELISTA_DATA_ACCESS_PROVIDERS,

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

  // The list screen (plan 0012). Same reasoning a fifth and sixth time, and there is
  // nothing new about either: both reach this injector's `HttpClient`.
  provideService(LINE_SERVICE, LineApi),
  provideService(COMMENT_SERVICE, CommentApi),

  // The account screen (plan 0015). A seventh time, and still nothing new: `AccountApi`
  // reaches this injector's `HttpClient`, so the token's default resolving at the root
  // would not work.
  provideService(ACCOUNT_SERVICE, AccountApi),

  // The live connection (plan 0016). Bound here for the same reason as every line
  // above: talking to a real server is the app's call, and `RealtimeSocket` reaches
  // `ApiUrl`, `TokenStore` and `SessionStore`, which exist only in this injector.
  //
  // Deliberately **not** in `VELISTA_DATA_ACCESS_PROVIDERS`. `RealtimeMemory` stays the
  // token's default, so every spec and every run without a backend keeps working with
  // no change at all, and the fake and the transport are chosen in exactly the same
  // place as every other real transport.
  //
  // No initializer, unlike `ConnectionRecovery` below. `ZoneStore` injects
  // `REALTIME_CLIENT`, so this is constructed when the store is, and its constructor
  // effect on `isAuthenticated()` starts the lifecycle from there.
  provideService(REALTIME_CLIENT, RealtimeSocket),

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

  // Start the update schedule (plan 0034, section 4). A listener again, and started
  // the same way and for the same reason: nothing injects it, so without this line
  // nothing would ever construct it and the app would go on checking for a new
  // version exactly once per cold start.
  //
  // Started in both run modes even though only one of them has a service worker. The
  // service returns from its constructor without subscribing to anything when there
  // is no enabled worker, so under the shell this costs one object, and keeping the
  // line unconditional means there is no second place where the two modes disagree.
  provideEnvironmentInitializer(() => void inject(AppUpdates)),

  // Start listening for `beforeinstallprompt` (plan 0033 D1). Nothing injects this
  // until somebody opens the install page or the account screen, and by then the
  // event has already fired and been dropped: Chromium fires it once, early, at its
  // own discretion, and a page cannot ask for another. Constructed here, the listener
  // is running on whatever route the visitor actually arrived on.
  //
  // An **environment** initializer for the same reason `ConnectionRecovery` is one:
  // `APP_INITIALIZER` is read once from the root injector at bootstrap, and nothing
  // asks a route injector for it, so under the shell it would never run at all.
  provideEnvironmentInitializer(() => void inject(InstallStore)),
];
