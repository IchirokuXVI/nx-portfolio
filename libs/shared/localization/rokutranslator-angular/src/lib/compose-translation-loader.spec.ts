import { composeTranslationLoader } from './provide-rokutranslator';
import type { TranslationSource } from './rokutranslator-service';

/**
 * Plan 0006's acceptance criteria 2 and 5, moved here with the function itself
 * (plan 0005 D11): every app needs this dispatch, so it lives in the library rather
 * than being written out at four composition sites.
 *
 * Both are about composition rather than about translation: that a second library can
 * be added without the composition site learning where its assets are, and that a
 * library whose assets fail to load costs the app some words rather than the whole
 * app.
 */
describe('composeTranslationLoader', () => {
  /** Criterion 2: each namespace reaches its own library's loader, and nobody else's. */
  it('routes every namespace to the source that declared it', async () => {
    const velista = jest.fn().mockResolvedValue({ greeting: 'from velista' });
    const lists = jest.fn().mockResolvedValue({ greeting: 'from lists' });

    const sources: TranslationSource[] = [
      { namespace: 'velista', locales: ['en'], loader: velista },
      { namespace: 'lists', locales: ['en'], loader: lists },
    ];

    const load = composeTranslationLoader(sources);

    await expect(load('en', 'velista')).resolves.toEqual({
      greeting: 'from velista',
    });
    await expect(load('en', 'lists')).resolves.toEqual({
      greeting: 'from lists',
    });

    // Not just "the right one answered": the wrong one was never asked. A dispatch
    // that called both and picked a result would satisfy the assertions above while
    // fetching every library's assets for every namespace.
    expect(velista).toHaveBeenCalledTimes(1);
    expect(velista).toHaveBeenCalledWith('en', 'velista');
    expect(lists).toHaveBeenCalledTimes(1);
    expect(lists).toHaveBeenCalledWith('en', 'lists');
  });

  /**
   * The library only asks for namespaces it was configured with, so this is
   * unreachable through `provideRokuTranslator`. It is asserted anyway because the
   * alternative behaviour is a rejected promise, and section 4.4 is entirely about
   * what a rejected loader does to a blocking resolver.
   */
  it('falls back to the first source rather than rejecting on an unknown namespace', async () => {
    const first = jest.fn().mockResolvedValue({ ok: true });

    const load = composeTranslationLoader([
      { namespace: 'velista', locales: ['en'], loader: first },
    ]);

    await expect(load('en', 'nobody-owns-this')).resolves.toEqual({ ok: true });
  });
});
