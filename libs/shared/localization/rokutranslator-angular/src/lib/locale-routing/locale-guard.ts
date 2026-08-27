import { inject } from '@angular/core';
import {
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { ROKU_TRANSLATOR } from '../roku-translator-token';
import { writeAppLocale } from './app-locale-storage';
import { isLocaleSegment } from './is-locale-segment';
import { LocaleRouteData } from './locale-route-data';
import { resolveLocaleSegments } from './locale-segment';
import { resolveGuessLocale } from './resolve-locale';

/** Storage key for the app at the site root (mapped from the empty path). */
const ROOT_APP_KEY = 'landingV2';

/**
 * The one locale guard (plan 0005 D6). Every app installs it on its own parent
 * route, configured entirely from route `data`, and it establishes one invariant
 * before anything below that route renders:
 *
 * **the segment immediately after the app's mount is a supported, canonical locale.**
 *
 * It has to hold *before* rendering rather than during, because the app's 404 page
 * is localized too: there is no page an app can show, not even a failure, until it
 * knows what language to show it in. So this guard never declines a URL and never
 * routes to a not found page of its own. It settles a locale and hands the rest of
 * the path to normal routing, which is free to 404 afterwards, in a language the
 * visitor can read.
 *
 * The four cases and their worked examples live in `resolveLocaleSegments`, which is
 * pure and carries the tests. All this adds is the two effects: adopt the locale on
 * the app's translator, and persist it.
 *
 * It replaces the pair this workspace used to have, `localeGuard` on the shell's
 * `:locale` route (which *inserted* a locale into a path that had none) and
 * `localeCorrectionGuard` on each app's route (which *replaced* one the app did not
 * support). Under app owned routing every app needs both behaviours at its own
 * mount, so two guards meant every app wiring up two.
 */
export const localeGuard: CanActivateFn = async (
  route,
  state
): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const data = route.data as Partial<LocaleRouteData>;

  if (!data.supportedLocales || !data.appKey) {
    return shellPreloadGuard(router, state);
  }

  const tree = router.parseUrl(state.url);
  const primary = tree.root.children['primary'];
  const segments = primary ? primary.segments : [];

  const resolved = resolveLocaleSegments({
    segments: segments.map((segment) => segment.path),
    mountPath: data.mountPath ?? '',
    appKey: data.appKey,
    supportedLocales: data.supportedLocales,
    defaultLocale: data.defaultLocale,
  });

  await inject(ROKU_TRANSLATOR).changeLocale(resolved.locale);
  writeAppLocale(data.appKey, resolved.locale);

  if (!resolved.changed) {
    return true;
  }

  if (!primary) {
    // The bare root, so there is no primary group to edit: this is landingV2's
    // insert case, `/` becoming `/{locale}`.
    const redirect = router.createUrlTree(['/', ...resolved.segments]);
    redirect.queryParams = tree.queryParams;
    redirect.fragment = tree.fragment;
    return redirect;
  }

  // Rebuild the primary segments in place rather than through `createUrlTree`, so
  // matrix parameters on the segments that survive, and any secondary outlet
  // hanging off this group, are carried across untouched. Reused by consuming the
  // map, so a path that legitimately repeats does not end up as the same
  // `UrlSegment` object twice.
  const spare = new Map(segments.map((segment) => [segment.path, segment]));

  primary.segments = resolved.segments.map((path) => {
    const existing = spare.get(path);

    if (existing) {
      spare.delete(path);
      return existing;
    }

    return new UrlSegment(path, {});
  });

  return tree;
};

/**
 * **Transitional, deleted with the shell's `:locale` route** (plan 0003, step 6).
 *
 * The shell still owns a locale first route for apps that have not migrated yet, and
 * it installs this guard with no `data` at all: it cannot know any app's locales
 * before that app's bundle has loaded. All it can do is make sure *some* locale is
 * in the path, and let the app's own guard correct it once the app is there.
 *
 * Once every app owns its locale segment, nothing installs this guard without data
 * and this branch goes with the route that needed it.
 */
function shellPreloadGuard(
  router: Router,
  state: RouterStateSnapshot
): true | UrlTree {
  const tree = router.parseUrl(state.url);
  const primary = tree.root.children['primary'];
  const segments = primary ? primary.segments.map((s) => s.path) : [];
  const first = segments[0];

  if (first && isLocaleSegment(first)) {
    return true;
  }

  const guess = resolveGuessLocale(first ? first : ROOT_APP_KEY);

  const redirect = router.createUrlTree(['/', guess, ...segments]);
  redirect.queryParams = tree.queryParams;
  redirect.fragment = tree.fragment;

  return redirect;
}
