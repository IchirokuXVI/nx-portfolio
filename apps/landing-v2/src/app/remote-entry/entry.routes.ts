import { Route } from '@angular/router';
import { appProviders } from '../app-providers';

/**
 * What the shell lazy-loads through the `landingV2/Routes` alias.
 *
 * The providers ride on this route because the shell never bootstraps this remote:
 * it loads these routes into a document it already rendered, so this is the only
 * injector the app layer can reach while it runs as a remote. See app-providers.ts.
 */
export const remoteRoutes: Route[] = [
  {
    path: '',
    providers: [...appProviders],
    // Where the app is mounted, stated by the layer that knows it. landingV2 sits at
    // the site root, so its mount is empty and the locale is the first segment. The
    // locale guard reads this from the route chain rather than from DI: a guard
    // resolves against the closest environment injector Angular has created by the
    // preactivation phase, and this route's is not reliably one of them.
    data: { mountPath: '' },
    loadChildren: () =>
      import('@portfolio/landing-v2/feature-shell').then(
        (m) => m.LandingV2Routes
      ),
  },
];
