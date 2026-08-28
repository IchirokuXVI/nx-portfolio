import { InjectionToken } from '@angular/core';

/**
 * Where this app is mounted, as a path: `/damoclesSword`, or `''` for the app at the
 * site root and for any app running standalone on its own origin.
 *
 * Under `/{mount}/{locale}/{rest}` the locale is the segment immediately after the
 * mount, so this is what tells `localeGuard` which segment is the locale and
 * `switchAppLocale` which one to rewrite (plan 0005 D7).
 *
 * A token rather than a constant in each app's route table, because the mount is
 * exactly the value that differs between an app running under the shell and the same
 * app running on its own origin, and that difference is a composition decision.
 * velista already held it as `APP_BASE_PATH`, and binds this one to it rather than
 * writing `/velista` down twice.
 *
 * Defaults to `''`, which is both the site root app's real value and the right answer
 * for anything that has not been told otherwise, since that is the shape every URL had
 * before this plan.
 */
export const APP_MOUNT_PATH = new InjectionToken<string>('APP_MOUNT_PATH', {
  providedIn: 'root',
  factory: () => '',
});
