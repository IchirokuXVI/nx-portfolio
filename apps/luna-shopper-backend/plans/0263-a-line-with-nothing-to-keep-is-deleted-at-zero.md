> **PR:** [#977](https://github.com/IchirokuXVI/nx-portfolio/pull/977)

> **Withdrawn on 2026-11-12 by the owner.** In his words: "to prevent users from deleting a
> line by mistake (which also removes the history and other things), a line will only be
> deleted if you manually delete it from the sheet or line page. Lines with a quantity of 0
> (or less, just in case) will be hidden and you can only see them when searching. This
> already happens for lines that have at least 1 buy in the list, but the lines that were
> never bought will also be hidden. This change of heart comes from the fact that I didn't
> think about the assistant, users with only edit access, and probably more situations."
> PR #977 now deletes nothing: it holds this note and specs, unit and real Postgres, that a
> settle, a delta and a basket demand that take a bare line to 0 leave it standing at 0.

# 0263: a line with nothing to keep is deleted at zero

> Written on 2026-11-11 from the owner's decision of that day (section 7 of the batch
> decisions). Since backend `0047` a line at 0 stays on its list until somebody deletes it on
> purpose. The owner: "if a line goes back to 0 units and it doesn't have any data saved yet
> (no buys, no line label, supermarket set or anything), it will be deleted. The only data
> that isn't taken into account for this is the product since it is usually set by the app
> itself. If a line has a product set but not any other info, it will be deleted if it goes
> down to 0 without any buys or anything. This needs a test to make sure a settle doesn't
> delete it by reducing the amount before saving the buy".
>
> Amends `0047` section 2.2 ("Zero is not deleted") for a line with nothing to keep, and the
> comments that restate it (`list.messages.ts:101` to `:110`, `list-line.entity.ts:66` to
> `:72`). A line that keeps anything stays at 0 as `0047` says, so the kept list and the
> suggestions of `0123` are unchanged. The client half is velista `0192`.
>
> Needs PRs #959 to #961 in `dev`. Independent of `0262`.
>
> Prerequisite reading: `0047` sections 2.2, 4 and 5; `0123` section 2; `0132` (the soft
> delete); `0207` section 1 (`named`); `0199` (the favourite and the chain); velista `0187`
> section 1 (the take back at the floor).
>
> Code anchors, read on `origin/feat/velista-0183-line-unit-chip` as of 2026-11-11:
> `apps/luna-shopper-backend/core/src/app/entities/list-line.entity.ts:73` (`quantity`),
> `:132` (`favoriteItemId`), `:140` (`preferredSupermarketId`), `:151` (`named`);
> `entities/line-settlement.entity.ts:72` to `:77` (`lineId`, a foreign key), `:185`
> (`revertedAt`); `entities/line-comment.entity.ts:19` to `:24` (`lineId`, a foreign key);
> `core/src/app/lists/line-named.ts` (`namedOnAdd`: absent means a person typed it);
> `core/src/app/lists/line.service.ts:2080` to `:2156` (`applyLineEdit`), `:2197` to `:2199`
> (the quantity of an edit), `:2053` (`updateAsOperator`), `:2389` (`applyRename`), `:3102` to
> `:3177` (`addQuantity`), `:3602` to `:3629` (`delete` and its permission rule), `:3693` to
> `:3730` (`removeLineContents`), `:3741` to `:3770` (`applyLineDeletion`, `line.deleted`,
> `baskets.linesChanged`); `core/src/app/lists/settlement.service.ts:202` to `:260` (the line
> is saved at `:211`, the settlement at `:228`); `core/src/app/baskets/basket-settle.service.ts:174`
> to `:232` (the line saved at `:180`, the settlement at `:201`);
> `core/src/app/baskets/basket-demand.service.ts:115` to `:126` (a demand goes through
> `addQuantity`); `apps/luna-shopper-backend/gateway/src/app/lists/list.controller.ts:543` to
> `:595` and `:614` to `:631`; `libs/luna-shopper/contracts/src/schemas/messages/list.schemas.ts:253`
> to `:257` and `:1191` to `:1198`; `apps/luna-shopper-backend/realtime/src/app/consumer/jetstream.consumer.ts:318`
> to `:323` (the payload is relayed unchanged); `apps/luna-shopper-backend/assistant/src/app/assistant/tools.ts:385`
> to `:407`, `:1132` to `:1166`; `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:507`
> to `:567` and `:631` to `:676`, `libs/velista/models/src/lib/catalog-visit.ts:184` to `:199`.

## Brief for the agent

### Objective

When a member's write lowers a line from above 0 to 0, and the line keeps nothing of the closed
list of section 1, and the caller may delete it by hand, core soft deletes the line in the same
transaction, answers the write with the line and `deleted: true`, and announces `line.deleted`
with `emptied: true`. A settle never does this.

### Context

- A line at 0 stays today (`0047` section 2.2). The only delete is `LineService.delete`, a soft
  delete since `0132` that keeps `line_settlements` and removes comments and the product set
  (`removeLineContents`).
- A settle saves the lowered line BEFORE it inserts the buy, in both settle paths
  (`settlement.service.ts:211` then `:228`; `basket-settle.service.ts:180` then `:201`). A rule
  placed where any save of a line at 0 runs would fire between the two and delete a line that is
  about to hold a buy. That is the failure the owner names.
- The writes that set an amount: `addQuantity` (the delta, also the basket demand), `update`
  (the `PATCH`, also the assistant's set), `updateAsOperator`, the merge, the add and the batch
  add (which only raise), and the two settles and the basket revert.

### Target state

1. `lineKeeps(manager, line)` in a new `core/src/app/lists/line-keeps.ts` answers whether the
   locked line holds anything of section 1, with one query over the two tables.
2. `addQuantity` and the member's `update` call it under their lock, and only when the write
   took the line from above 0 to 0 (section 2).
3. Nothing else calls it, and a spec proves that the settles do not (section 6, first).
4. The answers and the event of section 3; the assistant reports a removed line.
5. The OpenAPI document and the admin wire types are regenerated.

### Scope

- `apps/luna-shopper-backend/core` (`line.service.ts`, the new file, `list-acts.ts`, specs),
  `libs/luna-shopper/contracts` (the answer types and schemas, the doc comments of section 0),
  `apps/luna-shopper-backend/gateway` (route docs, HTTP specs), `apps/luna-shopper-backend/assistant`
  (`tools.ts`), and the generated files.
- Do NOT touch the settle services except to add specs, velista (velista `0192`), or any
  migration.

### Constraints

- The owner's words of section 0 are settled. D1 to D9 are the writer's.
- The deletion runs inside the write's own transaction and lock; no second transaction.
- Every POST answers 201 with a body. An error's facts go in `details`, words in `messageArgs`.
- No dashes as punctuation in any prose.

### Action boundaries

- Proceed with sections 1 to 6.
- Stop and ask before writing a release task or any cleanup of existing lines (D8).
- Stop and ask before changing an existing migration or adding one.
- Stop and ask if the settle spec of section 6 cannot be written without changing a settle.
- Regenerate `openapi.json` and `wire-types.ts` with their targets. Never edit them by hand.

### Progress evidence

The settle specs of section 6 first, with output; then each criterion of section 8; and one
HTTP walk on an ephemeral slot: a product line from a card (`named: false`) at 25 g, minus 25
(201, `deleted: true`, `line.deleted` with `emptied` on the socket, the list read no longer
holds it); the same with a chain set (201, the line at 0, kept); a free text line at 1, minus 1
(kept); a product line at 1 settled `BOUGHT` 1 (the line at 0, `boughtCount` 1, no
`line.deleted`).

## 0. Decisions

The owner's, 2026-11-11, not to reopen: his words in the head of this plan. In short: a line at
0 with no buys, no label, no chain "or anything" is deleted; the product does not count; a test
proves a settle does not delete it.

The writer's, open to the owner:

- **D1. The closed list of section 1.** The owner's examples are buys, a label and a chain, "or
  anything". The list is what a person wrote on the line, read from the schema; what the app
  wrote (the products, the group, the unit, the order, the change history) does not count.
- **D2. Any settlement counts, of either outcome, reverted or not.** "They had none" is a fact a
  person recorded, and a buy taken back is still served by the line's history (`0054`). When in
  doubt a line is kept: keeping it costs a row at 0, deleting it wrongly loses what a person
  wrote.
- **D3. A free text line is never deleted by this rule.** Its name is always `named`
  (`line-named.ts`, rule 1), which is the label the owner names. Question 1.
- **D4. The favourite counts.** Only a person chooses it (`0199`), so it is not "set by the app
  itself".
- **D5. Only a member's lowering to 0 triggers it**: `addQuantity` and the member's `update`,
  when the amount before was above 0 and after is 0. An edit that clears the chain of a line
  already at 0, an operator's edit, a merge, a rename, an add, a revert and both settles never
  delete. A rename always names the line, so it would keep it anyway.
- **D6. The caller must be allowed to delete the line by hand.** The rule of `delete`
  (`line.service.ts:3608` to `:3620`) moves into `canDeleteLine` in `list-acts.ts` and both read
  it. A writer who may not delete an approved line on a list that asks for approval leaves it at
  0, as today: the refusal protects an agreement, and stepping must not go around it. For a
  basket demand that is the owner's permission, as `addQuantity` already asks.
- **D7. The answer is the line plus `deleted: true`, not a 204 or an error.** An older client
  reads a valid line at 0 and then removes the row on the `line.deleted` event it already
  handles. A new client reads `deleted` and removes it at once.
- **D8. No cleanup of existing bare lines at 0.** They were kept on purpose under the rule of
  `0047`, and deleting rows a person wrote is a release task by `CLAUDE.md`, never a migration.
  Proposed instead, if the owner wants it: a release task `NNNN-delete-bare-lines-at-zero` with
  its `check.sh` counting the lines section 1 would delete, its window, and a soft delete
  through the same rule. Question 2.
- **D9. One change row, `deleted`, with the line as it stood before the write.** That is what a
  basket's removed row must show (what the list asked for when it went), and it is what
  `applyLineDeletion` writes for a delete by hand.

## 1. What a line keeps (the closed list)

A line is kept at 0 when ANY of these holds. Nothing else counts.

| # | Table | Column or row | Kept when |
| --- | --- | --- | --- |
| 1 | `list_lines` | `named` | true (a person typed the name; always true on a line with no product) |
| 2 | `list_lines` | `preferredSupermarketId` | not null (the chain) |
| 3 | `list_lines` | `favoriteItemId` | not null (the product a person chose among several) |
| 4 | `line_settlements` | any row with this `lineId` | exists, either outcome, reverted or not (D2) |
| 5 | `line_comments` | any row with this `lineId` | exists, typed or voice (`comment_audio` follows its comment) |

Does NOT count: the product set (`list_line_items`), `itemSetHash`, `productGroupId`, the group
tombstones (`list_line_group_removals`), `unit`, `approvalStatus`, `position`, `version`,
`createdByUserId`, the change history (`list_line_changes`), frozen trip rows
(`basket_trip_rows`), a basket's skips (`basket_line_skips`), and a claim by a live basket.

Every line made before plan `0207` reads `named` true and so is kept: the safe direction.

`lineKeeps` reads 1 to 3 off the locked row and 4 and 5 in one statement
(`SELECT EXISTS (... line_settlements ...) OR EXISTS (... line_comments ...)`) through the
write's manager. Both tables carry a foreign key to `list_lines`, so an insert of a buy or a
comment takes `FOR KEY SHARE` on the line, which waits for the write's `FOR UPDATE`, and the
reverse. The read and a concurrent buy or comment cannot interleave.

## 2. Where the check sits

- **`addQuantity`** (`line.service.ts:3102`): after `validateQuantity` and `authorizeEdit`
  (`:3151` to `:3154`), inside the transaction and under the lock: when `line.quantity > 0`,
  the new `quantity === 0`, `canDeleteLine(...)` and `!(await lineKeeps(manager, line))`, it
  calls `removeLineContents` and the soft delete instead of `writeEdit`, and records the change
  of D9. Otherwise it writes as today.
- **The member's `update`**: in `applyLineEdit`'s transaction after `prepareEdit` (`:2129`) and
  before `writePreparedEdit`, with `prepared.before.quantity > 0 && locked.quantity === 0`.
  `applyLineEdit` gains a parameter `deletesAtZero`, true from `update` and false from
  `updateAsOperator` (D5). The rename path (`:2098`) never reaches it.
- **Never in a shared save.** Not in `writeEdit`, not in an entity subscriber, not in the
  change recorder. The two settles call none of these methods; they save the line with
  `lines.save` and insert the buy after it (Context), and they stay exactly as they are. That is
  the whole guarantee the owner asks for, and the spec of section 6 pins it.

The emptied path shares `removeLineContents` and the soft delete with `delete`; after the
commit it emits as `applyLineDeletion` does (`:3760` to `:3768`), with the payload of
section 3.

## 3. The answer and the event

- **`POST /v1/lines/:id/quantity`**: 201, the line as it stood at 0 (read before its contents
  were removed, so `itemIds` are the products it held) plus `deleted: true`. A new contract type
  `LineQuantityResult extends LineView { deleted?: true }` and a schema `lineQuantityResult`
  beside `updateLineResult` (`list.schemas.ts:253`); `LINE_PATTERNS.addQuantity` answers it.
- **`PATCH /v1/lines/:id`**: 200 as today, `UpdateLineResult` gains `deleted?: true`.
- Absent on every other answer, so no reader changes until it wants to.
- **The event**: `line.deleted` with `{ id, listId, emptied: true }`, and no `line.updated`
  before it. Realtime relays the payload unchanged (`jetstream.consumer.ts:318` to `:323`), and
  velista's mapper reads `id` and `listId` and ignores the rest, so an older client removes the
  row as for any delete. Then `baskets.linesChanged(listId, [id])`, as a delete does.
- A basket demand answers the row as today (`basket-demand.service.ts:133`); the deleted line is
  no longer in it, which the shopping list already treats as a row gone
  (velista `settle-sheet.ts:1308` to `:1311`).

## 4. What each caller does

- **The kept list (`0047`) and the suggestions (`0123`)** are unchanged: a candidate of `0123`
  has a purchase (its section 2), which is row 4, so no line `0123` can suggest is ever deleted.
- **The product page's take back at the floor (velista `0187` section 1).** A minus on a line
  the visit made, where the person may delete, still sends `DELETE` (`catalog-visit.ts:184` to
  `:192`); unchanged. A line the visit made that the person may not delete is lowered by a delta
  and, by D6, stays at 0. NEW: a line that was there before the visit and holds only a product
  is now deleted by the server when a minus takes it to 0, where `0187` says such a line "is
  never deleted". That sentence of `0187` is superseded for a line with nothing to keep. Velista
  `0192` reads the answer.
- **The assistant.** `upsert_lines` in `set` mode with quantity 0 sends the `PATCH`
  (`tools.ts:397`); when the answer says `deleted`, the item reports `action: 'removed'` (a new
  member of `ItemResult.action`, `:1134`) and `describeLine` reads it. Its free text lines are
  named and are never deleted (D3).
- **A batch** (`addMany`) only raises lines and never meets the rule.
- **The merge** sums two lines and never lowers to 0 from above; it never deletes by this rule.

## 5. The documents

The route docs of the two routes say when `deleted` is present. Then:

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 6. Specs, the settle first

1. **Required by the owner, by name:** `core/src/app/lists/settlement.service.spec.ts` and a
   real Postgres spec beside it (`settle-keeps-line.integration.spec.ts`): a product line from a
   card (`named: false`, no chain, no favourite, no comment, no buy) at 1, settled `BOUGHT` 1.
   After it the line stands at 0 with `deletedAt` null, one settlement, `boughtCount` 1, and no
   `line.deleted` was emitted. The same with `BOUGHT` 3 (floored at 0).
2. The same for `basket-settle.service` on a basket row of that line, with the same checks.
3. A spec that `lineKeeps` is called by `addQuantity` and `update` only: the settle specs spy on
   it and assert no call.
4. `line-keeps.spec.ts`: each row of section 1 alone keeps the line; a line with only products
   and a group does not; a reverted buy and a `NOT_AVAILABLE` keep it.
5. `line-quantity-delta.spec.ts`: a bare product line at 25 minus 25 is soft deleted, answers
   `deleted: true`, emits `line.deleted` with `emptied`, records one `deleted` change and calls
   `linesChanged`; at 50 minus 25 it stands at 25; at 0 an edit of the chain deletes nothing;
   a writer who may not delete it leaves it at 0.
6. The `update` specs: `quantity: 0` deletes as above; `updateAsOperator` with `quantity: 0`
   does not; a rename to 0 does not.
7. `basket-demand` spec: a demand to 0 on a bare line deletes it as the owner may.
8. Gateway HTTP specs: the two answers carry `deleted`.
9. `assistant.service.spec.ts`: a set to 0 answered with `deleted` reports `removed`.

## 7. Existing lines

D8: nothing is cleaned up by this plan.

## 8. Acceptance criteria

- [ ] A member's write from above 0 to 0 on a line that keeps nothing of section 1, by a caller
      who may delete it, soft deletes it in the same transaction.
- [ ] Every row of section 1 keeps a line; the products do not.
- [ ] Neither settle ever deletes a line, and the specs 1 to 3 prove it.
- [ ] The answers carry `deleted: true` and the event `emptied: true`; nothing else changes on
      the wire.
- [ ] `npx nx affected -t lint test` is green; `openapi.json` and `wire-types.ts` are committed.

## 9. Not in this plan

- The client (velista `0192`). A way back after the deletion (velista `0192` question 1).
- A cleanup of existing bare lines (D8).

## 10. Questions for the owner

1. **D3.** A free text line ("pan") is always "named", so it is never deleted at 0. Is that what
   you want, or should a free text line with nothing else go too?
2. **D8.** Lines already at 0 with nothing to keep stay. Do you want a release task that deletes
   them once?
3. **D2.** A buy that was taken back, and a "they had none", keep the line. Agreed?
4. **D6.** A person who may not delete a line (an approved line on a list that asks for
   approval) leaves it at 0. Agreed?
