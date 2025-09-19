import { Route } from '@angular/router';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { LocaleWrapperComponent } from './locale-wrapper-component';

export const appRoutes: Route[] = [
  {
    path: ':locale',
    component: LocaleWrapperComponent,
    children: [
      {
        path: 'odontogram',
        loadChildren: () =>
          import('odontogram/Routes').then((m) => m.remoteRoutes),
      },
      {
        path: '',
        loadChildren: () =>
          import('landing/Routes').then((m) => m.remoteRoutes),
      },
      { path: '**', component: NotFoundComponent },
    ],
  },
  {
    path: '**',
    component: LocaleWrapperComponent,
  },
];
