export { provideRokuTranslator } from './lib/provide-rokutranslator';
export { RokuTranslatorModule } from './lib/rokutranslator-module';
export { RokuTranslatorPipe } from './lib/rokutranslator-pipe';
export { RokuTranslatorService } from './lib/rokutranslator-service';
export { provideRokuTranslatorTesting } from './lib/testing/provide-rokutranslator-testing';
export { RokuTranslatorTestingModule } from './lib/testing/rokutranslator-testing-module';

// Locale-first routing helpers (see 0002 locale routing refactor).
export { addLocaleRedirect } from './lib/locale-routing/add-locale-redirect';
export { readAppLocale, writeAppLocale } from './lib/locale-routing/app-locale-storage';
export { localeCorrectionGuard } from './lib/locale-routing/locale-correction-guard';
export type { LocaleRouteData } from './lib/locale-routing/locale-route-data';
export {
  isLocaleSegment,
  localeSegmentMatcher,
} from './lib/locale-routing/locale-segment-matcher';
export {
  resolveDesiredLocale,
  resolveGuessLocale,
} from './lib/locale-routing/resolve-locale';
