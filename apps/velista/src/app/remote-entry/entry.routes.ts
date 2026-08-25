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
    loadChildren: () =>
      import('@portfolio/velista/feature-shell').then((m) => m.AppShellRoutes),
  },
];
