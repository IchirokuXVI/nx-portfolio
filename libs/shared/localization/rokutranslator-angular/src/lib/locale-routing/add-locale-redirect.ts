import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { resolveGuessLocale } from './resolve-locale';

/** Storage key for the root landing app (mapped from the empty path). */
const ROOT_APP_KEY = 'landing';

function appKeyForPath(firstSegment: string | undefined): string {
  return firstSegment ? firstSegment : ROOT_APP_KEY;
}

/**
 * Phase 1: a URL reached this route because its first segment is not a locale
 * (a locale-less app path, or the bare root). Redirect to `/{guess}/{path}` with
 * a best-guess locale (the target app's last-used locale, else the browser
 * locale, else a default), preserving the remaining segments, query, and
 * fragment. The app's own {@link localeCorrectionGuard} validates the guess once
 * it loads.
 */
export const addLocaleRedirect: CanActivateFn = (_route, state): UrlTree => {
  const router = inject(Router);

  const tree = router.parseUrl(state.url);
  const primary = tree.root.children['primary'];
  const segments = primary ? primary.segments.map((s) => s.path) : [];

  const guess = resolveGuessLocale(appKeyForPath(segments[0]));

  const redirect = router.createUrlTree(['/', guess, ...segments]);
  redirect.queryParams = tree.queryParams;
  redirect.fragment = tree.fragment;

  return redirect;
};
