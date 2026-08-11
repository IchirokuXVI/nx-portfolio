import { Route } from '@angular/router';
import { LandingV2Wrapper } from './landing-v2-wrapper/landing-v2-wrapper';

// landingV2 mounts at the locale root (D2), so detail pages are namespaced
// under `projects/` to avoid colliding with the odontogram/damoclesSword
// sibling remotes. Restaurant POS has no detail page yet (0002/0003) — its
// card's "View project" falls back to `appLink`.
export const LandingV2Routes: Route[] = [
  {
    path: '',
    component: LandingV2Wrapper,
  },
  {
    path: 'projects/portfolio',
    loadComponent: () =>
      import('@portfolio/landing-v2/feature-portfolio').then(
        (m) => m.PortfolioPage
      ),
  },
  {
    path: 'projects/odontogram',
    loadComponent: () =>
      import('@portfolio/landing-v2/feature-odontogram').then(
        (m) => m.OdontogramPage
      ),
  },
  {
    path: 'projects/damoclesSword',
    loadComponent: () =>
      import('@portfolio/landing-v2/feature-damocles').then(
        (m) => m.DamoclesPage
      ),
  },
];
