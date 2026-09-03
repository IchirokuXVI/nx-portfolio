/**
 * Appending a page to the rows already shown (plan 0004, section 4).
 *
 * Cursor pagination has a known defect in this backend: a cursor timestamp
 * loses microseconds, so a row can come back on both sides of a page boundary.
 * This plan does not fix it and does not need to. What it must not do is make
 * it worse, which is what appending blindly would do: the operator would see
 * the row twice, and clicking either copy would edit the same record.
 *
 * So the merge is by id, and the rest of the list obeys the other half of the
 * rule: there is more if and only if `nextCursor` is not null. A page's length
 * says nothing. A short page is not the last one, and a page holding exactly
 * the requested number is not proof that another exists.
 */

/**
 * The rows already shown, plus the ones that are new in this page.
 *
 * The **first** copy of a repeated row wins. A repeat is the same record read a
 * moment later, so the two are the same row; keeping the one already on screen
 * means a row the operator is looking at does not move or flicker when the next
 * page arrives.
 *
 * A row with no id is dropped rather than shown. It cannot be opened, edited or
 * deleted, since every one of those is addressed by id, so drawing it would put
 * a line on the screen that does nothing when clicked.
 */
export function appendPage<T>(
  shown: readonly T[],
  page: readonly T[],
  idOf: (row: T) => string
): T[] {
  const seen = new Set(shown.map(idOf));
  const merged = [...shown];

  for (const row of page) {
    const id = idOf(row);
    if (id === '' || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(row);
  }

  return merged;
}
