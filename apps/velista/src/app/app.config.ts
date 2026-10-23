import { APP_BASE_HREF } from '@angular/common';
import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { documentMount } from './document-mount';

/**
 * velista's bootstrap configuration, for both addresses it is served at: its own
 * origin and the portfolio's `/velista` path (plan 0165).
 *
 * **`appProviders` is not here** (velista `0155`). `appRootRoute` carries it in both
 * run modes, and this file holds only what a route cannot provide: the router itself,
 * the service worker and the browser's error listeners. It used to spread the list
 * here as well, which gave the own origin build two environment injectors holding
 * the same services. Each ran its own initializers and each built its own
 * `RealtimeSocket`, so every frame of the user room arrived twice.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    // The router keeps every URL whole, mount included, instead of reading
    // `/velista/` from the `<base>` that `index.html` sets under the portfolio.
    // `appRootRoute` consumes the mount itself (plan 0165 D3).
    { provide: APP_BASE_HREF, useValue: '/' },

    /**
     * The service worker, registered **here and nowhere else** (plan 0013 D4).
     *
     * It is off under the portfolio's `/velista` path (plan 0165 D4): `ngsw.json`
     * lists its files from the root of the build, so a worker registered there would
     * resolve them against the portfolio's root and fail its first manifest check.
     *
     * `enabled` follows the build, because `serviceWorker: true` is set on the
     * production configuration alone (`project.json`). A development build emits no
     * worker, so registering one would 404 on port 4205, and nothing stale is ever
     * served while developing.
     *
     * `registerWhenStable:30000` is the default and is kept deliberately: registration
     * waits for the app to become stable, so it stays out of the critical path of the
     * first paint, and the 30 second ceiling means an app that never stabilises still
     * ends up with a worker.
     */
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && documentMount() === '',
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
