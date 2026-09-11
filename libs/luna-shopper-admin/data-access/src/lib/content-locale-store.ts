import { computed, Injectable, signal, type Signal } from '@angular/core';
import { CONTENT_LOCALES } from '@portfolio/luna-shopper-admin/models';

/** The one key this store writes, namespaced so it cannot collide on an origin. */
const CONTENT_LOCALE_KEY = 'luna-shopper-admin.content-locale';

/** What the catalog is read in when nothing was chosen and nothing was stored. */
const FALLBACK = CONTENT_LOCALES[0];

/**
 * The language the operator reads the catalog in (admin plan 0026).
 *
 * **Not the interface language, and the two stay apart.**
 * `APP_AVAILABLE_LOCALES` is one entry long: the labels, the buttons and the
 * navigation are English, and they stay English whatever this says. What this
 * decides is which language a product's name is read in and which language the
 * server answers in, which is a question about the catalog rather than a
 * question about the back office. Conflating them would make the Spanish name
 * unreadable until somebody translated the admin interface.
 *
 * {@link order} is the value every reader actually wants. A screen keeps
 * receiving a list of locales in preference order and keeps falling through it,
 * exactly as it did when that list was a constant, so nothing downstream learns
 * that there is a chosen locale at all.
 *
 * **It is an order and never a filter.** A product named in one language only
 * still shows the name it has, and the badge still marks the language it is
 * missing. Hiding a row for want of a translation would make the screen that
 * finds untranslated rows the one screen that cannot show them.
 *
 * Persistence is `localStorage`, beside `SessionStorage` and for the same
 * reason: it is per origin, so a row opened in a second tab is read in the
 * language the operator chose in the first. Every access is wrapped, because
 * reading storage *throws* rather than answering empty in a private window, in
 * an embedded webview, or on an origin the user has denied storage to. An
 * operator whose browser refuses storage still gets a working app, one that
 * reads English again after every reload.
 */
@Injectable()
export class ContentLocaleStore {
  private readonly _locale = signal(stored());

  /** The chosen language. One of {@link CONTENT_LOCALES}, always. */
  readonly locale: Signal<string> = this._locale.asReadonly();

  /**
   * The content locales, the chosen one first. What every reader passes as the
   * order.
   *
   * Every content locale is in it, so a value with no text in the chosen
   * language falls through to the language it does have. A signal rather than a
   * value, so a screen reading it inside a `computed` reacts to the switch and
   * the list page's fetch has one thing to watch.
   */
  readonly order: Signal<readonly string[]> = computed(() => {
    const chosen = this._locale();
    return [chosen, ...CONTENT_LOCALES.filter((locale) => locale !== chosen)];
  });

  /**
   * Read the catalog in this language from now on.
   *
   * A locale the content is not written in is **ignored**: not set and not
   * stored. The control offers the two that exist, so this is the case where
   * something else calls it, and putting a language nobody serves at the head
   * of the order would cost every name on screen its fallback for nothing.
   */
  choose(locale: string): void {
    if (!CONTENT_LOCALES.includes(locale)) {
      return;
    }

    this._locale.set(locale);
    try {
      globalThis.localStorage?.setItem(CONTENT_LOCALE_KEY, locale);
    } catch {
      // Storage refused. The choice still holds for this page: it is a signal
      // either way, and this is only what makes it survive a reload.
    }
  }
}

/**
 * The stored choice, or the fallback.
 *
 * A stored value is filtered against {@link CONTENT_LOCALES} rather than
 * trusted, because it was written by an older build or by hand in a console: a
 * build that once served a third language must not leave a locale nobody serves
 * at the head of the order.
 */
function stored(): string {
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(CONTENT_LOCALE_KEY) ?? null;
  } catch {
    return FALLBACK;
  }

  return raw !== null && CONTENT_LOCALES.includes(raw) ? raw : FALLBACK;
}
