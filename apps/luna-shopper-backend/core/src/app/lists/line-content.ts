/**
 * How two lines are decided to name the same thing (plan 0050, section 3; plan
 * 0091, section 1).
 *
 * It lives here, beside the add, because two callers must fold the same way.
 * The add merges "Jamón" into the "jamon" line already on the list, and a
 * generation run composes a basket line from both; a run that folded differently
 * from the add would compose a line that no longer matches the list line it came
 * from. `baskets/line-dedup.ts` re-exports it for that reason and states
 * what the run does with it.
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
 * The text two free text lines have to share to be one line: trimmed, case
 * folded, accent folded, and with runs of whitespace collapsed.
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
 * What an add has to share with a line to land on it: the name, as
 * {@link normalizeContent} folds it, **and** what the line means by it.
 *
 * Two things a household buys can carry one name. "Milk" naming the whole milk
 * of one brand and "Milk" naming the oat one of another are two purchases, and
 * an add that raised the first when somebody picked the second lost a line
 * without saying so. So the name alone decides nothing.
 *
 * A line can be met in up to two ways, and an add that shares **either** with it
 * lands on it:
 *
 * - **Its product group**, for a line that follows one. The set of such a line
 *   moves under it as the catalog syncs, so two adds of the same suggestion a
 *   week apart meet on the group and would not meet on the set.
 * - **Its product set**, by the digest the row already carries. A basket's add
 *   names products and never a group (`AddBasketLineRequest`), so this is how it
 *   meets the line a list page made from the same suggestion.
 *
 * A line with neither is free text, and free text meets free text and nothing
 * else. A line that follows a group and holds no product is not free text, so it
 * offers its group alone.
 *
 * The kinds are namespaced apart, so a digest can never collide with a group id
 * or with the absence of both.
 */
export function lineIdentities(line: {
  content: string;
  itemSetHash: string | null;
  productGroupId: string | null;
}): string[] {
  // A null character, which no name can hold once it has been through a text
  // column, so a name cannot spell another line's meaning.
  const name = `${normalizeContent(line.content)}\u0000`;
  const identities: string[] = [];
  if (line.productGroupId !== null) {
    identities.push(`${name}group:${line.productGroupId}`);
  }
  if (line.itemSetHash !== null) {
    identities.push(`${name}set:${line.itemSetHash}`);
  } else if (line.productGroupId === null) {
    identities.push(`${name}text`);
  }
  return identities;
}
