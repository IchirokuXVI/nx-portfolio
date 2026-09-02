# 0054: the number on the row is the control

> Server half: `apps/luna-shopper-backend/plans/0056`, which owns the rule and its arithmetic.
>
> The number on the right of a basket row is the one thing on this screen everybody looks at and
> the one thing nobody can touch. Settling two of five takes a tap on the row, a sheet, a pane
> and a spinbutton; buying twenty because the shop has a sale on cannot be expressed at all.
>
> This plan makes that number the control. Drag it down and you have bought the difference. Drag
> it up and the basket will buy more.
>
> Prerequisite reading: `0043` sections 3 and 4 (the reel, why it commits once, and why the
> quantity is the state), `0044` section 4.2 (the two settle buttons this sits beside),
> `0052` section 6 (the status control on the row, which this shares its space with) and backend
> `0056` in full, including its section 3.2, which this screen has to draw the failure of.

## 1. What is being built

`QuantityReel`, on the basket row, bound to the **outstanding** number, with one write behind it.

| Piece | Where |
| ----- | ----- |
| The reel on the row, and the row still opening the sheet | `basket-line-row` |
| One call, both directions | `BasketApi.setOutstanding`, `BasketStore` |
| The sentence a lower says, before it is committed | `basket-line-row`, `en.json`, `es.json` |
| The stale line answer | `BasketStore`, `basket-error-copy.ts` |
| The same reel in the settle sheet's quantity pane | `settle-sheet` |

## 2. The gesture, and the two meanings

Backend `0056` section 1 is the rule and this screen is where it has to be legible without being
read:

- **Down** means bought. Five to three is two in the trolley, and it is exactly what "got some"
  does with fewer taps.
- **Up** means this basket will buy more than the households asked for. It is the sale, and
  nothing has been bought yet.

The screen does not explain this in a paragraph. It shows the consequence at the moment of the
gesture, which is section 3.

**The row still opens the settle sheet on a tap.** The reel is a separate target inside it and
takes the drag; the rest of the row takes the tap. `line-row` on the list page already lives with
exactly this arrangement, so the interaction is one somebody has met.

## 3. A lower says what it is about to record, before it records it

`QuantityReel` commits on release. Between the drag starting and the release, the row draws a
quiet caption under the number:

| Direction | Caption |
| --------- | ------- |
| down | "2 bought" |
| up | "buying 20 instead of 5" |
| back to the start | nothing |

This is not a confirmation dialog and must not become one. A dialog on a gesture done one handed
over a trolley is the thing `0043` removed from the list page. The caption is the confirmation:
it appears while the thumb is still down, it names the number and the verb, and letting go is the
commit.

The wording matters more here than anywhere else in the basket, because the **same control one
screen deeper means the opposite** (`0055`, changing what each list asked for, where lowering is
a household changing its mind and buys nothing). The two captions are written together and
reviewed together, and neither says "units" alone.

## 4. The one call

`BasketStore.setOutstanding(lineId, next)` sends `{ outstanding: next, from: current }` and
applies the returned line.

- **One call, not two.** The client never decides whether the drag was a purchase or a raise:
  backend `0056` section 3 makes that decision server side, on numbers only it can see, and a
  client that decided would get it wrong exactly when two phones are moving one line.
- **The response is a settle result in both directions.** A raise answers `skippedCount: 0`, so
  the existing skip reporting (`0049` section 1.2, and the named lists `0052` shipped) comes
  across unchanged and needs no branch.
- **The row is busy while it is in flight**, through the existing `busyLines` set, and the reel is
  `readonly` rather than disabled during it, which is what the input was built for: the number is
  real and worth reading while it settles.

### 4.1 The stale answer, and what the reader is told

Backend `0056` section 3.2 refuses a write whose `from` no longer matches, because a stale
gesture would invert its own meaning: what you meant as "I got one" would be applied as "buy one
more".

The screen's answer is not an error. The store refetches the line, the reel returns to the number
as it now stands, and the row says, once and quietly:

> Somebody else changed this line. It says 3 now.

That sentence is the whole feature of the refusal. Anything shorter ("that did not work") makes
somebody drag again into the same race, and anything longer is a paragraph in a shop.

It goes in `basket-error-copy.ts`, which `0052` section 7 created for exactly this: a failure with
no sentence is the defect that file exists to close.

## 5. Raising a finished line is not undoing it

A line that is done can be raised, and it goes back to partly settled. **No settlement is
reverted**, nothing is put back on any household's list, and the history says the same thing it
said before.

Undoing a purchase is the reopen control from `0052` section 6 and backend `0054` section 3,
which lives in the sheet, says what it is, and reverts the settlements that got the line there.
The two are drawn apart and worded apart:

| | Gesture | What it says |
| --- | --- | --- |
| Raise a done line | drag the reel up | we want more of this |
| Reopen | the sheet's control | that purchase did not happen |

Getting these two confused is the most likely misreading of this screen, which is why the raise
caption says "buying N" and never "N left".

## 6. The sheet keeps its buttons, and gets the reel

Nothing in `0044` section 4.2 is removed. "Got all", "got some" and "they had none" stay, and
they stay because they are the accessible, unambiguous path and because "they had none" has no
representation on a reel at all: `NOT_AVAILABLE` is an outcome and not a quantity, and a number
dragged to zero must never be able to mean the shop had none.

What changes in the sheet is the **quantity pane**. It draws its own spinbutton today, with a key
table copied out of `QuantityReel` and a comment saying it matches. It uses the reel instead, so
there is one number control in this product and one keyboard path through it. The comment in
`settle-sheet.ts` about matching the reel's table goes with it, since a copy that no longer
exists cannot drift.

## 7. Accessibility

- The reel is already a `spinbutton` with a full keyboard path, and it comes across with the
  component. `0044` section 7 required exactly that.
- Its accessible name on this screen is what it is bound to: how many are still to get. Not "how
  many to buy", which is the number underneath.
- The commit is announced politely with the same sentence the caption showed, so a reader who
  cannot see the caption still learns whether they recorded a purchase or raised a target.
- The row's own button keeps its full accessible name, which already carries the quantity, the
  product and the attribution. The reel is excluded from it rather than repeated inside it.
- The drag target is at least 44 square and is not adjacent to the row's own tap target in a way
  that makes one become the other. On the smallest supported width the reel keeps its size and
  the content truncates, because the number is the control and the text is not.

## 8. Acceptance criteria

- Dragging the number down by two records two bought, with the same allocation, events and skip
  report a "got some" of two produces.
- Dragging it to zero finishes the line, exactly as "got all" does.
- Dragging it up raises what the basket will buy, records no purchase, and changes no household's
  list.
- The caption under the number, while the thumb is down, names the number and says which of the
  two is about to happen, and letting go where it started does nothing.
- A line moved by somebody else in the meantime refuses the write, restores the true number, and
  says so in one sentence.
- Raising a finished line reopens nothing and reverts no settlement.
- The settle sheet's three buttons still work, and its quantity pane uses the same reel.
- A guest can do all of it.
- Tapping the row still opens the sheet, and dragging the reel never does.
- The spinbutton keyboard path works on the row and in the sheet, and both announce what they
  committed.
