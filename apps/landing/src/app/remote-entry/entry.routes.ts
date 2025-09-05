import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () =>
      import('@portfolio/landing/feature-shell').then(
        (m) => m.LandingShellRoutes
      ),
  },
];
