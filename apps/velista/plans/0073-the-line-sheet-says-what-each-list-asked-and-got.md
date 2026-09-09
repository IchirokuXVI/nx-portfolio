# 0073: the line sheet says what each list asked for and got

> Server half: `apps/luna-shopper-backend/plans/0104`, which owns the arithmetic and the two
> writes this screen sends.
>
> The number on a basket row means two things today. Dragging it down records a purchase, and
> dragging it up says the basket will buy more than anybody asked for. Nobody standing in a shop
> reads it that way. They put a tin back and reach for the same number expecting it to undo what
> they just did, and instead the basket decides to buy nine.
>
> Under the number, the same confusion is split across two buttons. "Split between lists" says
> who got how many of what was just bought. "Change what each list asked for" opens a second
> sheet over the first and says who wanted how many. They are the same six rows, drawn twice, in
> two places nobody finds.
>
> This plan gives the row one meaning in each direction and puts the six rows on the sheet the
> shopper already opened, under the product they already picked.
>
> Prerequisite reading: `0054` (the reel on the row, whose raise this reverses), `0055` and
> `0068` (the units sheet, whose rows move here and whose file goes), `0052` section 6 (the
> reopen control on the row, which stays) and backend `0104` in full.

## 1. What is being built

| Piece                                                       | Where                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| The row's number: zero to what was asked, and up takes back | `basket-line-row`                                                     |
| The list summary, on the settle sheet, under the product    | `settle-sheet`                                                        |
| The units sheet, the allocate pane and their route, deleted | `line-units-sheet`, `settle-sheet`, `feature-shell/src/lib/routes.ts` |
| The bought write                                            | `BasketApi`, `BasketStore`, `basket-memory`                           |
| Every quantity control loses its plus and minus buttons     | `QuantityReel`                                                        |
| The copy                                                    | `en.json`, `es.json`                                                  |

## 2. The row's number

**It runs from zero to what the lists asked for.** `ceiling()` on `basket-line-row` is the line's
own `quantity` and no longer `LINE_QUANTITY_MAX` minus what is settled.

| Direction | What it does             | The caption while the thumb is down |
| --------- | ------------------------ | ----------------------------------- |
| down      | records that many bought | "2 bought"                          |
| up        | takes that many back     | "2 taken back"                      |

The caption is still the confirmation and is still not a dialog (`0054` section 3). What changes
is the second row of that table: "buying 20 instead of 5" goes, with the act it described.

A line of six that was dragged to zero and comes back to four is two bought and four still to
get, and the row draws itself partly settled again. That is the sentence this whole plan is for.

### 2.1 The reopen control stays

The row's reopen (`0052` section 6) is now the same act as dragging the number to the top, and it
stays because it is one tap and one target for the reader who cannot drag. `0054` section 5 said
the two were different things. They are not any more, and that section is retired rather than
worked around.

## 3. The summary, on the sheet the shopper already opened

The settle sheet keeps its title, its outstanding line and its product entry, in that order.
**The summary goes directly under the product entry**, above the settle buttons.

It is a heading, one row per list, and nothing else.

```
Milk
4 outstanding
Milk, semi skimmed                          Change
-------------------------------------------------
Lists that asked for this
  Flat                    asked for  4     got  2
  Parents' house          asked for  2     got  0
  3 more lists                                  v
-------------------------------------------------
[ Got all 4 ]  [ Got some ]  [ They had none ]
```

Both numbers on a row are controls. Both are reels, the same one control this product has
everywhere, and neither is a second copy of the other's rules.

- **Asked for** is what that list wants through this basket. It writes
  `BasketStore.setOriginQuantity`, unchanged from `0068`, floored at what that list has already
  got and capped at `LINE_QUANTITY_MAX`.
- **Got** is what this basket has bought for that list. It writes the new
  `BasketStore.setOriginSettled` (backend `0104` section 4), floored at zero and capped at what
  that list asked for.

**Raising "got" takes the outstanding number down by the same amount**, exactly as dragging the
row's number down does, and it is the same purchase written the same way. Lowering it takes a
purchase back for that list alone.

Under the rows, when the line's own quantity is above what the lists asked for, the one quiet
sentence `0068` already carries: "4 for these lists, plus 2 extra". Nothing creates that any more
(backend `0104` section 2.1) and the lines that have it are still readable.

### 3.1 What the sentence under the title becomes

`0055` section 5 put a permanent sentence on the units sheet saying that nothing on it was marked
as bought. It was true of that sheet and it is false of this one, so it goes.

Its job is done by the column headings instead. "Asked for" and "Got" are two words that say
which number is which, on rows that sit under the settle buttons the shopper came for.

### 3.2 The lists that did not ask

The collapsed container of `0068` section 4.3 comes across whole: closed by default, labelled
with its count, holding the lists that hold this line at zero, the candidates, and the lists that
hold no such line at all. A row there has an "Asked for" reel at zero and no "Got" number,
because a list that asked for nothing cannot have got any.

Raising one from zero puts the list on the line, which is the only way an added line reaches a
household (`0056`, folded into `0068`). Deleting the units sheet without keeping this would take
that away, and it is the one part of the old sheet that is not a duplicate of something else.

### 3.3 Who sees it

The all or nothing rule of `0044` section 4.1, which is what gated both deleted buttons: the
owner, or a registered participant holding `WRITE` on every source list.

**A guest sees the sheet without the summary**, and settles the whole line or part of it through
the buttons as they do today. A guest is never told which household a tin of tomatoes belongs to.

### 3.4 Reading it

The origins are read when the sheet opens, through the `getLineOrigins` call the units sheet made,
and the summary draws its own loading and failure states in its own block. **The settle buttons
never wait for it.** A shopper who opened the sheet to press "Got all" must not be held up by a
read about lists.

## 4. What goes

- **The allocate pane** and its entry, and every `basket.allocate.*` key. Saying who got how many
  is what the "Got" reels do, in the place the answer is read.
- **The units sheet**: `line-units-sheet`, its route `…/sheet/lines/:lineId/units`, its entry
  button and every `basket.units.open` reference. Its rows, its collapsed section, its ordering
  and its refusal sentences move into the settle sheet as they are.
- `0055` section 5's "nothing here is marked as bought" sentence, per section 3.1.

`BasketApi.getLineOrigins` and `setOriginQuantity` stay exactly as they are. The sheet that called
them is what goes, not the calls.

## 5. Quantity controls lose their buttons

`QuantityReel.hideButtons` defaults to `true`, and the one caller that passes it explicitly stops
passing it. The drag, the tap and the keyboard path are untouched.

This is a whole product change and not a change to the basket: the list page's rows, the edit line
sheet and every reel added since answer to the same default. `QuantityStepper`, which is a
different control with a different job in the line composer, is not touched.

## 6. Copy

Keys that go: every `basket.allocate.*`, and `basket.units.open`, `basket.units.notBuying`,
`basket.units.title`, `basket.units.close`.

Keys that move to the settle sheet unchanged: the rest of `basket.units.*`.

New and changed:

| Key                           | en                        |
| ----------------------------- | ------------------------- |
| `basket.units.lists`          | Lists that asked for this |
| `basket.units.got`            | Got                       |
| `basket.line.takenBack_one`   | 1 taken back              |
| `basket.line.takenBack_other` | {{count}} taken back      |
| `basket.units.gotLabel`       | {{name}}, got             |
| `basket.units.askedLabel`     | {{name}}, asked for       |

`basket.units.bought` is renamed to `basket.units.got` because the column is now a control and the
word beside it in the history is "got". Spanish beside each.

## 7. Accessibility

- Two reels on one row need two names that differ before the number: "Flat, asked for" and
  "Flat, got", which is what `basket.units.askedLabel` and `basket.units.gotLabel` are for.
- The summary is one `role="status"` region, as the units sheet was, so a change to either number
  is announced once and not twice.
- The collapsed container keeps its disclosure semantics and its count.
- The row's number keeps its own name, which is how many are still to get, and announces what it
  committed in the words the caption used.

## 8. Tests

1. The row's reel maxes at the line's quantity, and a line of six settled to zero offers a reel
   from zero to six.
2. Raising the row's reel sends `setOutstanding` with the new number and `from`, and the caption
   while the thumb is down says how many are taken back.
3. A line raised from zero to four draws itself partly settled with two got.
4. The summary draws under the product entry, one row per origin, with both numbers.
5. Raising a row's "got" reel takes the sheet's outstanding number down by the same amount.
6. Lowering it takes a purchase back for that list and leaves the other origins alone.
7. The "got" reel caps at what that list asked for, and the "asked for" reel floors at what it
   got.
8. A guest sees the buttons and no summary, and the origins are not read for them.
9. The collapsed container lists the lists that asked for nothing, and raising one puts the list
   on the line.
10. The summary's read failing leaves the settle buttons usable.
11. The units route resolves to nothing, and no component references it.
12. A reel drawn anywhere in velista has no plus or minus button.
13. The e2e that shops (`0050`) gains: settle a line to zero, raise it to two, and read the
    household's line asking for the rest.

## 9. Acceptance criteria

- The number on a row cannot go above what the lists asked for, and going up takes purchases back.
- A line dragged to zero and back to four says two bought and four to get, on the row and on the
  sheet.
- The sheet says, under the product, what every list asked for and what every list got, and both
  are numbers a reader who passes the rule can move.
- Raising what one list got reduces what is left to buy, and is the same purchase the row's number
  writes.
- Neither "Split between lists" nor "Change what each list asked for" exists, and nothing they did
  is now impossible.
- A list that asked for nothing is still reachable, still behind one control, and raising it still
  puts an added line on a household's list.
- A guest can still shop the whole basket.
- No quantity control in velista draws a plus or a minus button.
