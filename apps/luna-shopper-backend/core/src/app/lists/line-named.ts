/**
 * Whether a person typed the name of a line (plan 0207, section 1).
 *
 * `list_lines.named` is a fact beside `content` and never a second name. The
 * server keeps two rules about it (section 1.2), and every write that can move
 * the flag asks one of the functions here, so no two writes can answer
 * differently:
 *
 * 1. **A line with no product is named**, whatever the request says. A reader
 *    that draws the product in place of the name of a line that is not named
 *    then always has a product to draw.
 * 2. **A write of `content` with no flag names the line.** The assistant, the
 *    rename of a basket row, the edit of an operator and every client written
 *    before the flag then keep their meaning with no change.
 *
 * `holdsProduct` is always about the set as it stands **after** the write. The
 * test is the one of review point 4: the products of the line are empty or
 * they are not, and the products a group put there count as any other.
 */

/** The flag a new line starts with (section 1.3). Absent means a person typed it. */
export function namedOnAdd(
  named: boolean | undefined,
  holdsProduct: boolean
): boolean {
  return !holdsProduct || named !== false;
}

/**
 * The flag of a line after an edit (section 1.3).
 *
 * - `named` in the request wins over rule 2, so `named: false` beside a
 *   `content` takes the name away and hands the line the name of a product.
 * - `content` with no flag is rule 2.
 * - An edit that names neither leaves the flag as it is.
 * - Rule 1 is asked last, and it outranks all three.
 */
export function namedAfterEdit(
  current: boolean,
  edit: { content?: string; named?: boolean },
  holdsProduct: boolean
): boolean {
  if (!holdsProduct) {
    return true;
  }
  // A boolean and nothing else. Core is also reached in process, and a null
  // here must read as an absent flag and never be written to the column.
  if (typeof edit.named === 'boolean') {
    return edit.named;
  }
  return edit.content !== undefined ? true : current;
}

/**
 * The flag of a line after a write that moved its products and said nothing
 * about its name, which is the sync of a product group. Rule 1 alone.
 */
export function namedOverSet(current: boolean, holdsProduct: boolean): boolean {
  return !holdsProduct || current;
}

/**
 * The flag of the line that survives a merge (section 1.3): named when either
 * line is. The name of the survivor is the name a person typed on one of them.
 *
 * Rule 1 needs no branch here. A line that is not named holds a product, and a
 * merge keeps the products of both lines, so two lines that are not named
 * leave a survivor with products.
 */
export function mergedNamed(
  survivor: { named: boolean },
  absorbed: { named: boolean }
): boolean {
  return survivor.named || absorbed.named;
}
