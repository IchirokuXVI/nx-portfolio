import { appPath, sheetSegments } from '@portfolio/velista/platform';

/**
 * Where a basket and its join screen live in the route table, in one place.
 *
 * Three screens across two plans navigate here — `0045`'s dashboard card, its
 * history rows, and `0044`'s own join screen on the way in — so the segments are
 * constants rather than string literals repeated in each. A route table is the
 * one thing a typo in cannot fail at compile time and will not fail at test time
 * either: a `routerLink` to a path that does not exist simply does nothing when
 * it is tapped.
 *
 * These are **segments and not URLs**. Every path in this app is
 * `/{mount}/{locale}/{rest}` (plan 0001), which `appPath` already assembles, so
 * nothing here reimplements it.
 */
export const BASKET_PATHS = {
  /** The history listing (`0045`), and the prefix the basket sits under. */
  list: 'shopping-lists',
  /** One basket, the screen `0044` is about. Takes a generated list id. */
  basket: 'shopping-lists/:generatedListId',
  /**
   * The guest join screen, on a short segment because it is the one path in this
   * app that gets pasted into a group chat and read aloud.
   *
   * Deliberately **not** under `shopping-lists/`: a stranger holding this link
   * has no shopping lists and is not browsing a section of the app, and every
   * segment is another way for the link to arrive broken.
   */
  join: 's/:secret',
} as const;

/** The path to one basket. `appPath` puts the mount and the locale in front. */
export function basketPath(
  locale: string,
  basePath: string,
  generatedListId: string
): string {
  return appPath(locale, basePath, BASKET_PATHS.list, generatedListId);
}

/**
 * The settle sheet's own URL, which is where the two sheets over it go back to.
 *
 * A line's units sheet (`0055`) and its send sheet (`0056`) are both reached from
 * the settle sheet, so dismissing one of them onto the basket would take the person
 * two screens back from one gesture. They name this instead, in full, for the reason
 * every dismissal in this app names its page in full: a relative climb makes a
 * component's correctness depend on how many segments some other file's path
 * happens to have (plan 0031).
 *
 * The `sheet` marker is stamped by {@link sheetSegments} rather than typed, because
 * a URL written by hand is the one that can quietly opt out of the rule.
 */
export function settleSheetPath(
  locale: string,
  basePath: string,
  generatedListId: string,
  lineId: string
): string {
  return `${basketPath(locale, basePath, generatedListId)}/${sheetSegments(
    'lines',
    lineId,
    'settle'
  ).join('/')}`;
}

/** The path to the join screen for one link secret. */
export function joinPath(
  locale: string,
  basePath: string,
  secret: string
): string {
  return appPath(locale, basePath, 's', secret);
}

/**
 * The URL an owner copies out of the share sheet: absolute, and **locale free**.
 *
 * No locale segment on purpose. The link goes to somebody whose language this app
 * has no way to know, and `localeGuard` inserts the *recipient's* locale when a
 * URL arrives without one (plan 0005, its "insert a missing one" case). Baking
 * the sender's in would open the app in the wrong language for exactly the person
 * it was sent to, which is the one reader whose experience this screen exists to
 * protect.
 *
 * @param origin where velista is served from: its own domain in the standalone
 *   build, the portfolio's under the shell.
 * @param basePath the mount, `''` standalone and `/velista` under the shell.
 */
export function shareUrl(
  origin: string,
  basePath: string,
  secret: string
): string {
  const base = `${origin.replace(/\/$/, '')}${basePath}`;
  return `${base}/s/${encodeURIComponent(secret)}`;
}
