import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { ROKU_TRANSLATOR } from '../roku-translator-token';
import { writeAppLocale } from './app-locale-storage';
import { APP_MOUNT_PATH } from './app-mount-path';
import { isLocaleSegment } from './is-locale-segment';
import { LocaleRouteData } from './locale-route-data';
import { resolveLocaleSegments } from './locale-segment';
import { resolveGuessLocale } from './resolve-locale';

/** Storage key for the app at the site root (mapped from the empty path). */
const ROOT_APP_KEY = 'landingV2';

/**
 * The one locale guard (plan 0005 D6). Every app installs it on its own parent
 * route, configured from route `data` (`appKey`, `supportedLocales`,
 * `defaultLocale`) plus the mount the app already holds as `APP_MOUNT_PATH`, and it
 * establishes one invariant before anything below that route renders:
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
  const fallbackMount = inject(APP_MOUNT_PATH);
  const data = readLocaleRouteData(route);

  if (!data.supportedLocales || !data.appKey) {
    return shellPreloadGuard(router, state);
  }

  const tree = router.parseUrl(state.url);
  const primary = tree.root.children['primary'];
  const segments = primary ? primary.segments : [];

  const resolved = resolveLocaleSegments({
    segments: segments.map((segment) => segment.path),
    mountPath: data.mountPath ?? fallbackMount,
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
 * Collect the guard's configuration from anywhere along the activated route chain,
 * deepest definition winning.
 *
 * Split across two routes on purpose, and the split follows ownership. The app's
 * entry route knows **where the app is mounted**, because that is the difference
 * between running as a remote of the shell and running standalone. The feature
 * library's route table knows the app's **locales**, because those come from the same
 * consts it passes to `provideRokuTranslator`. Neither knows the other's half.
 *
 * Read from route `data` rather than from DI, which is where `mountPath` started and
 * why this function exists. `Route.providers` on the entry route are not reliably
 * visible to a guard on a route below it: guards resolve against the closest
 * environment injector Angular has *created* by the preactivation phase, and the entry
 * route's is not always one of them, so `inject(APP_MOUNT_PATH)` quietly returned its
 * root default of `''`. The symptom was the shell inserting a second locale ahead of
 * the mount, `/odontogram/en` becoming `/en/odontogram/en`, which looks like a routing
 * bug and is a DI timing one. Route `data` is resolved during recognition and has no
 * such question. `APP_MOUNT_PATH` remains the fallback and is what the locale switcher
 * reads, since a component injector has no such timing problem.
 */
function readLocaleRouteData(
  route: ActivatedRouteSnapshot
): Partial<LocaleRouteData> {
  const merged: Partial<LocaleRouteData> = {};

  for (const ancestor of route.pathFromRoot) {
    const data = ancestor.data as Partial<LocaleRouteData>;

    if (data.appKey !== undefined) {
      merged.appKey = data.appKey;
    }
    if (data.supportedLocales !== undefined) {
      merged.supportedLocales = data.supportedLocales;
    }
    if (data.defaultLocale !== undefined) {
      merged.defaultLocale = data.defaultLocale;
    }
    if (data.mountPath !== undefined) {
      merged.mountPath = data.mountPath;
    }
  }

  return merged;
}

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
