import { Route } from '@angular/router';
import { LandingComponent } from '../landing/landing';


export const remoteRoutes: Route[] = [
  { path: '', pathMatch: 'full', component: LandingComponent },
];
