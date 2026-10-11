import type { SettlementRowVm } from './line-detail-view';

/**
 * The buy history of a line, on its own page (velista `0135`, section 5).
 *
 * It was two cards on the line page that grew page by page and took most of its
 * height. A row there said who, how many, the price and the date. It did not say
 * which product was bought, though the settlement holds it.
 */

/** One purchase or one "found none", as a row of a month. */
export interface LineHistoryRowVm extends SettlementRowVm {
  /** The day of the month, as the reader's language writes it. */
  readonly day: string;
  /**
   * The product that was bought, "name · brand", or null for a row with no
   * product: a line of free text, a product the catalog no longer names, and
   * every row that is not a purchase.
   */
  readonly product: string | null;
}

/** One month of the history, newest first inside it. */
export interface LineHistoryMonthVm {
  /** `2026-09`, for the template's `track`. */
  readonly key: string;
  /** The month in the reader's language, with the year when it is not this year. */
  readonly label: string;
  readonly rows: readonly LineHistoryRowVm[];
}

/**
 * The rows of a history under their months, newest month first.
 *
 * The rows arrive newest first and stay in that order. A month is the reader's
 * calendar month, taken from the instant in the time zone of the device, because
 * "September" is where the reader's own calendar put the purchase.
 *
 * `Intl` and never `DatePipe`: the language is runtime state.
 */
export function groupHistoryByMonth(
  rows: readonly LineHistoryRowVm[],
  locale: string,
  now: Date
): readonly LineHistoryMonthVm[] {
  const months: { key: string; label: string; rows: LineHistoryRowVm[] }[] =
    [];

  for (const row of rows) {
    const key = `${row.at.getFullYear()}-${String(row.at.getMonth() + 1).padStart(2, '0')}`;
    const last = months[months.length - 1];
    if (last !== undefined && last.key === key) {
      last.rows.push(row);
      continue;
    }
    months.push({ key, label: monthLabel(row.at, locale, now), rows: [row] });
  }

  return months;
}

/**
 * "September", or "September 2025" for a month of another year, as a heading.
 * Spanish writes a month in lower case, and a heading starts with a capital.
 */
export function monthLabel(at: Date, locale: string, now: Date): string {
  const text = monthName(at, locale, now);
  let first = text.charAt(0);
  try {
    first = first.toLocaleUpperCase(locale);
  } catch {
    // A tag `Intl` refuses. The fallback of `monthName` starts with a digit.
    first = first.toUpperCase();
  }
  return first + text.slice(1);
}

/**
 * The same month as the language writes it inside a sentence: "since October",
 * "desde octubre".
 */
export function monthName(at: Date, locale: string, now: Date): string {
  const sameYear = at.getFullYear() === now.getFullYear();
  try {
    return new Intl.DateTimeFormat(
      locale,
      sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }
    ).format(at);
  } catch {
    return at.toISOString().slice(0, 7);
  }
}

/** The day of the month, "28", in the digits of the reader's language. */
export function dayOfMonth(at: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(at);
  } catch {
    return String(at.getDate());
  }
}

/** The three figures over the months (section 5). Each is null when it cannot be said. */
export interface LineHistoryFactsVm {
  /** How many purchases. `more` is true when older pages were not read yet. */
  readonly times: { readonly count: number; readonly more: boolean } | null;
  /** The month of the oldest purchase, known only once every page is read. */
  readonly since: string | null;
  /** The median days between purchases, or null under three of them. */
  readonly everyDays: { readonly days: number; readonly rough: boolean } | null;
  /** What one cost at the newest purchase that has a price, formatted. */
  readonly lastPaid: string | null;
}
