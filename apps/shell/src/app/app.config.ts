import {
  ApplicationConfig,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { appRoutes } from './app.routes';

const SUPPORTED_LOCALES = ['en', 'es'];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    provideAppInitializer(() =>
      RokuTranslator.init({
        lowercaseLocale: true,
        supportedLocales: SUPPORTED_LOCALES,
      })
    ),
  ],
};
