import { Route } from '@angular/router';
import { appRootRoute } from '../app-root-route';

/**
 * What the shell lazy-loads through the `velista/Routes` alias.
 *
 * The mount is the only thing this file knows that the standalone build does not:
 * the shell puts velista at `/velista`, so the locale is the segment after it. The
 * route itself, its providers and the reasons for both live in `app-root-route.ts`.
 */
export const remoteRoutes: Route[] = [appRootRoute('/velista')];
