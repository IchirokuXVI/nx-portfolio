import { NxWelcomeComponent } from './nx-welcome.component';
import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    component: NxWelcomeComponent,
  },
  {
    path: 'odontogram',
    loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes),
  }
];
