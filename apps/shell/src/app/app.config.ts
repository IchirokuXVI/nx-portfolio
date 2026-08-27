import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { appRoutes } from './app.routes';

/**
 * **The shell has no translator.**
 *
 * It used to initialize one here, as an app initializer, and every remote used that
 * instance. Each app owns its own now (plan 0005), sets its own document title
 * (D10) and settles its own locale (plan 0003), so there is nothing left for the
 * shell to hold on anybody's behalf. What remains is a host that mounts remotes and
 * supplies a router, which is what it should have been.
 *
 * `TitleStrategy` is gone with the translator: with no `titleNs` in any route table,
 * Angular's default strategy sets whatever an app's `localizedTitle` resolver
 * produced, which is already the finished string.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
  ],
};
