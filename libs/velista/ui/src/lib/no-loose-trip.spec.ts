import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * No screen calls a session "loose" (velista `0095`, section 4; backend `0130`,
 * section 3: "The screen never says loose").
 *
 * A session is labelled by its date alone. The Spanish check matches the phrase and
 * not the word, because "tiendas sueltas" on the shops screen means single shops and
 * has nothing to do with a trip.
 */
describe('no trip is called loose (velista 0095, test 3)', () => {
  const assets = resolve(__dirname, '../../assets/i18n');

  it.each(['en', 'es'])(
    '%s.json says neither loose nor compras sueltas',
    (locale) => {
      const text = readFileSync(resolve(assets, `${locale}.json`), 'utf8');

      expect(text).not.toMatch(/\bloose\b/i);
      expect(text).not.toMatch(/compras sueltas/i);
    }
  );
});
