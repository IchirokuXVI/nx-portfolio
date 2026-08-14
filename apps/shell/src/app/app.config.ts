import {
  ApplicationConfig,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    // Supported locales are no longer global; each app declares its own via
    // provideRokuTranslator, and the locale routing layer validates per app.
    provideAppInitializer(() => RokuTranslator.init({ lowercaseLocale: true })),
  ],
};
