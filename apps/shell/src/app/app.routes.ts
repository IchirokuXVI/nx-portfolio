import { localeGuard } from '@portfolio/localization/rokutranslator-angular';
import { Route } from '@angular/router';
import { NotFoundComponent } from '@portfolio/shared/ui';

export const appRoutes: Route[] = [
  {
    // Plain locale segment; localeGuard checks it is a valid locale and, when it
    // is not (an app path or the bare root), redirects to /{guess}/{path}. The
    // route is componentless, so children render in the shell's root outlet.
    path: ':locale',
    canActivate: [localeGuard],
    children: [
      {
        path: 'odontogram',
        title: 'app-title',
        data: { titleNs: 'odontogram/ui', titleFallback: 'Odontogram' },
        loadChildren: () =>
          import('odontogram/Routes').then((m) => m.remoteRoutes),
      },
      {
        path: 'damoclesSword',
        title: 'app-title',
        data: { titleNs: 'damoclesSword', titleFallback: "Damocle'Sword" },
        loadChildren: () =>
          import('damoclesSword/Routes').then((m) => m.remoteRoutes),
      },
      {
        path: '',
        title: 'app-title',
        data: { titleNs: 'landingV2', titleFallback: 'Portfolio' },
        loadChildren: () =>
          import('landingV2/Routes').then((m) => m.remoteRoutes),
      },
      {
        path: '**',
        title: 'app-title',
        data: { titleNs: 'landingV2', titleFallback: 'Portfolio' },
        component: NotFoundComponent,
      },
    ],
  },
  {
    // No locale (including the bare root): localeGuard redirects to /{guess}/...
    path: '**',
    canActivate: [localeGuard],
    component: NotFoundComponent,
  },
];
