> **PR:** [#1075](https://github.com/IchirokuXVI/nx-portfolio/pull/1075)

# 0199: the trash saves at once and locks the row

> Decided on 2026-11-22. On a zone list row, the minus of the stepper draws a red trash
> where its next press reaches 0 (velista `0188`, the owner's S14), and a line at 0 is
> hidden (velista `0192`). Today the trash press waits for the quiet beat of 800 ms like any
> press, and during that beat the row still answers taps. The owner's ruling: the row may
> stay on screen until the save is done, but from the trash press on it is locked so it
> cannot be tapped again, it does not wait the quiet beat, and it shows a darker background
> with a spinner in the middle.
>
> Amended on 2026-11-23: the lock has a ceiling of 2 minutes, and it is a layer over the
> whole row, the stepper included. At the ceiling the lock ends and the row stays drawn at
> 0, usable, until the write answers.
>
> Nothing is deleted: a line at 0 is hidden and found by searching (velista `0192`). This
> plan changes when the run is written and how the row looks until then.
>
> Independent of every other plan of this round; it can be built and released alone.
> Velista `0197` removes the dimming of a row whose write is in flight; this lock is a
> different state and keeps its own look. In the compact layout of velista `0203` the reel
> has no trash (the owner's ruling), so this plan applies to the stepper only.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/ui/src/lib/list/quantity-stepper.ts:218`
> (`minusClears`), `:355` (`press`); `libs/velista/ui/src/lib/list/line-row.html:400` to
> `:414` (the stepper in the row, `(stepped)`); `libs/velista/feature-lists/src/lib/list-page/list-page.ts:1823`
> (`quantityRuns`, `_writeRun`, which hides the row and moves focus), `:1985` to `:1990`
> (`stepQuantity`), `:1706` (an existing `flush`); `libs/velista/platform/src/lib/quantity-runs.ts:22`
> to `:30` (`QuantityRuns.flush`); `libs/velista/models/src/lib/compose-list-groups.ts` (which
> lines at 0 are drawn); `libs/velista/ui/src/lib/icons/icons.ts` (`SpinnerIcon`).

## Brief for the agent

### Objective

When a press of a zone list row's trash takes its line to 0, write the run at once, keep
the row drawn and locked with a darker background and a centred spinner until the write
answers, then hide it as today.

### Context

- The trash is the minus at the amount where one press reaches 0 (`minusClears`). Its press
  emits a `QuantityStep` with `to: 0` and `repeat: false`. A hold never reaches 0.
- The page gathers steps per line (`quantityRuns`) and writes a run after 800 ms of quiet.
  `flush(lineId)` writes it at once. `_writeRun` patches the store before the request goes
  out, so today the row is hidden as soon as the run is written, and focus moves to the
  next row (`focusAfterLeaving`).
- A row drawn by the search stays at 0 and is not hidden.

### Target state

1. **No wait.** A step with `to === 0` and `from > 0` that is not a repeat flushes the
   line's run at once, with every press of the run before it.
2. **The row stays until the answer.** From that step until the write answers, the page
   holds the line in a `clearing` set. A line in it is drawn where it was, at 0, even where
   velista `0192` would hide it.
3. **The row is locked.** A row whose line is clearing gets an input `clearing`. It draws a
   darker background over the whole row (`--app-surface-sunken`, the same as a pressed row
   of velista `0196`, or a scrim token if that fails contrast), a `SpinnerIcon` centred on
   the row, `aria-busy="true"` and `aria-disabled="true"`. A tap on the row, the stepper, the
   picture or the choose button does nothing. Amended on 2026-11-23: the darker look is a
   layer over everything the lock stops, in both layouts: the row's whole box with its
   hairline and its violet edge, the picture, the text, the stepper, and the approve and
   reject buttons under the row, so nothing that looks active is dead. A notice under the
   row is drawn over the layer and stays usable. The spinner is centred on the row, on a
   raised disc edged with `--app-border-strong`, over the layer. The layer is `--app-scrim` at the half strength of a disabled control, so the row
   under it stays legible. The row is described by the word "Saving" while it is locked,
   and a key held with Alt, Ctrl or Meta passes the lock, as Tab and Escape do.
4. **After the answer.** On success the line leaves `clearing` and is hidden as today, and
   focus moves as `_writeRun` moves it now. On failure it leaves `clearing`, the row is drawn
   at its stored amount with the failed notice, and it is usable again.
5. In a search the trash writes at once and locks the row the same way; after the answer the
   row stays drawn at 0, unlocked.
6. **The ceiling** (the owner's ruling of 2026-11-23). A line write has no client timeout.
   When the write has not answered 2 minutes after the trash press
   (`QUANTITY_CLEAR_LOCK_MAX_MS` in `libs/velista/models/src/lib/limits.ts`), the lock ends
   and the row stays drawn at 0, usable, until the write answers. The line leaves `clearing`
   and joins `lingering`, which the grouping keeps in place as it keeps `clearing`. The row
   shows the truth: the 0 the store holds, with no notice and no other amount drawn over
   it, `aria-busy` still true while the write is out and no `aria-disabled`. A plus is an
   ordinary step from 0. The request is not cancelled. When it answers, the line leaves
   `lingering`: on success a line still at 0 is hidden as usual, and focus moves only if it
   had dropped to the page; a line the person raised meanwhile is decided by the store's
   handling of two writes in order, as any two runs are; on failure the store snaps the
   line back and draws its own failed notice. One timer per line, cleared when the write
   answers and when the page goes away; the answer of an older trash never touches the
   state of a newer trash of the same line. In a search the ceiling only ends the lock.

### Scope

- Work in `feature-lists` (the page and its grouping input), `models` (the grouping rule
  that keeps a clearing line drawn), `ui` (the row's `clearing` input and its look).
- Do NOT change the stepper itself, the trash glyph, the hold, or the product page and
  catalog steppers (they do not hide a line at 0).

### Constraints

- Rule T1 and the contrast spec.
- The lock looks the same in both row layouts.
- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if the store cannot report when the write of one run answered without
  changing its public API.

### Progress evidence

The specs of section 1; `npx nx affected -t lint test`; a slot walk with the network
throttled to "Slow 4G": press the trash, see the locked row with the spinner, tap it twice
with no effect, see it hidden after the answer; and the same with the gateway stopped, to
see the failed notice.

## 1. Specs

1. A step to 0 from a press flushes the run in the same task; a step to 0 that is a repeat
   cannot happen (the hold never reaches 0), and a step to 1 waits the quiet beat as today.
2. While the write is pending, the line is drawn in To buy with `clearing` true, and
   `compose-list-groups` keeps it there.
3. A clearing row ignores clicks on itself and on its stepper and draws the spinner.
4. On success the line is hidden and focus is on the next row; on failure the row is back at
   its stored amount, unlocked, with the failed notice.
5. With fake timers: the row is locked until the ceiling; at the ceiling it is unlocked,
   drawn at 0, kept in its group, with no notice; a plus after the ceiling is a normal step
   from 0 and the row shows 1 at once and after the beat; a late success with the line still
   at 0 hides it and leaves focus where the person put it; a late success after a raise is
   applied as the store applies two writes in flight; a late failure shows the store's own
   failed notice; two lines clearing at once do not affect each other; an answer before the
   ceiling clears the timer; an older trash's answer does not touch a newer one; in a search
   the ceiling only ends the lock; the page going away clears the timer.
6. The lock's layer covers the host, the row and the decisions, and comes before a notice,
   which stays usable; the disc has an edge; the row is described by the lock's word; Tab,
   Escape and a key with Alt, Ctrl or Meta pass the lock.

## 2. Acceptance criteria

- The trash never waits 800 ms.
- A row cannot be tapped between the trash press and the answer.
- The locked row has a darker layer over all of it, the stepper included, and a spinner in
  the middle.
- No row stays locked longer than 2 minutes; at the ceiling the lock ends and the row stays
  drawn at 0, usable, until the write answers.

## Not in this plan

- The dimming of other writes (velista `0197` removes it).
