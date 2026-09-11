import type { Provider } from '@angular/core';
import { ApiUrl } from './api-url';
import { SessionBootstrap } from './auth/session-bootstrap';
import { SessionLifecycle } from './auth/session-lifecycle';
import { SessionStorage } from './auth/session-storage';
import { SessionStore } from './auth/session-store';
import { ContentLocaleStore } from './content-locale-store';
import { DeploymentStore } from './deployment/deployment-store';
import { ServerReachability } from './health/server-reachability';

/**
 * Everything this library provides, in one list the app spreads into its
 * injector.
 *
 * The list is owned here rather than assembled by the app, so a service that
 * moves or arrives is added in one place and both the app and every spec pick it
 * up from there.
 *
 * **Real transports are deliberately absent.** `DeploymentApi`, `SessionApi` and
 * `HealthApi` are not here: talking to a live gateway is the app's decision,
 * made in `app-providers.ts` beside the `HttpClient` they depend on.
 * `DeploymentMemory`, `SessionMemory` and `HealthMemory` stay their tokens'
 * defaults, so a spec and a run with no backend keep working with no change at
 * all.
 */
export const LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS: Provider[] = [
  ApiUrl,
  ServerReachability,
  DeploymentStore,
  SessionStorage,
  SessionStore,
  SessionBootstrap,
  SessionLifecycle,
  // Which language the catalog is read in (admin plan 0026). Here rather than
  // `providedIn: 'root'` for the reason every store above is: one instance on
  // the app injector, reachable from a spec that spreads this list and from
  // nothing that did not.
  ContentLocaleStore,
];
