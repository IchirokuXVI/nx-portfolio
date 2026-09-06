/**
 * How two lines are decided to name the same thing (plan 0050, section 3; plan
 * 0091, section 1).
 *
 * It lives here, beside the add, because two callers must fold the same way.
 * The add merges "Jamón" into the "jamon" line already on the list, and a
 * generation run composes a basket line from both; a run that folded differently
 * from the add would compose a line that no longer matches the list line it came
 * from. `generated-lists/line-dedup.ts` re-exports it for that reason and states
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
