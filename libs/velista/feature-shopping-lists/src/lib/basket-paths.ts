import {
  shareUrl as absoluteShareUrl,
  appPath,
  sheetSegments,
} from '@portfolio/velista/platform';

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
  basket: 'shopping-lists/:basketId',
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
  basketId: string
): string {
  return appPath(locale, basePath, BASKET_PATHS.list, basketId);
}

/**
 * The settle sheet's own URL, addressed by the **row key** (velista `0090`).
 *
 * Every caller that opens the sheet goes through it, and so does the sheet itself
 * when its row is re-keyed underneath it: a row's key is its anchor's line id, and
 * the anchor moves when a rename merges two rows or the anchor is bought to zero.
 * One function means the replacement URL and the opening URL cannot differ.
 *
 * The `sheet` marker is stamped by {@link sheetSegments} rather than typed, because
 * a URL written by hand is the one that can quietly opt out of the rule.
 */
export function settleSheetPath(
  locale: string,
  basePath: string,
  basketId: string,
  rowKey: string
): string {
  return `${basketPath(locale, basePath, basketId)}/${sheetSegments(
    'rows',
    rowKey,
    'settle'
  ).join('/')}`;
}

/**
 * The filter sheet's own URL, which the shop picker returns to (velista `0078`).
 *
 * The picker is pushed over this sheet and pops back onto it, so one back gesture
 * from the picker lands on the filter sheet exactly once (`0031`); this URL is the
 * picker's fallback for a cold load on its own address. Both name the other in full,
 * for the reason every dismissal in this app names its page in full.
 */
export function filterSheetPath(
  locale: string,
  basePath: string,
  basketId: string
): string {
  return `${basketPath(locale, basePath, basketId)}/${sheetSegments(
    'filter'
  ).join('/')}`;
}

/** The shop picker's URL, a sheet of its own under the filter sheet's address. */
export function shopPickerPath(
  locale: string,
  basePath: string,
  basketId: string
): string {
  return `${basketPath(locale, basePath, basketId)}/${sheetSegments(
    'filter',
    'shop'
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
 * The locale free part is the whole of `shareUrl` in `platform`, which every shared
 * link in this app now goes through; this only names the segments. It stays a
 * function of its own so the join screen's address is written down once, beside the
 * route that serves it.
 *
 * @param origin where velista is served from: its own domain in the standalone
 *   build, the portfolio's under the shell.
 * @param basePath the mount, `''` standalone and `/velista` under the shell.
 */
export function basketShareUrl(
  origin: string,
  basePath: string,
  secret: string
): string {
  return absoluteShareUrl(origin, basePath, 's', secret);
}
