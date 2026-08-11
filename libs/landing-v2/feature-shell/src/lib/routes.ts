import { Route } from '@angular/router';
import { LandingV2Wrapper } from './landing-v2-wrapper/landing-v2-wrapper';

// landingV2 mounts at the locale root (D2), so detail pages are namespaced
// under `projects/` to avoid colliding with the odontogram/damoclesSword
// sibling remotes. Restaurant POS has no detail page yet (0002/0003) — its
// card's "View project" falls back to `appLink`.
//
// All three detail routes share one lazy-loaded page (ProjectPage,
// feature-project) that resolves which project to render from route `data`
// — see libs/landing-v2/feature-project's project-page.ts.
export const LandingV2Routes: Route[] = [
  {
    path: '',
    component: LandingV2Wrapper,
  },
  {
    path: 'projects/portfolio',
    loadComponent: () =>
      import('@portfolio/landing-v2/feature-project').then(
        (m) => m.ProjectPage
      ),
    data: { projectId: '1' },
  },
  {
    path: 'projects/damoclesSword',
    loadComponent: () =>
      import('@portfolio/landing-v2/feature-project').then(
        (m) => m.ProjectPage
      ),
    data: { projectId: '2' },
  },
  {
    path: 'projects/odontogram',
    loadComponent: () =>
      import('@portfolio/landing-v2/feature-project').then(
        (m) => m.ProjectPage
      ),
    data: { projectId: '3' },
  },
];
