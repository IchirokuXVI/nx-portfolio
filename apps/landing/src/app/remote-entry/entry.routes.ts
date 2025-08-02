import { Route } from '@angular/router';
import { LandingShellRoutes } from '@portfolio/landing/feature-shell';


export const remoteRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    children: LandingShellRoutes,
  },
];
