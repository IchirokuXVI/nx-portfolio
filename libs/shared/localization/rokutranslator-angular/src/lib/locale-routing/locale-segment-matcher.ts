import { UrlMatcher, UrlMatchResult, UrlSegment } from '@angular/router';

/** A well-formed locale: two-letter language, optional region (e.g. `en`, `en-US`). */
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/i;

export function isLocaleSegment(path: string): boolean {
  return LOCALE_RE.test(path);
}

/**
 * `UrlMatcher` that matches only when the first URL segment is a well-formed
 * locale, consuming it and exposing it as the `locale` route param (the same
 * role the old `:locale` path had, but conditional). When the first segment is
 * not a locale (an app path such as `damoclesSword`, or an empty root), it
 * returns null so a lower-priority redirect route can add the locale.
 */
export const localeSegmentMatcher: UrlMatcher = (
  segments: UrlSegment[]
): UrlMatchResult | null => {
  const first = segments[0];

  if (!first || !isLocaleSegment(first.path)) {
    return null;
  }

  return {
    consumed: [first],
    posParams: { locale: first },
  };
};
