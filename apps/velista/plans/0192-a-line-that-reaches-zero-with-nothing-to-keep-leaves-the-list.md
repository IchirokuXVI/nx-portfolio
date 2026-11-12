> **PR:** [#986](https://github.com/IchirokuXVI/nx-portfolio/pull/986)

> **Rewritten on 2026-11-12 from the owner's decision of that day.** In his words: "to
> prevent users from deleting a line by mistake (which also removes the history and other
> things), a line will only be deleted if you manually delete it from the sheet or line page.
> Lines with a quantity of 0 (or less, just in case) will be hidden and you can only see them
> when searching. This already happens for lines that have at least 1 buy in the list, but the
> lines that were never bought will also be hidden. This change of heart comes from the fact
> that I didn't think about the assistant, users with only edit access, and probably more
> situations."
>
> He also decided that the stepper's minus draws a red trash where its next press reaches 0,
> "that way the user knows the line will disappear". That is velista `0188` (class `is-clear`
> on the minus) and is not built here.

# 0192: a line at zero is hidden and found by searching

## 1. Objective

On a zone list at rest, a line whose quantity is 0 or less is not drawn, whether or not it was
ever bought. The page's search draws it at 0, so a person can find it and step it back up, and
a step above 0 puts it back in To buy. Nothing is deleted: the only delete is the one by hand
from the line's sheet or its line page, exactly as on `dev`.

This is a view rule in velista's own models. The server decides nothing new. Backend `0263`
was withdrawn on the same day: no answer carries `deleted`, no event carries `emptied`, and a
write to 0 leaves the line at 0.

## 2. What the list did with a line at 0 before this plan

Read on the base of this branch (`dev` plus velista `0188` and backend `0262`/`0263`), in
`libs/velista/models/src/lib/compose-list-groups.ts`, `select-list-state.ts`, the list page and
its template.

- `selectListState` passes every line to the page. It hides nothing. The header counts
  `wantedCount` (quantity above 0) and `lineCount` (every line).
- `composeListGroups` decides the sections. At rest (no words in the composer's field):
  - **A line at 0 that was never bought was drawn in To buy**, after the wanted lines and the
    due rows, in the list below the due section (`restLines`), with its stepper at 0. Rejected
    ones were drawn last with the rejected lines. This is the case the owner's rule changes.
  - **A line at 0 with a buy leaves To buy once the trips have loaded and named at least one
    trip** (velista `0095`, section 5). This is what the owner meant by "already hidden".
    Three places still draw it at rest, and this plan leaves all three as they are:
    1. **The trip folds.** Each live and past trip under To buy draws the rows of the lines it
       holds, at whatever amount they now have. A past trip is folded until somebody opens it;
       an open fold draws the line (no stepper, only a row that opens the line).
    2. **The due rows** (velista `0089`, backend `0123`): a line the list suggests is drawn
       under the wanted lines while it is at 0, not rejected and not claimed, with its own
       stepper at 0. These are lines with a purchase history.
    3. **The fallback in To buy**: while the trips have not loaded, after their read failed,
       and when the read named no trip, a bought line at 0 stays last in To buy "where it can
       be raised" (velista `0095`, section 5).
  - Reorder mode already drew no line at 0.
- During a search the page is flat (`composeListView` over every line) and draws every
  matching line, at 0 or not. A bought line at 0 that lives only in old trips has always been
  found this way.
- The shopping list (basket) draws no row for a line at 0. The catalog tab's held lines and the
  product page's lists table draw a held line at 0.

## 3. The rule as built

- `composeListGroups` no longer puts a line at 0 or less that was never bought in To buy, in
  any state of the trips, rejected or not. The fallback for a bought line now reads
  `quantity <= 0`. Nothing else in the function changes: the trips, the due rows and the
  fallback above are untouched.
- The amount read is the stored one. While a run of stepper presses is open, the row keeps its
  place (velista `0188`, decision H): a minus to 0 then a plus inside the quiet beat leaves the
  row where it is and writes nothing. The row leaves when the run's write lands, and the
  store's optimistic patch counts.
- The search is unchanged: it draws the line at 0 with its stepper, and a plus there writes the
  run like any other row. Emptying the field shows the line back in To buy.
- **When this reader's own run takes a row out of To buy** (`ListPage._writeRun`, the send of
  the page's `quantityRuns`):
  - The page reads, while the row is still drawn, whether focus is in it
    (`leaving-row-focus.ts`). After the next render it focuses the same control of the next
    row, else of the previous row, else the page's heading (made focusable with
    `tabindex="-1"`). Focus that was elsewhere is left alone.
  - It says `list.line.hiddenAtZero` once in the page's polite region:
    en "{{name}} is at 0 and hidden. Search for it to bring it back.",
    es "{{name}} está a 0 y se oculta. Búscalo para recuperarlo."
    The name is the one the row drew.
  - The stepper's own settled "0" is not drawn: the run's write and the stepper's announce
    timer both fire after the same quiet beat, the run's first, and the row is removed in the
    render that would have drawn the stepper's sentence. The stepper is not changed.
  - A line another device lowered, a line lowered from the sheet or the line page, and a
    dropped write sent again move no focus and say nothing.
  - A row that goes from To buy into the due rows says nothing; focus that was in it still
    moves to the next row.
- The line page and the line sheet of a line at 0 behave as on `dev`, reached from the search,
  a link or the shopping list. Their delete by hand is the only delete, and the "deleted by
  another user" notice is exactly as on `dev`.
- Checked and unchanged: the header ("3 of 7 pending", "Nothing left" when every line is at 0) stays true. The empty state ("Nothing on this list yet") is drawn only for a list with no
  line at all, so it never claims that a list with hidden lines is empty. A list whose every
  line is at 0 and never bought draws the To buy heading with nothing under it, and the trips
  if it has any; the same screen `dev` already draws when every line is bought and at 0.
  Under a category whose lines are all hidden, the page says "No lines match." with Reset, as
  for any category that narrows To buy to nothing. Sorting is unchanged. The basket, the
  catalog tab and the product page are unchanged.

## 4. What this branch removed

The deletion that the first version of this plan built, completely: reading `deleted` on the
quantity and update answers, `emptied` on `line.deleted`, the store's `_emptying`,
`emptiedNotice` and `LineEmptied`, the `emptied` deletion mark and its `LineGoneReason` value
(the type is back to `'byOthers' | 'unavailable'`, as on `dev`), the keys
`list.gone.emptied`, `list.line.emptied` and `basket.line.emptied`, the line page's leave on
its own deleting minus, the memory fakes' deletion at 0, `CatalogAddStore` dropping a held line
answered `deleted`, and their specs. Every one of those files is back to its `0188` base, which
is `dev` plus the stepper. Kept: the focus rule of section 3, moved from a deleted row to a
hidden one.

## 5. Specs

- `compose-list-groups.spec.ts`: a line at 0 never bought is not drawn at rest with no trip,
  with trips not ready, with trips; nor when rejected; nor below 0; the search finds it at 0;
  above 0 it is back in To buy. The existing cases for bought lines at 0 keep their fallback.
- `list-page.spec.ts`: one run to 0 makes one write, the row leaves, the line is still held,
  and the sentence is said; focus moves to the next row's same control, else the previous row,
  else the heading; focus elsewhere is left alone; a line another device lowered says nothing;
  the search draws the line at 0 and a plus there brings it back with no sentence; a row lowered
  inside the search stays drawn and says nothing; a minus to 0 then a plus inside the quiet beat
  keeps the row and writes nothing. The three older cases that drew a never bought line at 0
  now expect it hidden.

## 6. Acceptance criteria

1. On a zone list at rest, no line at 0 or less that was never bought is drawn, product or free
   text.
2. Typing the line's name in the composer's field draws it in the results with its stepper at
   0; a plus there and an empty field show it back in To buy.
3. Lowering a line to 0 with the row's stepper makes one write; the row leaves when the write
   lands; nothing is deleted.
4. Focus in the row moves to the same control of the next row, else the previous row, else the
   heading; the polite region says the sentence once; nothing moves for another device's write.
5. A minus to 0 and a plus inside the quiet beat keep the row and write nothing.
6. A line with a buy behaves the same in To buy, and its trip folds and the due rows still draw
   it as on `dev`.
7. The line's sheet, opened from the search results, still has its delete by hand.

## 7. Questions for the owner

1. The copy of `list.line.hiddenAtZero` (en and es above).
2. A bought line at 0 is still drawn at rest in three places (section 2): an open trip fold,
   the due rows, and To buy itself while the trips are loading, failed, or named no trip. Should
   any of them stop drawing it?
3. A list whose lines are all at 0 shows the To buy heading with nothing under it. Should To buy
   say something there (for example that lines at 0 are found by searching)?
4. Lowering a line to 0 from its sheet over the list hides its row with no sentence. Should the
   page say the sentence then too?
