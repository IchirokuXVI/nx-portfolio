import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, TitleStrategy } from '@angular/router';
import { ROKU_TRANSLATOR } from '@portfolio/localization/rokutranslator-angular';
import { appRoutes } from './app.routes';
import { RokuTitleStrategy } from './roku-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    // **Transitional, and the whole of what the shell step of plan 0003 deletes.**
    //
    // The translator is per app now (plan 0005), so initializing one here is the
    // shell holding state that belongs to somebody else. It stays only until the
    // last app owns its locale: an app that has not migrated still resolves the
    // transitional root `ROKU_TRANSLATOR`, and it has to be initialized by someone.
    //
    // Resolved through the token rather than imported, so this line inits exactly
    // the instance those apps will find.
    provideAppInitializer(() =>
      inject(ROKU_TRANSLATOR).init({ lowercaseLocale: true })
    ),
    // Localize document titles through RokuTranslator (route title = key).
    { provide: TitleStrategy, useClass: RokuTitleStrategy },
  ],
};
