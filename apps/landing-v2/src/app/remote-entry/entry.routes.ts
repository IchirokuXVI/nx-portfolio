import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    loadChildren: () =>
      import('@portfolio/landing-v2/feature-shell').then(
        (m) => m.LandingV2Routes
      ),
  },
];
