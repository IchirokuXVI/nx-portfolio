import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  inject,
  provideAppInitializer,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import {
  adminAuthInterceptor,
  DEPLOYMENT_SERVICE,
  DeploymentApi,
  DIRECTORY_SERVICE,
  DirectoryApi,
  LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS,
  RESOURCE_GATEWAYS,
  ResourceApiGateways,
  SESSION_SERVICE,
  SessionApi,
  SessionBootstrap,
  SessionLifecycle,
} from '@portfolio/luna-shopper-admin/data-access';
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import { provideService } from '@portfolio/shared/data-access';
import { environment } from '../environments/environment';
import { DocumentTitle } from './document-title';
import { ADMIN_RESOURCES } from './resources';
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
  // The interceptor attaches the bearer token to gateway requests and to nothing
  // else, and turns a 401 into a renewal, an overlay and a retry rather than into
  // a lost request (plan 0003, section 6).
  provideHttpClient(withFetch(), withInterceptors([adminAuthInterceptor])),

  // The app's own services, which cannot provide themselves. The array is owned by
  // the library, so a service that moves is added in one place.
  ...LUNA_SHOPPER_ADMIN_DATA_ACCESS_PROVIDERS,

  // The real transports, bound **here** rather than left as their tokens' defaults:
  // both need the `HttpClient` configured a few lines above, which only exists in
  // this injector. `DeploymentMemory` and `SessionMemory` stay the defaults, so
  // every spec and every run without a backend keeps working with no change at all.
  //
  // `provideService`, not `useService`: the first provides the implementation as
  // well as binding it, and neither class provides itself anywhere.
  provideService(DEPLOYMENT_SERVICE, DeploymentApi),
  provideService(SESSION_SERVICE, SessionApi),
  provideService(RESOURCE_GATEWAYS, ResourceApiGateways),
  provideService(DIRECTORY_SERVICE, DirectoryApi),

  // Which resources this app has (plan 0004). The route table is built from the
  // same list, so a resource cannot be reachable without a link or linked
  // without a route, and a reference field pointing at one of them resolves
  // through this rather than through a second registry.
  provideResources(...ADMIN_RESOURCES),

  // Ask the server about itself, and take a passwordless session if it offers one
  // (plan 0002, section 5).
  //
  // An **app** initializer rather than an environment one, because the router's
  // first navigation must not run until this settles: the guard would otherwise
  // bounce a development operator to the login screen and sign them in behind it.
  // This is also what starts the environment read that decides the accent colour,
  // so `0001`'s `DeploymentStore.load()` is no longer called separately.
  provideAppInitializer(() => inject(SessionBootstrap).run()),

  // Start counting interaction before anything can happen (plan 0003, section 2).
  //
  // An **environment** initializer, which runs earlier than the app initializer
  // above, and started explicitly because nothing injects this service until a
  // token needs renewing — by which point every interaction it should have been
  // counting has already happened and the session would look idle from birth.
  provideEnvironmentInitializer(() => inject(SessionLifecycle).start()),

  // Put the environment name in the document title (plan 0001, section 6). A
  // listener, not a dependency: nothing injects it, so without this line nothing
  // would ever construct it and the tab would keep the static title from
  // `index.html`.
  DocumentTitle,
  provideEnvironmentInitializer(() => void inject(DocumentTitle)),
];
