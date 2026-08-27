import { Route } from '@angular/router';
import { appProviders } from '../app-providers';

/**
 * What the shell lazy-loads through the `velista/Routes` alias.
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
    // is the locale. Route data rather than the `APP_MOUNT_PATH` this same layer
    // provides: a guard resolves against the closest environment injector Angular has
    // created by the preactivation phase, and this route's is not reliably one of
    // them, so `inject()` there returns the token's root default. The token is what
    // the locale switcher reads, where a component injector has no such problem.
    data: { mountPath: '/velista' },
    loadChildren: () =>
      import('@portfolio/velista/feature-shell').then((m) => m.AppShellRoutes),
  },
];
