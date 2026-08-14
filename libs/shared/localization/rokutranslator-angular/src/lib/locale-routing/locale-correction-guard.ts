import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { writeAppLocale } from './app-locale-storage';
import { LocaleRouteData } from './locale-route-data';
import { resolveDesiredLocale } from './resolve-locale';

/** Read the `locale` param from anywhere along the activated route chain. */
function findLocaleParam(route: ActivatedRouteSnapshot): string | null {
  for (const ancestor of route.pathFromRoot) {
    const locale = ancestor.paramMap.get('locale');
    if (locale) {
      return locale;
    }
  }
  return null;
}

/** Replace the leading locale segment of the current URL with `locale`. */
function correctedUrlTree(
  router: Router,
  state: RouterStateSnapshot,
  locale: string
): UrlTree {
  const tree = router.parseUrl(state.url);
  const primary = tree.root.children['primary'];

  if (primary && primary.segments.length > 0) {
    primary.segments[0].path = locale;
  }

  return tree;
}

/**
 * Phase 2: runs during an app's route activation (before its components render).
 * Validates the URL locale against the app's own locales (from route `data`) and
 * corrects it via a `UrlTree` when unsupported. Because nothing has rendered yet,
 * the correction is a router navigation, not a full reload.
 *
 * Backwards compatible: a route that does not declare `supportedLocales` / `appKey`
 * is left untouched.
 */
export const localeCorrectionGuard: CanActivateFn = async (
  route,
  state
): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const data = route.data as Partial<LocaleRouteData>;

  if (!data.supportedLocales || !data.appKey) {
    return true;
  }

  const urlLocale = findLocaleParam(route);
  const desired = resolveDesiredLocale({
    urlLocale,
    appKey: data.appKey,
    supportedLocales: data.supportedLocales,
    defaultLocale: data.defaultLocale,
  });

  await RokuTranslator.changeLocale(desired);
  writeAppLocale(data.appKey, desired);

  const currentUrlLocale = urlLocale
    ? RokuTranslator.formatLocale(urlLocale)
    : '';

  if (desired !== currentUrlLocale) {
    return correctedUrlTree(router, state, desired);
  }

  return true;
};
