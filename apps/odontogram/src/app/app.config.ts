import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { appProviders } from './app-providers';
import { appRoutes } from './app.routes';

/**
 * Standalone bootstrap configuration. Only used when this remote is served on its own
 * port, where it deliberately renders nothing (see remote-entry/entry.ts), and by the
 * standalone app once it is extracted. Under the shell it is `entry.routes` that
 * carries `appProviders`.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    ...appProviders,
  ],
};
