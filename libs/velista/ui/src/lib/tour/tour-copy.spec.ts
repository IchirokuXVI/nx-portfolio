import { TOUR_STOPS } from '@portfolio/velista/platform';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * **Rule O6, as a test** (velista `0099`, sections 9 and 12).
 *
 * A card says what the thing is for, not what it is called. So no card names a screen
 * by its route, and none names a feature by the word the code knows it by: a person
 * who has never heard "basket" or "zone" is exactly who the tour is for.
 *
 * The product name is allowed. It is what the person installed, and rule N1 keeps it
 * data in the translations rather than a constant.
 */

/** A route written the way a URL writes it, in either language. */
const ROUTES = /\/|\bshopping-lists\b|\bzones\b|\bsetup\b|\bsheet\b/i;

/** The words the code uses for what the interface calls something else. */
const FEATURE_NAMES: Readonly<Record<string, RegExp>> = {
  en: /\b(zones?|baskets?|assistant|harvester|luna)\b/i,
  es: /\b(zonas?|cestas?|asistente|luna)\b/i,
};

type Tree = { readonly [key: string]: string | Tree };

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    node = typeof node === 'object' ? node[part] : undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

describe('the tour copy (rule O6)', () => {
  const assets = resolve(__dirname, '../../../assets/i18n');

  describe.each(['en', 'es'])('%s', (locale) => {
    const copy = JSON.parse(
      readFileSync(resolve(assets, `${locale}.json`), 'utf8')
    ) as Tree;

    it.each(TOUR_STOPS.map((stop) => [stop.id, stop] as const))(
      'the %s card has a title and a body',
      (_, stop) => {
        expect(lookup(copy, stop.titleKey)).toBeTruthy();
        expect(lookup(copy, stop.bodyKey)).toBeTruthy();
      }
    );

    it.each(TOUR_STOPS.map((stop) => [stop.id, stop] as const))(
      'the %s card names no route and no feature by its code name',
      (_, stop) => {
        for (const key of [stop.titleKey, stop.bodyKey]) {
          const text = lookup(copy, key) ?? '';

          expect(text).not.toMatch(ROUTES);
          expect(text).not.toMatch(FEATURE_NAMES[locale] as RegExp);
        }
      }
    );

    it('has the buttons, the count and the account row', () => {
      for (const key of [
        'tour.progress',
        'tour.skip',
        'tour.next',
        'tour.finish',
        'account.tour.again',
      ]) {
        expect(lookup(copy, key)).toBeTruthy();
      }
      expect(lookup(copy, 'tour.progress')).toContain('{{n}}');
      expect(lookup(copy, 'tour.progress')).toContain('{{total}}');
    });
  });
});
