/**
 * An absolute URL inside this app, built from the two things that vary.
 *
 * A relative navigation would have to know how many empty path routes sit between the
 * caller and the app's mount, which is a fact about the route table that breaks
 * silently the first time one is added. The locale belongs to this app now (plan 0003)
 * and the mount is `/velista` today and `''` after extraction (extraction contract,
 * item 5), so neither may be written down anywhere: both are passed in, read from
 * `RokuLocaleStore` and `APP_BASE_PATH` by whoever is navigating.
 *
 * It lives in `platform` rather than beside the pages that use it because two feature
 * libraries now navigate: `feature-entry` (plan 0008) and `feature-auth` (plan 0009).
 * Importing it from one feature library into the other would couple two siblings and,
 * worse, pull the first one's barrel into the second one's lazy chunk. It reaches for
 * nothing, so this is the lowest place it can sit.
 *
 * `zones` and not the word the interface uses, per rule N2 (plan 0001): the
 * translation layer renames the word, the URLs never do.
 */
export function appPath(
  locale: string,
  basePath: string,
  ...segments: readonly string[]
): string {
  const mount = basePath.split('/').filter((segment) => segment !== '');

  // `/{mount}/{locale}/{rest}`. It used to be `/{locale}/{mount}/{rest}`, back when
  // the shell owned a locale first route on every app's behalf (plan 0003). In the
  // standalone build the mount is `''`, so the result is `/{locale}/...` under both
  // shapes and nothing about this function's contract changed there.
  return ['', ...mount, locale, ...segments].join('/');
}
