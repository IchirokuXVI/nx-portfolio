import { CONTENT_LOCALES } from './catalog.messages';
import {
  ADAPTER_CAPABILITIES,
  ADAPTER_KEYS,
  adapterCapabilities,
} from './harvest.messages';

/**
 * What an adapter is able to tell us, and what language it says it in (plan
 * 0103, section 4; the language is plan 0111, section 7).
 *
 * The table is the contract: the spawn enforces it and the back office draws its
 * form from it, so the two cannot disagree about what a chain needs. The rule
 * worth a test is the fallback, because it is what a reader one release behind a
 * backend that added an adapter gets, and it is the only part no call site sees
 * until that day.
 */
describe('adapterCapabilities', () => {
  it('answers "I know nothing" for an adapter it does not know', () => {
    // Every boolean false and no printed language. A back office one release
    // behind then draws a plain form rather than a broken one, and the spawn is
    // still the thing that refuses a bad request.
    expect(adapterCapabilities('a-chain-added-next-year')).toEqual({
      writesPrices: false,
      scopesItsOwn: false,
      listsItsOwnStores: false,
      hasProductPages: false,
      printedLocale: null,
    });
  });

  it('answers the same for a missing adapter key', () => {
    for (const absent of [null, undefined, '']) {
      expect(adapterCapabilities(absent).printedLocale).toBeNull();
      expect(adapterCapabilities(absent).writesPrices).toBe(false);
    }
  });

  it('answers a null printed language rather than guessing one', () => {
    // The safe direction, and the reason the accept asks the operator: an
    // unknown adapter's printed string gets filed under no language rather than
    // under a language nobody checked.
    expect(adapterCapabilities('deza-web').printedLocale).toBe('es');
    expect(adapterCapabilities('not-an-adapter').printedLocale).toBeNull();
  });

  it('states a printed language for every adapter, or says there is none', () => {
    // A new adapter added to the table without the field would be `undefined`
    // here, which reads as neither a language nor an honest "nothing known".
    for (const key of ADAPTER_KEYS) {
      const { printedLocale } = ADAPTER_CAPABILITIES[key];
      expect(
        printedLocale === null ||
          (CONTENT_LOCALES as readonly string[]).includes(printedLocale)
      ).toBe(true);
    }
  });

  it('says the two sources that print nothing print nothing', () => {
    // OpenStreetMap's name tag is written by mappers in the local language of
    // wherever the shop is, and a manual row is whatever an operator typed. In
    // both cases the operator names the language, because nobody else can.
    expect(ADAPTER_CAPABILITIES['osm-places'].printedLocale).toBeNull();
    expect(ADAPTER_CAPABILITIES['manual'].printedLocale).toBeNull();
  });

  it('says every storefront this build reads prints Spanish', () => {
    for (const key of [
      'mercadona-api',
      'deza-web',
      'carrefour-web',
      'lidl-api',
    ] as const) {
      expect(ADAPTER_CAPABILITIES[key].printedLocale).toBe('es');
    }
  });
});
