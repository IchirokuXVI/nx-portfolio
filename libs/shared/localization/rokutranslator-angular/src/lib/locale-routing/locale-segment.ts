import { canonicalLocale } from '@portfolio/localization/rokutranslator';
import { isLocaleSegment } from './is-locale-segment';
import { resolveDesiredLocale } from './resolve-locale';

/**
 * How many path segments an app's mount contributes: `''` is 0, `/velista` is 1.
 *
 * The locale sits immediately after the mount (`/{mount}/{locale}/{rest}`), so this
 * is also the index of the locale segment. Deriving it from the mount rather than
 * writing an integer down keeps the "how many empty path routes are above me"
 * question out of every call site, which is the same reasoning `appPath` in
 * `libs/velista/platform` already records.
 */
export function mountDepth(mountPath: string): number {
  return mountPath.split('/').filter((segment) => segment !== '').length;
}

/** The segment occupying the locale slot, or `undefined` when the path ends at the mount. */
export function localeSegmentOf(
  segments: readonly string[],
  mountPath: string
): string | undefined {
  return segments[mountDepth(mountPath)];
}

/** Which of the four cases in plan 0005 D6 a path fell into. */
export type LocaleSegmentCase =
  'supported' | 'non-canonical' | 'unsupported' | 'insert';

export interface ResolvedLocaleSegments {
  /** The locale the app should adopt. Always supported and always canonical. */
  locale: string;
  /** The path the app should be on, as plain segment strings. */
  segments: string[];
  /** Whether that differs from the path that came in. */
  changed: boolean;
  case: LocaleSegmentCase;
}

/**
 * The whole of the guard contract (plan 0005 D6), as a pure function so each of its
 * four cases and every worked example can be a test rather than a browser session.
 *
 * The invariant it establishes: **the segment immediately after the mount is a
 * supported, canonical locale.** It never rejects a path and never routes anywhere
 * else, because an app's own 404 page is localized and cannot be drawn until the
 * language is known. Whatever follows the locale is handed back untouched, for
 * ordinary routing to match or to 404 on.
 *
 * The asymmetry between the last two cases is the part worth reading twice. A
 * locale shaped segment is **consumed**, because it was occupying the locale slot
 * and a supported locale now takes that slot: `/velista/zz/qwfp` becomes
 * `/velista/es/qwfp`. A segment that is not locale shaped was never in that slot, so
 * the locale is inserted **in front of it** and it keeps its place:
 * `/velista/qwfp` becomes `/velista/es/qwfp`. `zz` and `de` disappear; `home` and
 * `qwfp` survive and are routed to.
 */
export function resolveLocaleSegments(params: {
  segments: readonly string[];
  mountPath: string;
  appKey: string;
  supportedLocales: readonly string[];
  defaultLocale?: string;
}): ResolvedLocaleSegments {
  const index = mountDepth(params.mountPath);
  const before = params.segments.slice(0, index);
  const found = params.segments[index];
  const after = params.segments.slice(index + 1);

  const supported = params.supportedLocales.map(canonicalLocale);

  if (found !== undefined && isLocaleSegment(found)) {
    const canonical = canonicalLocale(found);

    if (supported.includes(canonical)) {
      // A supported URL locale outranks the stored preference and replaces it: a
      // link someone followed is a stronger signal than what they last picked.
      // Non canonical (`en-US`) is still supported, and is rewritten to `en`.
      //
      // The comparison is against the **raw** segment on purpose. The guard this
      // replaces compared the already formatted locale, so `en-US` and `en` looked
      // equal and the URL kept its region forever.
      return {
        locale: canonical,
        segments: [...before, canonical, ...after],
        changed: found !== canonical,
        case: found === canonical ? 'supported' : 'non-canonical',
      };
    }

    // Locale shaped but not one this app has (`zz`, or `de` on an en/es app).
    // Replaced, not preserved: it was in the locale slot and is not a locale here.
    const replacement = resolve(params);

    return {
      locale: replacement,
      segments: [...before, replacement, ...after],
      changed: true,
      case: 'unsupported',
    };
  }

  // Absent, or a real path segment (`home`, `qwfp`). Insert in front of it.
  const locale = resolve(params);
  const tail = found === undefined ? after : [found, ...after];

  return {
    locale,
    segments: [...before, locale, ...tail],
    changed: true,
    case: 'insert',
  };
}

/**
 * The app's last used locale, then the browser locale, then its default. Unchanged
 * from plan 0002 D5; `urlLocale` is null because every caller here has already
 * established that the URL has nothing usable to offer.
 */
function resolve(params: {
  appKey: string;
  supportedLocales: readonly string[];
  defaultLocale?: string;
}): string {
  return resolveDesiredLocale({
    urlLocale: null,
    appKey: params.appKey,
    supportedLocales: params.supportedLocales,
    defaultLocale: params.defaultLocale,
  });
}
