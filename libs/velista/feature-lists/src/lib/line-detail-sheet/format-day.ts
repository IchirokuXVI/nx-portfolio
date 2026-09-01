/**
 * A date, in the reader's language.
 *
 * `Intl` rather than Angular's `DatePipe`, which is `CommentRow`'s reason and this
 * library's convention: the pipe needs `registerLocaleData` per locale and a
 * `LOCALE_ID` this app does not set, because the language is the app's own runtime
 * state rather than the shell's build time locale. `Intl` reads the tag it is handed,
 * which is exactly the tag `RokuLocaleStore` is holding.
 *
 * A **date** and not a time, unlike the comment timestamps beside it, and the
 * difference is the subject: a history says which day the household bought something,
 * and the hour is noise nobody reading their own consumption has ever wanted.
 */
export function formatDay(at: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
  } catch {
    // An unrecognised tag, which `Intl` throws a `RangeError` for. The ISO date is ugly
    // and correct, and a history row with no date at all would be worse.
    return at.toISOString().slice(0, 10);
  }
}
