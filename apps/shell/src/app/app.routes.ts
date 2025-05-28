import { Route } from '@angular/router';
import { NotFoundComponent } from './not-found/not-found.component';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () => import('landing/Routes').then((m) => m.remoteRoutes),
  },
  {
    path: 'odontogram',
    loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes),
  },
  {
    path: '**',
    component: NotFoundComponent
  }
];
