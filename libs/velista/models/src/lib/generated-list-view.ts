import type { GeneratedListStatus } from './enums';

/**
 * A generated shopping list: the basket somebody carries around the shop (plan 0045;
 * backend plans 0050 and 0051).
 *
 * **Called generated, never shopping list, inside the code.** `ShoppingList` in this
 * library is already a *zone* list, which is the thing a household writes into over a
 * week, and the two are not the same object at all: a zone list is a standing
 * collection people edit, a generated list is one trip composed from several of them
 * and finished. The interface calls this one "your shopping list" because that is what
 * a person carrying it calls it, and rule N2 is exactly this: the translation layer
 * renames the word, the code never does.
 *
 * Rule D4 applies as everywhere: these are **our** types, mapped from `unknown`, so a
 * backend rename breaks one mapper rather than a page.
 */

/**
 * One trip in the history listing (backend `0050` section 7's summary view).
 *
 * The summary and not the basket: the listing draws a name, a date and two numbers, and
 * loading every line of every trip to render them is the read that would eventually
 * need fixing. The lines belong to the basket screen (`0044`), which asks for one.
 *
 * `name` is nullable and **null is not missing**. An unnamed trip displays as its
 * generation date, localized by this client, with a number appended when it is not the
 * first that day (backend `0050` section 1). The server cannot store that default: it
 * does not know the reader's language, and a stored English date in a Spanish account
 * would be wrong forever. {@link displayNames} is where it is built.
 */
export interface GeneratedListSummary {
  readonly id: string;
  readonly name: string | null;
  readonly status: GeneratedListStatus;
  /** When the run composed it. The history is ordered by this, newest first. */
  readonly generatedAt: Date;
  readonly lineCount: number;
  /**
   * How many lines are **finished**, which merges two different outcomes.
   *
   * Kept beside the breakdown rather than replaced by it, and it is not the sum of the
   * two below: a line settled partly is neither bought nor unavailable yet, and a
   * server that later counts a third outcome would still count it here. The screens
   * draw the breakdown and fall back to this, which is what makes the fallback honest
   * rather than arithmetic.
   */
  readonly settledLineCount: number;
  /**
   * How many finished lines somebody actually came home with (backend `0053`,
   * section 2).
   *
   * This is what "3 of 4 got" is counted from, and velista `0045` could not say it:
   * `NOT_AVAILABLE` closes a line exactly as a purchase does, so a summary carrying
   * `settledLineCount` alone could only honestly say "finished". Saying "got" for a
   * shop that had none of it is worse than being vague, which is why the copy waited
   * for this field rather than guessing from the one that was already here.
   */
  readonly boughtLineCount: number;
  /** How many finished lines the shop simply did not have. The other half. */
  readonly notAvailableLineCount: number;
  /**
   * How many people have this basket open right now (backend `0053`, section 2).
   *
   * On the summary rather than fetched, which is the only reason the dashboard card can
   * draw it at all: velista `0045` refused a presence row because it would have cost a
   * request per card on every dashboard load, and `0044`'s participant surface answers
   * a different question anyway — who **may** open this, not who has. Zero is the
   * ordinary answer and draws nothing.
   */
  readonly presentCount: number;
}

/**
 * What one run left behind, and why (backend `0050` section 3).
 *
 * A line already carried by another `ACTIVE` basket is skipped rather than duplicated,
 * because putting one zone line in two live baskets is how a household ends up with two
 * of everything. It is **reported** rather than silently dropped: a basket missing the
 * milk somebody distinctly remembers putting on the list is a bug report, and this is
 * the difference between answering it and guessing.
 */
export interface GeneratedListSkippedLine {
  readonly listId: string;
  readonly content: string;
}

/** What a run produced: the basket it made, and what it did not take. */
export interface GeneratedListRun {
  readonly list: GeneratedListSummary;
  readonly skipped: readonly GeneratedListSkippedLine[];
}

/**
 * One zone, or one list inside it, that a run should draw from.
 *
 * A null `listId` means **every list in the zone the caller may draw from, including
 * ones made later**, which is what the backend stores as `ALL` (backend `0049`
 * section 1). That is a different thing from naming today's lists one by one, and the
 * sheet says so under the tree: a group checked whole keeps including new lists.
 */
export interface GeneratedListSource {
  readonly zoneId: string;
  readonly listId: string | null;
}

/**
 * What the sheet sends when somebody presses Generate.
 *
 * `idempotencyKey` is what stops a double tap producing two baskets (backend `0050`
 * section 4): the same key from the same user inside the retention window returns the
 * run it produced the first time rather than composing a second one. The sheet mints
 * one **per opening** rather than per press, which is what makes the second press of a
 * double tap idempotent rather than merely fast.
 */
export interface CreateGeneratedListRequest {
  readonly name?: string | null;
  readonly profileId?: string;
  readonly sources?: readonly GeneratedListSource[];
  readonly idempotencyKey?: string;
}
