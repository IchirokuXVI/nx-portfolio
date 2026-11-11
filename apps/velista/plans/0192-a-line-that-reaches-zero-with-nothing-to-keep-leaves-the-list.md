# 0192: a line that reaches zero with nothing to keep leaves the list

> Decided on 2026-11-11 (section 7 of the batch decisions). Backend `0263` makes core delete a
> line whose amount a member lowers to 0 when it keeps nothing (no buys, no label, no chain, no
> favourite, no comment; the product does not count), answer the write with `deleted: true`, and
> announce `line.deleted` with `emptied: true`. This plan is the client half: the row leaves the
> list and the shopping list, an open sheet or line page of that line closes to its fallback, a
> screen reader hears it, and another device follows.
>
> Needs backend `0263` on the gateway, and PRs #959 to #961 in `dev`. Works with the stepper of
> velista `0188` and with today's reel alike: both write through `LineStore`.
>
> Prerequisite reading: backend `0263` in full; velista `0083` (the line gone notice); velista
> `0187` section 1 (the take back); `CLAUDE.md` "Going back never leaves the app".
>
> Code anchors, on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
> `libs/velista/data-access/src/lib/lines/line-api.ts:172` to `:245` (`updateLine`, which reads
> `absorbedLineId` beside the line), `:247` to `:261` (`addQuantity`);
> `libs/velista/data-access/src/lib/lines/line-store.ts:64` (`LineDeletion`), `:383`
> (`deletionOf`), `:881` to `:939` (`addQuantity`), `:1253` to `:1283` (`deleteLine`), `:1430`
> to `:1489` (`_write`), `:1611` to `:1619` (the `line.deleted` handler);
> `libs/velista/data-access/src/lib/realtime/realtime-event-mapper.ts:259` to `:268`,
> `realtime-events.ts:220` to `:224`; `libs/velista/feature-lists/src/lib/line-gone/line-gone.ts:26`,
> `:51` to `:108`; `libs/velista/feature-lists/src/lib/delete-line-sheet/delete-line-sheet.ts:103`
> to `:133` (a delete by hand: a confirmation, no undo); `libs/velista/feature-lists/src/lib/line-page/line-page.ts:398`
> to `:404` and `:555` (`leave`), `line-page.html:69` to `:80`;
> `libs/velista/feature-lists/src/lib/list-page/list-page.ts:441` (`announcement`), `:1753` to
> `:1790` (`changeQuantity`); `libs/velista/feature-shopping-lists/src/lib/settle-sheet/settle-sheet.ts:362`
> to `:384` and `:1308` to `:1311` (a row gone); `basket-page.html:707` (`outstandingSaid`);
> `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:507` to `:567`, `:631` to `:676`;
> `libs/velista/ui/assets/i18n/en.json:886` (`list.line.quantityChanged`), `:996` to `:1000`
> (`list.gone`).
>
> Read "Angular conventions" in `CLAUDE.md` before any code, and load `design-taste-frontend`
> and `antislop` before the template, the styles or the copy.

## Brief for the agent

### Objective

Read `deleted` on the two quantity answers and `emptied` on `line.deleted`, remove the line as
this reader's own delete or as another device's, close what is open about it to its fallback,
move focus somewhere sensible, and say it once in the page's polite region.

### Context

- A delete by hand is a confirmation sheet (`delete-line-sheet.ts`) with no undo; the store
  marks the line `mine` before the request so an open sheet closes quietly (`line-gone.ts`).
- A `line.deleted` this reader did not make marks `others`, and an open sheet then says "This
  line was deleted by another user" (`en.json:997`), which is wrong for a line that reached 0.
- The event can arrive before the answer of the write that caused it.
- The line page shows "That line is no longer in this list" when its line is missing
  (`line-page.html:69`), and its own stepper writes through `LineStore.addQuantity` (`:399`).
- The shopping list already closes a sheet whose row is gone after a demand to 0
  (`settle-sheet.ts:1308` to `:1311`).

### Target state

1. `LineApi.addQuantity` answers `{ line, deleted }`; `updateLine` adds `deleted`. Both read it
   from `unknown` (rule D4).
2. `LineStore` removes a line whose answer says `deleted`, marked `mine`, and keeps the reason
   for the page's sentence (section 2).
3. A `line.deleted` with `emptied` for a line this store is lowering to 0 is `mine`; otherwise it
   is the new mark `emptied`, and an open sheet says the line reached 0 (section 3).
4. The page says it once, and focus lands on a row that still exists (section 4).
5. `CatalogAddStore` drops a held line answered `deleted` (section 2).

### Scope

- `libs/velista/data-access`, `libs/velista/models`, `libs/velista/feature-lists`,
  `libs/velista/feature-shopping-lists`, `libs/velista/feature-catalog`, `libs/velista/ui/assets`.
- Do NOT touch the stepper itself (velista `0188`), the add rules (`0185`), the shopping list
  layout (`0190`) or any backend project.

### Constraints

- The server decides; velista never predicts whether a line keeps anything.
- Copy through RokuTranslator keys in `en` and `es`, no number in a key, no dashes.
- Sheets dismiss through `SheetNavigation`; nothing calls `Location.back()` bare.

### Action boundaries

- Stop and ask if backend `0263` is not on the gateway of the slot.
- Build section 5 (the way back) only if the owner answered question 1 yes; otherwise leave it
  out and say so in the PR.

### Progress evidence

Each criterion of section 7 with spec output, `npx nx build velista`, and one walk on a slot with
backend `0263`: a card added at 25 g, minus once on the list: the row leaves, focus is on the
next row's stepper, the region reads "Bananas is off the list"; the same line open on a second
device's line sheet shows "This line reached 0 and was removed"; a line with a chain set stays at
0.

## 0. Decisions

### The owner's, fixed

- Backend `0263` section 0, quoted there.
- **A hold never takes an amount to 0** (owner, 2026-11-11, velista `0188`): a repeat stops at
  the last amount above 0, and only a separate press goes to 0. A deletion never comes from a
  finger held a moment too long.

### The writer's, open to the owner

- **A. A plus before the save cancels the 0.** Velista `0188` sends the amount once the presses
  stop. A minus to 0 then a plus inside that wait sends the net amount (or nothing), so the
  server never sees 0 and nothing is deleted.
- **B. No confirmation.** The line keeps nothing, so a re-add is one press, and the owner asked
  for the deletion to happen at 0.
- **C. Its own sentence on another device**, not "deleted by another user": nobody deleted it.
- **D. The way back is proposed, not built by default** (section 5, question 1). Today's delete
  by hand has none.

## 1. The wire

- `LineApi.addQuantity` returns `LineQuantityResult { line: Line; deleted: boolean }`, `deleted`
  read as `body['deleted'] === true`. `LineUpdateResult` gains `deleted: boolean` the same way.
  The memory fakes (`line-memory.ts`) apply backend `0263` section 1 over their own rows.
- The event mapper reads `emptied: payload['emptied'] === true` onto the `line.deleted` event.

## 2. The store

- Before sending a write whose optimistic result is 0, `LineStore` puts the line in
  `_emptying`. On the answer: `deleted` true, it marks the line `mine`, removes it
  (`_removeLine`) and sets `emptiedNotice` (`{ listId, lineId, name }`, a signal the pages read
  and clear); `deleted` false, the line is taken out of `_emptying`.
- `addQuantity` and `updateLine` keep their return shapes for their callers: `'succeeded'` with
  the line gone. `changeQuantity` (`list-page.ts:1753`) no longer announces "now 0" when the line
  left; the store's notice says it.
- `CatalogAddStore._step` and the take back of the lower kind drop the held line and its visit
  entry when the answer says `deleted`, so the card shows the add again.

## 3. Another device

- `line.deleted` with `emptied`: a line in `_emptying` is `mine` (the event beat the answer);
  otherwise `LineDeletion` gains `'emptied'` and the line is marked so.
- `watchLineGone` answers the reason `emptied` (`LineGoneReason` gains it); the notice draws
  `list.gone.emptied`. The line page's missing state draws the same sentence for that mark.

## 4. What the person sees and hears

- **The list page**: the row leaves. If focus was in it, focus moves to the same control of the
  next row, else the previous row, else the list's heading. `announcement` reads
  `list.line.emptied`.
- **The line page**: a minus that deletes leaves to the list with `leave()` (`replaceUrl`), and
  the list page reads `emptiedNotice` once it has drawn its region.
- **The list's line sheet**: closes quietly through the `mine` mark, as after a delete by hand,
  and the list says the sentence.
- **The shopping list**: the row is gone after the basket's own reread; the sheet closes as it
  does today, and `outstandingSaid` reads `basket.line.emptied`.

| key | `en` | `es` |
| --- | --- | --- |
| `list.line.emptied` | {{name}} is off the list | {{name}} ya no está en la lista |
| `basket.line.emptied` | {{name}} is off {{list}} | {{name}} ya no está en {{list}} |
| `list.gone.emptied` | This line reached 0 and was removed | Esta línea llegó a 0 y se quitó |

## 5. The way back (only if the owner says yes)

A strip in the list page's composer dock, the place of the voice strip, with the sentence and
"Undo" / "Deshacer". It stays until the next write or its close cross, never on a timer. Undo
sends one add with the line's held `content`, `itemIds`, `unit`, `named` and the amount before
the last minus. It makes a new line at the end of the list; comments and history there were
none to lose.

## 6. Specs

- `line-api.spec.ts`: `deleted` read from `unknown`, absent is false.
- `line-store.spec.ts`: an answer with `deleted` removes the line as `mine` and sets the notice;
  the event before the answer is `mine`; an event for a line not being lowered is `emptied`.
- `line-gone.spec.ts`: the `emptied` reason and its sentence.
- `list-page.spec.ts`: focus moves to the next row, the region reads the sentence once.
- `line-page.spec.ts`: a deleting minus leaves to the list with `replaceUrl`.
- `catalog-add-store.spec.ts`: a held line answered `deleted` is dropped.
- The key parity of `en.json` and `es.json`.

## 7. Acceptance criteria

- [ ] A deleted answer removes the row at once on every page that draws it.
- [ ] Another device removes it and an open sheet says it reached 0.
- [ ] A screen reader hears one sentence, and focus is never left on a removed control.
- [ ] A line the server kept stays at 0 as today.
- [ ] `npx nx affected -t lint test` is green and `npx nx build velista` builds.

## Not in this plan

- The stepper and its hold (velista `0188`). The rule itself (backend `0263`).

## Questions for the owner

1. Do you want a way back (section 5), an "Undo" after a line leaves at 0? Today's "Borrar
   línea" has none, behind a confirmation.
2. Is "{{name}} ya no está en la lista" the sentence you want?
