import type { GeneratedListSummary } from './generated-list-view';

/**
 * The view models for the shopping list card and the history page (plan 0045).
 *
 * Separate from `generated-list-view.ts`, which holds what a generated list **is**:
 * these are what two particular screens draw. Plan 0004 rule D1 is the reason the split
 * is worth a file, since a container assembles one object shaped like the page rather
 * than handing a component eight inputs shaped like the API. Keeping them apart also
 * means the basket screen (`0044`) and these two can evolve without editing one
 * another's types.
 */

/**
 * The shopping list card on the dashboard (plan 0045, section 3.2).
 *
 * It replaces the resume card, and the replacement is the point rather than a
 * coincidence of layout: "pick up where you left off" answered "what was I doing" with
 * device local guesswork, and this answers it with server truth. Where the resume card
 * had to be talked out of showing a stale list, this one cannot show one, because an
 * `ACTIVE` basket either exists for this account or does not.
 */
export interface ShoppingListCardVm {
  readonly id: string;
  /** Already resolved: a real name, or the localized date form (see {@link displayNames}). */
  readonly name: string;
  readonly generatedAt: Date;
  readonly lineCount: number;
  /**
   * How many lines are **finished**, which is not the same as how many were bought.
   *
   * A `NOT_AVAILABLE` outcome closes a line exactly as a purchase does (backend `0051`
   * section 6), so this number counts both and the listing gives no breakdown between
   * them. That is why the copy beside it says "finished" rather than "got": a summary
   * carrying numbers alone cannot tell "they had none" from "they got it", and the
   * shorter word would be claiming a purchase that may never have happened.
   *
   * The mock's "3 of 4 got, 1 not available" needs the per line `lastOutcome` that
   * `0044`'s basket view carries and this one does not. It belongs on a screen holding
   * the lines, which is the basket, not on a card holding two integers.
   */
  readonly settledLineCount: number;
  /**
   * How many other `ACTIVE` baskets there are besides this one.
   *
   * Zero draws nothing. Above zero it draws the quiet "and N more" line, which is a
   * **separate link** to the history rather than part of the card's own button, so the
   * two destinations are two stops for a screen reader (section 7).
   */
  readonly otherActiveCount: number;
}

/** One row of the history page (plan 0045, section 3.3). */
export interface ShoppingListRowVm {
  readonly id: string;
  /** Already resolved, exactly as the card's is. */
  readonly name: string;
  readonly generatedAt: Date;
  readonly lineCount: number;
  /** Finished rather than bought, for the reason on {@link ShoppingListCardVm}. */
  readonly settledLineCount: number;
  /**
   * Whether this trip is the one being shopped now.
   *
   * Drawn as the word, never as colour alone (section 7). It is `status === 'ACTIVE'`
   * and is derived here so no template re-derives it from an enum.
   */
  readonly active: boolean;
}

/** How the history listing has got on. */
export type ShoppingListsLoad = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * Every state the history page can be in (plan 0045, section 3.3).
 *
 * A discriminated union for `HomeState`'s reason: independent booleans eventually
 * render two states at once.
 */
export type ShoppingListsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'populated';
      readonly rows: readonly ShoppingListRowVm[];
      /** Whether a further page is being fetched, for the row at the bottom. */
      readonly loadingMore: boolean;
    }
  | { readonly kind: 'error'; readonly correlationId: string | null };

// --- The unnamed list's display name ---------------------------------------

/**
 * Resolve every trip's display name in one pass, newest first.
 *
 * **In one pass over the whole set, and that is forced rather than tidy.** A trip with
 * no name shows its generation date, and a second unnamed one *on the same day* gets a
 * number appended (backend `0050` section 1, plan 0045 section 4.1). So the name of one
 * row depends on the other rows, which means it cannot be computed from a row in
 * isolation and cannot live in a pipe.
 *
 * The numbering counts **upwards in time**: the first unnamed trip of a day is bare,
 * the second is "2", the third "3". The input arrives newest first, so the pass runs
 * backwards over it and the labels stay stable as older pages are appended, which they
 * would not if the newest trip were number one.
 *
 * Only unnamed trips take part in the count. Naming one and leaving another bare on the
 * same day gives the bare one no number, because there is nothing for it to be told
 * apart from.
 *
 * @param summaries The trips, newest first, exactly as the listing gives them.
 * @param formatDate Formats a date in the reader's locale. Supplied by the caller so
 *   this stays pure and testable, and so the locale can change under a page that is
 *   already open.
 * @returns The display name per trip id.
 */
export function displayNames(
  summaries: readonly GeneratedListSummary[],
  formatDate: (date: Date) => string
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const seenOnDay = new Map<string, number>();

  // Backwards, so the oldest unnamed trip of a day is the bare one. See above.
  for (let index = summaries.length - 1; index >= 0; index--) {
    const summary = summaries[index];
    if (summary === undefined) {
      continue;
    }

    const typed = summary.name?.trim() ?? '';
    if (typed !== '') {
      names.set(summary.id, typed);
      continue;
    }

    const day = formatDate(summary.generatedAt);
    const ordinal = (seenOnDay.get(day) ?? 0) + 1;
    seenOnDay.set(day, ordinal);

    // The first of the day is the bare date. A number on every one of them would
    // read as a count of something rather than as a way of telling two apart.
    names.set(summary.id, ordinal === 1 ? day : `${day} ${ordinal}`);
  }

  return names;
}

/**
 * The day a basket was generated, in the reader's language.
 *
 * Day and month, matching the mock ("21 August", "24 August"), **plus the year when it
 * is not the current one**. The mock never shows a year because every trip it draws is
 * from the last fortnight, and a history that is kept forever eventually is not: two
 * baskets generated on the same day of the same month a year apart would otherwise be
 * given the same name and then numbered against each other, as though they were two
 * trips on one afternoon.
 *
 * `Intl.DateTimeFormat` rather than a hand written month table, so Spanish gets
 * "21 de agosto" and its own capitalization rather than an English shape with Spanish
 * words in it. **`Intl` and never `DatePipe`**, which is this app's convention rather
 * than a preference here: `DatePipe` needs `registerLocaleData` per locale and a
 * `LOCALE_ID`, and this app never sets one, because its language is runtime state
 * rather than the shell's build-time locale.
 *
 * @param now Passed in rather than read from the clock, so the year rule is testable
 *   without pretending it is a different December.
 */
export function formatGeneratedDate(
  date: Date,
  locale: string,
  now: Date = new Date()
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  } catch {
    // An unrecognised tag, which `Intl` throws a `RangeError` for. The ISO date is ugly
    // and correct, and it matters more here than in a single row: this feeds
    // `displayNames`, so an uncaught throw would take out the whole dashboard card and
    // every row of the history at once rather than spoiling one date.
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Whether a basket was generated today, in the reader's own timezone.
 *
 * The card says "generated today" rather than the date for the ordinary case, which is
 * somebody looking at the trip they are in the middle of. Compared by calendar day and
 * not by elapsed hours: a basket made at eleven last night is not today's, and one made
 * at one this morning is, which is how a person reads it.
 */
export function isSameDay(date: Date, now: Date = new Date()): boolean {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}
