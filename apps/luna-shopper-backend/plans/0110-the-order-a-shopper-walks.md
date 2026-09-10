# 0110: the order a shopper walks

> Client half: `apps/velista/plans/0075`, whose "The way you shop" radio is this order and
> draws nothing of its own for it.
>
> A basket's lines are written in the order the source lists happened to be read, list by
> list, position by position, and the page draws them so. Somebody who has shopped the same
> supermarket every Saturday for a year settles milk, then skimmed milk three seconds later,
> then juice ten seconds after that, because those are aisles, and the list still puts the
> juice first because it was written first.
>
> This plan writes each new basket's positions from the timing of the owner's past trips.
> It is computed once, when the basket is created, and never recomputed.
>
> Prerequisite reading: `0050` (composing a basket, and where `position` is written), `0047`
> and `0093` (settlements, and the ones that wait for a list), `0104` (reverting, which is
> why `revertedAt` matters here) and the sweep (`generated-list-sweep.service.ts`, which is
> what turns a forgotten basket into a completed one).

## 1. What is being built

| Piece                                                   | Where                                          |
| ------------------------------------------------------- | ---------------------------------------------- |
| The history read: offsets per product over past trips   | a new `generated-list-order.service.ts`, SQL in `generated-list.sql.ts` |
| The order, applied before the write                     | `generated-list.service.ts`, `create`          |

No contract changes, no migration, no route. `position` exists, `double precision`, and the
read already orders by it.

## 2. The history

The owner's last **seven** trips: baskets with `ownerUserId` equal to the caller, status
`COMPLETED` or `ARCHIVED`, **with at least one live settlement**, ordered by `generatedAt`
descending, `id` descending, the tie break `listMine` pages on. A basket nobody settled
anything in is not a trip and does not use one of the seven.

For each trip, its lines and their live settlements, `line_settlements` joined on
`generatedListLineId` with `revertedAt IS NULL`, **both outcomes**: a line closed as not
available was still a shelf the shopper stood at. Then:

- The trip's start is its earliest `settledAt`.
- A line's offset in that trip is its earliest `settledAt` minus the start, in seconds. A
  line settled twice, in two shops, counts from the first.
- A line with no settlement in a trip has no offset in that trip and contributes nothing.

One SQL query, `ORDER_HISTORY_SQL`, answering `(key, offsetSeconds)` rows, from which the
service takes the **median** per key over however many trips the key appears in. One trip
is a median of one. There is no default for a key that appears in none.

### 2.1 What "the same product" is

Two keys, tried in this order, for matching a composed line against a past line:

1. **The product.** A past line's `itemId`, or the `itemId` its settlement copied, is among
   the composed line's options. A line whose pick was swapped in the aisle still matches
   the line it came from, because the option set is what the run composed from.
2. **The text.** `normalizeContent` of both contents agree. This is the key `mergeKey`
   already uses when a line has no products, and it is the only key a free text line has.

A composed line takes the first key that finds history. Nothing else matches: a product in
the same group, a similar name, are not the same product, and a wrong match puts the bread
in the dairy aisle.

## 3. The order

`create` calls `GeneratedListOrderService.order(userId, composed)` after `compose` and
before `write`, and `write` takes the positions from what comes back rather than from the
array index:

1. Lines with a median offset, ascending. Two equal offsets keep their composed order.
2. Then lines with none, ordered by `normalizeContent(content)` ascending, which is A to Z
   without accents or case getting in the way.

Positions are `index + 1` over that order, as today. The read is unchanged, `ORDER BY
position ASC, createdAt ASC`, and so is everything that writes a position later: a typed
line takes `MAX(position) + 1`, a split takes the midpoint, the owner's reorder route
rewrites them all. None of those recompute anything, and neither does a settle. **The order
is written once.**

A first basket, with no history, is every line in the second half, A to Z, which is a
better order than the one it has today.

### 3.1 Cost

One query per `create`, bounded by seven trips' lines and settlements, on indexes that exist
(`ix_generated_lists_owner`, `ix_settlements_basket_line_live`). No cache, because a create
is rare and the answer changes with every trip.

## 4. What this plan does not do

- It does not learn while the trip runs. The order is the basket's, written at creation,
  and a line typed in the aisle goes last.
- It does not key on the profile. `generated_lists` carries no profile column, only the
  snapshot, and the owner's trips are the owner's wherever they shopped.
- It does not change `resolvePick`. The first option is still the pick.
- It does not touch the list page. A list's order is the aisles as its author wrote them
  (`0012` section 9), and this is the basket's.

## 5. Tests

1. Three past trips settling milk, then skimmed milk, then juice, in that order, produce a
   basket ordered milk, skimmed milk, juice, whatever order the lists were read in.
2. A product present in two of seven trips takes the median of two, and a product in none
   goes after every product with history, A to Z by normalized content.
3. A reverted settlement is ignored, and a NOT_AVAILABLE one counts as a visit to the shelf.
4. A line settled twice in one trip counts from its first settlement.
5. A basket with no live settlement is not one of the seven.
6. A past line matches by option set when the pick was swapped, and a free text line
   matches by normalized content.
7. Positions are `1..n` over the new order, and the read returns them in that order.
8. A typed line, a split and the reorder route still write positions as they do today.
9. The query runs once per create (integration, counted).

## 6. Acceptance criteria

- A new basket for a shopper with past trips opens in the order those trips were walked.
- Products the shopper has never settled come after the ones they have, alphabetically.
- The order is computed at creation and nothing afterwards recomputes it.
- A shopper's first basket opens alphabetically.
