import type { Provider } from '@angular/core';
import { ApiUrl } from './api-url';
import { SessionBootstrap } from './auth/session-bootstrap';
import { SessionLifecycle } from './auth/session-lifecycle';
import { SessionStorage } from './auth/session-storage';
import { SessionStore } from './auth/session-store';
import { DeploymentStore } from './deployment/deployment-store';

/**
 * Everything this library provides, in one list the app spreads into its
 * injector.
 *
 * The list is owned here rather than assembled by the app, so a service that
 * moves or arrives is added in one place and both the app and every spec pick it
 * up from there.
 *
 * **Real transports are deliberately absent.** `DeploymentApi` and `SessionApi`
 * are not here: talking to a live gateway is the app's decision, made in
 * `app-providers.ts` beside the `HttpClient` they depend on. `DeploymentMemory`
 * and `SessionMemory` stay their tokens' defaults, so a spec and a run with no
 * backend keep working with no change at all.
 */
export const LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS: Provider[] = [
  ApiUrl,
  DeploymentStore,
  SessionStorage,
  SessionStore,
  SessionBootstrap,
  SessionLifecycle,
];
