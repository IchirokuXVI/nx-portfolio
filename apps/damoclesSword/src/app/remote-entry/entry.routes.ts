import { Route } from '@angular/router';
import { appProviders } from '../app-providers';

/**
 * What the shell lazy-loads through the `damoclesSword/Routes` alias.
 *
 * The providers ride on this route because the shell never bootstraps this remote:
 * it loads these routes into a document it already rendered, so this is the only
 * injector the app layer can reach while it runs as a remote. See app-providers.ts.
 */
export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [...appProviders],
    // Where the app is mounted, stated by the layer that knows it. The locale guard
    // on the feature shell's parent route reads it from here to find which segment
    // is the locale; the feature shell contributes the locales and knows nothing
    // about where it sits. A standalone build sets `''` and the same tables serve
    // `/{locale}/...`.
    //
    // Route data rather than DI: a guard resolves against the closest environment
    // injector Angular has created by the preactivation phase, and this route's is
    // not reliably one of them, so `inject(APP_MOUNT_PATH)` there returns its root
    // default. The token is still what the language selector reads, where a
    // component injector has no such timing problem.
    data: { mountPath: '/damoclesSword' },
    loadChildren: () =>
      import('@portfolio/damoclesSword/feature-shell').then(
        (m) => m.DamoclesSwordRoutes
      ),
  },
];
