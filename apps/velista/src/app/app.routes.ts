import { Route } from '@angular/router';
import { appRootRoute } from './app-root-route';
import { documentMount } from './document-mount';

/**
 * velista's route table. The mount comes from the document (plan 0165 D3): `''` on
 * the own origin, where the locale is the first segment (`/en/home`), and
 * `'/velista'` under the portfolio's gateway (`/velista/en/home`).
 */
export const appRoutes: Route[] = [appRootRoute(documentMount())];
