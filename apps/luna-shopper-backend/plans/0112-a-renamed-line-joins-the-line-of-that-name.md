# 0112: a renamed line joins the line of that name

> Client half: `apps/velista/plans/0083`. Basket half, which reuses this plan's merge:
> `0113`.
>
> `0091` made a list hold one line per name, but only for adds. Renaming a line to a name
> another line already has writes a second line of that name, and nothing refuses it. This
> plan closes that: a rename that collides merges the two lines, after the caller confirms
> it, and every row that hangs off the line that goes away moves to the line that stays.
>
> Prerequisite reading: `0091` in full (the add merge, and section 5 on why existing
> duplicates were not migrated), `0076` (what `WRITE` can edit on an approved line), `0093`
> (settlements that wait for a list), `0092` (basket origins) and `0070` (product group
> subscriptions).

## Brief for the agent

### Objective

Make `PATCH /v1/lines/:id` merge the renamed line with the list's line of the same
normalized name, only when the request confirms the merge, following sections 2 to 6.

### Context

- Core: `apps/luna-shopper-backend/core/src/app/lists/line.service.ts`. `update` calls
  `applyLineEdit`, which assigns `content` with no collision check. `add` locks the list
  (`lockList`), finds the target with `findMergeTarget` (earliest by `position`, then `id`,
  never a `REJECTED` line) and raises it with `raiseForAdd`.
- `normalizeContent` is in `core/src/app/lists/line-content.ts`.
- `authorizeEdit` and `reopenAfterEdit` implement `0076`.
- Rows keyed by a list line id, and their foreign keys, are in section 4.
- `version` on `list_lines` is informational: PATCH is last writer wins, and this plan does
  not change that.

### Target state

A rename to a free name behaves exactly as today. A rename to a taken name answers
`line_merge_required` without writing, and the same request with `confirmMerge: true`
leaves one line holding both lines' quantity, products, comments, settlements and basket
origins. Integration specs prove it against Postgres. `openapi.json` and the admin wire
types are regenerated.

### Scope

- Work only in: `core/src/app/lists/` (a new `line-merge.service.ts`, `line.service.ts`,
  their specs and SQL), `libs/luna-shopper/contracts` (the request field and the error
  codes), `libs/luna-shopper/platform/src/lib/errors/`, the gateway's lists DTO and
  controller, the generated `openapi.json` and `wire-types.ts`.
- Do NOT touch: the add path's behaviour, `generated-lists/` services other than through the
  merge moving origin rows, any migration of existing duplicates.

### Constraints

- One transaction per rename, under `lockList`, with the collision checked again after the
  lock is taken.
- The merge lives in one method, `LineMergeService.merge(manager, survivor, absorbed)`,
  because `0113` calls it for a basket rename.
- After the merge writes, read the survivor again before answering. Repository doubles in
  specs must return a copy per `findOne` (`luna-backend-spec-traps`).
- No new migration unless section 4 proves one necessary. Stop and ask before adding one.
- Regenerate, never hand edit: `npx nx run luna-shopper-backend-gateway:openapi` then
  `npx nx run luna-shopper-admin/models:wire-types`.

### Action boundaries

- Proceed with in-scope edits, unit and integration specs, and the two generators.
- Stop and ask before a schema change, before changing any existing error code, and if a
  table in section 4 turns out to hold a line id this plan does not name.

### Progress evidence

Report after the contract change, after the merge service with its integration spec, and
after regeneration. Every claim names the spec run or generator output that proves it.

## 1. What is being built

| Piece                                 | Where                                           |
| ------------------------------------- | ----------------------------------------------- |
| `confirmMerge` on the update request  | `UpdateLineDto`, `UpdateLineRequest`            |
| Collision detection on rename         | `line.service.ts`, `applyLineEdit` and `update` |
| The merge of two existing lines       | a new `line-merge.service.ts`                   |
| Three error codes                     | `error-codes.ts`, `domain-exception.ts`         |
| `absorbedLineId` on the update answer | the lists controller and contract               |

## 2. When a rename collides

A rename collides when the request carries `content`, `normalizeContent(content)` differs
from the line's current normalized content, and another line of the same list with that
normalized content exists and is not `REJECTED`. Among several such lines, the earliest by
`position`, then `id`, is the other line, as in `0091`.

A rename that changes only case, accents or spacing of the line's own name never collides.

Checks, in this order, before anything is written:

1. `authorizeEdit` for the renamed line, unchanged.
2. **Approval.** If the renamed line is `PENDING` or `REJECTED` and the other line is
   `APPROVED`, refuse with `line_merge_needs_approval`, unless the caller holds `DECIDE` or
   `MANAGE` on the list, or the list auto approves. Statuses are read before the edit.
3. **Products.** If the union of both lines' item ids exceeds `LINE_ITEM_SET_MAX`, refuse
   with `line_merge_too_many_products`, with `messageArgs.max`.
4. **Confirmation.** If `confirmMerge` is not `true`, refuse with `line_merge_required`,
   with `details: { otherLineId, otherContent, otherQuantity }`.

## 3. Which line stays, and what it becomes

- **The survivor is the earlier of the two** by `position`, then `id`. The other line is
  absorbed and deleted.
- The survivor **keeps its own spelling**. When the renamed line is the survivor, its own
  spelling is the new content from the request.
- `quantity` is the sum, capped at `LINE_QUANTITY_MAX`.
- `approvalStatus` is `APPROVED` if either line was `APPROVED` before the edit, otherwise
  the survivor's own status after `reopenAfterEdit`. `approvedByUserId` is the survivor's
  approver, or the absorbed line's when only that one was approved.
- `productGroupId` is the survivor's. When the survivor has none, the absorbed line's items
  that came from its group become `USER` items on the survivor.
- `version` goes up by one.
- **Permissions:** the merge needs nothing beyond the rename's own `authorizeEdit`. Raising
  an approved line's quantity and removing an approved line are part of the merge, as they
  are part of an add in `0091`, and neither asks for `DECIDE` or `MANAGE`.

## 4. What moves from the absorbed line

Every row below must end on the survivor before the absorbed line is deleted, because most
of these cascade on delete and are otherwise lost.

| Rows                          | Key                                         | What the merge does                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_line_items`             | `lineId`, unique with `itemId`              | Insert the absorbed line's items the survivor lacks, after the survivor's own, then recompute `itemSetHash`                                                                                               |
| `list_line_group_removals`    | `lineId`, unique with `itemId`              | Keep only when both lines follow the same group, as a union                                                                                                                                               |
| `line_comments`               | `lineId`                                    | Update to the survivor                                                                                                                                                                                    |
| `line_settlements`            | `lineId`, `listId`                          | Update to the survivor. `listId` is unchanged, the list is the same                                                                                                                                       |
| `generated_list_line_origins` | `lineId`, unique with `generatedListLineId` | Update to the survivor. Where one basket line has an origin on both, add the absorbed row's `quantity` to the survivor's row and delete the absorbed row. Set `lineVersion` to the survivor's new version |
| `core_audit`                  | `entityId`                                  | Nothing moves. Write one audit row naming both ids                                                                                                                                                        |

Verify this table against the entities before writing code. A line id column that is not
here is a stop condition.

## 5. What everybody hears

- The list room hears `LineDeleted` for the absorbed line, then `LineUpdated` for the
  survivor, in that order.
- No basket room hears anything. A basket reads its origins when it needs them, and a
  stale `lineVersion` is information, not a conflict.

## 6. The answer

`PATCH /v1/lines/:id` still answers a `LineView`, now always the survivor, which can carry a
different `id` from the path. When a merge happened, the answer also carries
`absorbedLineId`. The field is absent otherwise. Clients that ignore it keep working,
because the `LineDeleted` event arrives anyway.

## 7. Errors

| Case                                                    | Code                             | HTTP      |
| ------------------------------------------------------- | -------------------------------- | --------- |
| The new name is taken and the request did not confirm   | `line_merge_required`            | 409       |
| A pending or rejected line renamed onto an approved one | `line_merge_needs_approval`      | 409       |
| The merged product set exceeds `LINE_ITEM_SET_MAX`      | `line_merge_too_many_products`   | 409       |
| Everything `0076` already refuses                       | `forbidden`, `validation_failed` | unchanged |

Each new code gets its own exception class, its `ERROR_STATUS` row, and its message in the
error catalog in English and Spanish.

## 8. What this plan does not do

- It does not merge the duplicates that already exist (`0091` section 5 still holds).
- It does not merge onto a `REJECTED` line. A rename to a rejected line's name writes a
  duplicate, as an add does.
- It does not rename or merge basket lines. That is `0113`.

## 9. Tests

Integration specs against Postgres, except where noted.

1. A rename to a free name changes the content and nothing else, as before.
2. A rename to a taken name without `confirmMerge` answers `line_merge_required` with the
   other line's id, content and quantity, and writes nothing.
3. With `confirmMerge`, the earlier line survives with the summed quantity, and the later
   line is gone.
4. When the renamed line is the earlier one, it survives with the new spelling. When it is
   the later one, the survivor keeps its old spelling.
5. Products are the union without duplicates, in the survivor's order first, and the hash
   is recomputed.
6. A union above `LINE_ITEM_SET_MAX` is refused and nothing moves.
7. A pending line renamed onto an approved line is refused for a `WRITE` caller, and
   merges for a `DECIDE` caller and on an auto approve list.
8. An approved line renamed onto a pending line leaves an approved survivor.
9. Comments, settlements and basket origins of the absorbed line belong to the survivor
   afterwards. A basket line with origins on both ends with one origin row holding the sum.
10. A rename that only changes case or accents never collides.
11. Two concurrent renames onto the same name leave one line, not three (unit spec with the
    lock, or integration spec with two transactions).
12. The list room receives `LineDeleted` then `LineUpdated`.

## 10. Acceptance criteria

- [ ] No rename leaves two non rejected lines with the same normalized name on one list.
- [ ] Nothing a line owned is lost in a merge.
- [ ] A merge never happens without `confirmMerge: true`.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.
- [ ] `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
      is green, and the core integration target passes on a Luna slot.

## 11. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Run the core integration target against the ephemeral slot, then `--down <n>`.
