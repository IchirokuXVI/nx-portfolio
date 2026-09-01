/**
 * The segment that marks the rest of a URL as a sheet drawn over the page before it.
 *
 * ## The rule
 *
 * `<the covered page's URL>/sheet/<what the sheet is about>`. The marker sits
 * immediately after the page, never after the thing the sheet addresses, and that
 * placement is the whole of the rule rather than a detail of it. A page's URL is
 * unique, so stamping the marker straight after it gives every page a namespace no
 * other page can reach into; putting it further right would move two colliding URLs by
 * the same amount and leave them colliding.
 *
 * ## What it is for
 *
 * Pages and sheets used to share one namespace, and a sheet was told apart from a page
 * only by nobody having claimed its path yet. The list page's sheets sit below
 * `lines/:lineId`, which is also the **line page's** URL, so the line page's own
 * children were offered every one of them first: `lines/:lineId/confirm/delete` was
 * declared over both screens and resolved to the line page from both, which meant
 * deleting a line from a row on the list swapped the list out for the line page behind
 * the confirmation. Its siblings `edit` and `comments` worked only because the line
 * page happened to have no children by those names, so the same fault was waiting on
 * whoever added one next.
 *
 * With the marker, no sheet can ever be confused for a page or for another page's
 * sheet, and the route ordering that used to be load bearing is merely tidy.
 *
 * ## Where it is applied
 *
 * Once, by the `sheet()` helper in the route table, so a sheet added later cannot be
 * the one that forgets it. Callers opening a sheet use {@link sheetSegments}, and
 * `routes.spec.ts` asserts the two halves agree: every route drawn in a `SheetShell`
 * carries the marker, and nothing else does.
 */
export const SHEET_SEGMENT = 'sheet';

/**
 * The segments for opening a sheet over the page the caller is on.
 *
 * Relative to the page's own route, which is what makes the marker land in the right
 * place without the caller knowing where in the tree it sits: `navigate(['sheet',
 * 'lines', id, 'edit'], { relativeTo: route })`.
 */
export function sheetSegments(...segments: readonly string[]): string[] {
  return [SHEET_SEGMENT, ...segments];
}
