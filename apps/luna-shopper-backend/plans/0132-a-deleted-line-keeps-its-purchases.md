> **PR:** [#421](https://github.com/IchirokuXVI/nx-portfolio/pull/421)

# 0132: a deleted line keeps its purchases

> Second build plan of the series recorded in `0130`, and it needs no other plan.
>
> `LineSettlement.line` is `onDelete: 'CASCADE'`
> (`core/src/app/entities/line-settlement.entity.ts:67`), and `LineService.delete` is a real
> `DELETE` (`core/src/app/lists/line.service.ts:2387`). So deleting a line deletes every
> purchase ever made on it. Plan `0047` section 2.2 chose that on purpose: deleting "is the
> only thing that discards the history". It was a fair rule while a purchase was only a mark
> on a line. It stops being one in this series, for three reasons the audit found:
>
> - `0143` records what was paid. "What did I spend last week" must not get smaller because
>   somebody tidied a list on Sunday.
> - `0138` keeps a removed line on the basket screen, disabled, for whoever has not seen the
>   change yet. A row that says "2 bought" cannot be drawn from purchases that are gone.
> - `0142` builds a person's history out of `line_settlements` alone. A history with holes
>   where lines used to be is not a history.
>
> So a line is **soft deleted**: the row stays, marked, and its purchases stay with it.
> Everything else a line owned goes, exactly as it goes today. This is decision 2 of `0130`
> section 11, and it reverses plan `0047` section 2.2 in one respect only: what a delete does
> to `line_settlements`.
>
> Prerequisite reading: `0130` sections 2.1 and 13, plan `0047` sections 2 and 3, plan `0112`
> (the merge, which still removes a row), plan `0077` section 5.2 (the operator's delete and
> the audit trail), `core/src/app/lists/line.service.ts` around `delete`, and
> `core/src/app/audit/core-audit.service.ts` in full.

## Brief for the agent

### Objective

Make deleting a list line a soft delete that keeps the row and its settlements, remove what
the line owned apart from them in the same transaction, and make every read of `list_lines`
in core skip a deleted row, with integration specs for the raw SQL.

### Context

- `ListLine` (`core/src/app/entities/list-line.entity.ts`) extends `BaseEntity`. Four tables
  cascade from it: `line_settlements` (`line-settlement.entity.ts:67`), `list_line_items`
  (`list-line-item.entity.ts:45`), `line_comments` (`line-comment.entity.ts:22`, and
  `comment_audio` from it, `comment-audio.entity.ts:53`) and `list_line_group_removals`
  (`list-line-group-removal.entity.ts:49`).
- `generated_list_line_origins.lineId` has **no** foreign key
  (`generated-list-line-origin.entity.ts:22-26`). A basket outlives a deleted origin, and the
  settle reports `ORIGIN_DELETED` (`generated-list-settle.service.ts:203-213`).
- Two deletes exist. A member's: `LineService.delete` (`line.service.ts:2370`), `WRITE` on an
  unapproved line and `MANAGE` on any. An operator's: `deleteAsOperator` (`:2400`), through
  `this.audit.write(actorId, (tx) => tx.delete(ListLine, row))`. Both end in
  `applyLineDeletion` (`:2411`), which emits `line.deleted { id, listId }` to the zone and
  list rooms.
- A rename merge removes the absorbed line with a real delete
  (`core/src/app/lists/line-merge.service.ts:165`), **after** it moved the products, the
  settlements, the comments and the basket origins onto the survivor.
- TypeORM is `^1.1.0` (`package.json:67`). Nothing in the backend uses `@DeleteDateColumn`
  today. Core has about forty repository reads of `ListLine` and twelve raw SQL reads of
  `"list_lines"`, listed in section 4.
- `AuditedWrite` (`core/src/app/audit/core-audit.service.ts`) has `update` (`:151`) and
  `delete` (`:168`). It has no soft delete.
- The member merge (`core/src/app/merge/merge.service.ts:145-158`) rewrites
  `createdByUserId` and `approvedByUserId` on every line of a zone.

### Target state

Every acceptance criterion in section 10 holds. `line_settlements` rows survive a line's
deletion, no read serves a deleted line, and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts`
is green. The OpenAPI generator produces **no diff**, because no contract changes.

### Scope

- Work only in:
  - `core/src/app/entities/list-line.entity.ts`
  - a new migration `core/src/app/db/migrations/<next timestamp>-SoftDeletedLines.ts` and
    `migrations/index.ts`
  - `core/src/app/lists/` (`line.service.ts`, `line-merge.service.ts` for a comment only,
    `list-holding.sql.ts`, `suggestions/suggestions.sql.ts`, `trips/trips.sql.ts`, specs)
  - `core/src/app/generated-lists/generated-list.sql.ts`
  - `core/src/app/zones/zone-summary.sql.ts`
  - `core/src/app/admin/admin-list.service.ts`, `admin-zone.service.ts`
  - `core/src/app/merge/merge.service.ts`
  - `core/src/app/audit/core-audit.service.ts` and `core-audit.testing.ts`
  - `libs/luna-shopper/test-fixtures` only if a fixture type lists the columns of a line
- Do NOT touch: `LineView` and every contract, the gateway, `line.deleted`'s payload, the
  merge's behaviour, the foreign keys of the four child tables, the cascade from a deleted
  list, zone or account, anything under `libs/velista`. No restore route, no "recently
  deleted" read, no purge job.

### Constraints

- **`@DeleteDateColumn`, not a hand written predicate on every repository read.** It is
  TypeORM's own soft delete: `find`, `findOne`, `count` and a `createQueryBuilder` from the
  entity all add `"deletedAt" IS NULL` by themselves, and `softDelete` sets the column. It
  does **not** reach raw SQL, a subquery written as a string, an `UPDATE` query builder or a
  join to the table by name. Section 4 lists each of those, and each gets the predicate by
  hand.
- `repo.delete` and `manager.delete` stay **real** deletes on a soft deletable entity. The
  merge depends on that. Only `softDelete` and `softRemove` set the column.
- Raw SQL quotes `"deletedAt"` by hand, and each changed query is proven by an integration
  spec (`0130` section 13).
- Only make changes directly requested.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs.
- Stop and ask if `@DeleteDateColumn` under this TypeORM version does not filter a
  `findOne` that carries `lock: { mode: 'pessimistic_write' }`, or filters the merge's
  `delete`. Both are load bearing, and section 9 tests them first.
- Stop and ask before deleting any row the migration finds in an unexpected state. The
  migration in section 5 deletes nothing.

### Progress evidence

Report after the migration and the entity with the two TypeORM behaviour specs (section 9,
tests 1 and 2), after the two delete paths, and after the raw SQL with its integration
specs, each with the spec run.

## 1. What is being built

| Piece                                              | Where                                                  |
| -------------------------------------------------- | ------------------------------------------------------ |
| `deletedAt`, `deletedByUserId` on `list_lines`     | entity, migration                                      |
| `ix_lines_list_quantity` made partial              | entity, migration                                      |
| `AuditedWrite.softDelete`                       | `core-audit.service.ts`, the testing fake              |
| the member's and the operator's delete             | `line.service.ts`                                      |
| `"deletedAt" IS NULL` in every raw read            | the SQL files of section 4                             |
| `deletedByUserId` follows a member merge           | `merge.service.ts`                                     |

## 2. What a deleted line keeps, and what goes

| Kept                                                                 | Why                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| the `list_lines` row, with `content`, `quantity`, `listId`, its ids  | it is what a settlement's foreign key holds on to, and what names a past purchase         |
| every `line_settlements` row                                         | the point of the plan                                                                     |
| basket origins that name it                                          | they never had a foreign key. `0136` deletes the table                                    |

| Removed, in the same transaction                  | Why                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `line_comments`, and `comment_audio` through them | a conversation about a line nobody can open. Voice recordings are personal data and must not linger  |
| `list_line_items`                                 | the product set of a line nobody can buy. Each settlement copied its own `itemId` (plan `0047`)      |
| `list_line_group_removals`                        | tombstones of a subscription that ends here                                                          |

The row is left consistent with what it lost: `itemSetHash` and `productGroupId` are set to
null by the delete, so no index and no sync ever treats a deleted line as holding products
or following a group. `quantity`, `approvalStatus`, `position` and `version` are left as they
were. `version` is **not** bumped, because nothing reconciles against a deleted line.

This is today's cascade with one table taken out of it. A reader of this plan in a year
must be able to say "a delete removes everything except the purchases" and be right.

## 3. The schema

`ListLine` gains:

```ts
/**
 * When the line was deleted, or null while it stands (plan 0132).
 *
 * TypeORM's own soft delete column: every repository read and every query builder
 * made from this entity skips a row where it is set. Raw SQL does not, so every
 * raw read of `list_lines` carries `"deletedAt" IS NULL` by hand.
 */
@DeleteDateColumn({ type: 'timestamptz', nullable: true })
deletedAt!: Date | null;

/**
 * The member who deleted it. Null while it stands, and null when an operator
 * deleted it, because the audit trail names an operator and this names a member.
 */
@Column({ type: 'uuid', nullable: true })
deletedByUserId!: string | null;
```

A check constraint keeps the pair honest:
`ck_list_lines_deleted_by CHECK ("deletedByUserId" IS NULL OR "deletedAt" IS NOT NULL)`.

Of the three existing indexes, one becomes partial on a standing line, because nothing
reads a deleted one through it, and two already exclude a deleted line:

| Index                     | Today                                   | After                                                                  |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `ix_lines_list_quantity`  | `("listId", "quantity")`                | the same columns, `WHERE "deletedAt" IS NULL`                          |
| `ix_lines_item_set_hash`  | `WHERE "itemSetHash" IS NOT NULL`       | unchanged. A deleted line's hash is null, so it is already outside it  |
| `ix_lines_product_group`  | `WHERE "productGroupId" IS NOT NULL`    | unchanged, for the same reason                                         |

No index on `"deletedAt"`. Nothing in this plan reads deleted lines, and an index with no
reader is a write cost with no query. `0138` draws a removed row from its own change log.

The `@Index` decorator on the entity (`list-line.entity.ts:34`) gains the matching
`where`, so `migrations.spec.ts` sees the entity and the migration agree.

## 4. Every read of `list_lines`, and what each needs

### 4.1 Filtered by TypeORM, nothing to write

Repository reads and query builders made from `ListLine`. Verify each by reading it, and
change nothing unless it is in 4.2:

- `lists/line.service.ts`: `:674`, `:789` (the adds), `findMergeTarget` `:1015`,
  `maxPosition` `:1105`, `:1419` (rename), `readWritten` `:1557`, `:1647`, `:1843` (list
  rename), `addQuantity` `:2004`, `writeEdit` `:2129`, `reorder` `:2331`, `list` `:2440`.
- `lists/list-access.service.ts:93` (`getLine`). **This is the gate.** A deleted line
  answers "Line not found" to an edit, a settle, a comment, a settlement history and a
  second delete, which is what every one of them must say.
- `lists/settlement.service.ts:122`, `lists/product-group-sync.service.ts:159`, `:220`,
  `:271`, `:289`.
- `generated-lists/`: the zone line reads of the settle (`generated-list-settle.service.ts:184`
  onward), the reopen (`generated-list-reopen.service.ts:207` onward), the origins
  (`generated-list-origins.service.ts:520`, `:672`, `zoneLinesById`), the rename service and
  `waiting-settlement.service.ts:359`. A deleted origin already reads as `ORIGIN_DELETED`,
  and it keeps doing so because the find now misses it.
- `admin/admin-list.service.ts:217`, `:429`. An operator does not see deleted lines either.
  An operator's view of them is not in this plan.

**One consequence to state in a comment at `findMergeTarget`:** a deleted line is never a
merge target, so adding "Milk" to a list whose Milk was deleted creates a new line with a
new id and no history. That is intended. The old purchases stay reachable by product
through `GET /v1/items/:id/settlements`.

### 4.2 Not filtered, predicate added by hand

| Site                                                                                 | Reads                                         | Change                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------- |
| `generated-lists/generated-list.sql.ts:91` `CANDIDATE_LINES_SQL`                     | what a run composes                           | `AND ll."deletedAt" IS NULL`                                            |
| `generated-lists/generated-list.sql.ts:126` `SHEET_CANDIDATE_LINES_SQL`              | what the origins sheet offers                 | the same                                                                |
| `lists/list-holding.sql.ts:40` `LISTS_HOLDING_ITEM_SQL`                              | which lists already hold a product            | the same                                                                |
| `lists/suggestions/suggestions.sql.ts:35` `SUGGESTION_CANDIDATES_SQL`                | lines at zero worth suggesting                | the same. A deleted line at zero with purchases is exactly what it matches today |
| `lists/suggestions/suggestions.sql.ts:99` `SUGGESTION_RECENT_TRIPS_SQL`              | the list's ended trips                        | the same                                                                |
| `lists/trips/trips.sql.ts:89` `basket_rows`                                          | the rows of a basket trip                     | the same, in the `JOIN`'s `ON`                                          |
| `lists/trips/trips.sql.ts:127` `loose`                                               | the purchases of loose trips                  | the same                                                                |
| `lists/trips/trips.sql.ts:291` `lineKeyset`                                          | the boundary row of a cursor                  | **no predicate.** A cursor naming a line deleted since must still find its position, or the page restarts |
| `zones/zone-summary.sql.ts:179` the preview's lateral                                | `lineCount`, `wantedCount` of a zone card     | `AND ll."deletedAt" IS NULL`                                            |
| `zones/zone-summary.sql.ts:228` `LIST_COUNTS_SQL`                                    | the same two counts of a list                 | the same                                                                |
| `admin/admin-list.service.ts:146`, `:207`, `admin/admin-zone.service.ts:217`         | an operator's `lineCount`, as a string subquery | `AND n."deletedAt" IS NULL`                                           |
| `merge/merge.service.ts:169`                                                         | comment authors of a zone's lines             | **no predicate.** See 4.3                                               |
| `generated-lists/waiting-settlement.service.ts:315`                                  | an `UPDATE` by id of a line just written      | none. `0136` deletes the file                                           |

The trips reads need no new rule. Plan `0122` section 3 already says a purchase whose line
was deleted is skipped and a trip left with no line is not returned, and it got that from
the `JOIN`. The predicate keeps the sentence true now that the row survives.

The line counts are the reason this table exists. `wantedCount` is
`count(*) FILTER (WHERE quantity > 0)`, and a line deleted while it still asked for two is
counted as wanted forever unless both count queries skip it.

### 4.3 Must see deleted lines, on purpose

- **The member merge** (`merge/merge.service.ts:145-158`). Its two `UPDATE` query builders
  over `ListLine` are not filtered by TypeORM, which is right: a merged away member must not
  remain the author of a tombstone. It gains a third update, `deletedByUserId` from the
  source to the target, scoped to the zone's lines like the other two.
- **`GET /v1/items/:id/settlements`** (`lists/settlement.sql.ts:47`). It reads
  `line_settlements` by `itemId` and checks `READ` through `s."listId"`. It never joins
  `list_lines`, so the purchases of a deleted line are served with no change. That is the
  read the opening of this plan promises, and test 9 pins it.
- **`LINE_SETTLEMENT_SUMMARY_SQL`** (`settlement.sql.ts:88`) is called with the ids of lines
  a filtered read returned, so it needs nothing.

## 5. The migration

`<next timestamp>-SoftDeletedLines.ts`, registered in `migrations/index.ts`.

Up:

```sql
ALTER TABLE "list_lines"
  ADD COLUMN "deletedAt" timestamptz NULL,
  ADD COLUMN "deletedByUserId" uuid NULL;
COMMENT ON COLUMN "list_lines"."deletedAt" IS
  'When the line was deleted, or null while it stands (plan 0132). A deleted line keeps its row and its line_settlements and nothing else.';
ALTER TABLE "list_lines"
  ADD CONSTRAINT "ck_list_lines_deleted_by"
  CHECK ("deletedByUserId" IS NULL OR "deletedAt" IS NOT NULL);
DROP INDEX "ix_lines_list_quantity";
CREATE INDEX "ix_lines_list_quantity"
  ON "list_lines" ("listId", "quantity") WHERE "deletedAt" IS NULL;
```

Down: recreate the index without its predicate, drop the constraint and the two columns.
**Down is lossy in one stated way**: a line soft deleted while the column existed becomes a
standing line again, with no products and no comments. The down migration therefore deletes
those rows first (`DELETE FROM "list_lines" WHERE "deletedAt" IS NOT NULL`), which cascades
their settlements away and is exactly the state the earlier schema produces for a delete.
Say so in a comment, in the words the `WaitingSettlements` migration uses for its own lossy
step (`1756001900000-WaitingSettlements.ts:104-108`).

Nothing is backfilled. A line deleted before this plan is gone, with its purchases, and
cannot be rebuilt.

`core/src/migrate.ts` runs every pending migration in one transaction. Nothing here adds an
enum value, so that trap does not bite.

## 6. The two deletes

`LineService.delete` (`:2370`) keeps its authorization exactly (`:2376-2385`). Its removal
callback becomes a transaction:

1. Lock the row: `findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })`. Not
   found means it was deleted a moment ago: answer `NotFoundException('Line not found')`.
2. `delete` from `LineComment`, `ListLineItem` and `ListLineGroupRemoval` where
   `lineId = :id`. `comment_audio` follows its comment by cascade.
3. `update(ListLine, { id }, { itemSetHash: null, productGroupId: null, deletedByUserId:
   req.userId })`, then `softDelete(ListLine, { id })`. Two statements rather than one
   `update` that sets `deletedAt`, so the column is only ever written by the call whose name
   says what it does.

`deleteAsOperator` (`:2400`) does the same through the audit writer, which gains:

```ts
/**
 * Soft delete a row, and record what it said.
 *
 * Recorded as `CoreAuditAction.DELETE` with `after: null`, exactly as `delete` records
 * a real one: to a reader of the trail the row is gone either way, and the trail is
 * where an operator's name is kept.
 */
async softDelete<T extends ObjectLiteral>(target: EntityTarget<T>, row: T): Promise<void>;
```

It snapshots before it writes, for the reason `delete` gives at `:172-175`. The operator
path passes no `deletedByUserId`: the column names a member, and the trail names the
operator. `core-audit.testing.ts` gains the matching fake method, and the three `audit`
doubles in the line specs gain it with it.

`applyLineDeletion` (`:2411`) is unchanged: it reads the ids first, runs the removal, and
emits `line.deleted { id, listId }`.

`LineMergeService.merge` (`line-merge.service.ts:165`) keeps its real `delete`, and gains a
comment saying it is one on purpose: everything the absorbed line owned has moved to the
survivor by that point, its settlements included, so there is nothing left to keep a row
for, and a tombstone per merge makes every rename leave a ghost.

## 7. Events and contracts

None change. `line.deleted` carries `{ id, listId }` to the zone and list rooms as today.
`LineView` gains no field, because a deleted line is never served. A client cannot tell this
plan happened, which is the intent. `0138` is the plan that shows a removed row, and it
draws it from `list_line_changes`.

## 8. Not in this plan

- A restore route, a "recently deleted" read, a purge of old tombstones. None is asked for.
  A tombstone is one narrow row, and a list, zone or account deletion still removes it for
  real through the existing cascades.
- The change log and the `REMOVED` row on a basket: `0138`.
- Spend and a person's history: `0142`, `0143`.
- `basket_trip_rows` skipping a deleted line: `0135` writes that read and inherits the rule
  of 4.2.

## 9. Tests

Unit, against the real `DataSource` of the entity specs where the behaviour is TypeORM's:

1. `findOne` with `pessimistic_write` does not return a soft deleted line. **Write this
   first.** If it fails, stop (Action boundaries).
2. `repo.delete({ id })` on a soft deletable entity removes the row for real. The merge
   depends on it.
3. A member's delete: the row stays with `deletedAt` and `deletedByUserId` set,
   `itemSetHash` and `productGroupId` null, `version` unchanged, and `line.deleted` emitted
   once.
4. The authorization of `delete` is unchanged: the plan `0036` specs pass with no edit.
5. An operator's delete writes one `DELETE` audit row with a full `before`, and leaves
   `deletedByUserId` null.
6. A second delete of the same line answers not found.
7. Adding the deleted line's text again creates a new line and merges into nothing.
8. A rename merge still removes the absorbed row for real, and the survivor holds its
   settlements.

Integration, real database, through the integration target:

9. **The point of the plan**: settle a line twice, delete it, and both settlements are still
   in `line_settlements`, still served by `GET /v1/items/:id/settlements`, while
   `GET /v1/lines/:id/settlements` answers not found.
10. Comments, their audio, the product set and the group removals of a deleted line are
    gone.
11. `LIST_COUNTS_SQL` and the zone preview stop counting a line deleted at quantity two.
12. `CANDIDATE_LINES_SQL` and `SHEET_CANDIDATE_LINES_SQL` skip it, so a run never composes
    it and the origins sheet never offers it.
13. `LISTS_HOLDING_ITEM_SQL` does not name a list whose only matching line is deleted.
14. `SUGGESTION_CANDIDATES_SQL` does not suggest a deleted line that sits at zero with
    purchases.
15. The trips of a list skip the deleted line's row, drop a trip whose only line it was, and
    a rows cursor naming the deleted line still pages on from its position.
16. A basket settle on an origin whose line was soft deleted reports `ORIGIN_DELETED` and
    writes nothing, as it did for a real delete.
17. A member merge moves `deletedByUserId` to the target.
18. `migrations.spec.ts` is green: the entity and the migration agree on the index
    predicate and the constraint.

## 10. Acceptance criteria

- [ ] Deleting a line leaves its `line_settlements` rows in place, and no read serves the
      line.
- [ ] Comments, voice audio, the product set and the group removals of a deleted line are
      removed in the same transaction.
- [ ] Every raw SQL read in section 4.2 skips a deleted line, proven against a real
      database.
- [ ] A rename merge still removes the absorbed row, and leaves no tombstone.
- [ ] The operator's delete is in the audit trail as a deletion.
- [ ] No contract, route or event changed, and the OpenAPI generator produces no diff.

## 11. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts
npx nx run luna-shopper-backend-gateway:openapi   # expect no diff
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run the integration specs through their own target against a slot, run the migration up,
down and up again on that slot's core database, boot core once, then give the slot back.
