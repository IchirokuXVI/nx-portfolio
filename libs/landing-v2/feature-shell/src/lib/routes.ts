import { Route } from '@angular/router';
import { LandingV2Wrapper } from './landing-v2-wrapper/landing-v2-wrapper';

export const LandingV2Routes: Route[] = [
  {
    path: '',
    component: LandingV2Wrapper,
  },
  // Detail-page child routes (portfolio, odontogram, damoclesSword) are added in 0004.
];
