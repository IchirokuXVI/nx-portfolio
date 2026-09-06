/**
 * What a page load can fail with, in one place so that both the client that
 * raises them and the walk that has to tell them apart can import them without
 * importing each other.
 *
 * There are three, and the difference between them is what a caller is allowed
 * to do next:
 *
 * - {@link CarrefourHttpError}: this page was refused. Skip it, record it, and
 *   **never retry it**, because a retry is what turns a refusal into a block.
 * - {@link CarrefourBlockedError}: the refusals have stopped being isolated.
 *   Stop fetching entirely.
 * - {@link CarrefourBrowserError}: the browser stopped answering. The session is
 *   dropped and the next page gets a fresh one.
 */

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
 * Thrown when the refusals stop being isolated, which is the block escalating.
 *
 * A caller may skip a page that raised {@link CarrefourHttpError}. This one it
 * must not skip: it says the address is in the state plan 0090 section 4
 * describes, where only the first load of a fresh session succeeds, and every
 * page fetched from here deepens it.
 */
export class CarrefourBlockedError extends CarrefourHttpError {
  constructor(
    status: number,
    url: string,
    readonly refusals: number
  ) {
    super(status, url);
    this.name = 'CarrefourBlockedError';
    this.message =
      `Carrefour refused ${refusals} page loads in a row, the last with ` +
      `${status} for ${url}. Stopping rather than fetching into a deeper block.`;
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
 * Whether a failed page load is one a walk may step over.
 *
 * Everything is, except the block: that is the one failure which says the next
 * page will fail too, and worse for having been asked.
 */
export function isSkippable(error: unknown): boolean {
  return !(error instanceof CarrefourBlockedError);
}
