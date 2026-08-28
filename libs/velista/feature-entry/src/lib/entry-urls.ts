import { appPath } from '@portfolio/velista/platform';

/**
 * Where a sheet goes when it closes.
 *
 * `appPath` used to live here. It moved to `@portfolio/velista/platform` when plan
 * 0009 added a second feature library that navigates: it is the same function for
 * both, and a feature library reaching into a sibling's barrel to get it would couple
 * the two and pull this one's sheets into the other one's lazy chunk.
 *
 * `zones` rather than the word the interface uses, per rule N2 (plan 0001): the
 * translation layer renames the word, the URLs never do.
 */

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
