# 0228: a typed name meets the line that holds that product

> Asked for by the owner on 2026-10-27: "if you have a single line with a specific product in
> your list, with the same name as the line you just entered (a free text line without
> product), units are added to the existing one. If you have more than one, you will get a
> popover in the button telling you that product is already in your list." The owner picked
> the mocks in `apps/velista/plans/mocks/duplicate-line/` (PR #843) and answered three
> questions:
>
> 1. A line already bought counts, and the add takes it from 0 to 1.
> 2. A free text line of that name still takes the add without a question (plan `0091`).
> 3. The backend decides, because the app may not hold every line of a list.
>
> Velista `0170` is the client half and consumes everything here. Build this plan first.
>
> Every fact below was read on `dev` at `83f982bd` on 2026-10-27.
>
> Prerequisite reading: plan `0091` (one line per name), plan `0112` sections 2 and 4 (the
> rename refusal this plan copies), plan `0207` (`named`), plan `0214` section 1 (the merge
> key of a line that is not named), and in the code `line.service.ts` (`add`,
> `findAddTarget`, `findEarliestLines`, `raiseForAdd`), `line-content.ts`
> (`lineIdentities`, `normalizeContent`), `baskets/basket-line-add.service.ts`, and
> `LineMergeRequiredException` in `libs/luna-shopper/platform/src/lib/errors/domain-exception.ts`.

## Brief for the agent

### Objective

A free text add whose name is the name of exactly one line that holds a product raises that
line. When two or more such lines exist and the caller says it can ask, the add is refused
with the lines in `details`, and the caller answers with the line to raise or with a request
for a new line. The list add and the basket add behave the same, because both go through
`LineService.add`.

### Context

- **Today the typed name never meets a product line.** `lineIdentities`
  (`core/src/app/lists/line-content.ts:86-108`) keys a free text add as `<name>\0text`. A
  named line with a product is `<name>\0set:<hash>`, and a line that is not named is
  `set:<hash>` alone (plan `0214`). `add` (`line.service.ts:906-995`) looks up only those
  keys, so typing "Leche entera" beside the product line "Leche entera" creates a second
  line. Checked on staging on 2026-10-27: the answer was `merged: false`.
- **A raise already exists and already handles a bought line.** `raiseForAdd`
  (`line.service.ts:1494-1517`) adds to `quantity`, caps it, bumps `version`, writes a
  `QUANTITY_CHANGED` change and is announced as `line.updated`. Settlement lowers
  `quantity` by what was bought (`settlement.service.ts:196-215`), so a bought line sits at 0
  and a raise of 1 takes it to 1. That is the owner's answer 1, with no new code.
- **The lock is already taken.** `add` locks the list row before it reads (`lockList`), so a
  rule that reads every line of the list cannot race another add to the same list.
- **The basket add is the list add.** `BasketLineAddService.add`
  (`core/src/app/baskets/basket-line-add.service.ts`) calls `LineService.add` for
  `targetListId`. A refusal thrown there reaches the basket route unchanged.
- **The precedent for a refusal that carries a question.** `LineMergeRequiredException`
  (`platform/src/lib/errors/domain-exception.ts:233-236`) has `exposesDetails = true` and
  carries the other line in `details`. The problem schema documents that bag per code
  (`problem-details.schema.ts:64-67`). Velista turns it into a question
  (`libs/velista/feature-lists/src/lib/line-merge-question.ts`).
- **Core holds no product names.** A line holds `content`, `named`, `itemSetHash`,
  `productGroupId` and its item ids. For a line that is not named, `content` is the
  product's name in the locale of the person who added it (plan `0214`). Velista draws a
  product's brand and size from its own catalog read.

### Target state

1. A free text add (no `itemIds`, no `productGroupId`) resolves in this order, inside the
   existing transaction and lock:
   1. `intoLineId` is set: raise that line. Answer `merged: true`.
   2. A free text line of that name exists (`<name>\0text`, plan `0091`): raise it, as
      today. This holds even when `newLine` is true.
   3. `newLine` is true: create a line, as today.
   4. Find the **candidates**: lines of the list that are not `REJECTED`, that hold a
      product set or a group, and whose `normalizeContent(content)` equals the folded
      typed name. Any `named` value, any quantity, bought lines included.
      - One candidate: raise it. Answer `merged: true`.
      - Two or more and `askIfAmbiguous` is true: throw `LineAddNeedsChoiceException`.
      - Two or more and `askIfAmbiguous` is not true: create a line, as today.
      - None: create a line, as today.
2. `AddLineRequest` (contracts) and the gateway add DTO of the list route and the basket
   route gain three optional fields: `askIfAmbiguous: boolean`, `intoLineId: uuid`,
   `newLine: boolean`. `intoLineId` together with `newLine: true` is refused as a
   validation error. Any of the three on an add that carries `itemIds` or a group is
   ignored, because a product add is unchanged.
3. `LineAddNeedsChoiceException` is a new code `line_add_needs_choice`, HTTP 409,
   `exposesDetails = true`. Its `details` is
   `{ lines: [{ lineId, content, named, quantity, itemIds, productGroupId, approvalStatus }] }`,
   in list position order, at most `LINE_ADD_CHOICE_MAX` (10) entries. The problem schema
   description names the bag.
4. `intoLineId` names a line of the same list that is not `REJECTED`. Any other id is the
   existing line not found refusal. The line does not have to carry the typed name: the
   person chose it.
5. The OpenAPI document and the admin wire types are regenerated.

### Scope

- `apps/luna-shopper-backend/core/src/app/lists/line.service.ts` (`add` and a new private
  `findNamedProductLines`), `line-content.ts` only if a helper for the folded name belongs
  there, and the specs `line-add-merge.spec.ts` plus one integration spec on real Postgres.
- `apps/luna-shopper-backend/core/src/app/baskets/basket-line-add.service.ts` passes the
  three fields through, and its spec.
- `libs/luna-shopper/contracts`: `AddLineRequest`, `AddBasketLineRequest`, their schemas,
  and `LINE_ADD_CHOICE_MAX`.
- `libs/luna-shopper/platform/src/lib/errors`: the code, the exception, the schema text.
- `apps/luna-shopper-backend/gateway/src/app/lists/list.dto.ts` and
  `gateway/src/app/baskets/basket.dto.ts`: the three fields, documented.
- `apps/luna-shopper-backend/gateway/docs/openapi.json` and
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, regenerated.
- This plan file: section 6 at the end and the `> **PR:**` line at the top.

### Constraints

- **The batch add is unchanged.** `addMany` (the assistant, generation) keeps today's keys.
  A batch cannot ask, and the assistant has its own plan for near matches (`0148`, on hold).
- **A product add is unchanged.** Plans `0091` and `0214` already decide where a product
  add lands.
- **The one candidate merge does not need `askIfAmbiguous`.** An old velista build (the
  installed PWA, the Android app) gets the merge too. It reads `merged: true` already. Only
  the refusal is opt in, so an old build never meets a code it cannot read.
- **Never create when the person chose a line.** `intoLineId` raises or refuses. It never
  falls back to a new line.
- The quantity added is the request's `quantity`, validated as today, and the raise is
  capped by `raiseForAdd` as today.
- No migration. No new index: the candidate read is one `SELECT` over the locked list's
  lines, the same rows `findEarliestLines` already reads.

### Action boundaries

- Do not touch velista. Velista `0170` does that.
- Do not change `lineIdentities` keys. The new rule is a second lookup after the existing
  one, not a new key.
- Regenerate `openapi.json` and the wire types with their targets. Never edit them by hand.

### Progress evidence

- `line-add-merge.spec.ts` covers each branch of target 1, the 0 to 1 raise of a bought
  line, the refusal's details, the cap of 10, and `intoLineId` on another list.
- An integration spec on an ephemeral Luna slot shows two adds racing on one list with one
  candidate: both raise the same line, no second line exists.
- `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-admin/models`
  passes, with the regenerated documents committed.

## 1. Decisions

- **D1. The backend decides** (the owner, answer 3). The app may hold a page of lines, not
  the list. Only core, under the list lock, knows every line, so only core can say "one" or
  "two or more" truthfully.
- **D2. A bought line counts** (the owner, answer 1). A line at quantity 0 is a candidate,
  and a raise takes it to the added amount.
- **D3. A free text line of that name wins** (the owner, answer 2). Plan `0091` runs first
  and asks nothing.
- **D4. One round trip in the common case.** No preflight read. A free text add with no
  candidate or one candidate answers at once. Only two or more costs a second request, and
  that request is the person's answer.

## 2. Why the candidates are matched on `content`

Core has no product names, so the name the row shows is not available to it for a line that
is not named. For such a line `content` is the product's name in the adder's locale, which
is the name most people on that list typed and read. The known limit: a line added from the
catalog in English is "Whole milk" in `content`, and a person who types "Leche entera" does
not meet it. The add creates a line, as today. A later plan can carry the catalog's names
into the match if that limit shows up in use.

## 3. The refusal

```json
{
  "code": "line_add_needs_choice",
  "status": 409,
  "details": {
    "lines": [
      { "lineId": "…", "content": "Leche entera", "named": true,  "quantity": 2,
        "itemIds": ["112d47e2-…"], "productGroupId": null, "approvalStatus": "APPROVED" },
      { "lineId": "…", "content": "Leche entera", "named": false, "quantity": 1,
        "itemIds": ["21d3713f-…"], "productGroupId": null, "approvalStatus": "APPROVED" }
    ]
  }
}
```

The client draws each row from these fields and its own catalog read of `itemIds`. It
answers with `intoLineId` or with `newLine: true`. Both answers run through the same lock,
so a line deleted between the question and the answer is the not found refusal, and a new
free text line of that name added meanwhile takes a `newLine` answer (target 1.2).

## 4. Not in this plan

- The near match ("leche" against "leche entera"). The match is the whole folded name.
- The batch add, the assistant, generation runs.
- Any velista change.

## 5. Choices that are mine

- The three field names `askIfAmbiguous`, `intoLineId`, `newLine`.
- The cap of 10 lines in `details`. A list with eleven lines of one name is not a case the
  popover can draw well, and the eleventh is still reachable on the list.
- HTTP 409, as `line_merge_required` uses.

## 6. What the build decided

- **B1. `intoLineId` beside `newLine: true` is refused on every add**, a product add
  included, at the gateway (`NotBesideNewLine` on both DTOs, a 400 under `intoLineId`) and
  again in core (`ValidationException`). The pair is malformed whatever else the body
  carries, so "ignored on a product add" covers each field alone and not the pair.
- **B2. Only a JSON `true` turns a flag on.** Both DTOs read `askIfAmbiguous` and
  `newLine` as the body spelled them, as `named` already is, so `"false"` is a 400 and
  never a true. Core reads `=== true` as well.
- **B3. A chosen line is read by id and list, locked.** A line of another list, a
  deleted line, a `REJECTED` line and an id that matches nothing are the one
  `NotFoundException('Line not found')`. Core checks that the id is a uuid as well, with the
  `validateReference` helper that `favoriteItemId` uses, so a NATS caller that is not the
  gateway gets a validation error and not a failed cast in Postgres.
- **B4. The candidate read is its own `SELECT`** (`findNamedProductLines`) after the
  identity read, not a widening of `findEarliestLines`, so the `lineIdentities` keys and
  the rename's lookup are untouched. It runs only for a free text add that missed the free
  text line of its name and did not say `newLine`. "Holds a product set" is
  `itemSetHash !== null`; a line that follows a group with no product is a candidate.
- **B5. The refusal reads the products of the shown lines in one `In` query**, only when
  it refuses. `details.lines[].itemIds` is the set in attachment order, `productGroupId`
  is null when absent, and `content` is the row's own spelling. The cap applies to the
  details only: twelve candidates still refuse, and name the first ten by position.
- **B6. `messageArgs.content` is the typed name, trimmed**, so the server's sentence
  reads "This list already has more than one line called "{content}"". The client writes
  its own question from `details`.
- **B7. Two existing unit cases changed meaning on purpose.** "keeps free text apart from
  a line that names a product" and "never takes a group line with no product for free
  text" in `line-add-merge.spec.ts` now assert the raise of target 1.4.
- **B8. Documentation.** The list add route documents 409 `line_add_needs_choice`
  through a new `lineAddChoice` option of `ApiProblemResponses`; the basket add route lists
  it beside `basket_finished`. The 404 for `intoLineId` is the class level membership 404
  on the list route and the existing `notFound` on the basket route. The problem schema's
  `details` text names the bag, with the cap read from `LINE_ADD_CHOICE_MAX`.
- **B9. The NATS message schemas** (`list.schemas.ts`, `basket.schemas.ts` in contracts)
  gained the three fields, since they refuse unknown properties.
- **B10. Who else gets the one candidate merge.** Every caller of `line.add` with no
  flags: old velista builds, as the plan intends, and the basket add. `addMany` is
  unchanged, which a unit case asserts.
- **B11. A candidate deleted during the add is no candidate.** The candidate read takes no
  lock, and a delete does not take the list lock, so the one candidate can be gone when the
  add reads it again by id and list under `pessimistic_write` (`lockCandidateLine`). The add
  then creates a line and answers `merged: false`, as `findEarliestLines` does on the same
  miss, and never refuses a plain add with line not found. A chosen line that is gone stays
  the not found refusal (B3).
