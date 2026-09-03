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

/**
 * A `{ en: string[], es: string[] }` column as one line per locale.
 *
 * Product group synonyms are the only such column, and the form edits them as
 * text: a list editor per language is a great deal of screen for a handful of
 * words. The words keep their order and their spelling; only the commas are
 * added.
 */
export function localizedListToText(value: unknown): LocalizedText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const text: Record<string, string> = {};
  for (const [locale, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      text[locale] = entry.filter((one) => typeof one === 'string').join(', ');
    } else if (typeof entry === 'string') {
      text[locale] = entry;
    }
  }

  return text;
}

/**
 * One line per locale, back as the lists the column holds.
 *
 * An empty line is an empty list rather than a list holding one empty string,
 * which is the difference between "this group has no synonyms" and "this group
 * has a synonym that is nothing".
 */
export function localizedTextToList(
  value: unknown,
  locales: readonly string[]
): Readonly<Record<string, readonly string[]>> {
  const text = toLocalizedText(value);
  const lists: Record<string, readonly string[]> = {};

  for (const locale of locales) {
    lists[locale] = (text[locale] ?? '')
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== '');
  }

  return lists;
}

/** One empty string per locale, which is what a create form starts from. */
export function emptyLocalizedText(locales: readonly string[]): LocalizedText {
  return Object.fromEntries(locales.map((locale) => [locale, '']));
}

/** The locales this value is missing, out of the ones it is required to have. */
export function missingLocales(
  value: unknown,
  locales: readonly string[]
): readonly string[] {
  const text = toLocalizedText(value);
  return locales.filter((locale) => (text[locale] ?? '').trim() === '');
}
