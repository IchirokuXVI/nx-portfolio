import { Route } from '@angular/router';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appProviders } from './app-providers';

/**
 * The app's one root route, stated once and mounted twice.
 *
 * velista runs in two modes. The shell lazy-loads the exposed `./Routes` at
 * `/velista`; the standalone origin serves the same app at `/`. Everything about the
 * two is identical except **where the app starts**, so the mount is the argument and
 * the rest of the route is written once. Two hand-maintained copies would differ by a
 * string that almost never changes and is catastrophic when it is wrong, which is
 * exactly the kind of duplication that drifts (plan 0013 D2).
 *
 * ## Why the mount is on `data` and on a provider, both
 *
 * `data.mountPath` is what `localeGuard` reads to decide which segment is the locale.
 * It cannot read the token: a guard resolves against the closest environment injector
 * Angular has created by the preactivation phase, and a route's own `providers`
 * injector is not reliably one of them, so `inject(APP_MOUNT_PATH)` there returns the
 * token's root default (rokutranslator plan 0005 D7, shell plan 0003). Route data has
 * no such problem.
 *
 * `APP_BASE_PATH` is what components build links from, where a component injector
 * makes the token perfectly reliable. `APP_MOUNT_PATH` aliases it inside
 * `appProviders`, so the locale switcher follows without a second literal.
 *
 * Both come from `mount`, so the standalone build cannot inherit the mounted build's
 * `/velista` and send the guard looking for the locale one segment too far in. That
 * failure mode is silent and rewrites every URL wrongly on first navigation, which is
 * why `app-root-route.spec.ts` asserts it rather than trusting a reading.
 *
 * ## Why the providers ride here
 *
 * The shell never bootstraps this remote — it loads these routes into a document it
 * already rendered — so this route's injector is the only one the app layer can reach
 * while it runs as a remote. `appConfig` spreads the same providers for the standalone
 * bootstrap, which is a second attachment rather than a duplicate one. See
 * `app-providers.ts`.
 *
 * @param mount Where this build is mounted, with a leading slash and no trailing one.
 *   `'/velista'` under the shell, `''` standalone.
 */
export function appRootRoute(mount: string): Route {
  return {
    path: '',
    providers: [
      ...appProviders,
      // The one value that differs between the two modes. Kept out of `appProviders`
      // for that reason: a shared list cannot hold a value that is not shared.
      { provide: APP_BASE_PATH, useValue: mount },
    ],
    data: { mountPath: mount },
    loadChildren: () =>
      import('@portfolio/velista/feature-shell').then((m) => m.AppShellRoutes),
  };
}
