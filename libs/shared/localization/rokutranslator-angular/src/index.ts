export {
  composeTranslationLoader,
  provideRokuTranslator,
} from './lib/provide-rokutranslator';
export { refetchOnLocaleChange } from './lib/refetch-on-locale-change';
export { RokuLocaleStore } from './lib/roku-locale-store';
export { ROKU_TRANSLATOR } from './lib/roku-translator-token';
export { RokuTranslatorModule } from './lib/rokutranslator-module';
export { RokuTranslatorPipe } from './lib/rokutranslator-pipe';
export { RokuTranslatorService } from './lib/rokutranslator-service';
export type {
  LoaderFunction,
  TranslationSource,
} from './lib/rokutranslator-service';
export { provideRokuTranslatorTesting } from './lib/testing/provide-rokutranslator-testing';
export { RokuLocaleStoreTestingDouble } from './lib/testing/roku-locale-store-testing';
export { RokuTranslatorTestingModule } from './lib/testing/rokutranslator-testing-module';

// Locale-first routing helpers (see 0002 locale routing refactor).
export {
  readAppLocale,
  writeAppLocale,
} from './lib/locale-routing/app-locale-storage';
export { injectSupportedLocales } from './lib/locale-routing/inject-supported-locales';
export { isLocaleSegment } from './lib/locale-routing/is-locale-segment';
export { localeCorrectionGuard } from './lib/locale-routing/locale-correction-guard';
export { localeGuard } from './lib/locale-routing/locale-guard';
export type { LocaleRouteData } from './lib/locale-routing/locale-route-data';
export {
  localeSegmentOf,
  mountDepth,
  resolveLocaleSegments,
} from './lib/locale-routing/locale-segment';
export type {
  LocaleSegmentCase,
  ResolvedLocaleSegments,
} from './lib/locale-routing/locale-segment';
export {
  resolveDesiredLocale,
  resolveGuessLocale,
} from './lib/locale-routing/resolve-locale';
