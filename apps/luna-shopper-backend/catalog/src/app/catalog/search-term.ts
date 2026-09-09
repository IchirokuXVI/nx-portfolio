/**
 * Turning what somebody typed into something Postgres will match (plan 0048,
 * section 2).
 *
 * The composer sends whatever is in the box after three characters, so the term
 * reaching here is routinely a fragment of a word, occasionally a misspelling,
 * and always untrusted text.
 *
 * Occasionally it is not text at all but a barcode, off a label or a scanner, in
 * which case it names one product outright and the term carries it separately.
 */

/**
 * How much of a word two strings have to share for the fuzzy match to fire.
 *
 * It was 0.3, which is loose enough that the fuzzy branch stopped being a spell
 * checker and became a second, worse search: on the real Mercadona assortment it
 * added rows nobody typed towards, and it still could not reach the misspelling
 * it exists for on any field longer than a brand.
 *
 * 0.4 is the highest value the typo it is *for* survives. `similarity('Pascual',
 * 'pasqual')` is 0.4545 and nothing else about that comparison is adjustable, so
 * a threshold above it would delete the behaviour along with the noise.
 */
export const TRIGRAM_THRESHOLD = 0.4;

/**
 * The shortest query the fuzzy branch will answer at all.
 *
 * Three characters is where the composer starts asking, and at three characters
 * trigram similarity says almost nothing: "sal" and "sol" share two thirds of a
 * very small string, so a threshold that is strict for a word is loose for a
 * fragment. Below this length the query is treated as what it is, a prefix
 * somebody is still typing, and the full text branch answers it alone.
 */
export const MIN_FUZZY_LENGTH = 4;

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

/**
 * The digit counts a barcode is allowed to have: EAN-8, UPC-A, EAN-13 and
 * GTIN-14.
 *
 * The comparison against the column is an equality, so a stray "500" would find
 * nothing with or without this test. What the length buys is the meaning of the
 * field: {@link SearchTerm.ean} says "the caller handed us a barcode", which is
 * what the ranking reads it for, and a quantity somebody typed into the box is
 * not one.
 */
const BARCODE_LENGTHS = new Set([8, 12, 13, 14]);

export interface SearchTerm {
  /** What the caller typed, for the trigram comparisons and the exact test. */
  raw: string;
  /**
   * The barcode this query is, when it is one, for an equality test against
   * `items.ean`. Null for everything typed as words.
   *
   * It sits **beside** the text fields rather than replacing them: a query is
   * matched as a barcode and as text both, so a product whose name is a number
   * does not stop being findable by name.
   */
  ean: string | null;
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
  /**
   * The words as they were typed, for the literal recheck {@link
   * literalMatchSql} builds.
   *
   * `tsquery` above is matched against a stemmed document, and the Spanish
   * stemmer conflates far more than a shopper expects it to: it reduces
   * "salado", "salada" and "salted" to `sal`, so searching for salt answered
   * with salted caramel ice cream and dog food in sauce. The prefix does the
   * same in the other direction, matching `lech:*` to "lechuga". Neither is a
   * bug in Postgres. They are what a stemmed prefix query means, and they are
   * why the words are kept as typed beside it.
   */
  words: string[];
  /**
   * Whether the trigram branch may widen this query, by {@link
   * MIN_FUZZY_LENGTH}.
   *
   * A property of the term rather than a test at each call site, because the
   * three searches that read it have to agree: a query that is fuzzy-matched by
   * the item search and not by the group search puts an item above the kind of
   * thing it belongs to, which is the one ordering the suggest endpoint exists
   * to enforce.
   */
  fuzzy: boolean;
}

/**
 * The text an item's literal recheck reads: everything the product says about
 * itself, plus the name of the kind of thing it is.
 *
 * The group's **name** is in it and its synonyms are not, which is the same
 * split the search document holds since the trigger stopped writing weight D. A
 * carton labelled only "Pascual Semidesnatada" is reachable by "leche" because
 * its group is called that; it is not reachable by every other word an operator
 * once wrote down as meaning milk.
 *
 * A correlated subquery and not a join, because the two item searches assemble
 * their `FROM` differently and one of them is a TypeORM query builder. It is
 * only ever evaluated on rows the GIN index has already returned.
 *
 * The alias is `i`, which both item searches use.
 */
export const ITEM_SEARCH_TEXT = `(
  coalesce(i."name" ->> 'es', '') || ' ' ||
  coalesce(i."name" ->> 'en', '') || ' ' ||
  coalesce(i."brand", '') || ' ' ||
  coalesce((
    SELECT coalesce(g."name" ->> 'es', '') || ' ' || coalesce(g."name" ->> 'en', '')
    FROM "product_groups" g WHERE g."id" = i."productGroupId"
  ), '')
)`;

/**
 * The same text for a product group, and here the synonyms **are** in it.
 *
 * A synonym is a word for a kind of thing, and a group is the kind of thing.
 * What the recheck takes away is the stemmer's widening, not the operator's
 * list: "lácteo" still finds the milk group, while a synonym that merely stems
 * to the same three letters as the query no longer does.
 *
 * The alias is `g`, which both group searches use.
 */
export const GROUP_SEARCH_TEXT = `(
  coalesce(g."name" ->> 'es', '') || ' ' ||
  coalesce(g."name" ->> 'en', '') || ' ' ||
  "catalog_synonyms_text"(g."synonyms", 'es') || ' ' ||
  "catalog_synonyms_text"(g."synonyms", 'en')
)`;

/**
 * SQL asserting that every typed word appears **literally** in `textExpr`, at
 * the start of a word.
 *
 * It is a recheck and never a filter on its own: it is written beside a
 * `@@ to_tsquery(...)` that the GIN index answers, so Postgres finds the
 * candidates through the index and this narrows them. On its own it would be a
 * sequential scan of the table.
 *
 * **Accents are removed from both sides**, by `catalog_norm`, and that is not
 * cosmetic. The Spanish full text configuration strips accents while it stems,
 * so "salmon" already reaches "Salmón" today; a literal comparison that did not
 * would quietly delete every match a keyboard without accents can produce, which
 * in Spanish is most of them.
 *
 * The words come from {@link parseSearchTerm}, which splits on everything that
 * is not a letter or a digit, so none of them can carry a regular expression
 * operator into the pattern.
 */
export function literalMatchSql(
  textExpr: string,
  words: string[],
  bind: (value: unknown) => string
): string {
  return wordMatchSql(textExpr, words, bind, '');
}

/**
 * SQL asserting that every typed word is a **whole** word of `textExpr`, for the
 * ranking rather than for the filter.
 *
 * This is the key that answers what somebody typing "sal" was asking for.
 * "Helado salted caramel con salsa de caramelo salado" is a legitimate prefix
 * match and stays in the answer; it is not what the word means, and it used to
 * be the first row because `ts_rank` counted the word three times in a long
 * name. Salt is a whole word only on the salt.
 */
export function wholeWordMatchSql(
  textExpr: string,
  words: string[],
  bind: (value: unknown) => string
): string {
  return wordMatchSql(textExpr, words, bind, " || '\\M'");
}

function wordMatchSql(
  textExpr: string,
  words: string[],
  bind: (value: unknown) => string,
  suffix: string
): string {
  return words
    .map(
      (word) =>
        `"catalog_norm"(${textExpr}) ~ ('\\m' || "catalog_norm"(${bind(
          word
        )})${suffix})`
    )
    .join(' AND ');
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
  return {
    raw,
    tsquery: words.map((word) => `${word}:*`).join(' & '),
    words,
    fuzzy: raw.length >= MIN_FUZZY_LENGTH,
    ean: parseBarcode(raw),
  };
}

/**
 * The barcode a query is, or null when it is not one.
 *
 * Separators are dropped first, because a code read off a label or pasted from a
 * receipt arrives with spaces or hyphens between its digit groups while the
 * column holds the digits alone.
 *
 * What is left is compared to the column **exactly**, the same way
 * `item.findByEan` compares it. Catalog stores the code its source published, so
 * a search that quietly padded a twelve digit UPC into a thirteen digit EAN
 * would answer for products the lookup beside it cannot find, and the two would
 * disagree about what a barcode names.
 */
export function parseBarcode(query: string): string | null {
  const digits = query.replace(/[\s.-]+/g, '');
  return /^[0-9]+$/.test(digits) && BARCODE_LENGTHS.has(digits.length)
    ? digits
    : null;
}
