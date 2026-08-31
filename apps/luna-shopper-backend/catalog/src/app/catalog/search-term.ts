/**
 * Turning what somebody typed into something Postgres will match (plan 0048,
 * section 2).
 *
 * The composer sends whatever is in the box after three characters, so the term
 * reaching here is routinely a fragment of a word, occasionally a misspelling,
 * and always untrusted text.
 */

/** How much of a word two strings have to share for the fuzzy match to fire. */
export const TRIGRAM_THRESHOLD = 0.3;

/**
 * Trigram similarity contributes to the score, but far less than a real text
 * match does.
 *
 * `ts_rank` lands around 0.06 for one matched lexeme and climbs from there;
 * similarity is a proportion from 0 to 1 and a typo scores about 0.5. Scaling it
 * down by twenty keeps a fuzzy hit below every genuine one, which is the whole
 * ordering the two are being mixed to produce: "pasqual" finds Pascual, and it
 * finds it *underneath* everything that actually says Pascual.
 */
export const TRIGRAM_WEIGHT = 0.05;

export interface SearchTerm {
  /** What the caller typed, for the trigram comparisons and the exact test. */
  raw: string;
  /**
   * A `to_tsquery` expression: each word prefix matched, joined with `&`.
   *
   * A prefix query and not `plainto_tsquery`, because the composer asks after
   * three characters and "lech" has to find "leche". Every character that
   * `to_tsquery` would parse as an operator is stripped first: the expression is
   * still passed as a bound parameter, so this is not what stops an injection,
   * it is what stops a stray apostrophe turning a search into a syntax error.
   */
  tsquery: string;
}

/**
 * Parse a raw search box value, or answer null when there is nothing to search
 * for.
 *
 * Null rather than an empty term, because "no query" is a real case with its own
 * meaning throughout: `item.search` lists, and `item.searchOffers` ranks nothing
 * and falls back to a plain ordering.
 */
export function parseSearchTerm(query?: string): SearchTerm | null {
  const raw = (query ?? '').trim();
  if (raw.length === 0) {
    return null;
  }
  const words = raw
    // Anything that is not a letter, a digit or a mark becomes a separator. This
    // keeps accented characters, which is not optional in Spanish.
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return null;
  }
  return { raw, tsquery: words.map((word) => `${word}:*`).join(' & ') };
}
