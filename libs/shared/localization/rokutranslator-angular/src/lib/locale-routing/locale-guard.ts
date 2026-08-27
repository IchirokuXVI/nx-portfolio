import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { isLocaleSegment } from './is-locale-segment';
import { resolveGuessLocale } from './resolve-locale';

/** Storage key for the app at the site root (mapped from the empty path). */
const ROOT_APP_KEY = 'landingV2';

function appKeyForPath(firstSegment: string | undefined): string {
  return firstSegment ? firstSegment : ROOT_APP_KEY;
}

/**
 * Guard on the locale (`:locale`) route. If the first URL segment is a
 * well-formed locale, activation proceeds and each app's
 * {@link localeCorrectionGuard} then validates that value against its own
 * locales. Otherwise the URL carries no locale (an app path such as
 * `damoclesSword`, or the bare root): redirect to `/{guess}/{path}` with a
 * best-guess locale (the target app's last-used locale, else the browser
 * locale, else a default), preserving query and fragment. The target app's
 * correction guard then validates the guess once it loads.
 */
export const localeGuard: CanActivateFn = (_route, state): true | UrlTree => {
  const router = inject(Router);

  const tree = router.parseUrl(state.url);
  const primary = tree.root.children['primary'];
  const segments = primary ? primary.segments.map((s) => s.path) : [];
  const first = segments[0];

  if (first && isLocaleSegment(first)) {
    return true;
  }

  const guess = resolveGuessLocale(appKeyForPath(first));

  const redirect = router.createUrlTree(['/', guess, ...segments]);
  redirect.queryParams = tree.queryParams;
  redirect.fragment = tree.fragment;

  return redirect;
};
