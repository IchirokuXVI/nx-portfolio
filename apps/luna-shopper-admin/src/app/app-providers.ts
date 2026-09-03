import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  DEPLOYMENT_SERVICE,
  DeploymentApi,
  DeploymentStore,
  LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS,
} from '@portfolio/luna-shopper-admin/data-access';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { provideService } from '@portfolio/shared/data-access';
import { environment } from '../environments/environment';
import { DocumentTitle } from './document-title';
import { LUNA_SHOPPER_ADMIN_TRANSLATION_PROVIDERS } from './translation-providers';

/**
 * Everything the app layer supplies to its libraries.
 *
 * Attached in **one** place, unlike velista's, which has to be spread into both a
 * standalone bootstrap and a route the shell mounts. This app has one run mode: it
 * is not a micro-frontend, it is never mounted anywhere, and `app.config.ts` is the
 * only entry point there is (plan 0001, section 2).
 */
export const appProviders: (Provider | EnvironmentProviders)[] = [
  // Where the backend is, from this app's own environment surface. Every service in
  // `data-access` injects this token and no library reads an environment file.
  { provide: ADMIN_API_CONFIG, useValue: environment.api },

  // The app's translations, on this injector so they sit above every route.
  ...LUNA_SHOPPER_ADMIN_TRANSLATION_PROVIDERS,

  // `withFetch` because it costs nothing and is what the rest of the workspace uses.
  // No interceptor yet: `0002` adds the one that attaches the bearer token, and
  // there is no token to attach until it does.
  provideHttpClient(withFetch()),

  // The app's own services, which cannot provide themselves. The array is owned by
  // the library, so a service that moves is added in one place.
  ...LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS,

  // The real transport, bound **here** rather than left as the token's default:
  // `DeploymentApi` needs the `HttpClient` configured a few lines above, which only
  // exists in this injector. `DeploymentMemory` stays the default, so every spec and
  // every run without a backend keeps working with no change at all.
  //
  // `provideService`, not `useService`: the first provides the implementation as
  // well as binding it, and `DeploymentApi` provides itself nowhere.
  provideService(DEPLOYMENT_SERVICE, DeploymentApi),

  // Ask which deployment this is, once, as early as there is an injector to ask
  // from. An initializer rather than a component's constructor because the answer
  // decides the accent colour of the whole app, so it should not wait on whichever
  // screen happens to render first.
  provideEnvironmentInitializer(() => inject(DeploymentStore).load()),

  // Put the environment name in the document title (plan 0001, section 6). A
  // listener, not a dependency: nothing injects it, so without this line nothing
  // would ever construct it and the tab would keep the static title from
  // `index.html`.
  DocumentTitle,
  provideEnvironmentInitializer(() => void inject(DocumentTitle)),
];
