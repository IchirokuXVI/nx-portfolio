import { Route } from '@angular/router';
import { localeCorrectionGuard } from '@portfolio/localization/rokutranslator-angular';
import {
  DAMOCLES_APP_KEY,
  DAMOCLES_DEFAULT_LOCALE,
} from '@portfolio/damoclesSword/ui';
import { DamoclesSwordWrapper } from './damocles-sword-wrapper/damocles-sword-wrapper';
import { DAMOCLES_USABLE_LOCALES } from './usable-locales';

export const appRoutes: Route[] = [
  {
    path: '',
    component: DamoclesSwordWrapper,
    canActivate: [localeCorrectionGuard],
    data: {
      appKey: DAMOCLES_APP_KEY,
      supportedLocales: DAMOCLES_USABLE_LOCALES,
      defaultLocale: DAMOCLES_DEFAULT_LOCALE,
    },
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
        path: 'services',
        loadComponent: () =>
          import('@portfolio/damoclesSword/feature-services').then(
            (m) => m.DamoclesSwordFeatureServices
          ),
      },
      {
        path: '**',
        redirectTo: '',
      },
    ],
  },
];
