> **PR:** [#1074](https://github.com/IchirokuXVI/nx-portfolio/pull/1074)

# 0197: a row does not dim while its amount saves

> Decided on 2026-11-22. After a row's amount is saved, the owner sees a darker background
> flash for a moment. It was reproduced on staging on 2026-11-22 with a guest group: a press
> on plus, then 800 ms later (the quiet beat of velista `0188`) the row gets the class
> `in-flight` and `opacity: 0.7` for the round trip, about 250 ms, and then goes back. The
> row is not replaced in the DOM and draws no bones. On the night theme 70% lets the dark
> page show through the stepper capsule and the photo, so the row darkens and lightens again.
>
> The owner's ruling: the dimming goes. Most people never learn what it means, and the
> spinner the compact row draws in place of the total says it better. The row of today has
> no spinner, and he accepts that for now. If the dimming is missed it comes back later.
>
> Amends velista `0012` section 3.3 and the comment "A row with a write in flight stays
> live" of `line-row.ts`: the row stays live as before; it is only not dimmed. Independent
> of every other plan of this round; it can be built and released alone.
>
> Code anchors, on `dev` at `e06813139`: `libs/velista/ui/src/lib/list/line-row.html:13` and
> `:19` (`aria-busy` and the class `in-flight`); `libs/velista/ui/src/lib/list/line-row.scss:34`
> to `:38` (`.row.in-flight { opacity: 0.7 }`); `libs/velista/ui/src/lib/list/line-row.ts:82`
> to `:86` (the comment) and `:210` to `:226` (`saving`, the compact row's spinner).

## Brief for the agent

### Objective

Stop drawing a zone list row at 70% opacity while its write is in flight, and keep
everything else that state does.

### Context

- `line().write === 'pending'` sets `aria-busy="true"` and the class `in-flight`. Only the
  class is visual.
- The compact row already draws a spinner in place of the total while the run is open or
  the write is in flight (`saving`).

### Target state

1. The rule `.row.in-flight { opacity: 0.7 }` is removed. The class `in-flight` is removed
   from the template too, unless another rule or a spec reads it; `aria-busy` stays.
2. The comment in `line-row.ts` says the row is not dimmed and why, with the date of the
   ruling.
3. Nothing else changes: the row stays usable while it saves, the failed and overwritten
   notices are unchanged, the compact row's spinner is unchanged.

### Scope

- Work in `libs/velista/ui/src/lib/list/line-row.{html,scss,ts,spec.ts}`.
- Do NOT add a spinner to the row of today.

### Constraints

- No dashes as punctuation in comments.

### Action boundaries

- Stop and ask if an e2e or another component reads the class `in-flight`.

### Progress evidence

`npx nx affected -t lint test`; on a slot, a recording of a step at 390 by 844 on the night
theme shows no change of opacity on the row after the quiet beat.

## 1. Specs

1. A row whose line has `write: 'pending'` has `aria-busy="true"` and an opacity of 1 (no
   `in-flight` class, or a class with no opacity rule).
2. The existing specs of the saving spinner pass unchanged.

## 2. Acceptance criteria

- No darkening of a row when its amount saves, in either theme and either layout.
- `aria-busy` still says the row is saving.

## Not in this plan

- The lock of a row whose trash was pressed (velista `0199`), which is a different state
  with its own look.
