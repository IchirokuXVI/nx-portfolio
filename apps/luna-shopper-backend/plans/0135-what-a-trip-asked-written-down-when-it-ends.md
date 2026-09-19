# 0135: what a trip asked, written down when it ends

> Part of the series `0130` records. Needs `0134`. Plan `0136` needs this one.
>
> A finished basket is a record of a trip, and half of that record is what the trip asked
> each list for. Today nothing writes that half down. It is read, every time, from
> `generated_list_line_origins`, and it stays true only because a finished basket refuses
> every write, so its origins happen to stop moving. Plan `0122` section 4 says it
> outright: "The numbers freeze by themselves. Origins and settlements stop changing when
> the basket ends, so an old row never follows the line's live quantity. Nothing is
> copied."
>
> Plan `0136` deletes the origins table, and an open basket's "asked" becomes `bought + left`,
> read from lists that never stop moving (`0130` section 4). From then on nothing
> freezes by itself. So this plan makes the freeze an act: **the numbers are frozen by the
> finish.** When a basket stops being open, what it asked of every zone line is written
> into `basket_trip_rows`, once, and when it is reopened the rows are deleted. It lands
> before `0136` so that `0136` has somewhere to put a finished basket's origins, and so
> that the reads which need a finished trip's numbers are already off the table `0136`
> drops.
>
> Prerequisite reading: `0130` sections 2.2, 3 and 4. Plans `0122` (sections 3, 4 and 6),
> `0123` (sections 4 and 5), `0059` (the sweep), `0057` (finish and reopen), `0112`
> (section 4, what a merge moves) and `0094` (siblings on one zone line). Code:
> `core/src/app/lists/trips/trips.sql.ts` as `0134` left it,
> `core/src/app/lists/suggestions/suggestions.sql.ts` in full,
> `core/src/app/generated-lists/generated-list.service.ts` (`update`, `delete`),
> `core/src/app/generated-lists/generated-list-sweep.service.ts`,
> `core/src/app/lists/line-merge.service.ts` in full, and the memory notes on raw SQL in
> TypeORM and on Luna backend spec traps.

## Brief for the agent

### Objective

Add `basket_trip_rows`, write it in the transaction that moves a basket out of `OPEN`,
delete it in the transaction that moves one back, backfill it for every basket that is
already finished, keep it true across a line merge, and make the trips reads and the two
suggestion reads take a finished basket's "asked" from it.

### Context

- `GeneratedListService.update` (`generated-list.service.ts:794-844`) is the only place a
  basket's status is written. The sweep finishes a basket through it
  (`generated-list-sweep.service.ts:128-132`), the client finishes and reopens through it,
  and archiving goes through it. It saves with `this.lists.save(list)` at `:807`, **outside
  any transaction**, and then announces claims and `list.tripsChanged`.
- After `0133` the statuses are `OPEN`, `FINISHED` and `ARCHIVED`, and `isOpenBasket`
  replaces `isLiveGeneratedList`. `UpdateGeneratedListRequest.status` accepts any of them
  (`generated-list.messages.ts:403-409`), so every transition between the three is
  reachable.
- "Asked" is read in three places, all from origins:
  - `trips.sql.ts`, the `asked` half of `basketRowsCte`, which `TRIPS_CTE` and
    `BASKET_TRIP_ROWS_SQL` share.
  - `suggestions.sql.ts:95-128`, `SUGGESTION_RECENT_TRIPS_SQL`: the list's newest ended
    basket trips and which candidates each asked for.
  - `suggestions.sql.ts:138-160`, `SUGGESTION_LAST_ASKED_SQL`: what the newest ended
    basket trip asked of each candidate.
- `SUGGESTION_CANDIDATES_SQL` (`suggestions.sql.ts:32-55`) also reads origins, but it asks
  about **live** baskets only, so it is not a read of a finished trip and does not change
  here.
- "Ended" in the suggestions is the negation of the claim's test: not (`OPEN` and inside
  the claim window). A basket can therefore be ended and still `OPEN`, between the moment
  its window closes and the next tick of the sweep. Such a basket has no trip rows, and
  the reads still have to see what it asked.
- `LineMergeService.merge` (`line-merge.service.ts:112-167`) moves everything the absorbed
  line owns onto the survivor and deletes the absorbed line **last**, at `:165`. Origins
  move in `moveOrigins` (`:253-286`), called at `:153`: a basket line with an origin on
  both zone lines ends with one row holding both contributions. Settlements move at
  `:147-150`. Both callers, the zone rename of plan `0112` and the basket rename of plan
  `0113`, go through this one method.
- An origin row carries no foreign key on `lineId`, because plan `0050` wanted a basket to
  outlive a zone line deleted under it. Since `0132` a delete is a soft delete, so the
  only hard deletes left are the absorbed line of a merge and the cascade from a deleted
  list.
- `GeneratedListService.delete` reads the basket's origin lists **before** the delete,
  because they cascade away with it (`:865-868`). Trip rows cascade the same way.
- `core/src/migrate.ts` runs every pending migration in one transaction (`0130`
  section 13).

### Target state

Every acceptance criterion in section 11 holds. A basket has rows in `basket_trip_rows`
exactly while its status is not `OPEN`. No read of a finished basket's "asked" touches
`generated_list_line_origins`. `TripView`, `TripRowView` and `LineSuggestionView` are
unchanged on the wire.

### Scope

- Work only in:
  - a new migration in `core/src/app/db/migrations/`, and `index.ts` beside it
  - new `core/src/app/entities/basket-trip-row.entity.ts`, and `entities/index.ts`
  - new `core/src/app/generated-lists/basket-trip-rows.service.ts`,
    `basket-trip-rows.sql.ts` and their specs, and `generated-lists.module.ts`
  - `core/src/app/generated-lists/generated-list.service.ts` (`update` only)
  - new `core/src/app/lists/trips/basket-asked.sql.ts`, and `trips.sql.ts`
  - `core/src/app/lists/suggestions/suggestions.sql.ts` and `suggestions.service.ts`
  - `core/src/app/lists/line-merge.service.ts`
  - the specs of each
- Do NOT touch: `generated_list_line_origins` or anything that writes it, the settle and
  revert services, `trips.mappers.ts`, `trips.service.ts` beyond what the SQL's
  parameters need, `SUGGESTION_CANDIDATES_SQL`, `BASKET_ORIGIN_LISTS_SQL` and
  `OWNER_ORIGIN_LISTS_SQL`, the claim SQL, any contract, any gateway file. Computing
  "asked" as `bought + left` at the finish is `0136`. A person's history is `0142`.

### Constraints

- **The invariant: a basket has trip rows exactly while it is not `OPEN`.** Every read in
  this plan leans on it, so every write path keeps it, inside the transaction that changes
  the status.
- The choice between the two sources of "asked" is made on the **status alone**, never on
  the claim window. The rows are written by a status change, so only the status says
  whether they exist.
- One row per basket and zone line, however many sibling basket lines or origins fed it
  (plan `0094`). This is the grouping `basketRowsCte` already applies on read.
- A row is written once and never edited, with one exception: a line merge moves it.
- No wire change. If `openapi.json` or the wire types show a diff, something leaked.
- Raw SQL quotes every camelCase column by hand, and every rule here is proven by an
  integration spec against a real database.

### Action boundaries

- Proceed with in scope edits, the migration, unit and integration specs.
- Stop and ask if `0134` is not merged, if a second site that writes
  `generated_lists.status` turns up, or if the backfill fails on the unique constraint,
  which means two lists claim one line and the data needs looking at before any code.

### Progress evidence

Report after the migration with its backfill count, after the finish and reopen writes
with their specs, after the merge with its spec, after the trips SQL with its integration
spec, and after the suggestions SQL with its integration spec. Each with the run.

## 1. What is being built

| Piece                                                | Where                                                   |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `basket_trip_rows` and its entity `BasketTripRow`    | a new migration, `entities/basket-trip-row.entity.ts`   |
| `BasketTripRowsService.freeze` and `.thaw`           | `generated-lists/basket-trip-rows.service.ts`           |
| the freeze and the thaw inside the status change     | `GeneratedListService.update`                           |
| the backfill of every basket that is not `OPEN`      | the migration                                           |
| trip rows follow a line merge                        | `LineMergeService.moveTripRows`                         |
| `basketAskedCte`, one definition of "asked"          | `lists/trips/basket-asked.sql.ts`                       |
| trips and suggestions read it                        | `trips.sql.ts`, `suggestions.sql.ts`                    |

## 2. The table

```sql
CREATE TABLE "basket_trip_rows" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "basketId" uuid NOT NULL,
  "listId" uuid NOT NULL,
  "lineId" uuid NOT NULL,
  "asked" integer NOT NULL,
  CONSTRAINT "pk_basket_trip_rows" PRIMARY KEY ("id"),
  CONSTRAINT "uq_basket_trip_rows_line" UNIQUE ("basketId", "lineId"),
  CONSTRAINT "ck_basket_trip_rows_asked" CHECK ("asked" >= 0),
  CONSTRAINT "fk_basket_trip_rows_basket" FOREIGN KEY ("basketId")
    REFERENCES "generated_lists" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_basket_trip_rows_line" FOREIGN KEY ("lineId")
    REFERENCES "list_lines" ("id") ON DELETE CASCADE
);

CREATE INDEX "ix_basket_trip_rows_list" ON "basket_trip_rows" ("listId", "basketId");
```

- **`asked` is the only fact.** What was bought is already written down, in
  `line_settlements` under `basketId` (`0134`), and copying it here is a second record of
  one purchase that a revert then has to keep in step. `left` and the outcome are derived
  from the two, as `trips.mappers.ts` derives them today.
- **Zero is a value.** An origin taken back to zero is a trip that stopped asking, and
  today it is still a row of the trip (`asked` 0, outcome `NOT_BOUGHT`). The freeze writes
  it, so a trip has the same rows the day after it ends as the day before.
- **`lineId` has a foreign key, and an origin row did not.** Plan `0050` left it off so a
  basket was able to outlive a zone line deleted under it. Since `0132` a deleted line is still
  a row, so the two hard deletes left are a merge, which moves the row first (section 5),
  and the cascade from a deleted list, whose trips nobody can read any more because the
  read starts with `requireRead` on the list. A row naming no line is unreadable today
  already (`basket_rows` inner joins `list_lines`), so the key removes nothing a reader
  ever saw, and it is the same rule `line_settlements.lineId` follows.
- **`listId` is a copy**, as it is on a settlement. A line never moves between lists, so
  it cannot drift, and it is what the trips read and the index serve. **There is no
  `zoneId`.** An origin row carried one for the claim, which reads origins of open baskets
  and never a trip row, and no read of a finished trip asks for a zone. A column nothing
  reads is a column that drifts unnoticed, so `0130` section 2.2 lists none.
- The unique key is `(basketId, lineId)`, which `ON CONFLICT` in section 3 leans on. The
  index on `(listId, basketId)` serves the trips of a list, the only hot read.

```ts
@Entity({ name: 'basket_trip_rows' })
@Unique('uq_basket_trip_rows_line', ['basketId', 'lineId'])
@Index('ix_basket_trip_rows_list', ['listId', 'basketId'])
export class BasketTripRow {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'uuid' }) basketId!: string;
  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'basketId' })
  basket!: GeneratedList;
  @Column({ type: 'uuid' }) listId!: string;
  @Column({ type: 'uuid' }) lineId!: string;
  @ManyToOne(() => ListLine, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lineId' })
  line!: ListLine;
  @Column({ type: 'int' }) asked!: number;
}
```

It does not extend `BaseEntity`, for the reason `GeneratedListLineOrigin` does not: it is
written once and has no life of its own to audit. Register it in `entities/index.ts` and
in the `forFeature` list of `generated-lists.module.ts`.

## 3. The freeze and the thaw

```ts
@Injectable()
export class BasketTripRowsService {
  /** Write what this basket asked of every zone line. Idempotent. */
  freeze(manager: EntityManager, basketId: string): Promise<void>;
  /** Delete them. The basket is open again and its lists answer for it. */
  thaw(manager: EntityManager, basketId: string): Promise<void>;
}
```

Both take the caller's manager and hold no repository, as `LineMergeService` does, so they
run inside the caller's transaction and draw no second connection from the pool.

```sql
-- BASKET_TRIP_ROWS_FREEZE_SQL, $1 is the basket
INSERT INTO "basket_trip_rows" ("basketId", "listId", "lineId", "asked")
SELECT gll."generatedListId",
       ll."listId",
       ll.id,
       SUM(o."quantity")::int
FROM "generated_list_line_origins" o
JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
JOIN "list_lines" ll ON ll.id = o."lineId"
WHERE gll."generatedListId" = $1::uuid
GROUP BY gll."generatedListId", ll."listId", ll.id
ON CONFLICT ON CONSTRAINT "uq_basket_trip_rows_line" DO NOTHING
```

- **The list comes from the line, not from the origin's copy.** They agree
  in every row that exists, and reading it from `list_lines` is what makes the unique key
  safe to group under: one line is in one list.
- **The inner join to `list_lines` drops an origin whose line is gone**, which the foreign
  key requires and which loses nothing: `basket_rows` drops the same origin on every read
  today. A soft deleted line (`0132`) is still a row, so it is frozen like any other, and
  the trips read decides whether to draw it, as it does for an open basket.
- `thaw` is `DELETE FROM "basket_trip_rows" WHERE "basketId" = $1::uuid`.
- `0136` replaces the `SELECT` of the freeze with `bought + left` over the basket's
  coverage, and changes nothing else in this plan. That is the seam, and it is why the
  statement lives in a file of its own.

### 3.1 Where they are called

`GeneratedListService.update` wraps its write in `this.dataSource.transaction`. Inside it:
lock and re-read the basket (`pessimistic_write`), apply the fields, save, then

| From                   | To                     | Trip rows                                  |
| ---------------------- | ---------------------- | ------------------------------------------ |
| `OPEN`                 | `FINISHED`             | `freeze`                                   |
| `OPEN`                 | `ARCHIVED`             | `freeze`                                   |
| `FINISHED`             | `ARCHIVED`, and back   | nothing. The rows stand.                   |
| `FINISHED`, `ARCHIVED` | `OPEN`                 | `thaw`                                     |
| any                    | the same status        | nothing                                    |

Stated as the code states it: `if (wasOpen && !isOpen) freeze` and `if (!wasOpen && isOpen)
thaw`, which are the two branches `update` already has for the claim (`:822-831`). Archiving
says nothing about whether a basket was shopped (plan `0110`), so archiving an open basket
ends its trip exactly as finishing it does, and archiving a finished one changes nothing.

- The announcements (`GeneratedListUpdated`, the claim release, `list.tripsChanged`) stay
  **after** the commit, where they are today. `list.tripsChanged` already fires on a status
  change (`:837-842`), so a client in the list room reads the frozen numbers on its next
  read and no new event is needed.
- The sweep needs no change. It calls `update`.
- A rename or a change of `defaultTargetListId` alone takes the same transaction and
  touches no trip row.
- **The race that is accepted.** `GeneratedListOriginsService.setOriginQuantity` checks the
  status before its own transaction and does not lock the basket, so an origin edit that
  read `OPEN` a moment before the finish can commit after the freeze, and the trip then
  shows the number from before that edit. The window is one request wide, the edit is the
  shopper's own, and `0136` deletes the origin writes altogether. It is not worth a lock in
  a service this series removes.

## 4. One definition of "asked"

```ts
// core/src/app/lists/trips/basket-asked.sql.ts

/**
 * What every basket asks, or asked, of the lines of one list. `$1` is the list.
 * `basketParam` narrows it to one basket, for the rows read.
 *
 * Two sources, chosen on the status alone. A basket that is not `OPEN` answers
 * from `basket_trip_rows`, which its finish wrote. An `OPEN` basket answers
 * from its origins. The invariant of plan 0135 (rows exist exactly while the
 * basket is not `OPEN`) is what makes the two halves disjoint.
 */
export function basketAskedCte(basketParam: string | null): string {
  const frozen = basketParam ? `AND r."basketId" = ${basketParam}::uuid` : '';
  const open = basketParam
    ? `AND gll."generatedListId" = ${basketParam}::uuid`
    : '';
  return `
  "basket_asked" AS (
    SELECT r."basketId" AS "basketId",
           r."lineId" AS "lineId",
           r."asked" AS "asked"
    FROM "basket_trip_rows" r
    WHERE r."listId" = $1::uuid ${frozen}
    UNION ALL
    SELECT gll."generatedListId" AS "basketId",
           o."lineId" AS "lineId",
           SUM(o."quantity")::int AS "asked"
    FROM "generated_list_line_origins" o
    JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
    JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
    WHERE o."listId" = $1::uuid
      AND gl."status" = 'OPEN' ${open}
    GROUP BY gll."generatedListId", o."lineId"
  )`;
}
```

The `gl."status" = 'OPEN'` on the second half is not redundant. A finished basket keeps its
origins until `0136` drops the table, and without the predicate every finished trip
answers twice. `0136` replaces the second half with the open basket's coverage and leaves
the first alone.

### 4.1 The trips

In `trips.sql.ts` the `asked` half of `basketRowsCte` (as `0134` left it) becomes a read of
that relation:

```sql
${basketAskedCte(basketParam)},
"asked" AS (
  SELECT a."basketId" AS "tripId",
         a."lineId" AS "lineId",
         a."asked" AS "asked"
  FROM "basket_asked" a
),
```

`bought` and `basket_rows` are unchanged. Plan `0122` section 4 is reversed in one
sentence: a finished trip's rows no longer freeze because nothing writes its origins. They
freeze because the finish wrote them down. Everything else that section says still holds:
one row per zone line, `left` is `max(0, asked - bought)`, no name and no current quantity
on the row.

### 4.2 The suggestions

Both statements keep their parameters, their "ended" test and their answers. They stop
naming origins.

```sql
-- SUGGESTION_RECENT_TRIPS_SQL
WITH ${basketAskedCte(null)},
"ended" AS (
  SELECT gl.id AS "tripId",
         gl."generatedAt" AS "generatedAt"
  FROM "basket_asked" a
  JOIN "list_lines" ll ON ll.id = a."lineId" AND ll."listId" = $1::uuid
  JOIN "generated_lists" gl ON gl.id = a."basketId"
  WHERE NOT (
    gl."status"::text = ANY($2::text[])
    AND gl."generatedAt" >= $3::timestamptz
  )
  GROUP BY gl.id
  ORDER BY gl."generatedAt" DESC, gl.id DESC
  LIMIT $5
)
SELECT e."tripId" AS "tripId",
       COALESCE(
         ARRAY_AGG(DISTINCT a."lineId"::text)
           FILTER (WHERE a."lineId" IS NOT NULL),
         '{}'
       ) AS "lineIds"
FROM "ended" e
LEFT JOIN "basket_asked" a
  ON a."basketId" = e."tripId"
 AND a."lineId" = ANY($4::uuid[])
 AND a."asked" > 0
GROUP BY e."tripId", e."generatedAt"
ORDER BY e."generatedAt" DESC, e."tripId" DESC
```

```sql
-- SUGGESTION_LAST_ASKED_SQL
WITH ${basketAskedCte(null)}
SELECT DISTINCT ON (a."lineId")
       a."lineId" AS "lineId",
       a."asked" AS "asked"
FROM "basket_asked" a
JOIN "generated_lists" gl ON gl.id = a."basketId"
WHERE a."lineId" = ANY($4::uuid[])
  AND a."asked" > 0
  AND NOT (
    gl."status"::text = ANY($2::text[])
    AND gl."generatedAt" >= $3::timestamptz
  )
ORDER BY a."lineId", gl."generatedAt" DESC, gl.id DESC
```

- **Why the union and not the table alone.** "Ended" is the claim's negation, so a basket
  whose window closed and that the sweep has not reached yet is ended and still `OPEN`. It
  has no trip rows. Reading `basket_trip_rows` alone drops it for one sweep interval
  and changes which trips count toward `STAPLE_TRIPS`. Reading the relation keeps plan
  `0123`'s answer to the row.
- Presence was "an origin with `quantity > 0`". It is now "asked above zero", over the sum.
  The two differ only when sibling origins of one zone line split a positive ask with a
  zero, and the sum is the honest reading of "the trip asked for it".
- `suggestions.service.ts` passes the same parameters in the same order. If `0133`
  renamed the statuses constant, the call sites already follow it.
- `SUGGESTION_CANDIDATES_SQL` is untouched. It asks whether a **live** basket holds a
  line, and a live basket is `OPEN`, so it still reads origins until `0136`.

## 5. A merge moves the rows

`LineMergeService.merge` gains `moveTripRows`, called at the same point as `moveOrigins`
(`line-merge.service.ts:153`), before the absorbed line is deleted at `:165`. The foreign
key makes the order load bearing: a row still naming the absorbed line is deleted with
it.

```ts
/**
 * The trip rows that point at the absorbed line (plan 0135, section 5).
 *
 * A finished basket that asked for both lines ends with one row, the
 * survivor's, holding both asks, because `uq_basket_trip_rows_line` allows one
 * row per basket and zone line. The twin of `moveOrigins`, and the reason is
 * the same: the two lines are one line now, and the trip asked for it.
 */
private async moveTripRows(
  manager: EntityManager,
  survivorId: string,
  absorbedId: string
): Promise<void>;
```

For each row on the absorbed line, in `id` order: when the same basket has a row on the
survivor, delete the moving row first and add its `asked` to the staying one, otherwise
update its `lineId`. Deleted first, so the pair never exists twice under the unique key,
which is the order `moveOrigins` uses at `:273-279`. Both lines are on one list, so
`listId` does not move.

This is the one edit a trip row ever takes. It does not make a finished trip follow its
list: a merge changes which line the household calls milk, not how much milk the trip
asked for.

## 6. Migration

`<next free timestamp>-BasketTripRows.ts`, class `BasketTripRows<timestamp>`, listed last in
`CORE_MIGRATIONS` with a comment saying it follows the migrations of `0132`
(`list_lines.deletedAt`), `0133` (the three statuses) and `0134`.

**Up**: the table and the index of section 2, a `COMMENT ON TABLE` naming this plan, then
the backfill, which is the freeze of section 3 over every basket that is not open:

```sql
INSERT INTO "basket_trip_rows" ("basketId", "listId", "lineId", "asked")
SELECT gll."generatedListId",
       ll."listId",
       ll.id,
       SUM(o."quantity")::int
FROM "generated_list_line_origins" o
JOIN "generated_list_lines" gll ON gll.id = o."generatedListLineId"
JOIN "generated_lists" gl ON gl.id = gll."generatedListId"
JOIN "list_lines" ll ON ll.id = o."lineId"
WHERE gl."status" <> 'OPEN'
GROUP BY gll."generatedListId", ll."listId", ll.id;
```

- The status literal is the one `0133` wrote, and `0133`'s migration runs first inside the
  same transaction when both are pending. A rebuilt enum type is usable in that
  transaction. A value **added** to an existing type is not (`0130` section 13), which is
  `0133`'s trap and not this plan's, and it is named here so nobody reorders the two.
- Nothing a reader sees changes at the backfill. A finished basket's origins have not
  moved since it finished, so the sums written are the sums every read computed
  yesterday.

**Down**: `DROP TABLE "basket_trip_rows"`. Lossless **while the origins table exists**,
because a finished basket's origins still hold every number. `0136` deletes that table,
and from then on this down loses what every finished trip asked. `0136` says so in its own
down. It is said here as well, because this is the file somebody reads before running it.

## 7. Events

None new. `list.tripsChanged { listId }` already fires for every origin list when a basket
moves between statuses (`generated-list.service.ts:837-842`), and the lists it names are
read from origins by `tripListsOfBasket`, which still works for a finished basket until
`0136` moves that read too.

## 8. Not in this plan

- "Asked" as `bought + left` over the coverage, the deletion of
  `generated_list_line_origins`, and `tripListsOfBasket` reading `basket_sources` or trip
  rows: `0136`.
- `SUGGESTION_CANDIDATES_SQL` and the claim, which ask about open baskets: `0136`.
- Staples counted over sessions as well as basket trips, which is what gives a household
  that only uses its `LIVE` basket any suggestions: `0142`.
- A finished trip in a person's history: `0142`.
- Any purge of trip rows. Plan `0050` section 7 left retention unbounded and this does not
  decide it.

## 9. Tests

Unit:

1. `update` calls `freeze` on `OPEN` to `FINISHED` and on `OPEN` to `ARCHIVED`, `thaw` on
   either back to `OPEN`, and neither on `FINISHED` to `ARCHIVED`, on a rename, or on a
   status set to the value it already has.
2. The announcements of `update` still run after the transaction, and a `freeze` that
   throws leaves the status unchanged and announces nothing.
3. The sweep finishes a basket and its trip rows exist.
4. `moveTripRows`: a row on the absorbed line alone is repointed, a basket with a row on
   both ends with one row holding the sum, and a line with no trip rows is a no op.

Integration, real database, through the integration target on a slot:

5. The freeze writes one row per zone line for a basket whose line has two sibling basket
   lines and two origins, with `asked` their sum, and a row with `asked` 0 for an origin
   taken back to zero.
6. The freeze skips an origin whose line no longer exists and writes a soft deleted line's
   row.
7. The freeze twice is one set of rows. Freeze, thaw, freeze after an origin edit writes
   the edited number.
8. **The invariant.** After every transition of test 1, run against the database, a basket
   has rows exactly when it is not `OPEN`.
9. Deleting a basket deletes its rows, and its purchases become session purchases (`0134`
   test 10 still passes).
10. A zone rename that merges two lines (plan `0112`) moves a finished trip's rows, and the
    trip reads one row with the summed `asked` and the summed `bought`. The same through a
    basket rename (plan `0113`).
11. The trips of a list: a finished basket's rows read `asked` from `basket_trip_rows`, an
    open basket's from origins, and a list that has one of each returns both with the
    numbers plan `0122`'s own specs expect. **A finished basket whose origins are then
    deleted by hand still reads the same `asked`**, which is the proof that the read is off
    the origins table.
12. A finished basket answers once and not twice while its origins still exist.
13. `SUGGESTION_RECENT_TRIPS_SQL` and `SUGGESTION_LAST_ASKED_SQL` return what plan `0123`'s
    integration spec expects, unchanged, and they still count a basket that is `OPEN` and
    past the claim window as ended.
14. The migration backfills every basket that is not `OPEN` and none that is, and down
    then up again reproduces the same rows.

## 10. What a reader of this plan must not conclude

A trip row is not a basket line under another name. It has no text, no product, no order
and no state, nobody edits it, and an open basket has none. It is the one number a finished
trip cannot get from anywhere else.

## 11. Acceptance criteria

- [ ] `basket_trip_rows` exists with the unique key, the check and both foreign keys of
      section 2.
- [ ] A basket has rows in it exactly while its status is not `OPEN`, across every
      transition, the sweep included, and the write is in the transaction that changes the
      status.
- [ ] Every basket that was already finished or archived has its rows after the migration.
- [ ] A line merge moves trip rows to the survivor and sums a collision.
- [ ] The trips of a list and both suggestion reads take a finished basket's "asked" from
      `basket_trip_rows`, and an open basket's from its origins, through one shared
      relation.
- [ ] `TripView`, `TripRowView` and `LineSuggestionView` are unchanged, and `openapi.json`
      and the wire types have no diff.

## 12. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper/contracts
npx nx build luna-shopper-backend-core
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
git status --short apps/luna-shopper-backend/gateway/docs libs/luna-shopper-admin/models
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

The two generators are run to prove the last criterion: they must leave no diff. Run the
integration specs through their own target against a slot (memory note on Luna backend
spec traps), boot core once on that slot so a `type` import that erased a token shows
itself, then give the slot back.
