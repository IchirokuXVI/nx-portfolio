/**
 * The reply as the plain text the client renders it as (plan 0225, section 2).
 *
 * A backstop, not the rule. The prompt says to write plain sentences, and the
 * evaluation showed one model family ignoring the old half sentence about it 15
 * times out of 15 when it listed several lists. The client shows the reply as
 * text, so a `**` reaches the person as two asterisks. This removes the four
 * shapes the evaluation actually saw and nothing else: a lone `*` in "2 * 3" and
 * an underscore inside a word stay as they are.
 *
 * `stripped` counts the replacements, so the turn record can say how often the
 * prompt still loses and the prompt change is judged from the logs rather than
 * from a hunch.
 */
export function plainText(text: string): { text: string; stripped: number } {
  let stripped = 0;
  const count = (replacement: string) => {
    stripped += 1;
    return replacement;
  };

  const lines = text.split(/\r?\n/).map((line) =>
    line
      .replace(HEADING, () => count(''))
      .replace(LINK, (_match, label: string) => count(label))
      .replace(BOLD_STARS, (_match, inner: string) => count(inner))
      .replace(BOLD_UNDERSCORES, (_match, inner: string) => count(inner))
  );

  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 0) {
      out.push(joinItems(run));
      run = [];
    }
  };

  for (const line of lines) {
    const item = BULLET.exec(line);
    if (item) {
      count('');
      run.push(item[1]);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();

  // Untouched text goes back exactly as it came, line endings included.
  return stripped === 0
    ? { text, stripped }
    : { text: out.join('\n'), stripped };
}

/** A line that starts with `- `, `* `, `• ` or `N. `, and what follows it. */
const BULLET = /^\s*(?:[-*•]|\d+\.)\s+(.*?)\s*$/;

/** One or more `#` and a space at the start of a line. */
const HEADING = /^\s*#+\s+/;

/** `[text](url)`, which keeps its text. */
const LINK = /\[([^\]\n]+)\]\([^)\s]+\)/g;

/** `**x**`, with something other than a space just inside each pair. */
const BOLD_STARS = /\*\*(?=\S)([^*\n]*?\S)\*\*/g;

/**
 * `__x__`, and only where it is not part of a word, so `snake__case` and the
 * like are not read as markers.
 */
const BOLD_UNDERSCORES = /(?<!\w)__(?=\S)([^_\n]*?\S)__(?!\w)/g;

/**
 * Consecutive list items as one sentence: joined with `, `, and closed with a
 * full stop when the last one has no end punctuation of its own. An item's own
 * trailing comma, semicolon or full stop goes before the join, so "leche." and
 * "pan." become "leche, pan." rather than "leche., pan.".
 */
function joinItems(items: string[]): string {
  const parts = items.map((item, index) =>
    index < items.length - 1 ? item.replace(/[.,;]+$/, '') : item
  );
  const joined = parts.join(', ');
  return /[.!?:…]$/.test(joined) ? joined : `${joined}.`;
}
