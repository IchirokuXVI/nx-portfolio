import { Route } from '@angular/router';
import { localeCorrectionGuard } from '@portfolio/localization/rokutranslator-angular';
import { OdontogramFeatureFullOdontogramCrud } from '@portfolio/odontogram/feature-full-odontogram-crud';
import {
  ODONTOGRAM_APP_KEY,
  ODONTOGRAM_DEFAULT_LOCALE,
} from '@portfolio/odontogram/ui';
import { ODONTOGRAM_USABLE_LOCALES } from './usable-locales';

export const appRoutes: Route[] = [
  {
    path: '',
    component: OdontogramFeatureFullOdontogramCrud,
    canActivate: [localeCorrectionGuard],
    data: {
      appKey: ODONTOGRAM_APP_KEY,
      supportedLocales: ODONTOGRAM_USABLE_LOCALES,
      defaultLocale: ODONTOGRAM_DEFAULT_LOCALE,
    },
  },
];
