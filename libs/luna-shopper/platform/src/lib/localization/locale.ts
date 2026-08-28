/**
 * Request locale resolution (plan 0004, section 12).
 *
 * The backend is multilingual by requirement, not just the frontend. A request's
 * locale is resolved from, in order of preference: an explicit locale (a query
 * param or the versioned path segment the frontend already uses), the
 * `Accept-Language` header, the user's stored preference when known, and finally
 * a default of English. Only the language subtag is kept (`es-419` -> `es`), and
 * anything outside the supported set falls through to the next source.
 */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Narrows an arbitrary string to a supported locale, or `undefined`. */
export function toSupportedLocale(
  value: string | null | undefined
): SupportedLocale | undefined {
  if (!value) {
    return undefined;
  }
  // Keep only the primary language subtag, lower cased: `ES-419` -> `es`.
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(language)
    ? (language as SupportedLocale)
    : undefined;
}

/**
 * Parses an `Accept-Language` header and returns the first supported locale,
 * honouring the `q` weighting so `es;q=0.9, en;q=0.8` prefers Spanish.
 */
export function localeFromAcceptLanguage(
  header: string | null | undefined
): SupportedLocale | undefined {
  if (!header) {
    return undefined;
  }

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const quality = qParam ? Number(qParam.split('=')[1]) : 1;
      return { tag, quality: Number.isNaN(quality) ? 0 : quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const locale = toSupportedLocale(tag);
    if (locale) {
      return locale;
    }
  }
  return undefined;
}

/**
 * Resolves the effective request locale from the ordered candidate sources.
 * The first source that yields a supported locale wins; everything falls back to
 * {@link DEFAULT_LOCALE}. Sources are evaluated lazily so a costly lookup (the
 * stored user preference) only runs when the cheaper ones miss.
 */
export function resolveLocale(sources: {
  explicit?: string | null;
  acceptLanguage?: string | null;
  storedPreference?: string | null;
}): SupportedLocale {
  return (
    toSupportedLocale(sources.explicit) ??
    localeFromAcceptLanguage(sources.acceptLanguage) ??
    toSupportedLocale(sources.storedPreference) ??
    DEFAULT_LOCALE
  );
}
