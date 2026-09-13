# 0113: renaming a basket line renames its lines

> Client half: `apps/velista/plans/0084`. Builds on `0112`, whose merge this plan calls.
>
> A basket line's name can be changed today only by the owner, and only inside the basket:
> the zone lines it came from keep the old name, and the next basket brings the old name
> back. This plan lets a basket line be renamed by anybody who can write every list it came
> from, renames those zone lines in the same transaction, and merges wherever the new name
> is already taken, in a list or in the basket, after the caller confirms.
>
> Prerequisite reading: `0112` in full, `0092` (a basket line's origins), `0094` section 5
> (the basket merge rule), `0051` and the memory note on guest reachable routes (who reads
> a basket response or broadcast), and `generated-list-sharing.service.ts`'s
> `writableAmong`.

## Brief for the agent

### Objective

Add a participant route that renames a basket line and every zone line it came from, with
the permission rule in section 2, the collision handling in section 4, and one confirmation
covering every merge.

### Context

- The owner only route `PATCH /v1/generated-lists/:id/lines/:lineId` (core
  `generated-list-line.service.ts`, `updateLine`) writes `content` on the basket line alone,
  merges nothing, and tells only the owner's sessions.
- Participant routes live on `GeneratedListParticipantController` behind `ParticipantGuard`
  (`gateway/src/app/generated-lists/generated-list-sharing.controller.ts`).
- `generated_list_line_origins` links a basket line to zone lines (`lineId`, `listId`).
- `writableAmong(userId, listIds)` answers in one query which lists a user can write.
- `basket-merge.ts` holds the basket merge rule: same normalized content, and the same
  product or either one without a product.
- Room broadcasts cannot be projected per socket, so they always carry the least privileged
  reader's view.
- After a delegated write, read the entity again before answering
  (`stale-entity-answer-after-delegated-write` memory).

### Target state

A participant with `WRITE` on every origin list renames a basket line, the zone lines and
the basket line carry the new name, collisions merge only after confirmation, the basket
room and each list room hear it, and integration specs prove it.

### Scope

- Work only in: `core/src/app/generated-lists/` (a new rename service and its specs),
  `core/src/app/lists/line-merge.service.ts` only to call it, the gateway's generated lists
  controllers and DTOs, `libs/luna-shopper/contracts`, the generated `openapi.json` and
  `wire-types.ts`.
- Do NOT touch: the settle, split, origins and reopen services except where section 5 moves
  rows, or the realtime service beyond a new event name if section 6 needs one.

### Constraints

- One core transaction for the whole rename. Lock the basket line, then every origin list in
  ascending id order, before any check that decides a merge.
- Every check in sections 2 and 4 runs before the first write. A refusal writes nothing.
- No migration. Stop and ask if one seems necessary.
- Regenerate `openapi.json` and the wire types, never hand edit them.

### Action boundaries

- Proceed with in-scope edits, unit and integration specs, and the generators.
- Stop and ask if `0112` is not on `dev`, or if a table references `generatedListLineId`
  that section 5 does not name.

### Progress evidence

Report after the permission rule with its specs, after renames without collisions, after
merges, and after regeneration, each with its spec run.

## 1. What is being built

| Piece                                                       | Where                                           |
| ----------------------------------------------------------- | ----------------------------------------------- |
| `PATCH /v1/generated-lists/:id/basket/lines/:lineId`        | `GeneratedListParticipantController`, a new DTO |
| The rename, its checks and its merges                       | a new `generated-list-line-rename.service.ts`   |
| The owner's `content` field goes through it                 | `generated-list-line.service.ts`                |
| A removal event for an absorbed basket line, if none exists | `realtime.events.ts`                            |

## 2. Who can rename

| Caller                 | Line with origins                                                | Line with no origin (added, on no list) |
| ---------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| Guest                  | refused, `forbidden`                                             | refused, `forbidden`                    |
| Registered participant | allowed with `WRITE` on every origin list, otherwise `forbidden` | refused, `forbidden`                    |
| Owner                  | the same rule as a registered participant                        | allowed                                 |

`WRITE` is `writableAmong` over the line's distinct origin `listId`s. A caller who can write
some of them and not all is refused, and nothing is renamed. A finished basket refuses with
`generated_list_finished`.

## 3. What a rename changes

- The basket line's `content` becomes the new content, and `lastEditedByParticipantId` and
  `lastEditedAt` are set.
- Every origin zone line is renamed through the same path `0112` gives `PATCH /v1/lines/:id`,
  including `reopenAfterEdit` for that list.
- Other basket lines that came from the same zone lines keep their names. A basket line is
  never renamed by a zone rename.

## 4. Collisions

Before writing, collect every collision:

- **Per origin list**, `0112` section 2's collision and its two refusals. A refusal carries
  `messageArgs.listName`.
- **In the basket**, another live line of this basket that the basket merge rule merges
  with the renamed line under its new content.

If any collision exists and the request does not carry `confirmMerge: true`, refuse with
`line_merge_required` and these details:

```ts
{
  lists: { listId: string; listName: string; zoneName: string; otherContent: string; otherQuantity: number }[];
  basket: { otherLineId: string; otherContent: string; otherQuantity: number } | null;
}
```

Every name in the details belongs to a list the caller can write, so nothing leaks.

## 5. The order of writes

1. Rename and merge the zone lines, list by list, through `LineMergeService`.
2. Read the basket line's origins again, because step 1 moves origin rows.
3. Rename the basket line.
4. If the basket collides, merge the two basket lines:
   - The survivor is the earlier by `position`, then `id`, and keeps its own spelling.
   - `quantity` and `settledQuantity` are summed.
   - Origins move to the survivor. Two origins on the same zone line become one row with the
     summed quantity.
   - `line_settlements.generatedListLineId` moves to the survivor.
   - Options are the union. The survivor's `itemId` stays, or takes the absorbed line's
     when it has none.
   - The absorbed basket line is deleted.
5. Read the survivor again and answer.

List every column that references a basket line id before writing step 4, as `0112` section
4 does for zone lines.

## 6. What everybody hears

- Each list room hears `0112`'s events for its zone line.
- The basket room hears `GeneratedListLineUpdated` for the survivor, built with
  `seesZoneData = false`, and the removal of the absorbed basket line. Use the existing
  event for a removed basket line if one exists. Otherwise add
  `GeneratedListLineRemoved` with `{ generatedListId, lineId }`, to the basket room and the
  JetStream subjects.
- The owner's sessions hear what they hear for a basket line update today.

## 7. The route

`PATCH /v1/generated-lists/:id/basket/lines/:lineId`, body
`{ content: string; confirmMerge?: boolean }`, validated as a basket line's content is
today. The answer is `{ line, absorbedLineId? }`, where `line` is projected for the caller
as the basket read projects it.

The owner's `PATCH /v1/generated-lists/:id/lines/:lineId` keeps its other fields. When it
carries `content`, it calls the same rename service, so there is one rename rule.

## 8. Errors

| Case                                               | Code                           |
| -------------------------------------------------- | ------------------------------ |
| A guest, or a caller who cannot write every origin | `forbidden`                    |
| A line with no origin, renamed by a non owner      | `forbidden`                    |
| The basket is finished                             | `generated_list_finished`      |
| A collision without confirmation                   | `line_merge_required`          |
| A pending zone line onto an approved one           | `line_merge_needs_approval`    |
| A merged product set above the limit               | `line_merge_too_many_products` |
| Empty or too long content                          | `validation_failed`            |

## 9. What this plan does not do

- It does not rename basket lines when a zone line is renamed.
- It does not let a guest rename anything.
- It does not add a unique name rule to the basket beyond the merge above.

## 10. Tests

Integration specs, except where noted.

1. A registered participant with `WRITE` on every origin renames a line, and the basket line
   and both zone lines carry the new name.
2. The same participant without `WRITE` on one origin is refused, and nothing changes.
3. A guest is refused.
4. An added line with no origin is renamed by the owner and refused for anybody else.
5. A zone collision without `confirmMerge` answers `line_merge_required` naming the list and
   zone, and writes nothing.
6. With `confirmMerge`, the zone lines merge as in `0112`, and the basket line is renamed.
7. A basket collision merges the two basket lines: summed quantities, moved origins and
   settlements, one survivor.
8. A zone line pending onto an approved one refuses the whole rename with the list's name.
9. The basket room broadcast carries no origins, no `targetListId` and no list names.
10. The owner's old route with `content` behaves exactly like the new route for the owner.
11. The answer's line reflects the writes (a double returning copies, per the memory note).

## 11. Acceptance criteria

- [ ] Renaming a basket line renames every zone line it came from, or nothing.
- [ ] Only callers who can write every origin list rename a line with origins, and only the
      owner renames a line with none.
- [ ] Every merge, in a list or in the basket, happens only after one confirmation.
- [ ] No broadcast gives a guest more than the basket read gives them.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.

## 12. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Run the core integration target against the ephemeral slot, then `--down <n>`.
