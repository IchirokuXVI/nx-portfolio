# 0012 (backlog) What a piece weighs

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> **Priority: low.** Nothing is wrong without it. A line of five tomatoes on a shelf that prices
> them per kilogram shows "1,99 €/kg" and no amount, which is honest, and the design series
> `0095`, `0096`, `0101` and `0102` was written so that this file is the only thing missing when
> somebody wants that amount. It is numbered `0012` and not `0011` on purpose: backlog `0011` was
> retired into `0095`, and three plans still cite it by that number.

## What was refused, and why

Plan `0096` separates what a shopper counts from what a shop measures, and leaves one question
open on purpose: **when a line counts pieces and the shop prices by weight, what does a piece
weigh?** Four answers were considered while `0096` was designed, and each was set aside for a
stated reason. They are recorded here so the next person does not rediscover them.

### 1. An approximate weight per piece, on the item

`approxPieceGrams` on `items`: a tomato is about 150 g, a sea bream about 400 g, so five
tomatoes are about 750 g and the amount is the per kilogram figure times that, marked as an
estimate. It is the direct answer.

**Refused because nothing states the number.** No storefront fixture carries one, no leaflet
prints one, and the catalog has several thousand products. An operator typing a weight for
every piece of produce and every fish is the kind of manual work that never finishes, and a
column that is null on nine products in ten answers a blank where a blank already is.

Under `0102` this is not a new design. It is the `GRAM` row of `item_unit_equivalences` for an
item measured in `UNIT`, which the table already holds for every packed product with a size.
What is missing is a source for produce and fish, not a column. If Mercadona's public API is
found to flag approximate weight pieces with the weight beside them, which the checked in
fixtures do not show, the adapter states it and the row fills itself.

### 2. The same weight, defaulted from the product group

A tomato weighs about the same in every chain, so `approxPieceGrams` on `product_groups`, with
the item overriding it. A few hundred groups is a job an operator finishes.

**Refused with the first**, for now: it is the same number stated once instead of many times,
and it is still a number nobody has. It is the cheaper of the two and is the one to build first
if this file is ever picked up.

### 3. Slices as a unit

A deli counter asks "how much" and a shopper answers "five slices". A `SLICE` measurement unit
with a small weight per slice prices it.

**Refused** because a slice is a piece with a bridge weight, which is answer 1 again with a
name, and because the base units of `0096` were chosen to be the ones a till prints. A slice
can return as a unit when the vocabulary grows. It is not a price fact.

### 4. Learning the weight from receipts

A till receipt prints the weighed grams on every weighed line, and backlog `0008` plans to read
receipts. Each read can store what a line actually weighed and refine a group's bridge weight
from many receipts, without asking the shopper anything.

**Deferred to `0008`**, because it is a consequence of reading receipts and not a design of its
own. When receipts are read, the weighed grams belong beside the settlement, and the average
per piece is a query over them.

## What picking this up takes

- Answer 2 first: one nullable column on `product_groups`, the item override through the
  `0102` table, a picker on the group form, and one row in the pricing table of `0096`
  section 5 for a `UNIT` line on a `GRAM` item, marked as an estimate.
- A source for the numbers, which is the real work: a capture of a storefront that states
  them, or an operator's afternoon over the produce groups.
- Nothing in velista beyond the mark it already draws.
