/**
 * The brand, read out of the description (plan 0085, section 8).
 *
 * The chain writes it in capitals inside the sentence: `Vino blanco DON SIMON
 * brik 1 L`, `Detergente en polvo ARIEL ORIGINAL 65 lavados`, `Galletas boer coco
 * CORAL 450 g`. A run of capitalised words is therefore a usable extractor, and
 * it is stored **with no pretence of certainty**: plan 0081 section 2.1 keeps the
 * brand out of the alias key for exactly this reason, and the same holds here.
 * The brand is for a person to read in the review queue, not for a matcher to
 * join on.
 *
 * It is wrong in the ordinary way an extractor like this is wrong. `ARIEL
 * BÁSICO` names a variant as well as a brand, and `G1 PÉREZ BARQUERO` a line as
 * well as a house. Neither costs anything, because nothing decides on this field.
 */

/** A word that counts towards a run: at least two characters, no lower case. */
function isCapitalised(word: string): boolean {
  if (word.length < 2) {
    return false;
  }
  if (!/[A-ZÀ-ÖØ-Þ]/.test(word)) {
    return false;
  }
  return !/[a-zà-öø-ÿ]/.test(word);
}

/**
 * The longest run of capitalised words, or null when there is none.
 *
 * Ties go to the first run, which is where a chain that names two things in
 * capitals puts the brand: `Choco wafer MILKA 5x30 g` has one run, and a
 * description with a brand and a shouted variant has the brand first.
 *
 * Call it with the **name**, not the whole description: a trailing `2 L` would
 * otherwise be scanned, and `L` on its own is one character short of counting
 * only by luck.
 */
export function extractBrand(name: string): string | null {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  let best: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    // Punctuation the chain hangs off a name (`ST.PIERRE`, `blan/color`) is not
    // part of the decision, so it is stripped before the word is judged and kept
    // in what is returned.
    const bare = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (bare && isCapitalised(bare)) {
      current.push(word);
      if (current.length > best.length) {
        best = [...current];
      }
      continue;
    }
    current = [];
  }
  return best.length > 0 ? best.join(' ') : null;
}
