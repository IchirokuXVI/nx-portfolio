import { Route } from '@angular/router';
import { Landing } from '@portfolio/landing/feature-shell';


export const remoteRoutes: Route[] = [
  { path: '', pathMatch: 'full', component: Landing },
];
