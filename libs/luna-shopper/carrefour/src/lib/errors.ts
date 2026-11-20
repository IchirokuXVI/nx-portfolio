/**
 * What a page load can fail with, in one place so that both the client that
 * raises them and the walk that has to tell them apart can import them without
 * importing each other.
 *
 * There are three that a page load raises, and the difference between them is what a caller is allowed
 * to do next:
 *
 * - {@link CarrefourHttpError}: this page was refused. Skip it, record it, and
 *   **never retry it**, because a retry is what turns a refusal into a block.
 * - `SourceBlockedError`, the run's refusal guard (plan 0215): the refusals
 *   have stopped being isolated. Stop fetching entirely. It is the guard's and
 *   not this library's, so every adapter stops the same way.
 * - {@link CarrefourBrowserError}: the browser stopped answering. The session is
 *   dropped and the next page gets a fresh one.
 *
 * A category walk raises a fourth, {@link CarrefourShortCategoryError}, when
 * a page that is no refusal ended the category before its end.
 */

import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';

/** Thrown when the storefront answers something a retry cannot fix. */
export class CarrefourHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`Carrefour answered ${status} for ${url}`);
    this.name = 'CarrefourHttpError';
  }
}

/**
 * Thrown when the browser stops answering, by hanging or by dying.
 *
 * **Measured, not imagined.** The first full crawl stalled after about 300
 * pages: the Chromium process was gone, the harvester held no child process and
 * no outbound connection, and the run sat in `ENUMERATE` forever. An abort could
 * not clear it either, because nothing in the call it was waiting on had a
 * deadline or read the signal. A page load that cannot fail is worse than one
 * that fails, so every call into the browser carries a deadline and this is what
 * a breach raises.
 */
export class CarrefourBrowserError extends Error {
  constructor(what: string) {
    super(`The browser stopped answering (${what})`);
    this.name = 'CarrefourBrowserError';
  }
}

/**
 * Thrown by a category walk that ended before the category did.
 *
 * A page that answered a 5xx, a 404 or no page state, or answered an empty
 * card list while it still states rows at its own offset, is a gap and not the
 * end. Ending the walk there in silence counted the category as read, and a
 * crawl whose every category read is the crawl that may be declared whole: it
 * then replaced category paths and could delist from a walk that never saw
 * the rest of the category. The products read before the gap were yielded
 * already and stay valid. The walk raises this so its caller names the
 * category as not fully read.
 *
 * **It is not a refusal.** A 403 or a 429 is {@link CarrefourHttpError}, which
 * the guard counts; this is the page saying nothing about a block. An end pass
 * asks a refusal again, and of these only the {@link transient} ones.
 */
export class CarrefourShortCategoryError extends Error {
  constructor(
    readonly categoryId: string,
    /** The page that ended the walk, from 0. */
    readonly page: number,
    /** What the page answered, for an operator: `Carrefour answered 503`. */
    readonly cost: string,
    readonly url: string,
    /**
     * The status the page answered when it was not a 200, else null: a 200
     * with no page state or an empty card list carries none.
     */
    readonly status: number | null = null
  ) {
    super(
      `${cost} for ${url}, so category ${categoryId} ended at page ${page + 1}`
    );
    this.name = 'CarrefourShortCategoryError';
  }

  /**
   * Whether the gap was a 5xx, which is usually a passing blip and worth one
   * more ask later in the run (owner decision 103b).
   *
   * A 404 is an answer about the page, and an empty page or a page with no
   * state is what the storefront chose to serve. Asking either again minutes
   * later is expected to answer the same, so neither is transient.
   */
  get transient(): boolean {
    return this.status !== null && this.status >= 500;
  }
}

/**
 * Whether a failed page load is one a walk may step over.
 *
 * Everything is, except the block: that is the one failure which says the next
 * page will fail too, and worse for having been asked. It says the address is
 * in the state plan 0090 section 4 describes, where only the first load of a
 * fresh session succeeds, and every page fetched from there deepens it.
 */
export function isSkippable(error: unknown): boolean {
  return !(error instanceof SourceBlockedError);
}
