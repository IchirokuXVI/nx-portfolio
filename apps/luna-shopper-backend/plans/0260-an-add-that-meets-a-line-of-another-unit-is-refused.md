# 0260: an add that meets a line of another unit is refused

> Written on 2026-11-09 from the owner's decisions of that day (U1 to U3, section 0). Plan
> `0246` M5 answers an add that meets a line of another unit as the duplicate question of
> plan `0228`, and `newLine: true` then creates a second line of the same thing in the add's
> unit. The owner decided that such an add is an error, never a choice and never a silent new
> line, until a conversion between units exists (backlog `0024`). This plan makes core refuse
> it before anything is written, with a refusal that names the line and both units, so the
> client can say "this list already counts milk in litres".
>
> It amends `0246` M5 and section 3.3 in their add half. The merge half (a rename onto a line
> of another unit, `line_unit_differs`) stays as `0246` built it. It also records U1, which
> closes the first bullet of `0246` section 9; the text of `0246` is left as it is.
>
> Depends on PRs #959 (backend `0246`), #960 (velista `0182`) and #961 (velista `0183`) being
> in `dev`. The client half is velista `0185` (the composer with no quantity picker, and the
> sentence of this refusal), written on the same day by another writer.
>
> Prerequisite reading: `0246` in full (section 0, M5, section 3.3, section 9), `0228` in full
> (target 1, D1 to D4, B1 to B11), velista `0170` (what the duplicate question is for), and the
> PR body of #959 ("Review round 1" finding 6, "Review round 2" finding 1).
>
> Code anchors, read on `origin/feat/velista-0183-line-unit-chip` on 2026-11-09 (it carries
> #959 to #961):
> `apps/luna-shopper-backend/core/src/app/lists/line.service.ts:960` (`add`), `:1021` to
> `:1023` (`differs`, `unitChoice`), `:1027` to `:1042` (a chosen line of another unit),
> `:1067` to `:1076` (the add's unit first, then `unitChoice`), `:1080` to `:1101` (the typed
> name candidates), `:1191` (`addMany`), `:1257` to `:1278` (the batch target and the fold in
> one unit), `:1624` to `:1653` (`needsChoice` and its `'unit'` variant);
> `core/src/app/lists/line-merge.service.ts:195` (the merge refusal);
> `libs/luna-shopper/platform/src/lib/errors/domain-exception.ts:296`
> (`LineUnitDiffersException`), `error-codes.ts:184` and `:715`,
> `problem-details.schema.ts:66`; `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts:690`
> to `:800` (`AddLineRequest`, `LineAddChoice.unit`); the specs
> `core/src/app/lists/line-add-merge.spec.ts:342` to `:442` and
> `gateway/src/app/lists/line-add-choice.http.spec.ts`, `line-unit.http.spec.ts:311`;
> `assistant/src/app/assistant/tools.ts:326` to `:350` and `:1560` (`refused`);
> `libs/velista/feature-lists/src/lib/list-error-copy.ts:93`.

## Brief for the agent

### Objective

An add that states a unit (a product add, a basket add or a batch item with `unit`) and would
land on a line that counts in another unit, and on no line of its own unit, is refused with
`line_unit_differs` before anything is written. The refusal carries the line it met and both
units. A typed name that states no unit takes the unit of the product line it lands on and adds
one default of that unit to it (U3, R5).

### Context

- Today an add raises the earliest line of its own unit first (`line.service.ts:1067`). When
  its unit holds none and a line of another unit matches, the add throws
  `line_add_needs_choice` naming that one line (`:1074` to `:1076`, via `needsChoice(...,
  'unit')` at `:1648`). With `newLine: true` the add skips that throw and creates a line in its
  own unit, a product add included (`0246` PR #959, review round 2, "Superseded decisions").
- A free text add whose typed name meets one product line of another unit throws the same
  question (`:1093` to `:1099`). With two or more candidates and `askIfAmbiguous`, the question
  lists every candidate, whatever its unit (`:1100` to `:1101`): a candidate of another unit is
  offered, and choosing it then answers `line_unit_differs` (`:1033` to `:1040`).
- `addMany` raises only a line of the item's unit (`:1261`) and otherwise creates a line in
  the item's unit beside a line of another unit. Two items of one thing in two units become two
  lines (`:1269` to `:1278`).
- A free text add always counts `UNIT`: the gateway offers `UNIT` alone for a line with no
  product (`line-unit.http.spec.ts:279`), so a free text line never counts grams.
- `LineUnitDiffersException` has no `details` (`domain-exception.ts:296`). The merge throws it
  (`line-merge.service.ts:195`); so does the add for a chosen line of another unit.
- Velista draws `line_unit_differs` as `list.error.unitDiffers`, worded for a rename
  (`list-error-copy.ts:93`).

### Target state

1. Every add path in core that states a unit resolves the line it would land on, and when the
   only lines it meets count in another unit it throws `line_unit_differs` with the details of
   section 2. Nothing is written. `newLine: true` does not change that (R2).
2. A free text add that states no unit and no quantity, and lands on a product line of the
   typed name (`0228` target 1.4, or an `intoLineId` answer), raises that line by
   `defaultQuantityOf(line.unit)`: one piece, one kilo or one litre (R5). A free text line it
   creates still counts `UNIT` (U1).
3. `addMany` refuses the whole batch on the first item that meets only a line of another
   unit (R3), and refuses before the transaction a batch that names one thing in two units.
4. `line_unit_differs` exposes its details, and the problem schema documents the bag.
5. The OpenAPI document and the admin wire types are regenerated and committed.

### Scope

- `apps/luna-shopper-backend/core/src/app/lists/line.service.ts` (`add`, `addMany`,
  `needsChoice`, `findNamedProductLines` or its caller), and the core specs of section 5.
- `libs/luna-shopper/platform/src/lib/errors/` (`domain-exception.ts`, `problem-details.schema.ts`,
  `problem-details.ts` if it lists the codes with a bag).
- `libs/luna-shopper/contracts`: `LineUnitDiffersDetails` beside `LineAddNeedsChoiceDetails`
  in `list.messages.ts`, and the doc comments of `AddLineRequest.unit`, `askIfAmbiguous` and
  `newLine` that describe M5.
- `apps/luna-shopper-backend/gateway`: the route documentation of the list add, the basket add
  and the batch add (`ApiProblemResponses`), and the HTTP specs.
- `apps/luna-shopper-backend/assistant`: only if the spec of section 5 shows that a batch
  refusal is not read as a refusal today.
- The generated `openapi.json` and `wire-types.ts`.
- Do NOT touch the merge, the rename planner, velista or the back office.

### Constraints

- U1 to U3 are the owner's and are settled. R1 to R6 are the writer's; the owner may overrule
  them before the build.
- No migration. No release task: section 6 says why existing rows need none.
- The refusal is thrown before the first write of the transaction, so the rollback undoes
  nothing and no `line.updated` or `line.added` is announced.
- No dashes as punctuation in any prose.

### Action boundaries

- Proceed with sections 1 to 5.
- Stop and ask if PRs #959, #960 and #961 are not all in `dev`.
- Stop and ask if velista `0185` names a different code or a different shape of `details`
  than section 2: the two plans must agree before either is built.
- Regenerate `openapi.json` and `wire-types.ts` with their targets. Never edit them by hand.

### Progress evidence

Each criterion of section 7 with its spec output, the two generation targets run and their
diffs committed, and one HTTP walk on an ephemeral slot: a loose product line at 750 g, then a
typed add of its name with no unit and no quantity (201, the line at 1750 g), an add of that
product in `UNIT` with `newLine: true` (409 `line_unit_differs` naming the line, `GRAM` and
`UNIT`), and a batch of that product in `UNIT` (the same 409, `details.index` 0), with the list
unchanged after the two refusals.

## 0. Decisions

The owner's, 2026-11-09, not to reopen:

- **U1. A free text line counts pieces.** To count in another unit a line needs a product.
  This closes the first bullet of `0246` section 9 ("a product decision the owner has not
  taken"). W1 of `0246` stands. This plan records U1 and leaves the text of `0246` as it is.
- **U2. A conversion between units is wanted at an add and at a merge, and not now.** Until a
  conversion plan is built, an add or a merge that meets a line of another unit is an error,
  never a choice and never a silent new line. The conversion is backlog `0024`.
- **U3. The composer has no quantity picker.** A person types and presses add. That creates a
  free text line, or adds one default unit (`defaultQuantityOf(unit)`: one piece, one kilo,
  one litre) to the line that already holds that name or product. A line of another unit is an
  error (U2). The amount is stepped on the list. The composer is velista `0185`.

The writer's, open to the owner:

- **R1. The code is `line_unit_differs`, not a sibling.** It already means "these amounts
  count in different units and nothing was summed", it is a 409, the gateway already documents
  it on the list add and the basket add (PR #959, review round 1, finding 6), and velista
  already maps it. A second code for the same fact would need a second entry in every client.
  The occasion (an add or a rename) is known to the client from the route it called, so the
  sentence can differ without the code differing. The add's refusal carries `details`
  (section 2); the merge's stays without them, as `0246` built it.
- **R2. `newLine: true` does not create a line beside a line of another unit.** U2 says an
  error and never a silent new line, and a line the person asked for by answering a question
  this plan no longer asks is the same second line by another door. `newLine` stays an answer
  only where `0228` offers it: beside two or more candidates in the add's unit. With `newLine:
  true` and only lines of another unit, the add is refused as without it.
- **R3. A batch that meets a line of another unit is refused whole.** The alternative, skipping
  the item and reporting it, needs a new slot in `AddLineResult[]` (an item with no line), which
  every caller of the batch would have to read, and the assistant would be the only reader that
  can use it. The gateway already refuses a whole batch for one item's unit
  (`line-unit.http.spec.ts:311`), the batch is one transaction already, and the assistant
  reads a refused batch as a refusal and reports it through `refused` (`tools.ts:1560`) with
  the platform's sentence. `details.index` names the item, so a caller can send the batch again
  without it.
- **R4. Two items of one thing in two units in one batch are a validation error**, a 400
  before the transaction opens, with `messageArgs.field` `items`. Today they become two lines
  (`:1269`). That is the same second line U2 forbids, and no line exists yet to name in a 409.
- **R5. A typed name with no unit takes the unit of the product line it lands on.** This is the
  owner's reading of U3: "add 1 unit (kg, L...) by default to a line with the same name". A free
  text add that states neither `unit` nor `quantity` and lands on a product line of the typed
  name raises it by `defaultQuantityOf(line.unit)`: "plátanos" onto the loose product line
  "plátanos" at 750 g makes it 1750 g. Only an add that states a unit keeps the check and is
  refused. A free text add that states a `quantity` and no unit counts `UNIT`, as today, and
  is checked as a stated unit: a bare number with no unit onto a gram line would add grams
  where the caller meant pieces, which is the risk `0246` M8 names. U1 is unchanged: this is a
  raise of an existing product line, and a free text line the add creates counts pieces.
- **R6. `LineAddChoice.unit` stays on the wire, and it now says something.** A typed name with
  no unit can be asked about lines of any unit (section 1 step 3), and the client says what one
  default of each would add ("+1 kg", "+1").

## 1. The rule in core

`add` (`line.service.ts:960`) resolves in this order, inside the existing transaction and
lock. "Its unit" is the add's `unit`, `UNIT` when absent. An add "states a unit" when it
names `unit` or `quantity`; a free text add that names neither is an **open add** (R5).

1. `intoLineId` set (free text only, as `0228` B3): an open add raises the chosen line by
   `defaultQuantityOf(chosen.unit)`, whatever its unit. An add that states a unit raises the
   chosen line of its unit; of another unit, `line_unit_differs` with section 2's details.
2. The identity targets (`:1067`): the earliest line in its unit is raised, as today. Else, the
   earliest line of another unit is `line_unit_differs` naming it, **whatever `newLine` says**
   (R2). This replaces `:1074` to `:1076`.
3. A free text add that met no free text line of its name: read the candidates of `0228`
   target 1.4 (`findNamedProductLines`).
   - **An open add** (R5): `0228` target 1.4 runs on every candidate, whatever its unit. One
     candidate is raised by `defaultQuantityOf(line.unit)`; two or more refuse with
     `line_add_needs_choice` when `askIfAmbiguous`, listing all of them with their `unit`, or
     create a `UNIT` line when not; `newLine: true` creates a `UNIT` line, as `0228` target 1.3
     allows. The answer `intoLineId` then raises the chosen line by step 1.
   - **An add that states a unit**, split by unit. One or more in its unit: `0228` target 1.4
     runs on those alone, and `newLine: true` creates a line. None in its unit and one or more
     of another unit: `line_unit_differs` naming the first by list position, whatever `newLine`
     and `askIfAmbiguous` say (R2). This check runs even when `newLine` is true, so step 3 is
     reached with `newLine: true` too; today `newLine` skips it (`:1080`).
   - None at all: create, as today.
4. Create, as today.

`needsChoice` loses its `'unit'` variant (`:1628`, `:1649`): a question is never about a unit
again. The single candidate path at `:1093` to `:1099` keeps its lock and its B11 rule (a
candidate deleted meanwhile is no candidate).

`addMany` (`:1191`):

- Before the transaction: two items with one key (`keys`) and two units are refused (R4).
- In the plan loop (`:1257`): a key whose target in the item's unit is absent and whose target
  in another unit is present refuses the batch with `line_unit_differs`, `details.index` the
  item's position (R3). `findAddTarget` already answers both (`:1710` to `:1736`), so no read is
  added.
- Two items of one thing in one unit still fold, as `0246` section 3.3 built.

The basket add goes through `LineService.add` (`0228` context), so it follows the same rule
with no change of its own.

## 2. The refusal

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
  `quantity`) is the line the add met, `unit` is what the add counted in, `index` is the
  batch item's position or null on a single add.
- `LineUnitDiffersException` gains `override readonly exposesDetails = true`. The merge throws
  it with no details, which the problem factory omits; the schema text says the bag is present
  on an add.
- `problem-details.schema.ts:66` names `line_unit_differs` beside the two codes whose bag it
  describes, and lists the three fields.
- `messageArgs.content` is the line's own spelling, so the server's sentence reads "The line
  "Leche entera" of this list counts in another unit".
- The client's sentence comes from the code and `details`: velista `0185` says "This list
  already counts {content} in {unit of the line}", and keeps today's rename sentence on the
  rename route.
- A typed name from the composer (an open add, R5) never meets this refusal; it raises the
  product line by one default of its unit. The refusal reaches the composer only from a
  product picked in the typeahead or the catalog add, which state a unit.

## 3. The gateway and the documents

- The list add, the basket add and the batch add document 409 `line_unit_differs` (the first
  two already do; the batch add is checked and added if absent).
- The descriptions of `askIfAmbiguous` and `newLine` in the add DTOs and the contract stop
  saying that a line of another unit is offered and that `newLine` creates beside it.
- Then:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 4. The assistant

Its fresh adds are free text and carry no unit (PR #959, review round 1, finding 3). Free text
batch items meet free text lines by name alone (`0228` constraint), so they never reach a line
of another unit. A product item can. The refusal then comes back for the whole call and is
reported by `refused` (`tools.ts:1560`) with the platform's sentence. A spec asserts that, and
the builder changes the tool only if the spec fails.

## 5. Specs

- `core/src/app/lists/line-add-merge.spec.ts`: the four cases at `:368` to `:442` change
  meaning on purpose, and the PR names them. A product add meeting only a `GRAM` line throws
  `line_unit_differs` with the details and writes nothing; the same with `newLine: true`; an
  open typed name whose one candidate is `GRAM` at 750 raises it to 1750, and one whose one
  candidate is `UNIT` raises it by 1; the same typed name with `quantity: 1` and no unit throws
  `line_unit_differs`; an open typed name with a `UNIT` and a `GRAM` candidate and
  `askIfAmbiguous` lists both with their units; `intoLineId` on the `GRAM` one from an open add
  raises it by 1000; a stated `UNIT` add with a `UNIT` and a `GRAM` candidate raises the `UNIT`
  one with no question; a stated `UNIT` add choosing a `GRAM` line carries the details; `addMany`
  with an item meeting a `GRAM` line refuses with `index`, writes nothing and announces
  nothing; two items of one product in `UNIT` and `GRAM` are a 400.
- `core/src/app/lists/line-add-typed-name.integration.spec.ts` on real Postgres: an open typed
  add beside a weighed product line raises it by 1000 g and creates no line; a product add in
  `UNIT` beside it is refused and the list reads as before.
- `core/src/app/baskets/basket-line-add.service.spec.ts`: the refusal reaches the basket route
  unchanged.
- `gateway/src/app/lists/line-add-choice.http.spec.ts` and `line-unit.http.spec.ts`: the 409
  and its details pass through on the list add, the basket add and the batch add.
- `libs/luna-shopper/platform/src/lib/errors/problem-factory.spec.ts`: the details are exposed.
- `assistant/src/app/assistant/assistant.service.spec.ts`: a batch refused with
  `line_unit_differs` is reported as refused, never as added or increased.

## 6. What existing rows keep

Between the deploy of `0246` and this plan, `newLine` and `addMany` can create a second line of
one thing in another unit. Those lines stay: each add raises the line in its own unit first
(section 1 step 2), and a rename of one onto the other is already refused. No release task: no
amount is wrong, and nothing merges them, because U2 says a merge across units waits for a
conversion. If this plan ships in the same release as `0246`, no such row exists.

## 7. Acceptance criteria

- [ ] No add that states a unit raises, sums or creates beside a line of another unit when its
      unit holds no line; each refuses with `line_unit_differs` before the first write.
- [ ] An open typed name raises the one product line of its name by
      `defaultQuantityOf(line.unit)`, and a line it creates counts `UNIT`.
- [ ] `newLine: true` on an add that states a unit never creates a line beside a line of
      another unit only.
- [ ] `line_add_needs_choice` never throws for a unit; for a stated unit it lists only lines in
      that unit, for an open add every candidate with its unit.
- [ ] A refused batch writes nothing, announces nothing and names the item in `details.index`.
- [ ] A batch naming one thing in two units is a 400.
- [ ] `line_unit_differs` from an add carries `details.line`, `details.unit` and
      `details.index`; from a merge it is unchanged.
- [ ] The specs of section 5 pass, and `npx nx affected -t lint test` is green.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.

## 8. Not in this plan

- A conversion between units at an add or a merge (backlog `0024`).
- The merge and the rename planner (`0246` section 3.3 stands).
- The composer, the error sentence and the line page (velista `0185`).
- A free text line that counts grams (U1 closes it).

## 9. Questions for the owner

1. **R5.** Typing the name of a weighed product line adds one kilo to it (this plan, your
   reading of U3). Should a typed name be refused there instead, so that a free text add never
   means a kilo? That needs every free text add to count `UNIT` and the composer to show the
   refusal of section 2.
2. **R3.** Is a whole batch refusal acceptable for the assistant, or should a later plan teach
   the batch to skip and report?
