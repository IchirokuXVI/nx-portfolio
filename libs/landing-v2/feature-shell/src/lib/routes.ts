import { inject } from '@angular/core';
import { Route } from '@angular/router';
import {
  LANDING_V2_APP_KEY,
  LANDING_V2_DEFAULT_LOCALE,
  Layout,
} from '@portfolio/landing-v2/ui';
import {
  localeGuard,
  localizedTitle,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { NotFoundComponent } from '@portfolio/shared/ui';
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
    canActivate: [localeGuard],
    // This app's own title, from this app's own translator (plan 0005 D10). The
    // shell used to set it through a `titleNs` in its route data; with a translator
    // per app the shell has none to look it up in.
    title: localizedTitle('app-title'),
    // Hold activation until the strings are in. `loaded$` settles either way, so a
    // failed chunk renders the page with keys rather than never rendering at all.
    resolve: { translationsReady: () => inject(RokuTranslatorService).loaded$ },
    data: {
      appKey: LANDING_V2_APP_KEY,
      supportedLocales: LANDING_V2_USABLE_LOCALES,
      defaultLocale: LANDING_V2_DEFAULT_LOCALE,
    },
    children: [
      {
        // The locale, which this app now owns rather than inheriting from a
        // `:locale` route the shell kept on everybody's behalf. landingV2's mount
        // contributes no segment, so `/{mount}/{locale}/{rest}` degenerates to
        // `/{locale}/{rest}` and none of its URLs change. What changed is who
        // decides: the shell used to insert the locale before this app loaded.
        path: ':locale',
        component: Layout,
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
      {
        /**
         * **Load bearing, and not merely a 404.** The guard above only runs when this
         * parent route matches, and a parent with `children` matches only if one of
         * them matches the remainder. With `:locale` as the only child, a URL with no
         * locale segment failed to match the whole branch and the guard, whose job
         * here is to *insert* the missing locale, never ran. For the app at the site
         * root that is every locale-less URL there is, `/` included.
         *
         * So the app claims every path below its mount and the guard settles the
         * locale for all of them. Anything still here afterwards carries a supported
         * canonical locale and simply is not a route.
         */
        path: '**',
        component: NotFoundComponent,
      },
    ],
  },
];
