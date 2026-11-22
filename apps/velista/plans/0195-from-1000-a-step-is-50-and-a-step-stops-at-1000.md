# 0195: from 1000 a step is 50, and a step stops at 1000

> Decided on 2026-11-22. From 1000 base units the stepper moves by at least 10 today (a
> hundredth of the top name, velista `0188` S7b). For a weight the base step of 25 g wins,
> so a kilo steps by 25 g. The owner wants 5% of 1000 instead: from 1000 every step is at
> least 50, so a kilo steps by 50 g. He also ruled that a press which would cross 1000 in
> either direction lands on 1000 first: a typed 1025 g goes down to 1000, not to 975, and a
> typed 990 g goes up to 1000, not to 1015. He dislikes rules for special cases and accepted
> this one.
>
> Amended on 2026-11-22 after the owner approved the mock: the stop at 1000 becomes one case
> of a general rule. The step rule takes a list of **snap points**, and 1000 is the one point
> it uses by default. A step that would pass a snap point lands on that point instead, in
> both directions. The basket row sheet's buy controls pass the list's ask as a second point
> (velista `0201` and `0204`), so a buy can land exactly on an ask that the step grid would
> skip. The mocks are `apps/velista/plans/mocks/basket-row-buys/` and
> `apps/velista/plans/mocks/compact-reel/`.
>
> Amends velista `0188` (S7b, the step rule) and velista `0186` decision D (on a product step
> of 100 a typed 975 g went to 1075; it now goes to 1000). Independent of every other plan of
> this round; it can be built and released alone. The reel of velista `0203` steps through
> the same functions and takes the snap points as an input, as the stepper does. Velista
> `0201`, `0203` and `0204` need this plan built first.
>
> Code anchors, on `dev` at `3f26ae3d3`: `libs/velista/models/src/lib/line-unit.ts:145`
> (`QUANTITY_COARSE_FROM`), `:148` (`QUANTITY_STEP`), `:175` (`baseStep`), `:201` to `:218`
> (`stepAt` and its doc comment), `:220` to `:238` (`stepFrom`), `:240` to `:261`
> (`canStepUp`); `libs/velista/models/src/lib/limits.ts:123` and `:124`
> (`LINE_QUANTITY_MIN`, `LINE_QUANTITY_MAX`); `libs/velista/ui/src/lib/list/quantity-stepper.ts:224`
> to `:235` (`lessStep`, `moreStep`, the step words in the buttons' accessible names);
> `libs/velista/models/src/lib/line-unit.spec.ts` (the step rule's specs).

## Brief for the agent

### Objective

Make every step from 1000 base units at least 50, and make a step that would pass a snap
point land on that point, in both directions, in the one place the step rule lives. 1000 is
the snap point by default; a caller can pass more.

### Context

- `stepAt(value, unit, step)` returns `max(base, 10)` from 1000 and `base` below it.
  `stepFrom` adds `stepAt(value)` going up, and going down takes away
  `stepAt(value - base)`, so plus then minus always returns.
- Every stepper reads these functions: the row and sheet steppers of velista `0188`, the
  product page's table, the catalog rows, the line sheet. Nothing else computes a step.
- `canStepUp` refuses a plus that would pass the most (99 999) or, for a count from 1000,
  one that would not change the short reading.
- The base steps a product can carry (`QUANTITY_STEPS`) all divide 1000, so an amount on
  its step's grid reaches 1000 exactly. Only a typed amount off the grid can cross 1000
  without landing on it. A list's ask is often off the grid (990 g on a step of 25), and
  that is why velista `0201` passes it as a second point.

### Target state

1. A new constant `QUANTITY_COARSE_STEP = 50` beside `QUANTITY_COARSE_FROM`, with a doc
   comment naming the owner's rule (5% of 1000).
2. `stepAt` returns `max(base, QUANTITY_COARSE_STEP)` from `QUANTITY_COARSE_FROM`, for every
   unit (a count steps by 50 from 1000 too).
3. **Snap points.** A new constant `QUANTITY_SNAP_POINTS: readonly number[] = [1000]` (that
   is, `[QUANTITY_COARSE_FROM]`), with a doc comment naming the owner's rule. `stepFrom` and
   `canStepUp` take an optional last argument `snaps`. When a caller leaves it out, it is
   `QUANTITY_SNAP_POINTS`, so the stop at 1000 holds everywhere with no work. A caller that
   passes its own list replaces the default, so a list that keeps the stop at 1000 names
   1000 too (`[...QUANTITY_SNAP_POINTS, ask]`). Only an empty list passed on purpose turns
   snapping off.
4. **The snap rule.** `stepFrom` first computes the step as before (the result `next`).
   Going up, if one or more points lie above `value` and at or below `next`, it returns the
   lowest of them. Going down, if one or more points lie below `value` and at or above
   `next`, it returns the highest of them. So when two points are close, a step lands on the
   nearest one in the direction of travel first: with points 990 and 1000, going up from 975
   gives 990 and then 1000; going down from 1010 gives 1000 and then 990. A point equal to
   `value` is not passed, so the step moves on from it. A point at or below 0, or above
   `LINE_QUANTITY_MAX`, is ignored. Never under 0, as today.
5. **A floor or a ceiling of the caller.** A stepper or reel whose `min` is above 0, or
   whose ceiling is below `LINE_QUANTITY_MAX`, never lands on a point outside its range: a
   point below its `min` or above its ceiling is ignored. One helper in `line-unit.ts`
   (`snapPointsWithin(snaps, min, max)`) drops those points, and both controls call it, so
   no caller writes its own filter or clamp.
6. **After a snap off the grid.** A step that lands on a point off the step grid (990 with a
   step of 25) leaves the amount there, and the next step away from it moves by the step
   from that amount, as a typed amount does today: 990 down is 965. This follows from the
   rule of `stepFrom`; the owner has not ruled on it, and the builder does not add a snap
   back to the grid.
7. Plus then minus still returns to the start for every amount on a step's grid when no
   point lies between them. For an amount that crossed a point, it returns to the point,
   which is the rule.
8. **The controls take the points.** `QuantityStepper` (`quantity-stepper.ts`) gains an
   input `snaps: readonly number[]`, default `QUANTITY_SNAP_POINTS`, and passes it, through
   `snapPointsWithin` with its `min` and ceiling, to every `stepFrom` and `canStepUp` call
   (a press, a key, a hold). The reel of velista `0203` takes the same input with the same
   default. Who passes a second point is the business of velista `0201` (the buy steppers of
   the basket row sheet) and velista `0204` (its reels). Everywhere else only 1000 applies,
   and no other caller passes `snaps`.
9. The words of the buttons' accessible names say what the next press moves: `moreStep`
   uses the real difference (`stepFrom(value, 1) - value`), as `lessStep` already does, so a
   plus at 990 g says "10 g". Both read the same `snaps` the press uses, so a plus at 975 g
   with an ask of 990 g says "15 g".
10. `canStepUp` keeps its two rules over the new results.
11. The doc comments of `stepAt`, `stepFrom`, `QUANTITY_COARSE_FROM` and
    `QUANTITY_SNAP_POINTS` state the new rule and its examples (1000 g to 1050 g; 1025 g
    down to 1000 g; 990 g up to 1000 g; a count at 1000 to 1050; with points 990 and 1000,
    975 up to 990 then 1000).

### Scope

- Work in `libs/velista/models/src/lib/line-unit.{ts,spec.ts}`, and in
  `quantity-stepper.ts` and its spec (the `snaps` input and the step words).
- Do NOT pass a second point from any page here. Velista `0201` and `0204` do that.
- Do NOT change the short reading (`shortAmount`, `shortHundredths`) or the ceiling.
- Do NOT change the backend: it holds no step grid (velista `0186`, decision D).

### Constraints

- No dashes as punctuation in comments.
- The rule lives in `line-unit.ts` only (`stepFrom`). No caller adds its own clamp or its
  own snap.

### Action boundaries

- Stop and ask if a spec of another library fails because it asserted a 25 g step from a
  kilo or a step of 10 for a count from 1000, and the new value is not obviously what the
  owner ruled.

### Progress evidence

`npx nx affected -t lint test`; the specs of section 1 passing.

## 1. Specs

In `line-unit.spec.ts`:

1. Grams, no product step: 975 up 1000, 1000 up 1050, 1050 down 1000, 1000 down 975.
2. Grams, typed: 990 up 1000; 1025 down 1000; 1010 up 1060 and back down to 1010.
3. Grams, product step 100: 900 up 1000, 1000 up 1100; typed 975 up 1000.
4. Grams, product step 5: 995 up 1000, 1000 up 1050.
5. Millilitres behave as grams.
6. Count: 999 up 1000, 1000 up 1050, 1050 down 1000, 1000 down 999.
7. `canStepUp` at 99 950 is false for grams (the plus would pass 99 999).
8. For every amount on the grid of each base step from 0 to 3000, plus then minus returns
   to the start.
9. With `snaps` left out, the result equals the result with `[1000]`.
10. Points 990 and 1000, grams: 975 up 990, 990 up 1000; 1010 down 1000, 1000 down 990.
11. A point equal to the value is not a stop: points 990 and 1000, 990 down 965 and 990 up
    1000.
12. Off the grid after a snap: points 990 and 1000, 990 down 965, 965 down 940.
13. A point at or below 0, or above 99 999, is ignored; `snapPointsWithin([1, 1000], 1,
    99999)` drops the 1, and a point below the caller's `min` is never a result.
14. An empty list passed on purpose snaps nowhere: 990 up 1015, and 1025 down 975 (1025
    minus the step of 50 at 1000).

In `quantity-stepper.spec.ts`: the plus at 990 g is named with "10 g", at 1000 g with
"50 g"; with `snaps` `[990, 1000]` the plus at 975 g lands on 990 and is named with "15 g";
with no `snaps` input the stepper stops at 1000.

## 2. Acceptance criteria

- A kilo steps by 50 g with the buttons and with a hold.
- No press crosses 1000 without stopping on it, unless the caller passed an empty list on
  purpose.
- A caller that passes another point lands on it exactly, in both directions.
- Every stepper of the app shows it, with no change outside `line-unit.ts`, the stepper's
  `snaps` input and the step words.

## Not in this plan

- The hold's timing (velista `0194`).
- The list's ask as a snap point on the basket row sheet (velista `0201`, `0204`).
