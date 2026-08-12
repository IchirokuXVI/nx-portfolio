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
        title: 'Odontogram',
        loadChildren: () =>
          import('odontogram/Routes').then((m) => m.remoteRoutes),
      },
      {
        path: 'damoclesSword',
        title: "Damocle'Sword",
        loadChildren: () =>
          import('damoclesSword/Routes').then((m) => m.remoteRoutes),
      },
      {
        path: '',
        title: 'Portfolio',
        loadChildren: () =>
          import('landingV2/Routes').then((m) => m.remoteRoutes),
      },
      { path: '**', title: 'Portfolio', component: NotFoundComponent },
    ],
  },
  {
    path: '**',
    title: 'Portfolio',
    component: LocaleWrapperComponent,
  },
];
