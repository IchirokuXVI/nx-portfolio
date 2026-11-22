# 0195: from 1000 a step is 50, and a step stops at 1000

> Decided on 2026-11-22. From 1000 base units the stepper moves by at least 10 today (a
> hundredth of the top name, velista `0188` S7b). For a weight the base step of 25 g wins,
> so a kilo steps by 25 g. The owner wants 5% of 1000 instead: from 1000 every step is at
> least 50, so a kilo steps by 50 g. He also ruled that a press which would cross 1000 in
> either direction lands on 1000 first: a typed 1025 g goes down to 1000, not to 975, and a
> typed 990 g goes up to 1000, not to 1015. He dislikes rules for special cases and accepted
> this one.
>
> Amends velista `0188` (S7b, the step rule) and velista `0186` decision D (on a product step
> of 100 a typed 975 g went to 1075; it now goes to 1000). Independent of every other plan of
> this round; it can be built and released alone. The reel of velista `0203` steps through
> the same functions and gets this rule with no work of its own.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/models/src/lib/line-unit.ts:145`
> (`QUANTITY_COARSE_FROM`), `:148` (`QUANTITY_STEP`), `:175` (`baseStep`), `:201` to `:218`
> (`stepAt` and its doc comment), `:220` to `:238` (`stepFrom`), `:240` to `:261`
> (`canStepUp`); `libs/velista/ui/src/lib/list/quantity-stepper.ts:224` to `:235`
> (`lessStep`, `moreStep`, the step words in the buttons' accessible names);
> `libs/velista/models/src/lib/line-unit.spec.ts` (the step rule's specs).

## Brief for the agent

### Objective

Make every step from 1000 base units at least 50, and make a step that would cross 1000
land on 1000, in both directions, in the one place the step rule lives.

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
  without landing on it.

### Target state

1. A new constant `QUANTITY_COARSE_STEP = 50` beside `QUANTITY_COARSE_FROM`, with a doc
   comment naming the owner's rule (5% of 1000).
2. `stepAt` returns `max(base, QUANTITY_COARSE_STEP)` from `QUANTITY_COARSE_FROM`, for every
   unit (a count steps by 50 from 1000 too).
3. `stepFrom` going up: if `value < 1000` and the result is above 1000, it returns 1000.
   Going down: if `value > 1000` and the result is below 1000, it returns 1000. Never under
   0, as today.
4. Plus then minus still returns to the start for every amount on a step's grid. For an
   amount off the grid that crossed 1000, it returns to 1000, which is the rule.
5. The words of the buttons' accessible names say what the press moves: `moreStep` uses the
   real difference (`stepFrom(value, 1) - value`), as `lessStep` already does, so a plus at
   990 g says "10 g".
6. `canStepUp` keeps its two rules over the new results.
7. The doc comments of `stepAt`, `stepFrom` and `QUANTITY_COARSE_FROM` state the new rule
   and its examples (1000 g to 1050 g; 1025 g down to 1000 g; 990 g up to 1000 g; a count
   at 1000 to 1050).

### Scope

- Work in `libs/velista/models/src/lib/line-unit.{ts,spec.ts}` and the stepper's step
  words in `quantity-stepper.ts` and its spec.
- Do NOT change the short reading (`shortAmount`, `shortHundredths`) or the ceiling.
- Do NOT change the backend: it holds no step grid (velista `0186`, decision D).

### Constraints

- No dashes as punctuation in comments.
- The rule lives in `line-unit.ts` only. No caller adds its own clamp.

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

In `quantity-stepper.spec.ts`: the plus at 990 g is named with "10 g", at 1000 g with
"50 g".

## 2. Acceptance criteria

- A kilo steps by 50 g with the buttons and with a hold.
- No press crosses 1000 without stopping on it.
- Every stepper of the app shows it, with no change outside `line-unit.ts` and the step
  words.

## Not in this plan

- The hold's timing (velista `0194`).
