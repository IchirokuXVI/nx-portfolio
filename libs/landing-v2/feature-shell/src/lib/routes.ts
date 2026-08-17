import { Route } from '@angular/router';
import { localeCorrectionGuard } from '@portfolio/localization/rokutranslator-angular';
import {
  LANDING_V2_APP_KEY,
  LANDING_V2_DEFAULT_LOCALE,
  Layout,
} from '@portfolio/landing-v2/ui';
import { LandingV2Wrapper } from './landing-v2-wrapper/landing-v2-wrapper';
import { LANDING_V2_USABLE_LOCALES } from './usable-locales';

// landingV2 mounts at the locale root (D2), so detail pages are namespaced
// under `projects/` to avoid colliding with the odontogram/damoclesSword
// sibling remotes. Restaurant POS has no detail page yet (0002/0003) — its
// card's "View project" still falls back to `appLink`.
//
// Every page renders inside the shared `Layout` (a parent route with a
// <router-outlet>), which frames it with the site header + footer — so the
// landing page and every detail page share the same chrome without any
// content-projection plumbing. The child routes are the actual pages:
//
// A single parameterized route serves every project: ProjectPage
// (feature-project) reads `:slug` from the URL and resolves the matching
// project via ProjectMemory.getByDetailSlug — adding a project's detail
// page later needs no new route entry, just a `detailSlug` in the data and
// a content component (see project-page.ts's CONTENT_BY_SLUG).
export const LandingV2Routes: Route[] = [
  {
    path: '',
    component: Layout,
    canActivate: [localeCorrectionGuard],
    data: {
      appKey: LANDING_V2_APP_KEY,
      supportedLocales: LANDING_V2_USABLE_LOCALES,
      defaultLocale: LANDING_V2_DEFAULT_LOCALE,
    },
    children: [
      {
        path: '',
        component: LandingV2Wrapper,
      },
      {
        path: 'projects/:slug',
        loadComponent: () =>
          import('@portfolio/landing-v2/feature-project').then(
            (m) => m.ProjectPage
          ),
      },
    ],
  },
];
