import { Route } from '@angular/router';
import { DamoclesSwordWrapper } from './damoclesSword-wrapper/damoclesSword-wrapper';

export const appRoutes: Route[] = [
  {
    path: '',
    component: DamoclesSwordWrapper,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('@portfolio/damoclesSword/feature-home').then(
            (m) => m.DamoclesSwordFeatureHome
          ),
      },
      {
        path: 'about',
        loadComponent: () =>
          import('@portfolio/damoclesSword/feature-about').then(
            (m) => m.DamoclesSwordFeatureAbout
          ),
      },
      {
        path: 'contact',
        loadComponent: () =>
          import('@portfolio/damoclesSword/feature-contact').then(
            (m) => m.DamoclesSwordFeatureContact
          ),
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
