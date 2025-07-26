import { Route } from '@angular/router';
import { NotFoundComponent } from '@portfolio/shared/ui';

export const appRoutes: Route[] = [
  {
    path: 'odontogram',
    loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes),
  },
  {
    path: '',
    loadChildren: () => import('landing/Routes').then((m) => m.remoteRoutes),
  },
  { path: '**', component: NotFoundComponent }
];
