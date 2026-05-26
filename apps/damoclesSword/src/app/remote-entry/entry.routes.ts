import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    loadChildren: () =>
      import('@portfolio/damoclesSword/feature-shell').then(
        (m) => m.DamoclesSwordRoutes
      ),
  },
];
