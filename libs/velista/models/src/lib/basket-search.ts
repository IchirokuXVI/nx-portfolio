import type { BasketLine, BasketProduct } from './basket-view';
import { inLocale } from './shopping-profile';

/**
 * The accents the fold strips, as the range U+0300 to U+036F.
 *
 * Built from code points rather than written as a literal, for the reason
 * `basket-memory.ts` builds the same range the same way: a literal would hold the
 * combining marks themselves and they are invisible, so a checkout, an editor or a
 * patch that dropped one would leave a regular expression that still compiles and
 * quietly matches the wrong thing.
 */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g'
);

/**
 * A stand-in for a character that folds away to nothing, so {@link alignedFold}
 * can keep one output character per input character.
 *
 * U+FFFF is a permanent non-character: no keyboard produces it and no product
 * name carries it, so a position filled with it can never take part in a match.
 */
const NOTHING = String.fromCharCode(0xffff);

/**
 * Both sides of the basket's search, folded the same way (velista `0074`,
 * section 4.2).
 *
 * Four transformations and no cleverness: the string decomposed, the combining
 * marks dropped, lower cased, and its whitespace trimmed and collapsed. So
 * "platano" finds "Plátano", "MILK" finds "milk", and a line whose content was
 * pasted with two spaces in it is still found by what somebody types.
 *
 * Idempotent, which is what lets the page hand the already folded query down to a
 * row as its highlight without the row having to know whether it was folded yet.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Whether one basket line answers what somebody typed.
 *
 * Three places are searched and they are the three a person in a shop would
 * expect: the words on the line, the name of its pick in the reader's own
 * language, and the pick's brand. The brand is there because somebody standing at
 * the own brand shelf types "hacendado" and means every line that comes from it.
 *
 * **An empty query matches everything**, so the page draws the same list with the
 * field open as with it closed and the count says so. There is no minimum length
 * and no debounce here: `SUGGEST_MIN_CHARS` and `SUGGEST_DEBOUNCE_MS` belong to
 * the composer's typeahead, which asks the server, and this asks a `computed`.
 *
 * The product is whatever the basket holds for {@link BasketLine.pickId}, which is
 * undefined for a free text line and for a pick the catalog no longer names. Both
 * match on the line's own content alone.
 */
export function matchesBasketLine(
  line: BasketLine,
  product: BasketProduct | undefined,
  query: string,
  locale: string
): boolean {
  const folded = foldForSearch(query);
  if (folded === '') {
    return true;
  }

  if (foldForSearch(line.content).includes(folded)) {
    return true;
  }

  if (product === undefined) {
    return false;
  }

  if (foldForSearch(inLocale(product.name, locale)).includes(folded)) {
    return true;
  }

  const brand = product.brand;
  return brand !== null && foldForSearch(brand).includes(folded);
}

/**
 * A fold that keeps the string's length, so a match in it names a range of the
 * original.
 *
 * {@link foldForSearch} cannot do that: decomposing turns one character into
 * several and collapsing whitespace removes some, so an index into its answer says
 * nothing about where in the source that character was. This folds **per
 * character** instead, each one to exactly one, which makes the index map the
 * identity and leaves nothing to drift.
 *
 * The price is a fold that is very slightly weaker: a source that already carries
 * a base letter and a separate combining mark reads as two characters here rather
 * than one. Nothing is drawn wrongly when that happens, because the mark is only
 * ever placed on a range this function found, so a fold that finds nothing draws
 * nothing.
 */
function alignedFold(text: string): string {
  let folded = '';
  // By code **unit** and not by code point, which `for...of` would do: a character
  // outside the basic plane is two units, and folding it as one would shorten the
  // answer and shift every index after it. Each half of a surrogate pair folds to
  // itself, so the length holds and an emoji simply never matches anything.
  for (let at = 0; at < text.length; at += 1) {
    const base = text
      .charAt(at)
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .toLocaleLowerCase();
    // `base` is longer than one character for the handful of letters whose lower
    // case is two ("İ"), and empty for a lone combining mark. One character per
    // source character either way, or the identity map stops being one.
    folded += base === '' ? NOTHING : base.charAt(0);
  }
  return folded;
}

/**
 * Where in a line's content the first match of a folded query is, or null.
 *
 * What the row draws its `<mark>` around (velista `0074`, section 4.5). The first
 * match and not every one: a highlight is there to point at the row somebody is
 * looking for, and a line painted in three places is harder to read than a line
 * painted in none.
 *
 * Null for an empty query, and null when the line matched on its product's name or
 * brand rather than on its own words, which is exactly the case where there is
 * nothing in the content to point at.
 */
export function basketMatchRange(
  content: string,
  folded: string
): { readonly start: number; readonly end: number } | null {
  if (folded === '') {
    return null;
  }

  const start = alignedFold(content).indexOf(folded);
  return start === -1 ? null : { start, end: start + folded.length };
}
