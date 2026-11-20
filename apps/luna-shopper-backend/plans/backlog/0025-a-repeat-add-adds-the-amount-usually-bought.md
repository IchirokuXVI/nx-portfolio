# 0025 (backlog) A repeat add adds the amount usually bought

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Written on 2026-11-11 so the owner's first wish of 2026-11-10 is not lost: at an add of
> something already on the list, add the amount the person usually buys, "the MEDIAN of the
> amounts they bought for that line". On 2026-11-11 the owner: "the median isn't developed". So
> plan `0260` (amended that day) adds nothing at such an add and shows the line, and velista
> `0185` draws it. This file holds what exists, what would have to be decided and what a shopper
> would see. Code anchors were read on `origin/feat/velista-0183-line-unit-chip` on 2026-11-11.

## What exists today

- **A median of days, not of amounts.** `periodOf`
  (`apps/luna-shopper-backend/core/src/app/lists/suggestions/suggestion-rules.ts:120` to `:148`)
  folds the purchases of a line into trips (`mergePurchases`, `:75` to `:97`, twelve hour
  sessions) and takes the median **gap in days** between them, from three merged purchases
  (`SUGGESTION_MIN_PURCHASES`). It never reads an amount: it passes `quantity: 0` to the fold
  (`:127`).
- **The amount a suggestion offers is the last one, not a median.** `suggest`
  (`core/src/app/lists/suggestions/suggestions.service.ts:172` to `:219`) offers what the newest
  ended basket trip asked for the line while that trip is still the last word on it, else the
  units of the last merged purchase, never below 1 (`:211` to `:214`). Plan `0123` section 5 and
  plan `0142` section 8.2 decided that.
- **Each merged purchase already carries its summed amount** (`MergedPurchase.quantity`,
  `suggestion-rules.ts:42` to `:46`), so a median of amounts over merged purchases is one sort
  away from the data the suggestions already read.
- **The add has no place to put it.** Plan `0260` makes an add that meets a wanted line write
  nothing (`ALREADY_ON_LIST`) and raises a line kept at 0 by one step. This plan would change the
  second case, and perhaps the first.

## What would have to be decided

1. **Which adds use it.** Only a line kept at 0 (the line was bought and is wanted again), or
   also a wanted line (which A1 of `0260` says must not change)? The writer's reading: only a kept
   line, because A1 stands and the median is "what you usually buy when you buy it again".
2. **How many buys make a median.** Three merged purchases, as `periodOf` asks, or fewer? With
   one or two the median is the last amount, which the suggestion already offers.
3. **Per person or per household.** A settlement names who bought (unverified: the column the
   builder reads), but a line is the household's. The household's buys are the line's history; one
   person's would differ when two people shop differently.
4. **Per line or per product.** A line can change product (velista `0183`, several products), and
   a product can sit on two lines. Per line is what the owner said; per product would carry over
   to a new line of the same product.
5. **The unit.** A line's buys are in its unit since backend `0246`; a buy written before a unit
   change counts in another unit and must be left out, not converted (U2 of `0260`).
6. **Whole packs.** Backend `0259` (PR #962) separates what was wanted from what was paid for in
   whole packs. Which of the two is "the amount bought": the amount asked for, or the packs paid?
7. **What "bought" counts.** Only `BOUGHT` settlements, as the suggestions read; a partial buy of
   a trip folded into the trip, as `mergePurchases` folds it.
8. **Rounding.** A median of grams can fall between steps; it would round to the line's step
   (25 g today, the product's step after backend `0261`).
9. **Where it is computed.** In core at the add, with the same read the suggestions use, under the
   list lock; or kept on the line and refreshed at each settle.

## What the shopper would see

- A typed name or a catalog plus for a line kept at 0 takes the line to the usual amount ("750 g")
  instead of one step, and the page marks the line as velista `0170` and `0185` mark a raise.
- A line with too few buys behaves as `0260` says today: one step.
- If question 1 is answered "also a wanted line", the add raises a wanted line by the median, which
  reverses A1 and needs the owner's word first.

## Not in this plan

- The suggestions' period and their offered amount (plans `0123`, `0142`), which stay as they are.
- A conversion between units (backlog `0024`).
