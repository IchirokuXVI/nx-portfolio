import { APP_DEFAULT_LOCALE } from '@portfolio/velista/ui';

/**
 * Where a basket and its join screen live in the route table, in one place.
 *
 * Three screens across two plans navigate here — `0045`'s dashboard card, its
 * history rows, and `0044`'s own join screen on the way in — so the segments are
 * constants rather than string literals repeated in each. A route table is the
 * one thing a typo in cannot fail at compile time and will not fail at test time
 * either, because a `routerLink` to a path that does not exist simply does
 * nothing when tapped.
 *
 * They are **segments and not a whole URL**: every path in this app is
 * `/{mount}/{locale}/{rest}` (plan 0001), so the caller supplies the mount from
 * `APP_BASE_PATH` and the locale it is currently rendering in, and these say only
 * what comes after.
 */
export const BASKET_PATHS = {
  /** The history listing (`0045`), and the prefix everything else here shares. */
  list: 'shopping-lists',
  /** One basket, the screen `0044` is about. Takes a generated list id. */
  basket: 'shopping-lists/:generatedListId',
  /**
   * The guest join screen, on a short segment because it is the one path in this
   * app that gets pasted into a group chat and typed by hand.
   *
   * Deliberately **not** under `shopping-lists/`: a stranger holding this link
   * has no shopping lists and is not browsing a section of the app, and the
   * shorter the string the fewer ways it arrives broken.
   */
  join: 's/:secret',
} as const;

/**
 * A router link to one basket, as an array the way `routerLink` wants it.
 *
 * @param mount `APP_BASE_PATH`: `/velista` under the shell, `''` standalone.
 * @param locale the locale currently being rendered, which is the segment
 *   immediately after the mount (plan 0005).
 */
export function basketLink(
  mount: string,
  locale: string,
  generatedListId: string
): unknown[] {
  return [mount || '/', locale, BASKET_PATHS.list, generatedListId];
}

/**
 * The URL an owner copies out of the share sheet, absolute and locale free.
 *
 * **No locale segment, on purpose.** The link goes to somebody whose language
 * this app has no way to know, and `localeGuard` inserts the *recipient's*
 * locale when a URL arrives without one (plan 0005, its "insert a missing one"
 * case). Baking the sender's locale in would open the app in the wrong language
 * for exactly the person it was sent to.
 *
 * @param origin where velista is served from, which is its own domain in the
 *   standalone build and the portfolio's under the shell.
 */
export function shareUrl(origin: string, mount: string, secret: string): string {
  const base = `${origin.replace(/\/$/, '')}${mount}`;
  return `${base}/${BASKET_PATHS.join.replace(':secret', secret)}`;
}

/**
 * The locale to build a link with when nothing better is to hand.
 *
 * Re exported rather than imported twice: a link built with no locale at all
 * would be rewritten by the guard on arrival, which works but costs a
 * redirect on every tap.
 */
export const BASKET_FALLBACK_LOCALE = APP_DEFAULT_LOCALE;
