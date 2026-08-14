import {
  addLocaleRedirect,
  localeSegmentMatcher,
} from '@portfolio/localization/rokutranslator-angular';
import { Route } from '@angular/router';
import { NotFoundComponent } from '@portfolio/shared/ui';
import { LocaleWrapperComponent } from './locale-wrapper-component';

export const appRoutes: Route[] = [
  {
    // Matches only when the first segment is a well-formed locale, exposing it
    // as the `locale` param. App paths (odontogram, damoclesSword, the empty
    // landing path) are not locales, so they fall through to addLocaleRedirect.
    matcher: localeSegmentMatcher,
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
    // No locale in the URL (including the bare root): redirect to
    // /{guess}/{path}; the target app then validates and corrects the guess.
    path: '**',
    canActivate: [addLocaleRedirect],
    component: LocaleWrapperComponent,
  },
];
