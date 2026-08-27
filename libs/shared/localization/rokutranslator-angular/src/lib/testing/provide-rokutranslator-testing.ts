import { Provider } from '@angular/core';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuLocaleStore } from '../roku-locale-store';
import { ROKU_TRANSLATOR } from '../roku-translator-token';
import { RokuTranslatorService } from '../rokutranslator-service';
import { RokuLocaleStoreTestingDouble } from './roku-locale-store-testing';
import { RokuTranslatorTestingService } from './rokutranslator-testing-service';

/**
 * Everything the translation layer needs in a spec, so a component test can render
 * a `| rokuT` binding or read the active locale without knowing that a translator
 * exists.
 *
 * It now covers the store and the translator instance too, not just the service.
 * Before plan 0005 those were a module global and a root provided store, so a spec
 * reached them by mocking the whole core module; that mock is gone from every
 * consumer spec and lives here once.
 *
 * The translator is a **real** `RokuTranslator`, uninitialized. Nothing in a spec
 * should reach it (the service double answers every read), and one that does gets
 * an honest object rather than a hand written fake that drifts from the real class.
 */
export function provideRokuTranslatorTesting(): Provider[] {
  return [
    { provide: ROKU_TRANSLATOR, useFactory: () => new RokuTranslator() },
    { provide: RokuLocaleStore, useClass: RokuLocaleStoreTestingDouble },
    { provide: RokuTranslatorService, useClass: RokuTranslatorTestingService },
  ];
}
