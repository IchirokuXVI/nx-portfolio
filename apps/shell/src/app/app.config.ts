import {
  ApplicationConfig,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, TitleStrategy } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { appRoutes } from './app.routes';
import { RokuTitleStrategy } from './roku-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    // Supported locales are no longer global; each app declares its own via
    // provideRokuTranslator, and the locale routing layer validates per app.
    provideAppInitializer(() => RokuTranslator.init({ lowercaseLocale: true })),
    // Localize document titles through RokuTranslator (route title = key).
    { provide: TitleStrategy, useClass: RokuTitleStrategy },
  ],
};
