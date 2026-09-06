> **PR:** [#261](https://github.com/IchirokuXVI/nx-portfolio/pull/261)

# 0069: the pick sheet splits the line

> The product pane of the settle sheet lists a line's options and lets the shopper tap one.
> One. A shopper holding three skimmed and two whole taps whichever they hold in the hand that
> is free, and the other two units are recorded as the wrong milk.
>
> Backend `0094` made choosing several products a split: the line keeps one product and the
> balance, and one row per other product appears under it, ready to be settled on its own.
> This plan turns the pane's radio group into one stepper per product, with the line's own
> product showing what is left, and puts the new rows where the shopper is looking.
>
> Prerequisite reading: `0062` section 5 (the pane as it is, and the price and place each
> option carries, which stay), `0054` (the reel on the row, which is untouched), `0031` (a sheet
> whose line disappears must not strand the back gesture) and backend `0094` (the write, its
> stale guard, and the merge rule the fake must copy).

## 1. What is being built

| Piece                                                 | Where                                   |
| ----------------------------------------------------- | --------------------------------------- |
| The product pane: steppers, a computed balance, one commit | `settle-sheet`                      |
| The rows the answer creates, placed under the original | `BasketStore`, `basket-page`           |
| The write, and the fake's split and merge             | `BasketApi`, `BasketStore`, `basket-memory` |
| The models                                            | `libs/velista/models`                   |
| The copy                                              | `en.json`, `es.json`                    |

`BasketApi.setPick` and `BasketStore.setPick` go, replaced by `splitLine`. Nothing else on
the settle sheet changes: got all, got some, they had none, the allocation pane and the way
into the units sheet are as they were.

## 2. The pane

Opened as today, from the settle sheet's product entry, for a line with two or more options.
A line with one option has nothing to move and does not offer the pane, as a line with no
options never did.

Top to bottom:

1. The title asks the question the pane exists for: "Which did you get?"
2. The hint: "Move units to the milks you got. Milk, Skimmed keeps the rest."
3. One row per option, in the line's own option order, never re-sorted (`0062` section 5.2).
   The name, the price and the place stay exactly as `0062` draws them. What changes is the
   trailing edge:
   - **The line's own product** shows a number and no control: the balance, which is the
     outstanding amount minus every other row's stepper. It moves as the others move, and it
     is labelled "gets the rest".
   - **Every other product** shows a stepper from zero to the balance plus its own value, so
     the sum can never exceed the outstanding amount and the balance can never go negative.
4. One primary button, "Apply", and a quiet cancel. The split commits **once**, on the
   button, because each stepper move is a fragment of one decision and creating a row per
   tick would draw and fold rows while the thumb is still moving.

A line whose product is null (a group added line that was never picked) has no "own" row to
hold the balance. Its balance is drawn as a row of its own at the top, "no product chosen,
gets the rest", so the rule reads the same and the shopper sees what an unpicked remainder
means.

### 2.1 What the pane says a split is not

Under the button, one quiet sentence, because this pane used to change the record of a
purchase and now changes only what is still to buy:

> This changes which rows to buy. Nothing is marked as bought.

## 3. Committing

One write, `splitLine`, carrying `from` as the outstanding amount the pane opened with and
one share per stepper above zero. On success the sheet dismisses to the page (section 4). A
stale `from` is drawn under the button as `0054` section 4.1 draws a stale reel, with the
same sentence, and the pane reloads its numbers.

When every unit was moved and the line had nothing settled, the answer's `line` is the same
id with a new product (backend `0094` section 2.2), which the store merges by id like any
update. When a share landed on a sibling that already existed, that sibling arrives in
`merged` and the store merges it too. Nothing in the client decides which of the two
happened.

### 3.1 A line that disappears under an open sheet

Moving every unit of a sibling back to a product that already has a row folds the sibling
away, and the sheet that made the request is about a line that no longer exists. The sheet
dismisses with the page as its fallback, before the store applies the removal, so the back
gesture (`0031`) never lands on a sheet about nothing. The same handling covers a removal
that arrives over the socket while the pane is open.

## 4. Where the new rows go

The answer carries `created` with positions between the original and its next line. The store
already orders lines by position, so the rows fall into place under the original with no
client rule. `basket-page` scrolls nothing and announces once, through its live region: "Milk
split into 2 rows".

Each new row is an ordinary row (`0052`, `0054`): its own status control, its own reel, its
own product name. The shopper settles "Milk, Whole 3" and "Milk, Lactose free 2" as two lines,
which is what they are.

## 5. The models and the fake

`BasketLine` is unchanged: one `pickId`, one quantity, as before. A `BasketSplitResult`
model carries `line`, `created`, `merged` and `removed`, mapped from `unknown` (rule D4).

`basket-memory` implements the split and the merge rule of backend `0094` section 5, tie
break and survivor included, because the pane's specs and the e2e walk it without a backend
and a fake that merged by name alone would pass a sheet the server refuses.

## 6. Accessibility

- The balance is a `role="status"` region, so a screen reader hears it move without a live
  region per stepper.
- Each stepper carries the product's name in its own label: "Milk, Whole, units".
- The apply button is disabled while a write is out, and the sheet's one live region says
  the result.

## 7. Copy

| Key                               | en                                                       |
| --------------------------------- | -------------------------------------------------------- |
| `basket.product.title`            | Which did you get?                                       |
| `basket.product.hint`             | Move units to the ones you got. {name} keeps the rest.   |
| `basket.product.rest`             | gets the rest                                            |
| `basket.product.noneRest`         | no product chosen, gets the rest                         |
| `basket.product.apply`            | Apply                                                    |
| `basket.product.notBought`        | This changes which rows to buy. Nothing is marked as bought. |
| `basket.product.split`            | {name} split into {count} rows                           |

Spanish beside each. `basket.product.current` goes, since no row is "current" any more, and
`basket.product.cheapest` stays.

## 8. Tests

1. The pane draws a stepper on every product but the line's own, and the balance is the
   outstanding amount minus the steppers' sum.
2. A stepper cannot exceed the balance plus its own value, and the balance never reads below
   zero.
3. Apply sends one share per stepper above zero with `from` as the outstanding amount, and
   nothing for a stepper at zero.
4. The answer's created rows land under the original in the store's order, and the page
   announces the split once.
5. A merged sibling and a reassigned original are merged by id, and a removed id leaves the
   store.
6. A sheet about a removed line dismisses to the page.
7. A null product line draws the balance row at the top.
8. The fake's merge picks the same product, then the product free line, then the earliest.
9. The e2e that shops (`0050`) gains: split milk into two, settle each, read the household's
   line with two settlements naming two products.

## 9. Acceptance criteria

- Choosing several products is done with steppers, the line's own product takes the rest,
  and the sum can never exceed what is outstanding.
- One commit creates the rows, they appear directly under the original, and each is settled
  on its own.
- Moving units back to a product that has a row raises that row and folds the empty one away,
  and no sheet is left open about it.
- The pane says it marks nothing as bought, and it does not.
- A guest can do all of it.
