# 0055: changing what each list asked for

> Server half: `apps/luna-shopper-backend/plans/0057`, which owns every rule this plan renders.
>
> A basket line of three litres of milk is the flat wanting two and the parents' house wanting
> one. The screen says three. There is no way to see the split, no way to say the flat wants
> three rather than two, and no way to put a fourth list into a line the run composed without it.
>
> This is the sheet for that, and it is the one screen in the basket that changes a household's
> own list. Everything in it is drawn to keep that apart from buying.
>
> Prerequisite reading: `0044` section 4.1 (what is absent per reader, which decides who sees
> this at all), `0054` (the reel on the row, which means the opposite of the reels on this
> sheet), `0043` section 4 (the reel itself) and backend `0057` in full.

## 1. What is being built

A sheet at **`…/sheet/lines/:lineId/units`**, reached from the settle sheet, listing every list
that wants this line and letting a reader who passes the all or nothing rule move each number.

| Piece | Where |
| ----- | ----- |
| The way in, from the settle sheet | `settle-sheet` |
| The sheet: origins, a collapsed section of candidates, a total | a new `line-units-sheet` |
| The read and the write | `BasketApi`, `BasketStore` |
| The sentence that says this is not buying | `en.json`, `es.json` |

The path follows the sheet convention without thinking about it: `sheet()` in
`feature-shell/src/lib/routes.ts` stamps the marker, and the subject is what the sheet is about,
which is a line's units. Nothing types the segment by hand.

## 2. Who sees it

**A reader who passes `0044` section 4.1's all or nothing rule**, which is the owner by
construction and a registered participant holding `WRITE` on every source list. Nobody else, and
the control is **absent** rather than disabled, which `0030` settled for the list page.

A guest never sees the entry in the settle sheet, never reaches the route usefully, and is
refused by the server if they do. That is not a grudging restriction: every row on this sheet is
a household's name beside a number, and a guest must never have to know which household a tin of
tomatoes belongs to.

The entry is also absent when there is nothing to show, which is a line with no origins and no
candidates: an added line nobody has bound yet (`0056`) has neither.

## 3. The way in

In the settle sheet's action list, below the settle targets and above the destructive end of it,
labelled for what it does to the lists and not for what it does to the basket. "Change what each
list asked for", not "edit quantities": the second is what the reel on the row already does, and
these two controls must not be able to read as the same thing.

It opens a **second sheet over the first**, which the router already supports as a sibling child
route, and the back gesture returns to the settle sheet rather than to the page. `0031` is why
that has to be true and `SheetNavigation.dismiss` with the settle sheet's URL as the fallback is
how, since nothing in velista may call `Location.back()` unguarded.

## 4. The sheet

Three parts, top to bottom.

### 4.1 The total, at the top

One line: what this basket will buy, updating as the reels move. It is the number the reader is
actually deciding, and putting it at the top rather than under a list of rows means it is visible
while a thumb is on a reel at the bottom.

When the basket line has been raised above the sum of the lists (which `0054` allows and backend
`0057` section 5.1 preserves), the total says so in a second, quieter line: "3 for these lists,
plus 17 extra". Without it the arithmetic on the screen does not add up and looks like a bug.

### 4.2 The lists that are in

One row per origin. **List name on the left, a reel on the right showing what this list currently
contributes to the basket.** The zone name is drawn under the list name only when the reader has
two lists with the same name, which is the same rule the skip report uses.

Under each name, what the list itself asks for now, when it differs from the contribution. The
basket is a snapshot and this is the one screen where the snapshot and the live list are both in
front of somebody; showing what was taken without showing what is wanted is how somebody sets a
number that looks right and is not.

A row the owner may no longer write draws its numbers and no reel, with the reason. The
information is a fact about a list this reader is entitled to; the control is the thing that is
absent.

### 4.3 The lists that are not

A collapsed container, closed by default, labelled with its count: "3 other lists want this".

Opening it shows the same rows for lists that hold a matching line and did not contribute. Their
reels start at zero, and moving one off zero adopts it: the list joins this basket line, its own
line goes up, and the household sees somebody is out buying it.

Collapsed by default because the common case is a line that is exactly what it looks like, and an
expanded section of lists nobody is thinking about is four rows of noise over a trolley.

A candidate that cannot be adopted is drawn with its reason and no reel:

| Reason | What the row says |
| ------ | ----------------- |
| `CLAIMED` | somebody is already buying this for that list |
| `NOT_APPROVED` | that list has not agreed to this line yet |
| `SETTLED` | that list does not want any right now |

It is shown rather than hidden for one reason: "the parents' house also wants milk and somebody
else is already buying it" is worth knowing while standing in a dairy aisle. This is the
deliberate exception to `0030`, and it is not a breach of it, because the **control** is still
absent and only the fact is present.

## 5. This sheet does not buy anything, and it says so

The single most important line of copy in this plan, because the identical control one screen up
means "bought".

A permanent sentence under the title, not a warning and not a colour:

> Changing these changes what each list wants. Nothing here is marked as bought.

And the reels here have **no caption on the drag**, unlike `0054`'s, which says "2 bought" while
the thumb is down. The absence is deliberate and is the second half of the same message: the
gesture that narrates a purchase and the gesture that does not are told apart by whether they
narrate one.

The server enforces the same separation from its side (backend `0057` section 6): this write
answers with no settlement refs and emits no `line.settled`, so a client cannot draw a purchase
out of it even by mistake.

## 6. Committing, and getting it wrong

Each reel commits on release, one write per row, exactly as the row's reel does. There is no save
button and no batch: a sheet that collects five numbers and applies them at once has to explain a
partial failure, and applying them one at a time means the row that failed is the row that says
so.

The write carries what the client believed the contribution was, and a mismatch is refused and
redrawn with one sentence, reusing `0054` section 4.1's wording and its place in
`basket-error-copy.ts`.

Two failures get their own sentences, because both are actionable and neither is a bug:

- **Below what has already been bought.** "2 of these have already been bought for this list", and
  the reel returns to the floor rather than to where it started, which is where the reader was
  heading.
- **Access is gone.** The row loses its reel and keeps its numbers, in place, without closing the
  sheet.

## 7. Accessibility

- The sheet is a form of labelled numeric fields, which is what `0044` section 7 already requires
  of the allocation sheet, and the reel brings its `spinbutton` keyboard path with it.
- Each reel's accessible name is the list it belongs to, so a reader moving by control hears
  "Flat, 2" and not "quantity, 2" five times.
- The total is announced as it changes, politely and coalesced, so somebody cannot silently
  change what the basket will buy without hearing it.
- The collapsed container is a real disclosure widget with its count in its accessible name.
- A row with no reel says why in its own text and not by colour or position alone.

## 8. Acceptance criteria

- A reader who passes the rule opens the sheet from a line and sees each contributing list, what
  it put in, and what it currently wants.
- A guest sees no entry to it, and a registered participant holding only `READ` on one source
  list sees none either.
- Raising a list's number raises that list's own line by the same amount and the basket's total by
  the same amount, and marks nothing as bought.
- Lowering one does the same in reverse, and the list's line lands at zero rather than
  disappearing.
- Setting one to zero removes that list from the line.
- The collapsed section lists other lists that want the same thing, and moving one off zero adds
  it to the basket, including from a zone the basket was not generated from.
- A candidate another basket is already buying is visible, explained, and has no control.
- The total at the top always equals what the basket will buy, and says when part of it is extra.
- Nothing on this sheet appears in any purchase history or moves any bought indicator.
- A number somebody else changed first is refused with a sentence, and the sheet stays open.
- Lowering below what has already been bought is refused with the floor named.
- Dismissing returns to the settle sheet, and the Android back gesture does the same.
