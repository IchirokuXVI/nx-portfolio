const KEY_PREFIX = 'roku-locale:';

/** Read the locale last used for a given app, or null if none is stored. */
export function readAppLocale(appKey: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + appKey);
  } catch {
    // localStorage can throw in private mode / restricted contexts.
    return null;
  }
}

/** Persist the locale selected for a given app. */
export function writeAppLocale(appKey: string, locale: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + appKey, locale);
  } catch {
    // Ignore: persistence is best-effort.
  }
}
