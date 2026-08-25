import { Route } from '@angular/router';
import { localeGuard } from '@portfolio/localization/rokutranslator-angular';
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
        // Must stay ABOVE the empty-path landingV2 entry. An empty-path route
        // with loadChildren is not terminal: Angular would hand `velista/...`
        // to landingV2's own route table and render its not-found page instead
        // (velista plan 0001, section 6.1).
        path: 'velista',
        title: 'app-title',
        data: { titleNs: 'velista', titleFallback: 'Velista' },
        loadChildren: () =>
          import('velista/Routes').then((m) => m.remoteRoutes),
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
