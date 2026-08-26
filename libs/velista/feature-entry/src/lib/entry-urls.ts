/**
 * Where a sheet goes when it closes, and where a way in ends.
 *
 * Both are absolute URLs built from the two things that vary, rather than relative
 * navigations. A relative navigation would have to know how many empty path routes sit
 * between the sheet and the app's mount, which is a fact about the route table that
 * would break silently the first time one was added. The locale segment belongs to the
 * shell and the mount is `/velista` today and `''` after extraction (extraction
 * contract item 5), so neither may be written down anywhere: they are read from
 * `RokuLocaleStore` and `APP_BASE_PATH` and passed in here.
 *
 * `zones` rather than the word the interface uses, per rule N2 (plan 0001): the
 * translation layer renames the word, the URLs never do.
 */
export function appPath(
  locale: string,
  basePath: string,
  ...segments: readonly string[]
): string {
  const mount = basePath.split('/').filter((segment) => segment !== '');
  return ['', locale, ...mount, ...segments].join('/');
}

/** The two pages a sheet can be dismissed back onto, as a route table can say it. */
export type EntryReturnTo = 'landing' | 'home';

/**
 * The page under a sheet, named by the route rather than worked out from the URL.
 *
 * Both sheets exist twice over, once above the front door and once above the
 * dashboard, and after dismissal the person belongs back on whichever they came from.
 * Reading it from route data makes that a declaration in one table instead of string
 * surgery on a URL, and it is also correct for a deep link, where there is no history
 * entry to go back to.
 */
export function returnPath(
  returnTo: EntryReturnTo,
  locale: string,
  basePath: string
): string {
  return returnTo === 'home'
    ? appPath(locale, basePath, 'home')
    : appPath(locale, basePath);
}
