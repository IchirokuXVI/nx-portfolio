/** A well-formed locale: two-letter language, optional region (e.g. `en`, `en-US`). */
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/i;

/** Whether a URL segment looks like a locale (rather than an app path). */
export function isLocaleSegment(path: string): boolean {
  return LOCALE_RE.test(path);
}
