import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { appProviders } from './app-providers';
import { appRoutes } from './app.routes';

/**
 * The standalone half of the pair. This runs when velista is served from its own
 * origin (plan 0013), which since that plan is production rather than a preview: the
 * app draws its own chrome and owns its own token scope, so it borrows nothing from
 * the portfolio shell. Under the shell it is `appRootRoute` that carries
 * `appProviders`, and this configuration never runs at all.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    ...appProviders,

    /**
     * The service worker, registered **here and nowhere else** (plan 0013 D4).
     *
     * `appProviders` is spread into both run modes, so registering there would make
     * the *portfolio's* page register velista's worker on the *portfolio's* origin,
     * where `ngsw-worker.js` does not exist: a 404 on every shell page load, and a
     * worker scoped to the wrong origin if it ever did resolve. This file is the only
     * one the mounted build never reaches, which makes it the only correct home.
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
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
