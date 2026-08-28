import { Route } from '@angular/router';
import { appRootRoute } from './app-root-route';

/**
 * The standalone build's route table, served from velista's own origin (plan 0013).
 *
 * The mount is empty, so the app starts at `/` and the locale is the first segment:
 * `/en/home`, not `/velista/en/home`. That is the same rule landingV2 already runs
 * under, and `localeGuard` needs nothing else to settle it.
 */
export const appRoutes: Route[] = [appRootRoute('')];
