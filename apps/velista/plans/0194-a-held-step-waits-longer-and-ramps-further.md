# 0194: a held step waits longer and ramps further

> Decided on 2026-11-22. The owner wants the repeat of a held minus or plus to start a bit
> later, to speed up faster, and to keep speeding up for longer. He asked for 25% on each.
> The three cannot all hold over the same top speed: a steeper ramp from the same first
> interval reaches the old top speed sooner, so it lasts longer only if the top speed rises.
> He accepted the numbers below on 2026-11-22 and will judge them on a phone.
>
> Amends velista `0188` (the hold's numbers). Independent of every other plan of this round;
> it can be built and released alone. Velista `0193` changes the same repeat's pointer
> handling in another file; build them in either order.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/models/src/lib/limits.ts:127` to
> `:143` (`QUANTITY_HOLD_DELAY_MS`, `QUANTITY_HOLD_FIRST_MS`, `QUANTITY_HOLD_FACTOR`,
> `QUANTITY_HOLD_FASTEST_MS`, `QUANTITY_STEP_QUIET_MS` and their doc comments);
> `libs/velista/ui/src/lib/list/quantity-stepper.ts:555` to `:585` (`_repeat`, which reads
> them); the hold specs in `quantity-stepper.spec.ts` and any spec that names the old
> intervals (search for `255`, `217` and `QUANTITY_HOLD_`).

## Brief for the agent

### Objective

Change the four numbers of the hold, and every comment and spec that states them, so the
repeat starts after 500 ms and ramps from 300 ms to 60 ms by a factor of 0.8125.

### Context

- Today: the wait is 400 ms, the intervals are 300, 255, 217, 184, 157, 133, 113, then
  100 ms (factor 0.85). The ramp lasts about 1.36 s over 7 intervals, then 10 steps a
  second.
- `QUANTITY_STEP_QUIET_MS` (800 ms) must stay longer than the wait and the slowest
  interval, so a hold and a run of taps stay one run. 500 and 300 are both under it.

### Target state

1. `QUANTITY_HOLD_DELAY_MS` is 500.
2. `QUANTITY_HOLD_FIRST_MS` stays 300.
3. `QUANTITY_HOLD_FACTOR` is 0.8125.
4. `QUANTITY_HOLD_FASTEST_MS` is 60.
5. The intervals are 300, 244, 198, 161, 131, 106, 86, 70, then 60 ms: eight intervals of
   ramp (about 1.3 s) and then about 16 steps a second. The doc comment of
   `QUANTITY_HOLD_FIRST_MS` lists them.
6. The doc comment of `startHold` or `_repeat` that says "from 300 ms down to 100 ms" says
   60 ms.

### Scope

- Work in `libs/velista/models/src/lib/limits.ts`, the stepper's doc comments and the
  specs that state the numbers.
- Do NOT change how the interval is computed, the quiet beat, or anything velista `0193`
  changes.

### Constraints

- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if a spec outside the stepper depends on the old wait (for example an e2e
  that holds for a fixed time).

### Progress evidence

`npx nx affected -t lint test`; the spec of section 1 passing.

## 1. Specs

1. A hold emits nothing before 500 ms and its first repeat at 500 ms.
2. With fake timers, the repeats land at the intervals of target state 5, and every later
   interval is 60 ms.
3. `QUANTITY_STEP_QUIET_MS` is greater than `QUANTITY_HOLD_DELAY_MS` and than
   `QUANTITY_HOLD_FIRST_MS` (a spec, so a later change cannot break the rule silently).

## 2. Acceptance criteria

- The four constants have the values of target state 1 to 4.
- No comment or spec states the old numbers.

## Not in this plan

- The pointer handling of the hold (velista `0193`).
- The step size (velista `0195`).
