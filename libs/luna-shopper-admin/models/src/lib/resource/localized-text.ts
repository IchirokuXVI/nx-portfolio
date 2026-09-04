/**
 * A `jsonb` column holding one string per locale (plan 0004, section 2).
 *
 * Every name and label on supermarkets, items, locations and price scopes is
 * one of these, so the generic form renders one input per locale from the
 * start. Retrofitting that when the first Spanish name is needed would mean
 * touching every screen at once.
 *
 * Indexed by locale rather than typed as `{ en: string; es: string }`, which is
 * what the wire types say. The wire is right about what the server stores
 * today; this is the shape the form edits, and a third locale has to be a value
 * the form can hold before it can be a column the server accepts.
 */
export type LocalizedText = Readonly<Record<string, string>>;

/**
 * The locales the **content** is written in, which is not the same list as the
 * locales the **interface** is written in.
 *
 * `APP_AVAILABLE_LOCALES` is one entry long, because the operator reads English.
 * The catalog is read by shoppers, so its names exist in both languages and the
 * form has to be able to edit both regardless of what language its own labels
 * are in. Conflating the two would make the Spanish name uneditable until
 * somebody translated the admin interface.
 */
export const CONTENT_LOCALES: readonly string[] = ['en', 'es'];

/** Whatever came off the wire, as a {@link LocalizedText}. */
export function toLocalizedText(value: unknown): LocalizedText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const text: Record<string, string> = {};
  for (const [locale, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      text[locale] = entry;
    }
  }

  return text;
}

/**
 * The one string to show, given the locales to prefer.
 *
 * Falls through the preferred locales in order and then takes whatever else is
 * there, because a name in the wrong language reads better in a table than a
 * blank cell does. Empty only when the value carries no string at all.
 */
export function localizedTextValue(
  value: unknown,
  locales: readonly string[]
): string {
  const text = toLocalizedText(value);

  for (const locale of locales) {
    const entry = text[locale];
    if (entry !== undefined && entry.trim() !== '') {
      return entry;
    }
  }

  return Object.values(text).find((entry) => entry.trim() !== '') ?? '';
}

/** One empty string per locale, which is what a create form starts from. */
export function emptyLocalizedText(locales: readonly string[]): LocalizedText {
  return Object.fromEntries(locales.map((locale) => [locale, '']));
}

/**
 * A `jsonb` column holding one **list** of strings per locale, as the text the
 * form edits: one entry per line.
 *
 * `ProductGroup.synonyms` is the one column shaped this way. A line break is
 * the separator because it is the one character a synonym cannot contain.
 */
export function toLocalizedLines(
  value: unknown,
  locales: readonly string[]
): LocalizedText {
  const source =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const text: Record<string, string> = {};
  for (const locale of locales) {
    const entries = source[locale];
    text[locale] = Array.isArray(entries)
      ? entries.filter((entry) => typeof entry === 'string').join('\n')
      : '';
  }

  return text;
}

/**
 * The lines an operator typed, back as one array of entries per locale.
 *
 * Blank lines are dropped and entries are trimmed, so a trailing newline is not
 * a synonym that matches nothing. Every locale is present even when empty,
 * because the column is one object and a partial one would erase the other
 * language.
 */
export function fromLocalizedLines(
  value: unknown,
  locales: readonly string[]
): Readonly<Record<string, readonly string[]>> {
  const text = toLocalizedText(value);

  return Object.fromEntries(
    locales.map((locale) => [
      locale,
      (text[locale] ?? '')
        .split('\n')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    ])
  );
}

/** The locales this value is missing, out of the ones it is required to have. */
export function missingLocales(
  value: unknown,
  locales: readonly string[]
): readonly string[] {
  const text = toLocalizedText(value);
  return locales.filter((locale) => (text[locale] ?? '').trim() === '');
}
