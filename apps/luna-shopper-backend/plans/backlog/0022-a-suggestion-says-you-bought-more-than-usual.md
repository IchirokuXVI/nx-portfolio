# 0022 (backlog) A suggestion says you bought more than usual

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Recorded on 2026-11-09 from the owner's words while plan `0259` was decided. Backend `0259`
> stores on each settlement how much of a buy the line asked for (`wanted`), so an over buy is
> a fact: two 750 g packs for a 1 kg line, a 6 pack because the usual 3 pack was out, a second
> jar because it was on offer. The suggestions of plan `0123` read the median gap between
> purchases to say when a line is due again, and velista `0089` draws the due lines under the
> list. Neither knows that the last buy was bigger than usual. This plan makes a due line say
> so.
>
> Needs backend `0259` built, so that `line_settlements.wanted` exists and the over buy is
> stored. Velista half: a sentence on the due row of velista `0089`.
>
> Prerequisite reading: `0123` sections 3 and 4 (the two rules), `0125` (the due lines read),
> `0142` section 8.2 (the quantity a due line proposes), `0259` sections 0 and 1, velista
> `0089` section 2. Code: `core/src/app/lists/suggestions/suggestion-rules.ts`,
> `suggestions.service.ts`, `libs/velista/models/src/lib/due-lines.ts`.

## Brief for the agent

### Objective

When a line is due and its last purchase bought more than the line asked, say so on the due
row: "you bought 500 g more than usual last time, maybe you do not need it yet". Change
nothing about when a line is due or how much it proposes.

### Context

- `mergePurchases` folds the settlements of one trip into one purchase with `quantity` summed
  (`suggestion-rules.ts:75-90`); the period rule takes the median gap between merged purchases.
- `DueLine.quantity` is "what the last basket asked, else the last purchase" (`due-lines.ts:36-37`).
- After `0259` each `BOUGHT` settlement carries `quantity` and `wanted`, so a merged purchase
  can carry `over = Σ (quantity − wanted)`.

### Target state

1. The `Purchase` the rules read carries `wanted`, and a merged purchase carries `over`.
2. `DueLineView` gains `lastOver: number | null`: the over buy of the newest merged purchase
   when it is above zero, in the line's unit, else null. The timing and the proposed quantity
   do not change (the owner: "that doesn't need to change").
3. Velista's due row draws one sentence under the reason when `lastOver` is set: "Last time
   you got 500 g more than usual, you may not need it yet" (`en`), "La última vez cogiste
   500 g de más, puede que aún no lo necesites" (`es`), through `formatQuantity` of `0182`.

### Scope

- Work in `core` (the suggestions read and its rules), `contracts` (the view), velista
  `models`, `data-access`, and the due row in `feature-lists`, and the two i18n files.

### Constraints

- The rules stay pure and read a `now` the caller passes. No clock, no calendar day.
- The median and the proposed quantity are untouched. This plan adds words, not arithmetic.
- No dashes as punctuation in any prose or copy.

### Action boundaries

- Proceed with sections 1 to 2 once the owner moves this plan into `plans/`.
- Stop and ask if `0259` is not in `dev`.

### Progress evidence

Specs of the rules with an over bought newest purchase and with none; the due lines read
answering `lastOver`; a slot walk with a line bought at 1,5 kg for 1 kg, due again, drawing
the sentence.

## 1. Open decisions, the owner's

- **D1. The sentence or a smaller proposal?** The owner's words: the timing and the amount
  stay, and a message says you may not need it. This plan takes the words. A later version
  could lower the proposed quantity by the over buy, which the owner has not asked for.
- **D2. Which purchase counts.** The newest merged purchase only. An over buy two trips ago
  was consumed by now or it was not, and the median already absorbed the gap.
- **D3. Where the sentence stops.** Whether the sentence also appears on the line page's
  history header, next to "every N days", is not decided. The due row is the one place the
  owner named.

## 2. The rule

```ts
/** The over buy of the newest merged purchase, or null when it bought what was asked. */
export function lastOverOf(merged: readonly MergedPurchase[]): number | null;
```

`mergePurchases` sums `over` as it sums `quantity`. `lastOverOf` reads the last merged
purchase and answers `over` when it is above zero. The due lines read puts it on the view
beside `quantity`, and velista maps it to `DueLine.lastOver` and draws the sentence.

## Not in this plan

- **Putting a suggestion off for a while.** Backlog `0023`, the owner's second idea of the
  same day.
- **Lowering the proposed quantity.** D1.
