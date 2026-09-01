/**
 * How a generation run decides that two zone lines are the same thing (plan 0050,
 * section 3).
 *
 * The same thing appears in two zones, "Milk" in the flat list and in the
 * parents' house list, and the point of the feature is one line to buy once. So
 * lines are merged when they carry **the same product set**, and failing that on
 * **normalized text**.
 *
 * Merging on the set covers the plan's "same single product" case on its own: a
 * set of one product hashes like any other set, so two lines each naming only
 * Pascual Milk carry the same `itemSetHash` and meet here without a second rule.
 */

/**
 * The combining marks left behind by an `NFD` decomposition.
 *
 * Written as escapes rather than as the characters themselves, which are
 * invisible in an editor: a regex whose contents cannot be seen is a regex nobody
 * can review.
 */
const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g');

/**
 * The text two free text lines have to share to be merged: trimmed, case folded,
 * accent folded, and with runs of whitespace collapsed.
 *
 * **Deliberately conservative.** "milk" and "whole milk" stay separate, because
 * merging two things a user meant separately is a worse failure than showing two
 * lines they can merge by hand: the first loses a purchase silently, the second
 * is visible and takes one gesture to fix. Nothing here stems, and nothing here
 * strips a word.
 *
 * Accent folding is `NFD` plus a strip of the combining marks, so "Café" and
 * "cafe" meet. That is safe in both languages the product ships in, where an
 * accent is a spelling of the same word rather than a different word.
 */
export function normalizeContent(content: string): string {
  return content
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * The key two lines must share to be merged into one basket line.
 *
 * The product set wins when there is one, because it is an identity rather than a
 * spelling: two households typing "leche" and "Milk" for the same carton merge on
 * the set and would never have merged on the text. A free text line has no set
 * and falls back to the text, which is the busiest kind of line in the product
 * and the reason the text rule exists at all.
 *
 * The two are namespaced apart so a hash can never collide with a piece of text
 * somebody typed.
 */
export function mergeKey(line: {
  itemSetHash: string | null;
  content: string;
}): string {
  return line.itemSetHash
    ? `set:${line.itemSetHash}`
    : `text:${normalizeContent(line.content)}`;
}
