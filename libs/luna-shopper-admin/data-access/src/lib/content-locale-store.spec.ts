import { TestBed } from '@angular/core/testing';
import { CONTENT_LOCALES } from '@portfolio/luna-shopper-admin/models';
import { ContentLocaleStore } from './content-locale-store';

/**
 * The language the operator reads the catalog in (admin plan 0026, section 3).
 *
 * Four properties, and each is one of the four ways this can be wrong: the
 * default with nothing stored, the round trip through storage that makes the
 * choice survive a reload, a stored value this build does not serve, and a
 * browser whose storage throws rather than answering empty.
 */

const KEY = 'luna-shopper-admin.content-locale';

describe('ContentLocaleStore', () => {
  function boot(): ContentLocaleStore {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ContentLocaleStore] });
    return TestBed.inject(ContentLocaleStore);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('reads the first content locale when nothing was ever chosen', () => {
    const store = boot();

    expect(store.locale()).toBe(CONTENT_LOCALES[0]);
    expect(store.order()).toEqual(CONTENT_LOCALES);
  });

  /**
   * The order is the whole point: the chosen language first and **every** other
   * content locale after it, so a name written in one language only still has
   * something to fall through to.
   */
  it('puts the chosen language first and keeps the rest behind it', () => {
    const store = boot();

    store.choose('es');

    expect(store.locale()).toBe('es');
    expect(store.order()).toEqual(['es', 'en']);
    expect([...store.order()].sort()).toEqual([...CONTENT_LOCALES].sort());
  });

  /** A reload is a fresh instance. Nothing is being remembered in the object. */
  it('survives a reload', () => {
    boot().choose('es');

    expect(boot().locale()).toBe('es');
  });

  /**
   * A stored value is filtered rather than trusted. It was written by an older
   * build or by hand in a console, and a build that once served a third
   * language must not leave a locale nobody serves at the head of the order.
   */
  it('discards a stored language the content is not written in', () => {
    localStorage.setItem(KEY, 'fr');

    expect(boot().locale()).toBe(CONTENT_LOCALES[0]);
  });

  it('ignores a choice of a language the content is not written in', () => {
    const store = boot();

    store.choose('fr');

    expect(store.locale()).toBe(CONTENT_LOCALES[0]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  /**
   * Reading storage *throws* rather than answering empty in a private window,
   * in an embedded webview, or on an origin the user denied storage to. The app
   * still works there: it reads the default, and a choice holds for the page it
   * was made on.
   */
  it('works in a browser whose storage throws', () => {
    const refuse = () => {
      throw new Error('denied');
    };
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(refuse);
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(refuse);

    try {
      const store = boot();
      expect(store.locale()).toBe(CONTENT_LOCALES[0]);

      store.choose('es');
      expect(store.locale()).toBe('es');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
