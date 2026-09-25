> **PR:** [#428](https://github.com/IchirokuXVI/nx-portfolio/pull/428)

# 0138: what changed on a list, kept and shown to each viewer

> Client half: `apps/velista/plans/0093`. Series record: `0130`, which is the contract for
> every name used here.
>
> A basket follows its lists now, so a shopper looks away and the basket is different when
> they look back: a line was added, a quantity moved, a line was renamed, two lines became
> one, a line was taken off. The redesign asks for three things about that. A removed line
> stays visible, disabled, for a while. A changed line is marked. A banner says how many
> changes there are and opens a view of them. It also asks that "a while" is measured **per
> viewer and on the server clock**, so a phone that spent the change in a pocket still shows
> it, and a phone with a wrong clock shows it for the right time.
>
> Nothing in core remembers a change today. `list_lines.version` says that a line moved and
> not how, a hard delete leaves nothing (plan `0132` fixes the row, and still records no
> text before and after), and a merge tells the list room `line.deleted` and then
> `line.updated`, which a basket reads as a removal beside a change. This plan adds the
> record, the cursor that says what one viewer acknowledged, the two routes, and the `mark`
> the basket read of plan `0136` left empty.
>
> Prerequisite reading: `0130` in full (sections 3, 4, 6 and 11 above all), `0132` (the soft
> delete), `0136` (the basket read, `BasketView`, `BasketRowView`, coverage, the per list
> redaction), `0112` (the merge, section 5 on what a basket hears), `0077` section 8 (the
> audit trail this is not), `core/src/app/lists/line.service.ts` in full,
> `core/src/app/lists/line-merge.service.ts`, `generated-list-sweep.service.ts` (the shape of
> a sweep), and the memory notes on raw SQL in TypeORM and on cursor timestamps.

## Brief for the agent

### Objective

Build the `list_line_changes` record with its recorder, the `basket_change_cursors` table,
`GET /v1/baskets/:id/changes`, `POST /v1/baskets/:id/changes/seen`, the `mark` and
`unseenChangeCount` fields of the basket read, and the retention sweep, with integration
specs against a real database, and regenerate the OpenAPI document and the wire types.

### Context

- Every write to a list line goes through `LineService` (`core/src/app/lists/line.service.ts`)
  or through `LineMergeService.merge`. The entry points, verified on 2026-09-19:
  `add` (line 630), `addMany` (750), `update` (1211) and `updateAsOperator` (1254), both
  into `applyLineEdit` (1271) and from there into `applyRename` (1397) when the fold of the
  name moves, `writeListRename` (1839, the basket rename of plan `0113`), `addQuantity`
  (1985), `setApproval` (2262) and `setApprovalAsOperator` (2284), both into `applyApproval`
  (2297), `delete` (2370) and `deleteAsOperator` (2400), both into `applyLineDeletion`
  (2411). `reorder` (2329) writes `position` and is not a change of demand.
- **Three of those paths open no transaction today.** `applyLineEdit` saves through
  `writer.save(line)` when the edit touches no product (line 1335), `applyApproval` saves
  through a `persist` callback (line 2308), and `delete` calls `this.lines.delete`
  (line 2387). The operator twins already run inside `this.audit.write`, which is one
  transaction.
- `LineWriter` (line 200) is the seam an operator's edit uses to write its trail in the same
  transaction as the change. It has two methods, `save` and `transaction`.
- A settle (`SettlementService.settle`, and the basket settle of `0136`) moves
  `list_lines.quantity` and is **not** a change here. `0130` section 11, decision 12.
- `ProductGroupSyncService` (`core/src/app/lists/product-group-sync.service.ts`) rewrites a
  line's product set. That moves a row's options and not what a list asks for.
- `core_audit` (plan `0077`, `core/src/app/entities/core-audit.entity.ts`) is written by
  operator edits alone, holds a `before` document for a person who investigates, and is
  read by the back office.
- A participant row has `joinedAt`. The owner's row is created with the basket
  (`ensureOwnerParticipant`, and `0136` creates it with a `LIVE` basket), and its
  `joinedAt` is the basket's creation.
- `BasketRowView.mark` exists since `0136` and is always null. `BasketView` has no count of
  changes.
- `core/src/migrate.ts` runs every pending migration in one transaction.

### Target state

Every acceptance criterion in section 14 holds, every rule that is a `WHERE` or an upsert is
proven by an integration spec, and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper-admin/models`
is green with `openapi.json` and the wire types regenerated.

### Scope

- Work only in:
  - `core/src/app/entities/` (two entities and the barrel),
  - `core/src/app/db/migrations/` (one migration and `index.ts`),
  - a new `core/src/app/lists/changes/` folder (the recorder, its kinds, the sweep, specs),
  - `core/src/app/lists/line.service.ts`, `line-merge.service.ts` and `lists.module.ts` for
    the record sites of section 4,
  - the basket write services `0136` created, for the actor they hand to `LineService`,
  - a new `core/src/app/baskets/changes/` folder beside the read of `0136` (the changes
    read, the acknowledgement, the marks, their SQL file, specs). Follow the folder `0136`
    chose for the basket read if it is not `core/src/app/baskets/`,
  - `core/src/app/config/app-config.ts`,
  - the gateway's baskets controller and DTOs that `0136` created,
  - `libs/luna-shopper/contracts` (messages, patterns, schemas, the config free constants),
  - the generated files.
- Do NOT touch: `line_settlements`, the settle and revert services' behaviour, `core_audit`
  and its writer, the realtime service, any event (plan `0139` owns the fan out), anything
  under `libs/velista`.

### Constraints

- A change row is written **inside the transaction of the write that caused it**, through
  the caller's `EntityManager`. A record that is sometimes written and sometimes not is
  worse than none, which is the rule `core_audit` states about itself.
- Every time in this plan is the database's `now()`. No value from a client is ever compared
  to a server time, and no timestamp travels in a cursor or in an acknowledgement.
- The record is keyed by list and never by basket. One write serves every basket.
- Redaction is `0130` section 6, asked per list and at request time.
- Raw SQL quotes every camelCase column by hand. Cursors are id only.
- Every `@Query()` value lives on the DTO.
- Regenerate `openapi.json` and the wire types, never hand edit them.
- Only make changes this plan names.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs, the generators.
- Stop and ask if a write to `list_lines.content`, `quantity`, `approvalStatus` or
  `deletedAt` exists outside the sites of section 4 and outside a settle or a revert. Name
  the file and the line.
- Stop and ask if `0136` did not leave `mark` on `BasketRowView`, or left the basket read in
  a shape where the rows are composed outside one function this plan can extend.

### Progress evidence

Report after the migration and the recorder with their specs, after every record site is
wired, after the marks and the count, after the two routes, and after the sweep, each with
the spec run that proves it.

### Session strategy

One session. The record sites of section 4 are one track and the read side of sections 5 to
8 is another, and the second depends only on the table, so a subagent can take the record
sites once the migration and the recorder are committed.

## 1. What is being built

| Piece                                              | Where                                                  |
| -------------------------------------------------- | ------------------------------------------------------ |
| `list_line_changes`, `ListLineChange`              | migration, `entities/list-line-change.entity.ts`       |
| `basket_change_cursors`, `BasketChangeCursor`      | migration, `entities/basket-change-cursor.entity.ts`   |
| `LineChangeRecorder`                               | `lists/changes/line-change.recorder.ts`                |
| every record site                                  | `line.service.ts`, `line-merge.service.ts`             |
| `BasketChangesService` (`list`, `acknowledge`)     | `baskets/changes/basket-changes.service.ts`            |
| `BasketMarksReader` (marks and the unseen count)   | `baskets/changes/basket-marks.reader.ts` and its SQL   |
| `GET /v1/baskets/:id/changes`                      | gateway baskets controller                             |
| `POST /v1/baskets/:id/changes/seen`                | the same                                               |
| `ListLineChangeSweepService`                       | `lists/changes/list-line-change-sweep.service.ts`      |
| `LineChangeKind`, `BasketChangeView`, the requests | `contracts` `basket-changes.messages.ts` and schemas   |

## 2. The record

```sql
CREATE TABLE "list_line_changes" (
  "id"                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "createdAt"          timestamptz NOT NULL DEFAULT now(),
  "zoneId"             uuid NOT NULL,
  "listId"             uuid NOT NULL REFERENCES "shopping_lists" ("id") ON DELETE CASCADE,
  "lineId"             uuid NOT NULL,
  "kind"               varchar NOT NULL,
  "contentBefore"      varchar NULL,
  "contentAfter"       varchar NULL,
  "quantityBefore"     int NULL,
  "quantityAfter"      int NULL,
  "approvalBefore"     varchar NULL,
  "approvalAfter"      varchar NULL,
  "mergedIntoLineId"   uuid NULL,
  "actorUserId"        uuid NULL,
  "actorParticipantId" uuid NULL,
  "basketId"           uuid NULL,
  CONSTRAINT "ck_list_line_changes_kind" CHECK (
    "kind" IN ('ADDED','QUANTITY_CHANGED','RENAMED','MERGED','DELETED','APPROVAL_CHANGED')
  ),
  CONSTRAINT "ck_list_line_changes_merged" CHECK (
    ("kind" = 'MERGED') = ("mergedIntoLineId" IS NOT NULL)
  ),
  CONSTRAINT "ck_list_line_changes_basket_actor" CHECK (
    "actorParticipantId" IS NULL OR "basketId" IS NOT NULL
  )
);
CREATE INDEX "ix_list_line_changes_list" ON "list_line_changes" ("listId", "createdAt", "id");
CREATE INDEX "ix_list_line_changes_created" ON "list_line_changes" ("createdAt");
```

- **`kind` is a `varchar` with a check constraint, and not a Postgres enum.** The migration
  runner commits everything in one transaction, where a new enum value cannot be used, and
  `generated_list_participants.endedReason` already set this precedent.
- **`lineId` has no foreign key.** A merge removes the absorbed row, and the change that
  says so has to outlive it. `mergedIntoLineId` has none for the same reason: a survivor can
  be absorbed later.
- **`listId` cascades.** A list that is deleted leaves every coverage, so nothing can read
  its changes again.
- **`zoneId` is a copy**, as it is on a provenance row today, so the list ref of a change
  needs no join to be redacted.
- **`createdAt` is `now()`, the start of the transaction.** Every row one act writes shares
  one value, which is what section 6 relies on: acknowledging one row of a basket rename
  acknowledges all of them.
- `actorUserId` is set for an account holder, the operator included. `actorParticipantId`
  and `basketId` are set when the write came through a basket of `0136`. A guest's demand
  change has a participant and no user. None of the three carries a foreign key: a change is
  a fact about a list, and it outlives the basket and the account.

**One row per line per write.** A write that moves several things is one row, and `kind`
names the most significant of them in this order: `MERGED`, `DELETED`, `RENAMED`,
`QUANTITY_CHANGED`, `APPROVAL_CHANGED`. The columns carry everything that moved, so an edit
that renames a line, sets its quantity and sends it back to `PENDING` is one `RENAMED` row
with all six before and after columns filled. A column pair is null when that thing did not
move. `ADDED` fills the three `After` columns alone.

**What writes no row:**

| Write                                                      | Why                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| a settle, a revert, a skip                                 | `0130` section 11, decision 12. A purchase is not a change.         |
| `reorder`                                                  | it moves `position`, and a basket computes its own order (`0141`)   |
| a product set edit with nothing else, the group sync       | it moves a row's options and not what a list asks for               |
| an edit that leaves all three things as they were          | nothing moved                                                       |
| a list deleted, a list that leaves a coverage              | section 7                                                           |

## 3. The recorder

```ts
export interface LineChangeActor {
  userId: string | null;
  participantId: string | null;
  basketId: string | null;
}

export interface LineSnapshot {
  content: string;
  quantity: number;
  approvalStatus: LineApprovalStatus;
}

@Injectable()
export class LineChangeRecorder {
  added(manager: EntityManager, list: ListRef, line: ListLine, actor: LineChangeActor): Promise<void>;
  edited(manager: EntityManager, list: ListRef, lineId: string, before: LineSnapshot, after: LineSnapshot, actor: LineChangeActor): Promise<void>;
  merged(manager: EntityManager, list: ListRef, absorbed: LineSnapshot & { id: string }, survivor: ListLine, actor: LineChangeActor): Promise<void>;
  deleted(manager: EntityManager, list: ListRef, line: ListLine, actor: LineChangeActor): Promise<void>;
}
```

- `ListRef` is `{ id, zoneId }`. The recorder holds **no repository**. Every insert goes
  through the manager it is handed, so it cannot draw a second connection from the pool and
  cannot commit apart from its caller.
- `edited` compares the two snapshots, derives `kind` by the order in section 2, and writes
  nothing when they are equal. A caller never chooses a kind.
- `snapshotOf(line)` is a free function beside it, called **before** the line object is
  mutated. `updateAsOperator` already takes `const before = { ...line }` for the audit
  trail, and this is the same move.
- The insert is one `manager.insert(ListLineChange, row)`. `createdAt` is left to the
  column default so the database's clock writes it.

## 4. Every record site

**The rule that changes three methods: a write that records a change runs in a
transaction.** `LineWriter.save` is deleted. `LineWriter.transaction` is the one way an edit
reaches the database, and the member's writer opens `this.dataSource.transaction` for the
plain edit too. The comment at `line.service.ts:1328` argues that a plain edit needs no
transaction because an absolute write is last writer wins. That stays true of the race and
stops being an argument here: the transaction exists to commit two rows together, and it
locks nothing the save did not.

| Site                                      | Today                                           | After                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `add`, a new line                         | transaction at line 660                         | `added` after the insert                                                                                                                |
| `add`, landing on a line the list holds   | the same transaction, `raiseForAdd`             | `edited` with the quantity before and after. `0091` made this a raise and not an add.                                                   |
| `addMany`                                 | transaction at line 785                         | one call per written line, `added` or `edited` as above                                                                                 |
| `applyLineEdit`, no product touched       | `writer.save`, no transaction                   | `writer.transaction`, the save, then `edited`                                                                                           |
| `applyLineEdit`, product set touched      | `writer.transaction` into `writeEdit`           | `edited` after `writeEdit`, in the same work function                                                                                   |
| `applyRename`, no collision               | `writer.transaction`                            | `edited`                                                                                                                                |
| `applyRename`, merge confirmed            | `this.merges.merge` inside the transaction      | `merged` for the absorbed line. When the renamed line is the survivor, its own rename rides in that row's `contentAfter`. No second row. |
| `writeListRename` (basket rename, `0113`) | the caller's transaction, one step per list     | `edited` or `merged` per step, all sharing the caller's transaction and therefore one `createdAt`                                       |
| `addQuantity`                             | transaction at line 2003                        | `edited`                                                                                                                                |
| `applyApproval`                           | `persist` callback, no transaction for a member | the member path opens a transaction, the operator path already has one. `edited`.                                                       |
| `applyLineDeletion`                       | `remove` callback                               | both callers pass a function that takes a manager. The soft delete of `0132` and `deleted` commit together.                             |
| the demand write of `0136`                | its own transaction                             | `edited`, with the participant and the basket as the actor                                                                              |

- **The actor reaches `LineService` as an argument.** `AddLineRequest`, `UpdateLineRequest`
  and the rename plan gain an optional `via?: { participantId: string; basketId: string }`
  that only the basket services of `0136` set. It is a core internal field: the gateway's
  list DTOs do not carry it and `forbidNonWhitelisted` refuses it. `userId` stays what it
  is, the account whose permission the write was checked against, and it is null on a
  guest's demand change.
- An operator's write records a change as well as its audit row. The two tables answer
  different people, which section 9 argues.
- `LineMergeService.merge` is handed the actor by its two callers and calls `merged`
  itself, after it moved the settlements and before it removes the absorbed row, so the
  snapshot of the absorbed line is read while the row still exists.

## 5. What one viewer acknowledged

```sql
CREATE TABLE "basket_change_cursors" (
  "participantId" uuid PRIMARY KEY
    REFERENCES "generated_list_participants" ("id") ON DELETE CASCADE,
  "seenFrom"      timestamptz NOT NULL,
  "seenThrough"   timestamptz NOT NULL,
  "ackedAt"       timestamptz NOT NULL,
  CONSTRAINT "ck_basket_change_cursors_order" CHECK ("seenFrom" <= "seenThrough")
);
```

A table of its own and not three columns on the participant, because the participant row is
read on every request of the hot path and these three are read by two routes.

**The viewer is a participant** (`0130` section 11, decision 10). Two phones of one account
share a cursor. Two guests are two participants.

**Where a viewer starts.** A participant with no cursor row has
`start = GREATEST(participant."joinedAt", basket."generatedAt")`. For the owner of a `LIVE`
basket the two are the same moment by construction. A person who left and came back has a
new `joinedAt` and keeps the cursor row, so the later of the two decides.

**The marking rule**, in SQL and nowhere else. With `through = COALESCE(c."seenThrough",
start)` and `from = COALESCE(c."seenFrom", start)`:

| A change is | When                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------- |
| unseen      | `ch."createdAt" > through`                                                                |
| lingering   | `ch."createdAt" > from AND ch."createdAt" <= through AND now() < c."ackedAt" + $window`   |
| marked      | unseen or lingering                                                                       |

`$window` is `core.basket.changeMarkWindowMs`, from `BASKET_CHANGE_MARK_WINDOW`, default
`10m`. So a mark lasts from the change until ten minutes after **this viewer** acknowledged
it, however long that took. A phone in a pocket for three hours acknowledges nothing, and
the mark is there when it comes out.

**A viewer's own change is never marked for them.** A change whose `actorParticipantId` is
the viewer's participant, or whose `actorUserId` is the viewer's `userId`, is excluded from
both rows of the table above and from the count. Somebody who adds a line from the basket
does not get a banner about it.

**Two acts in one microsecond.** `createdAt` is a transaction's start, so rows of one act tie
on purpose. Rows of two acts can tie by accident, and the `>` then treats the second as
seen with the first. That is accepted: the alternative is a tuple cursor over `(createdAt,
id)` on a column whose ids are random, which orders nothing.

## 6. The acknowledgement

`POST /v1/baskets/:id/changes/seen`, participant guard, `ParticipantThrottle`.

```ts
class AcknowledgeBasketChangesDto {
  @IsUUID() through!: string; // the id of the newest change the client drew
}

interface BasketChangesAcknowledged {
  unseenChangeCount: number;
  /** How long the marks just acknowledged stay drawn. A duration, never a time. */
  marksLapseInMs: number;
}
```

One statement, so no timestamp passes through JavaScript and loses its microseconds:

```sql
INSERT INTO "basket_change_cursors" ("participantId", "seenFrom", "seenThrough", "ackedAt")
SELECT $1, $3::timestamptz, ch."createdAt", now()
FROM "list_line_changes" ch
WHERE ch.id = $2 AND ch."listId" = ANY($4::uuid[]) AND ch."createdAt" > $3::timestamptz
ON CONFLICT ("participantId") DO UPDATE
  SET "seenFrom" = "basket_change_cursors"."seenThrough",
      "seenThrough" = EXCLUDED."seenThrough",
      "ackedAt" = now()
  WHERE "basket_change_cursors"."seenThrough" < EXCLUDED."seenThrough"
```

`$3` is `start`, read in the same request by a `SELECT` that returns it as text with full
precision and hands it back untouched. `$4` is the coverage, computed before the statement
and outside any transaction.

- A `through` that names no change of a covered list answers `not_found`.
- A `through` at or before the cursor writes nothing and answers the count as it stands. The
  route is idempotent, and two phones of one account racing each other cannot move a cursor
  backwards.
- `through` is the change the client **drew**, and not "everything up to now". A change that
  arrives between the read and the acknowledgement stays unseen.

**The contract with the client.** The acknowledgement is sent only while the marked rows, or
the changes view, were on screen with the document visible. A background refetch
acknowledges nothing. This route cannot tell the difference and does not try to: the rule is
the client's to keep, and velista `0093` says how. The client is allowed to run a timer for
`marksLapseInMs` and read the basket again when it fires. It never compares its own clock to
a time the server sent.

## 7. The marks and the count on the basket read

`BasketView` gains two fields, and `BasketRowView.mark` is filled:

```ts
interface BasketView {
  // ...as 0136 left it
  unseenChangeCount: number; // capped at BASKET_CHANGE_LIMITS.countCap
  newestUnseenChangeId: string | null; // what the acknowledgement sends as `through`
}
```

`BasketMarksReader.marksFor(participant, coveredListIds)` runs one query over
`ix_list_line_changes_list` for the covered lists, newer than `from`, excluding the viewer's
own, and answers the marked changes newest first. The read of `0136` folds them into rows:

| The change, as it stands for this viewer                                      | The row                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ADDED`                                                                       | `mark: 'ADDED'`                                                        |
| `QUANTITY_CHANGED` from zero, `APPROVAL_CHANGED` out of `REJECTED`            | `mark: 'ADDED'`. The line entered the coverage.                        |
| `QUANTITY_CHANGED`, `RENAMED`, `APPROVAL_CHANGED` between the covered states  | `mark: 'CHANGED'`                                                      |
| `MERGED`                                                                      | the row that holds `mergedIntoLineId` gets `mark: 'CHANGED'`           |
| `DELETED`, `QUANTITY_CHANGED` to zero, `APPROVAL_CHANGED` into `REJECTED`     | the line left the coverage. See below.                                 |

- One mark per row. `ADDED` wins over `CHANGED`, so a line added and then raised is new.
- **A line that left the coverage.** Its merge key is read from the line, which still exists
  after a soft delete, a rejection or a fall to zero. When a covered row shares that key,
  the row is `CHANGED`: one of its entries went and its `left` fell. When none does, the
  reader builds a row of state `REMOVED` with `mark: 'REMOVED'`, keyed by the line's id,
  with the text from the change's `contentBefore`, no entries, `left` of zero, and `bought`
  from the basket's standing settlements on the line. Several removed lines of one key are
  one row. It is disabled, and it counts toward neither `progress` nor `pending` (`0130`
  section 4). Every write addressed to it is refused by `0136` as it stands, because its
  anchor is outside the coverage.
- A line bought to zero in the viewer's session is still covered (`0130` section 3), so it
  never reaches this branch. The fall to zero that removes a row is somebody setting the
  demand to zero.
- **A `MERGED` change never draws the absorbed line.** Its `lineId` names no row, and a
  change whose line is neither covered nor readable is dropped. A chain, A into B and then B
  into C inside one window, marks C through the second row and loses the first. Accepted.
- **A list that leaves a coverage writes no change, and its rows go without a mark.** The
  owner lost `WRITE`, the list was deleted, the zone was left. None of those is a change of
  what a list asks for, the viewer has no right left to read the list, and any record of it
  is keyed by basket, which this table never is.
- `unseenChangeCount` is `count(*)` over the unseen changes behind a `LIMIT` of
  `BASKET_CHANGE_LIMITS.countCap + 1`, 100, so a person back from three weeks away costs a
  bounded read. The client prints "99+".

## 8. The changes view

`GET /v1/baskets/:id/changes?cursor&limit`, participant guard. Newest first by
`("createdAt" DESC, id DESC)`, 20 by default and 100 at most, covered lists only, changes
newer than the retention, the viewer's own included here because this is a history and not
a nudge.

```ts
interface BasketChangeView {
  id: string;
  kind: LineChangeKind;
  at: string; // for display. Never compared to anything.
  unseen: boolean;
  rowKey: string | null; // the anchor of the row this line is in now. null when it is gone.
  contentBefore: string | null;
  contentAfter: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  approvalBefore: LineApprovalStatus | null;
  approvalAfter: LineApprovalStatus | null;
  listId: string | null; // set only when the reader was served a BasketListRef for it
  actor: { participantId: string } | { userId: string } | null;
}

interface BasketChangePage {
  items: BasketChangeView[];
  nextCursor: string | null;
}
```

- The cursor carries the boundary change's id and the boundary key is read back in SQL,
  after `SettlementService`.
- **Redaction.** `listId` follows `0130` section 6: it is served when the reader holds
  `WRITE` on that list, and the owner always does. A reader with no ref gets the change with
  no list identity at all, which is what a guest gets for every change.
- **The actor.** A participant of this basket is served as `{ participantId }`, because
  everybody on a basket already sees its people. An account that is not on the basket is
  served as `{ userId }` only beside a served `listId`: a reader who can write the list is a
  member of its zone and already resolves that person. Otherwise the actor is null. Core
  serves no name, as everywhere else.
- `lineId` and `mergedIntoLineId` are never served. `rowKey` is the address a client can act
  on.

Patterns `basket.changes.list` and `basket.changes.acknowledge` in `BASKET_PATTERNS`. Both
messages carry `participantId`, resolved by the guard, and never a `userId`.

## 9. Why this is not `core_audit`

| Question                 | `core_audit` (plan `0077`)                      | `list_line_changes`                                   |
| ------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| Who writes it            | an operator's edit, and nothing else            | every change of demand, by anybody                    |
| Who reads it             | the back office                                 | a shopper, a guest included                           |
| What it holds            | the whole row before, as a document             | three typed pairs, because a screen draws them        |
| How long it lives        | for ever                                        | `LIST_LINE_CHANGE_RETENTION`, thirty days             |
| What it is keyed by      | the table and the row                           | the list, because a coverage is a set of lists        |

Widening the audit table to members puts a household's every edit in a trail built for
investigating an operator, behind an admin route, with no retention. Reading marks out of it
puts a `jsonb` diff on the hottest read in the product. They are two tables because
they are two questions, and an operator's edit writes both.

## 10. Retention

`ListLineChangeSweepService`, shaped like `GeneratedListSweepService`: an `unref`ed
interval, a `running` flag, a batch cap per tick, and a `sweep()` a spec calls with no
timers.

```sql
DELETE FROM "list_line_changes"
WHERE id IN (
  SELECT id FROM "list_line_changes"
  WHERE "createdAt" < now() - ($1::double precision * interval '1 millisecond')
  ORDER BY "createdAt" LIMIT $2
)
```

| Key                              | Default | Becomes                                 |
| -------------------------------- | ------- | --------------------------------------- |
| `BASKET_CHANGE_MARK_WINDOW`      | `10m`   | `core.basket.changeMarkWindowMs`        |
| `LIST_LINE_CHANGE_RETENTION`     | `30d`   | `core.listLineChange.retentionMs`       |
| `LIST_LINE_CHANGE_SWEEP_ENABLED` | `true`  | `core.listLineChange.sweep.enabled`     |
| `LIST_LINE_CHANGE_SWEEP_INTERVAL`| `1h`    | `core.listLineChange.sweep.intervalMs`  |
| `LIST_LINE_CHANGE_SWEEP_BATCH`   | `5000`  | `core.listLineChange.sweep.batchSize`   |

The reads never trust the sweep. Both filter `"createdAt" >= now() - retention`, so a row
the sweep has not reached yet is already invisible. The compose files and the Helm config map
need no entry: every key has a default, and the memory note on tier 2 compose applies to a
**required** key only.

## 11. Migration

`ListLineChangesAndCursors`, the next free timestamp in `core/src/app/db/migrations/`,
registered in `index.ts`.

- **Up.** The two tables, the three constraints and the two indexes of sections 2 and 5.
  No backfill: nothing recorded a change before, and rows invented from `version` numbers
  are a history nobody can vouch for.
- **Down.** Drop `basket_change_cursors`, then `list_line_changes`. Lossy by nature and
  harmless: every mark and every history row goes, and no list or basket is touched.

## 12. Not in this plan

- Telling a basket room that a change happened. Plan `0139`. Until it lands a viewer learns
  of a change on their next read.
- The banner, the changes sheet and the rule for when a client acknowledges. Velista `0093`.
- A push notification about a change.
- Undoing a change from the changes view.
- A change record for a product set, or for a comment.

## 13. Tests

Unit specs for the recorder (`edited` derives each kind, writes nothing for equal
snapshots, fills only the pairs that moved) and for the fold of changes into marks.
Integration specs, real database, for everything below:

1. Each site of section 4 writes exactly one row of the right kind, with the actor it was
   given, and a settle, a revert, a reorder and a product only edit write none.
2. A refused write leaves no row: a rename refused with `line_merge_required`, an edit
   refused by `authorizeEdit`, an add that fails its limit.
3. A write that throws after the change was recorded rolls the change back with it.
4. A confirmed merge writes one `MERGED` row naming the survivor, and none for the survivor.
   A basket rename over three lists writes three rows that share one `createdAt`.
5. A participant with no cursor sees every change since `GREATEST(joinedAt, generatedAt)`
   as unseen, and none from before it.
6. An acknowledgement moves `seenThrough` to the change's own `createdAt` with its
   microseconds intact, shifts the old value into `seenFrom`, and stamps `ackedAt`.
7. A change acknowledged at `T` is marked at `T + 9m` and not at `T + 11m`, with the clock
   moved by writing `ackedAt` and never by waiting.
8. An acknowledgement older than the cursor writes nothing. Two racing acknowledgements end
   with the newer one.
9. A `through` from a list outside the coverage answers `not_found`.
10. The viewer's own change, by participant and by user id, is neither counted nor marked,
    and is listed by the changes view.
11. A deleted line whose key no covered row shares is one `REMOVED` row with the text it had,
    counted by neither `progress` nor `pending`. One whose key a covered row shares marks
    that row `CHANGED`.
12. A quantity set to zero removes, a quantity bought to zero in the session does not.
13. A guest's changes view carries no `listId` and no `{ userId }` actor. A named person
    with `WRITE` on one of two lists gets both for that list alone.
14. The count stops at the cap. The changes view pages across two rows that share a
    `createdAt` and visits each once.
15. The sweep deletes what is older than the retention, in batches, oldest first, and a row
    past the retention that the sweep has not reached is served by neither read.

## 14. Acceptance criteria

- [ ] Every change of what a list asks for, by a member, an operator or a basket, leaves one
      typed row, committed with the write that caused it.
- [ ] A purchase, a revert, a skip and a reorder leave none.
- [ ] A basket row says `ADDED`, `CHANGED` or `REMOVED` for the viewer reading it, and says
      it until ten minutes after that viewer acknowledged it, by the database's clock.
- [ ] A merge marks the survivor and never draws the absorbed line as removed.
- [ ] A removed line is a disabled row that counts toward nothing.
- [ ] `BasketView` carries the unseen count and the id to acknowledge through.
- [ ] A reader sees the list and the person behind a change only where `0130` section 6 lets
      them, and a guest sees neither.
- [ ] Changes older than thirty days are gone, and no read depends on the sweep for it.
- [ ] No event, no realtime change and no client change.
- [ ] `openapi.json` and the wire types are current.

## 15. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx run luna-shopper-admin/models:test
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run the integration specs through their own target against a slot, boot core on that slot
once so a `type` import on a constructor dependency is caught, then give the slot back.
