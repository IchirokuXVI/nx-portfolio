import { Route } from '@angular/router';
import { localeGuard } from '@portfolio/localization/rokutranslator-angular';
import { NotFoundComponent } from '@portfolio/shared/ui';

export const appRoutes: Route[] = [
  {
    // **Migrated (plan 0003): odontogram owns its own locale segment**, so it mounts
    // at the top level and its own guard settles the locale below `/odontogram`.
    // It sets its own document title too, which is why there is no `titleNs` here.
    path: 'odontogram',
    loadChildren: () => import('odontogram/Routes').then((m) => m.remoteRoutes),
  },
  {
    // **Transitional**, and shrinking one app per commit. The apps below have not
    // migrated yet, so the shell still inserts a locale ahead of them before their
    // bundles load. This whole route goes with the last of them (plan 0003, step 6).
    path: ':locale',
    canActivate: [localeGuard],
    children: [
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
