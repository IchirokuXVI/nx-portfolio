import { Route } from '@angular/router';

export const remoteRoutes: Route[] = [
  {
    path: '',
    loadChildren: () =>
      import('@portfolio/odontogram/feature-shell').then(
        (m) => m.OdontogramShellRoutes
      ),
  },
];
