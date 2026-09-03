import {
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { appProviders } from './app-providers';
import { appRoutes } from './app.routes';

/**
 * The app's one configuration.
 *
 * **No `provideServiceWorker` and no PWA** (plan 0001, section 4). This is an
 * internal tool opened on a desktop and a phone browser, not something anybody
 * installs, and a worker would only add a cache that can serve an operator a stale
 * build of a tool they use to change production data.
 *
 * No `provideZoneChangeDetection` either: the app is zoneless, like everything new
 * in this workspace.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    ...appProviders,
  ],
};
