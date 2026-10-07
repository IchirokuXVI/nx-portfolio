import {
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
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
    provideRouter(
      appRoutes,
      // A navigation that a guard refuses must leave the history as it was
      // (admin plan 0053, section 2.6). The record page asks before a form
      // with changes is left, and "Stay here" after the Back button of the
      // browser used to cost the entry that Back had gone to: the default
      // puts the address back by replacing it. `computed` walks the history
      // back to where it was.
      withRouterConfig({ canceledNavigationResolution: 'computed' })
    ),
    ...appProviders,
  ],
};
