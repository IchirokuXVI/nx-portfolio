# 0023 (backlog) A suggestion can be put off

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

> Recorded on 2026-11-09 from the owner's words while plan `0259` was decided. The list
> suggests the lines that are due (backend `0123`, velista `0089`), and a shopper who does not
> need one for the next shopping has no way to say so: the row stays under the list until the
> line is bought or the period passes. The owner wants a button that removes a suggestion for
> a while. Whether it comes back by itself after the next shopping or after a few days is not
> decided, and this plan records both readings for the owner to choose.
>
> Independent of `0259` and of backlog `0022` in code, and written beside them because the
> owner named the three together. Velista half: one control on the due row of velista `0089`.
>
> Prerequisite reading: `0123` section 4 (what makes a line due), `0125` (the due lines read),
> `0137` section 4 (a basket skip that is fresh for a window: the closest thing that exists),
> velista `0089` section 2. Code: `core/src/app/lists/suggestions/suggestions.service.ts`,
> `core/src/app/baskets/basket-rows.ts` (`toRuleEntry`, the `skipped` fact),
> `libs/velista/models/src/lib/due-lines.ts`.

## Brief for the agent

### Objective

Let a shopper put a due line off: one control on the due row that hides the suggestion until
it is due again by the rule the owner picks, and a read that leaves a put off line out of the
due lines until then.

### Context

- A due line is a line at zero that the rules say is wanted again (`due-lines.ts:3-13`). The
  server answers every due line and velista draws three before "Show more".
- A basket skip (`0137`) is the nearest existing shape: a row the shopper put off on a trip,
  fresh for a window, stored on the line with the basket.
- Nothing stores a shopper's "not now" against a suggestion today.

### Target state

1. A row of `line_snoozes` (or a column pair on the line, the builder decides with the owner):
   the line, who put it off, when, and `until`, the moment it comes back.
2. The due lines read leaves out a line whose snooze stands. The rules stay pure; the filter
   is in the read.
3. A control on the due row, "Not this time", that writes the snooze and takes the row out of
   the section at once. Undo for a few seconds, as velista's other quiet writes offer.

### Scope

- `core` (the table or columns, a write, the read's filter), `gateway` (one route),
  `contracts`, velista `models`, `data-access` and the due row in `feature-lists`.

### Constraints

- Putting a line off never changes its quantity, its period or its purchases. It hides a row.
- No dashes as punctuation in any prose or copy.

### Action boundaries

- Proceed only once the owner has answered D1 and moved this plan into `plans/`.

### Progress evidence

Specs of the read with a standing snooze and an expired one; the write through the gateway; a
slot walk where a due row is put off, disappears, and returns by the chosen rule.

## 1. Open decisions, the owner's

- **D1. When does a put off suggestion come back?** The owner's words: "pending to decide if
  it would come back automatically after you go shopping or simply after a few days". Two
  readings:
  - **After the next shopping.** `until` is null and the snooze ends when the list's next
    basket is finished (the trips read of `0134` knows the sessions). A shopper who puts milk
    off before the Saturday shop sees it again on Sunday. This fits "not for my next shopping".
  - **After a few days.** `until` is `now + N days`, N a constant such as 7 or the line's own
    period if it has one. Simpler to read, independent of baskets, and it can return before
    or long after the shopping.
  - A third reading combines them: the earlier of the two.
- **D2. Who may put a line off.** The shopper, for the whole household, or each person for
  themself. A suggestion is drawn to everybody who opens the list, so a per person snooze
  shows the row to one person and not another.
- **D3. Whether a put off line counts for the staple rule** of `0123` section 4. Hiding it
  for one trip should not make it less of a staple.

## Not in this plan

- **Saying that the last buy was bigger than usual.** Backlog `0022`.
- **Removing a suggestion for good.** A line the household never wants suggested again is a
  different control and was not asked for.
