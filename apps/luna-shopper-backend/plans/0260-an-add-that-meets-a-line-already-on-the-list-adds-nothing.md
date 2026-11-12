> **PR:** [#984](https://github.com/IchirokuXVI/nx-portfolio/pull/984)

# 0260: an add that meets a line already on the list adds nothing

> **Amended on 2026-11-11** from the owner's decisions of 2026-11-10 and 2026-11-11 (section 0).
> The plan of 2026-11-09 made an add raise the line it met by one default of its unit (R5) and
> refuse an add of another unit. The amendment keeps the refusal (U1, U2) and replaces the raise:
> an add of a product or of a typed name that is already on the list **adds nothing** and answers
> with the line it met (A1), and an add that creates a line creates it at **one step of its unit**,
> 25 g, 25 ml or 1 piece, and not at one kilo or one litre (A2). That replaces R5, every "raises
> that line by one default", and M4 of `0246` ("a new weight line starts at 1000"). The usual
> amount at a repeat add (the median of the amounts bought) is backlog `0025`, not built here.
> The title changed with it; the file name is the old one.
>
> It amends `0246` M4, M5 and section 3.3 in their add half, and `0228` target 1 (the raise of
> one candidate, the question). The merge half of `0246` (a rename onto a line of another unit,
> `line_unit_differs`) stays as `0246` built it. It records U1, which closes the first bullet of
> `0246` section 9; the text of `0246` is left as it is.
>
> Depends on PRs #959 (backend `0246`), #960 (velista `0182`) and #961 (velista `0183`) being in
> `dev`. The client half is velista `0185` (amended on the same day). The per product step of
> backend `0261` is later work; once velista `0186` sends it, the amount a product add states is
> that step, and nothing here changes.
>
> Prerequisite reading: the owner's decisions of 2026-11-11 (section 0 here quotes them),
> `0246` section 0 (M4, M5, M8), section 3.3 and section 9, `0228` in full (target 1, D1 to D4,
> B1 to B11), velista `0170` (what the duplicate question and the mark are for), `0091` sections 2
> and 3 (one line per name, the batch fold), and the PR body of #959 ("Review round 1" finding 6,
> "Review round 2" finding 1).
>
> Code anchors, read on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11 (it carries
> #959 to #961):
> `apps/luna-shopper-backend/core/src/app/lists/line.service.ts:960` (`add`), `:976` to `:979`
> (the unit and the default quantity), `:1008` to `:1014` (`raise`), `:1021` to `:1023`
> (`differs`, `unitChoice`), `:1029` to `:1042` (a chosen line), `:1052` to `:1076` (the
> identity targets, the add's unit first, then `unitChoice`), `:1080` to `:1104` (the typed name
> candidates), `:1129` to `:1134` (the merged answer), `:1191` (`addMany`), `:1223` to `:1226`
> (its units and quantities), `:1252` to `:1281` (the plan loop and the fold), `:1378` to `:1388`
> (its answer), `:1585` to `:1615` (`findNamedProductLines`, whose `select` has no `unit`),
> `:1624` to `:1654` (`needsChoice` and its `'unit'` variant), `:1718` to `:1740`
> (`findAddTarget`), `:1856` to `:1879` (`raiseForAdd`), `:3312` to `:3322` (how a view is read:
> `itemSetOf`, `settlementsOf`, `claims.claimOf`);
> `libs/luna-shopper/contracts/src/lib/units/line-unit.ts:126` to `:132` (`defaultQuantityOf`,
> 1 or 1000); `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts:688` to `:755`
> (`AddLineRequest`), `:762` to `:784` (`LineAddChoice`, `LineAddNeedsChoiceDetails`), `:799` to
> `:803` (`AddLineResult`), `:806` to `:825` (`AddLinesItem`), `:860` to `:870` (the unit change
> of an update, which names `defaultQuantityOf`);
> `libs/luna-shopper/contracts/src/lib/messages/basket.messages.ts:1100` to `:1111`
> (`BasketRowResult`); `libs/luna-shopper/contracts/src/schemas/messages/list.schemas.ts:476`
> (the `AddLineResult` schema); `core/src/app/baskets/basket-line-add.service.ts:66` to `:124`;
> `libs/luna-shopper/platform/src/lib/errors/domain-exception.ts:279` to `:298`
> (`LineAddNeedsChoiceException`, `LineUnitDiffersException`), `problem-details.schema.ts:66`;
> `gateway/src/app/lists/list.controller.ts:429` to `:497` (the list add and the batch add, whose
> `ApiProblemResponses` at `:477` names no `lineUnitDiffers`), `list.dto.ts:229` to `:236`
> (`ADD_CHOICE_DOCS`), `:269` to `:305` (`AddLineDto`);
> `gateway/src/app/baskets/basket.controller.ts:781` to `:824` (the basket add);
> `assistant/src/app/assistant/tools.ts:331` to `:364` (the fresh items through the batch, read
> as `added` or `increased`), `:373` to `:383` (an item already on the list writes nothing),
> `:1560` (`refused`).

## Brief for the agent

### Objective

Make every add in core follow one rule: an add that meets a line already on the list writes
nothing and answers that line; an add that meets only a line kept at zero raises it by the add's
amount; an add that meets nothing creates a line at one step of its unit; and an add of a
product that meets only a line of another unit is refused with `line_unit_differs` before any
write. Then document the new answer and regenerate the two generated files.

### Context

- Today an add raises the line it meets by the request's `quantity`, or by
  `defaultQuantityOf(unit)` when absent: 1 for a count, 1000 for grams and millilitres
  (`line-unit.ts:130`, `line.service.ts:977` to `:979`). The owner decided on 2026-11-10 and
  2026-11-11 that an add never changes the amount of a line a person already asked for, and
  that a new line starts at one step (section 0, A1 and A2).
- `raiseForAdd` (`:1856`) is the only write of a raise; a raise is announced as `line.updated`
  and answers `merged: true` (`:1129` to `:1134`). An answer that writes nothing has no shape
  today: `AddLineResult` is `{ line, merged }` (`list.messages.ts:799`).
- Today a line of another unit is answered as the duplicate question (`needsChoice(...,
  'unit')`, `:1022` to `:1023`, `:1074` to `:1076`, `:1097` to `:1099`), and `newLine: true`
  then creates a line in the add's unit. U2 makes that a refusal.
- The question of `0228` (`line_add_needs_choice`) is asked when a typed name meets two or more
  product lines and the caller set `askIfAmbiguous` (`:1101` to `:1103`). Its rows offered a
  raise of each line.
- `findNamedProductLines` selects no `unit` (`:1593` to `:1603`), so `needsChoice` writes
  `unit: 'UNIT'` for every candidate of a question of two or more (`:1641`), whatever the line
  counts. Section 1 fixes it, because the rows of the question now say what each line becomes in
  its own unit.
- A product add meets a line only by `lineIdentities` (`:1046` to `:1052`): the same product set,
  or the same name and group. A line that holds the product among others (a line of several
  products, velista `0183`) is not met today, and the add creates a second line.
- `addMany` sums: items that meet one line raise it by their summed quantities, and two items of
  one thing fold into one created line at the summed quantity (`:1252` to `:1281`). Its answer
  says `merged` per item (`:1378` to `:1388`).
- The basket add calls `LineService.add` and answers a `BasketRowResult` naming the line
  (`basket-line-add.service.ts:92` to `:123`), which says nothing of whether a line was made.
- The assistant reads the list first and sends only items it found no line for, through the
  batch (`tools.ts:331` to `:338`); an item it found with no number writes nothing (`:379` to
  `:383`). A batch answer of `merged` is reported as `increased` (`:354`).

### Target state

1. `defaultQuantityOf(unit)` answers one step: 1 for `UNIT`, 25 for `GRAM` and `MILLILITER`
   (A2). Every add that states no `quantity` uses it, single and batch.
2. `add` resolves as section 1 says. An add that meets a wanted line (quantity above 0) writes
   nothing, emits nothing, and answers 201 with `outcome: 'ALREADY_ON_LIST'` and the lines it met
   (section 2). An add that meets only lines at 0 raises one of them by its amount (R2). An add
   that meets nothing creates a line.
3. A product add that meets only lines of another unit is refused with `line_unit_differs` and
   the details of section 3, before any write, whatever `newLine` says. A free text add is never
   refused for a unit (R4).
4. A product add also meets a line whose product set holds every product of the add (R5).
5. `line_add_needs_choice` is asked only when a typed name meets two or more candidates, every
   one at 0, and the caller set `askIfAmbiguous` (R3). It is never asked about a unit, and each
   entry carries the line's real `unit`.
6. `addMany` follows the same rule per item (section 4); the basket add answers its outcome; the
   assistant reports `ALREADY_ON_LIST` as `unchanged` (section 5).
7. The OpenAPI document and the admin wire types are regenerated and committed.

### Scope

- `libs/luna-shopper/contracts`: `line-unit.ts` (`defaultQuantityOf` and its spec),
  `list.messages.ts` (`AddLineOutcome`, `AddLineResult`, `LineUnitDiffersDetails`, the doc
  comments of `AddLineRequest.quantity`, `unit`, `askIfAmbiguous`, `intoLineId`, `newLine` and of
  `AddLinesRequest`), `basket.messages.ts` (`BasketRowResult.addOutcome`), and the schemas
  `list.schemas.ts` and `basket.schemas.ts` that describe them.
- `apps/luna-shopper-backend/core/src/app/lists/line.service.ts` (`add`, `addMany`,
  `needsChoice`, `findNamedProductLines`, a new `findLinesHolding`, a new read of the views of
  met lines) and `core/src/app/baskets/basket-line-add.service.ts`, with the specs of section 7.
- `libs/luna-shopper/platform/src/lib/errors/` (`domain-exception.ts`,
  `problem-details.schema.ts`).
- `apps/luna-shopper-backend/gateway`: the route documentation of the list add, the basket add
  and the batch add, the descriptions in `ADD_CHOICE_DOCS`, and the HTTP specs.
- `apps/luna-shopper-backend/assistant/src/app/assistant/tools.ts` (the reading of a batch
  answer) and its spec.
- The generated `openapi.json` and `wire-types.ts`.
- Do NOT touch the merge, the rename planner, the update route, `addQuantity`, velista or the back
  office.

### Constraints

- U1, U2, A1 and A2 are the owner's and are settled. R1 to R8 are the writer's; the owner may
  overrule them before the build.
- Every POST answers 201 with a body. An add that adds nothing is an outcome, not an error: it is
  201 with the body of section 2, never 204 and never a 409.
- An error's machine readable facts go in `details`, the words' arguments in `messageArgs`.
- An add that adds nothing takes the list lock as today and writes no row, no change record, no
  version, and emits no event and no basket nudge.
- The refusal is thrown before the first write of the transaction.
- No migration. No release task: section 8 says why.
- No dashes as punctuation in any prose or comment.

### Action boundaries

- Proceed with sections 1 to 7.
- Stop and ask if PRs #959, #960 and #961 are not all in `dev`.
- Stop and ask if velista `0185` names another outcome value, another field, or another shape of
  `details` than sections 2 and 3: the two plans must agree before either is built.
- Stop and ask before raising `MIN_CLIENT_VERSION` in any cluster (section 8 says why no raise is
  needed).
- Stop and ask before adding a dependency, before deleting a file this plan does not name, before
  changing an existing migration, and before any behaviour this plan does not settle.
- Regenerate `openapi.json` and `wire-types.ts` with their targets. Never edit them by hand.

### Progress evidence

Each criterion of section 9 with its spec output, the two generation targets run and their diffs
committed, and the HTTP walk of section 7.3 on an ephemeral slot, with each answer's status and
body pasted into the PR.

## 0. Decisions

### The owner's, fixed

From 2026-11-09:

- **U1. A free text line counts pieces.** To count in another unit a line needs a product.
  This closes the first bullet of `0246` section 9. W1 of `0246` stands.
- **U2. A conversion between units is wanted at an add and at a merge, and not now.** Until a
  conversion plan is built, an add or a merge that meets a line of another unit is an error,
  never a choice and never a silent new line. The conversion is backlog `0024`.
- **U3. The composer has no quantity picker** (velista `0185`). Its second half, "adds one
  default unit to the line that already holds that name or product", is replaced by A1.

From 2026-11-10 and 2026-11-11:

- **A1. A product, or a typed name, that is already on the list adds nothing.** The line is
  shown so the person can find it and change its amount there. This replaces R5 of 2026-11-09
  and every "raises that line by one default". It holds on zone lists and on the shopping list.
  The owner first wanted the usual amount added when it is known, the median of the amounts the
  person bought for that line; on 2026-11-11: "the median isn't developed". That is backlog
  `0025`.
- **A2. A product that is not on the list is added at one step of its unit**: 25 g, 25 ml or 1
  piece. This replaces "one default unit (one kilo, one litre)" of U3 and M4 of `0246`. The step
  is one size per unit (25 for a weight "or any other measurement unit", 1 for a count). The per
  product step of backend `0261` is later work and, once built, is the step an add uses.

From 2026-11-12 (the owner's rulings on the build, PR #984):

- **R5 stands, and replaces decision 2 of `0214` for adds.** A product add meets a line that
  holds the product whatever the line's `named` flag, and raises it when it is kept at 0. The
  owner: the old rule as he remembers it was that when only one line holds a product, adding
  that product lands on that line regardless of its name. Decision 2 of `0214` ("an unnamed add
  never lands on a named line") still governs the identity key; for an add it is replaced by
  R5.
- **U2 means "only".** A product add lands on a line of its own unit when one holds the
  product, and is refused with `line_unit_differs` only when no line of its unit holds it, even
  when its earliest identity line counts in another unit. Example: "Leche" counts 2 pieces at
  position 1, "Desayuno" (several products, millilitres) holds milk at position 3; an add of milk
  in millilitres answers `ALREADY_ON_LIST` with "Desayuno", or raises it when it is kept at 0.
  The same in `addMany`. Section 1 steps 2 and 3 are amended below.
- **`intoLineId` on a kept line** raises it by the request's amount when the units agree, and by
  one step of the line's unit otherwise. Step 1 is amended below.
- **A refused add has its own sentence.** `line_unit_differs` on an add names the line with
  `messageArgs.content` and `messageArgs.variant: 'add'`, which picks "\"{content}\" is already
  on this list in another unit. Change the amount on that line." (Spanish: "\"{content}\" ya está
  en esta lista en otra unidad. Cambia la cantidad en esa línea."). The code and the `details`
  of section 3 are unchanged; the merge keeps its own sentence.
- **The assistant helps to fix it.** In the owner's words: "Make sure the assistant also answers
  with some help to fix it. For example, returning the line that is already on the list and
  telling you to use that one instead." A refused add or batch hands the model the met line
  from `details.line` (`onList`: id, name, quantity, unit) and an `instead` sentence that says
  to change the amount on that line. An `ALREADY_ON_LIST` slot already names its line
  (`product`, `quantity`, `unit` of the line it met), so it is left as it was.
- **Backend `0263` was withdrawn.** No write deletes a line because it reached 0; velista hides
  a line at 0 outside a search. Every line at 0 is a kept line (R2).

### The writer's, open to the owner

- **R1. The answer of an add that adds nothing is 201 with `outcome: 'ALREADY_ON_LIST'`, and
  `merged` stays `true` on it.** A 409 would make an ordinary press an error on every client,
  and an installed velista would draw it as a failure. A 201 whose `merged` is true is what an
  installed velista already reads as "a line already on the list took it": it keeps the row in
  place and marks it (velista `0170` target 4), which is the behaviour A1 asks for. The new
  `outcome` field says which of three things happened, and `alreadyOnList` names every line
  met, so a client can show all of them.
- **R2. A line at 0 is on the list only as a kept line, so an add that meets only lines at 0
  raises one of them by the add's amount.** A line at 0 asks for nothing: the shopping list does
  not draw it (`BasketRowResult` says a line at zero with no buy "left the basket",
  `basket.messages.ts:1102` to `:1105`), and the zone list draws it among the stocked lines. An
  add that left it at 0 would answer "already on the list" about a line that is on no list to
  buy, and on the shopping list there would be no row to show. This keeps the owner's answer 1
  of `0228` ("a line already bought counts, and the add takes it from 0 to 1"), now from 0 to
  one step. Once backend `0263` is built, a line with nothing to keep is deleted at 0, so the
  kept lines an add meets are the ones that hold a buy, a name or a choice. Either plan can be
  built first.
  _Note of 2026-11-12: backend `0263` was withdrawn by the owner. No write deletes a line at 0,
  so every line at 0 is a kept line, and an add that meets only kept lines raises one. The code
  needed no change for it._
- **R3. The duplicate question of `0228` survives only where an add would write.** When a typed
  name meets two or more candidates and at least one is wanted, nothing is written, so there is
  nothing to choose: the add answers `ALREADY_ON_LIST` with every wanted candidate, and the client
  marks them all. A question here would cost a tap to choose which line to look at, which the
  marks answer with none. When every candidate is at 0, the add would write a raise, and which
  line takes it is the person's choice as `0228` decided: with `askIfAmbiguous` it asks, and each
  row offers 0 to one step of that line's own unit. Without `askIfAmbiguous` it raises the
  earliest by position (`0091` rule for two lines of one name). "A new line" (`newLine: true`)
  stays an answer to that question.
- **R4. A free text add is never refused for a unit.** The refusal of 2026-11-09 for a free text
  add that stated a `quantity` existed because a raise would have added pieces to grams (`0246`
  M8). No add raises a wanted line now, and a raise of a line at 0 takes the amount from that
  line's unit (section 1). So a free text add meets a product line of any unit by name, and the
  stated `unit` and `quantity` of a free text add only shape a line it creates (always `UNIT`,
  U1). This also keeps every installed velista working: it sends `unit: 'UNIT'` and a
  `quantity` on every typed name (velista `0182`).
- **R5. A product add meets a line whose product set holds every product of the add.** A line of
  several products (velista `0183`) that holds the product is the product "already on the list"
  in the owner's words, and the catalog tab of velista `0185` switches its plus off for exactly
  that line. Today the add creates a second line of one product beside it. The read is new
  (`findLinesHolding`) and runs after the identity targets; it changes nothing for a line it
  does not meet. Same unit rules: a line of another unit only is `line_unit_differs`.
- **R6. A batch follows the single add per item, and never sums.** An item that meets a wanted
  line, or a line this batch already created or raised, adds nothing and answers
  `ALREADY_ON_LIST`. That ends the fold "at the summed quantity" of `0091` section 2: one rule
  for every add is the point of A1, and the assistant already folds its own duplicates
  (`foldDuplicates`, `tools.ts:252`).
- **R7. A batch item of a product that meets only a line of another unit refuses the whole
  batch**, with `details.index` naming the item (R3 of 2026-11-09, unchanged). The batch is one
  transaction; the assistant reads a refused batch as a refusal and reports it (`tools.ts:1560`).
  Two items of one product in two units in one batch are a 400 before the transaction, with
  `messageArgs.field` `items` (R4 of 2026-11-09, unchanged).
- **R8. `defaultQuantityOf` changes in place rather than a second function.** Core uses it only
  for an add that states no amount (`line.service.ts:978`, `:1225`, `:1420`). The update route
  never computes it; its doc comment (`list.messages.ts:866`) says what the client sends on a unit
  change, which is velista's own constant, and stays as it is.

## 1. The rule in core

Words used below: a line is **wanted** when its `quantity` is above 0, and **kept** when it is
0. "The add's amount" is the request's `quantity`, or `defaultQuantityOf(unit)` when absent; for
a raise of a line that counts in another unit than the request (a free text add, R4), it is
`defaultQuantityOf(line.unit)`. A **product add** carries `itemIds` or `productGroupId`; a
**free text add** carries neither. Rejected and deleted lines are never met, as today.

`add` (`line.service.ts:960`) resolves in this order, inside the existing transaction and lock.
"Met lines" go to section 2's answer.

1. **`intoLineId`** (free text only, `0228` B3). The chosen line, locked. Wanted: answer
   `ALREADY_ON_LIST` with it. Kept: raise it by `defaultQuantityOf(chosen.unit)` (R2, R4),
   whatever its unit; the old `line_unit_differs` at `:1035` to `:1040` goes.
   _Amended on 2026-11-12 (the owner, no change to the code): a kept chosen line is raised by
   the request's amount when its unit is the request's, and by one step of the line's own unit
   otherwise (`amountOnto`)._
2. **The identity targets** (`:1052`). The earliest line in the add's unit, as today
   (`sameUnit`). For a free text add the unit does not filter (R4): the earliest identity target
   of any unit. Wanted: `ALREADY_ON_LIST`. Kept: raise it.
   A product add whose unit holds none and whose earliest identity target counts in another
   unit: `line_unit_differs` with section 3's details, **whatever `newLine` says**. This
   replaces `:1073` to `:1076`.
3. **A product add's held lines** (R5). `findLinesHolding(manager, listId, itemIds)`: the lines
   whose product set contains every id of the add, in position order. Those in the add's unit:
   any wanted, `ALREADY_ON_LIST` with every wanted one (up to `LINE_ADD_CHOICE_MAX`); none
   wanted, raise the earliest. None in its unit and one or more of another unit:
   `line_unit_differs` naming the first by position.

_Amended on 2026-11-12 (the owner: U2 said "only"): for a product add, steps 2 and 3 run as one
step. The identity target of the add's unit, then the held lines of the add's unit, take the add
as above. Only when neither exists is the add refused with `line_unit_differs`, naming the
earliest by position of the identity target of another unit and the held lines of another unit,
whatever `newLine` says. An identity target of another unit no longer refuses before
`findLinesHolding` runs. `addMany` follows the same order per item (section 4)._
4. **A free text add's candidates** (`0228` target 1.4, `findNamedProductLines`), skipped when
   `newLine` is true, as today. Every candidate, whatever its unit (R4).
   - One or more wanted: `ALREADY_ON_LIST` with every wanted candidate (R3).
   - Exactly one, kept: raise it (after `lockCandidateLine`, B11 stands).
   - Two or more, all kept: with `askIfAmbiguous`, `line_add_needs_choice` listing all of them;
     without, raise the earliest (R3).
5. **Create**, as today, at the add's amount.

A raise is `raiseForAdd` (`:1856`) unchanged. It is only ever called on a kept line now, so
its cap at `LINE_QUANTITY_MAX` is the add's amount capped (backend `0262` raises the limit; not
this plan).

The answer of `ALREADY_ON_LIST` reads each met line's view the way `writeEdit` reads one
(`:3312` to `:3322`: `itemSetOf`, `settlementsOf`, `claims.claimOf`, all through the
transaction's manager), with no save, no `changes` record and no `emit`.

`needsChoice` loses its `'unit'` variant (`:1628`, `:1649` to `:1651`): a question is never
about a unit again. `findNamedProductLines` adds `unit: true` to its `select` (`:1593` to
`:1603`), so each entry of the question carries the line's real unit (Context).

`lineIdentities`, `findAddTarget` and the merge are unchanged.

The basket add goes through `LineService.add`, so it follows the same rule with no change of its
own except its answer (section 2).

## 2. The answer

```ts
/** What an add did (plan 0260, R1). */
export type AddLineOutcome = 'CREATED' | 'RAISED' | 'ALREADY_ON_LIST';

export interface AddLineResult {
  /** The line created or raised, or the first line met, in list position order. */
  line: LineView;
  /** True when the add landed on a line that was already there: `RAISED` or `ALREADY_ON_LIST`. */
  merged: boolean;
  outcome: AddLineOutcome;
  /**
   * Every wanted line the add met and left as it was, in list position order, at most
   * `LINE_ADD_CHOICE_MAX`. Empty unless `outcome` is `ALREADY_ON_LIST`; then `line` is its first.
   */
  alreadyOnList: LineView[];
}
```

A typed "plátanos" onto a list whose loose bananas line holds 750 g:

```json
{
  "line": { "id": "…", "content": "Plátanos", "quantity": 750, "unit": "GRAM", "version": 7, "…": "…" },
  "merged": true,
  "outcome": "ALREADY_ON_LIST",
  "alreadyOnList": [
    { "id": "…", "content": "Plátanos", "quantity": 750, "unit": "GRAM", "version": 7, "…": "…" }
  ]
}
```

- Status 201 on the list add and the batch add, as every POST.
- `version` is the line's own, unchanged: a client that reconciles by version keeps what it
  holds.
- The schema at `list.schemas.ts:476` gains `outcome` (enum of the three) and `alreadyOnList`
  (array of `lineView`), both required in the core answer. The batch answer is an array of the
  same object.
- **The basket add.** `BasketRowResult` gains `addOutcome?: AddLineOutcome`, set only by the
  line add (`basket-line-add.service.ts`), absent on every other row write. Its `entries` name
  every line of `alreadyOnList` (`opened.result(ids)`), so the shopping list can find the rows
  to mark. A line of `alreadyOnList` is wanted, so it is a basket row.

## 3. The refusal

Unchanged from 2026-11-09 in shape; only a product add reaches it now (R4).

```json
{
  "code": "line_unit_differs",
  "status": 409,
  "messageArgs": { "content": "Leche entera" },
  "details": {
    "line": { "lineId": "…", "content": "Leche entera", "unit": "MILLILITER", "quantity": 1500 },
    "unit": "UNIT",
    "index": null
  }
}
```

- `LineUnitDiffersDetails` in `list.messages.ts`: `line` (`lineId`, `content`, `unit`,
  `quantity`) is the line the add met, `unit` is what the add counted in, `index` is the batch
  item's position or null on a single add.
- `LineUnitDiffersException` (`domain-exception.ts:296`) gains `override readonly exposesDetails
  = true`. The merge throws it with no details, which the problem factory omits; the schema text
  says the bag is present on an add.
- `problem-details.schema.ts:66` names `line_unit_differs` beside the codes whose bag it
  describes, and lists the three fields.
- `messageArgs.content` is the line's own spelling.

## 4. The batch

`addMany` (`:1191`):

- Before the transaction: two items of one product (one key) in two units are refused (R7).
- Units and amounts: `defaultQuantityOf(units[index])` is one step now (`:1225`).
- In the plan loop (`:1256` to `:1281`), per item, the rule of section 1 steps 2, 3 and 5 (a
  batch item has no `intoLineId`, no question and no group). A free text item meets its free text
  line and, if none, the candidates of `findNamedProductLines` as a single add with no
  `askIfAmbiguous` does: wanted ones answer `ALREADY_ON_LIST`; a single kept one, or the earliest
  of several kept ones, is raised.
- A target already raised or created by an earlier item of this batch is wanted by then, so the
  later item answers `ALREADY_ON_LIST` and adds nothing (R6). `raises` keeps one delta per line,
  never a sum; `creations[planned].quantity += …` at `:1274` goes.
- A product item whose targets are all of another unit refuses the batch with
  `line_unit_differs`, `details.index` its position (R7). `findAddTarget` already answers both
  (`:1718` to `:1740`).
- Each slot of the answer carries its `outcome` and `alreadyOnList`. A slot that met a line of
  this batch answers that line with `ALREADY_ON_LIST`.
- An `ALREADY_ON_LIST` item emits nothing. The basket nudge at `:1373` names only lines that were
  created or raised.

## 5. The gateway, the assistant and the documents

- The list add, the basket add and the batch add document 409 `line_unit_differs` (the batch
  add lacks it today, `list.controller.ts:477`).
- `ADD_CHOICE_DOCS` (`list.dto.ts:229` to `:236`) and the contract's doc comments stop saying
  that a line of another unit is offered, that `newLine` creates beside it, and that an add
  raises a line. They say A1, R2, R3 and R4 in one sentence each. `AddLineRequest.quantity`
  says: the amount of a line the add creates, or of a raise of a kept line; never added to a
  wanted line.
- **The assistant** (`tools.ts:351` to `:357`): `outcome` decides the word. `CREATED` is
  `added`, `RAISED` is `increased`, `ALREADY_ON_LIST` is `unchanged` (`describeLine('unchanged',
  …)`, as `:381` already writes for an item it found itself). An answer with no `outcome` (a
  core of before this plan, during a deploy) is read as today from `merged`. The comment at
  `:349` to `:350` ("a merge is always a raise") is rewritten.
- Then:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 6. Who sees what change

- **A typed name already on the list**, wanted: nothing changes on the line; the client shows
  it. Kept at 0: it goes to one step, as before it went to one default.
- **A product from the catalog or the typeahead**: a new line starts at 25 g, 25 ml or 1, not at
  1 kg or 1 l. A product already on the list (also on a line of several products, R5): nothing
  changes. Of another unit only: the refusal.
- **The assistant**: "add milk" when milk is on the list reports it unchanged, which is what it
  already says when it found the line itself.
- **An installed velista** of before `0185`: a press that meets a wanted line reads `merged:
  true` and marks the row, with no amount added; its catalog plus draws one default before the
  answer, and the answer's quantity corrects the drawn amount. No refusal reaches a typed name
  (R4). That is why no `MIN_CLIENT_VERSION` raise is needed.

## 7. Specs and the walk

### 7.1 Core

- `line-unit.spec.ts:145` to `:147`: `defaultQuantityOf` answers 1, 25, 25.
- `core/src/app/lists/line-add-merge.spec.ts` (the cases at `:342` to `:442` change meaning on
  purpose, and the PR names each):
  - a product add meeting its wanted line answers `ALREADY_ON_LIST`, writes nothing (the
    repository's `save` is not called), records no change, emits nothing;
  - the same line at 0 is raised to 25 (`GRAM`) or 1 (`UNIT`) and answers `RAISED`;
  - a product add with no quantity creates a `GRAM` line at 25;
  - a product add meeting only a `UNIT` line of its product (its own unit `GRAM`) throws
    `line_unit_differs` with the details, with and without `newLine: true`, and writes nothing;
  - a product add meeting a line of several products that holds it, wanted, answers
    `ALREADY_ON_LIST` (R5); kept, raises it; of another unit, refuses;
  - an open typed name with one wanted `GRAM` candidate answers `ALREADY_ON_LIST`; with one kept
    `GRAM` candidate raises it to 25; the same with `quantity: 3` and `unit: 'UNIT'` does the
    same (R4);
  - two candidates, one wanted: `ALREADY_ON_LIST` with the wanted one, no question;
  - two candidates, both kept, `askIfAmbiguous`: `line_add_needs_choice`, each entry with its
    real `unit` (the `select` fix); without the flag, the earliest is raised;
  - `intoLineId` on a kept `GRAM` line raises it to 25; on a wanted one answers
    `ALREADY_ON_LIST`;
  - `needsChoice` is never called with a unit reason.
- `addMany`: an item meeting a wanted line answers `ALREADY_ON_LIST` and writes nothing; two
  items naming one new thing create one line at the first item's amount, and the second slot
  answers `ALREADY_ON_LIST`; a product item meeting only a line of another unit refuses with
  `details.index`, writes nothing and announces nothing; two items of one product in two units
  are a 400.
- `core/src/app/lists/line-add-typed-name.integration.spec.ts` on real Postgres: an open typed
  add beside a wanted weighed product line leaves the row byte for byte (quantity, version,
  `updatedAt`) and adds no `list_line_changes` row; beside the same line at 0 raises it to 25.
- `core/src/app/baskets/basket-line-add.service.spec.ts`: `addOutcome` passes through, `entries`
  name the met lines, and the refusal reaches the basket route unchanged.

### 7.2 Gateway, platform and assistant

- `gateway/src/app/lists/line-add-choice.http.spec.ts` and `line-unit.http.spec.ts`: 201 with
  `outcome` and `alreadyOnList` on the list add, the batch add and the basket add; the 409 and
  its details on the three routes.
- `libs/luna-shopper/platform/src/lib/errors/problem-factory.spec.ts`: the details are exposed.
- `assistant/src/app/assistant/assistant.service.spec.ts`: a batch answering `ALREADY_ON_LIST` is
  reported `unchanged`; a refused batch is reported refused; an answer with no `outcome` is read
  from `merged`.
- The gateway's `openapi-document.spec.ts` and `wire-types.spec.ts` pass after regeneration.

### 7.3 The HTTP walk, on an ephemeral slot

1. A list with a loose product line at 750 g (`GRAM`). A typed add of its name, no unit, no
   quantity: 201, `ALREADY_ON_LIST`, the line at 750 and the same `version`.
2. The same typed add with `quantity: 2`, `unit: 'UNIT'`: the same answer (R4).
3. An add of the product in `GRAM` with no quantity: the same answer.
4. Set the line to 0 through the update route; the typed add again: 201, `RAISED`, 25 g.
5. An add of a product sold by the kilo that is on no line: 201, `CREATED`, 25 g.
6. A line of several products set to `UNIT` that holds a product sold by the kilo; an add of that
   product in `GRAM`: 409 `line_unit_differs` naming the line, `UNIT` and `GRAM`; the same in a
   batch: 409, `details.index` 0. The list unchanged after both.
7. The basket add of step 1's name through a basket that covers the list: 201, `addOutcome`
   `ALREADY_ON_LIST`, the entry of that line.

## 8. What existing rows keep

Nothing is migrated. Lines created before this plan at 1000 g keep their amount. Between the
deploy of `0246` and this plan, `newLine` and `addMany` could create a second line of one thing
in another unit; those lines stay, a rename of one onto the other is already refused, and U2 says
a merge across units waits for a conversion.

## 9. Acceptance criteria

- [ ] `defaultQuantityOf` answers 1, 25, 25, and a product add with no quantity creates at one
      step.
- [ ] An add of any kind that meets a wanted line writes nothing, records nothing, emits nothing,
      and answers 201 with `outcome: 'ALREADY_ON_LIST'`, `merged: true` and `alreadyOnList`.
- [ ] An add that meets only kept lines raises one by its amount and answers `RAISED`.
- [ ] A product add that meets only lines of another unit refuses with `line_unit_differs` and
      its details before the first write, whatever `newLine` says; a free text add never does.
- [ ] A product add meets a line of several products that holds it.
- [ ] `line_add_needs_choice` is thrown only for two or more kept candidates with
      `askIfAmbiguous`, never for a unit, and each entry carries the line's real unit.
- [ ] A batch never sums, answers an outcome per item, and refuses whole on a unit with
      `details.index`.
- [ ] The basket add answers `addOutcome` and names the met lines in `entries`.
- [ ] The assistant reports `ALREADY_ON_LIST` as `unchanged`.
- [ ] The specs of section 7 pass, `npx nx affected -t lint test` is green, and the walk of 7.3
      is in the PR.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.

## 10. Not in this plan

- The usual amount at a repeat add, the median of the amounts bought (backlog `0025`).
- A conversion between units at an add or a merge (backlog `0024`).
- The per product step (backend `0261`, velista `0186`).
- The limit of 999 999 (backend `0262`).
- The deletion of a line with nothing to keep at 0 (backend `0263`, velista `0192`). _Note of
  2026-11-12: `0263` was withdrawn by the owner; no write deletes a line at 0._
- The merge and the rename planner (`0246` section 3.3 stands).
- Everything a client draws (velista `0185`).

## 11. Questions for the owner

1. **R2.** A typed name or a product whose only line is at 0 (bought, kept) is raised to one
   step rather than left at 0 and shown. Is that what you want, or should a kept line also be
   "already on the list" and stay at 0?
2. **R3.** When a typed name meets several lines and at least one is wanted, nothing is asked:
   every wanted line is marked. The question with "A new line" is asked only when every line is
   at 0. Is losing the "A new line" choice in the first case acceptable?
3. **R5.** A product on a line of several products counts as already on the list, so the add
   writes nothing there. Should it instead create a line of that product alone?
   _Answered on 2026-11-12: R5 stands (section 0)._
4. **R6.** A pasted list that names one thing twice now makes one line at the first amount, not
   the sum. Is that right?
5. **R7.** Is a whole batch refusal still acceptable for the assistant, or should a later plan
   teach the batch to skip and report?
