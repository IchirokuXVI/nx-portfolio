export { provideRokuTranslator } from './lib/provide-rokutranslator';
export { RokuTranslatorModule } from './lib/rokutranslator-module';
export { RokuTranslatorPipe } from './lib/rokutranslator-pipe';
export { RokuTranslatorService } from './lib/rokutranslator-service';
export { provideRokuTranslatorTesting } from './lib/testing/provide-rokutranslator-testing';
export { RokuTranslatorTestingModule } from './lib/testing/rokutranslator-testing-module';

// Locale-first routing helpers (see 0002 locale routing refactor).
export { readAppLocale, writeAppLocale } from './lib/locale-routing/app-locale-storage';
export { isLocaleSegment } from './lib/locale-routing/is-locale-segment';
export { localeCorrectionGuard } from './lib/locale-routing/locale-correction-guard';
export { localeGuard } from './lib/locale-routing/locale-guard';
export type { LocaleRouteData } from './lib/locale-routing/locale-route-data';
export {
  resolveDesiredLocale,
  resolveGuessLocale,
} from './lib/locale-routing/resolve-locale';
export { switchAppLocale } from './lib/locale-routing/switch-app-locale';
