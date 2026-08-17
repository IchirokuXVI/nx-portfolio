import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, TitleStrategy } from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { localeHeaderInterceptor } from '@portfolio/localization/rokutranslator-angular';
import { appRoutes } from './app.routes';
import { RokuTitleStrategy } from './roku-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    // Every request carries the active locale (Accept-Language) so the server can
    // return locale-dependent data. Shared HttpClient, so this covers all remotes.
    provideHttpClient(withInterceptors([localeHeaderInterceptor])),
    // Supported locales are no longer global; each app declares its own via
    // provideRokuTranslator, and the locale routing layer validates per app.
    provideAppInitializer(() => RokuTranslator.init({ lowercaseLocale: true })),
    // Localize document titles through RokuTranslator (route title = key).
    { provide: TitleStrategy, useClass: RokuTitleStrategy },
  ],
};
