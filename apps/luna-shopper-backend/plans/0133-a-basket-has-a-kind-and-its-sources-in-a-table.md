# 0133: a basket has a kind, three statuses and its sources in a table

> Third build plan of the series recorded in `0130`, and it needs no other plan. It is the
> header half of `0130` section 2.1: what a basket **is**, before `0136` changes what a
> basket **holds**. No basket line, origin or settlement moves here.
>
> Four things are wrong with the header today, and each blocks a later plan:
>
> - **Nothing says what kind of basket a row is.** `0136` creates one permanent basket per
>   person. Seven queries ask "is somebody still shopping this" of every row, and each of
>   them is wrong about a basket that never ends: the sweep finishes it after 60 hours
>   (`generated-list-sweep.service.ts:114-132`) and the settle then refuses it
>   (`generated-list-settle.service.ts:101`).
> - **The status has four values and uses two.** A run writes `DRAFT`, nothing in core writes
>   `ACTIVE`, the client writes it once on a reopen, and every reader treats the two as one
>   through `LIVE_GENERATED_LIST_STATUSES`. The word "live" is also about to mean a kind.
> - **What a basket draws from is a JSON blob.** `sourceSnapshot` cannot answer "which
>   baskets cover this list", and `0139` has to ask that on every line write.
> - **The overlap rule has lost its reason.** A run refuses a line another open basket of
>   the same person carries (plan `0050` section 3), because "two live baskets both claiming
>   the same milk is how a household ends up with two milks". That is true of two frozen
>   copies. It is false of two views of one line, and with a permanent basket over every
>   list it refuses everything.
>
> Prerequisite reading: `0130` sections 2, 3, 10, 11 (decisions 8 and 9) and 13, plan `0050`
> sections 2 to 4, plan `0052` sections 3 and 4 (the claim), plan `0059` section 4 (the
> sweep), plan `0078` section 3 (`pricingProfileId`), plan `0092` section 3.2 (the `CLAIMED`
> refusal), plan `0114` section 11.2 (which source names a reader sees), plan `0122`
> section 3, and `core/src/app/generated-lists/generated-list.service.ts` in full.

## Brief for the agent

### Objective

Give `generated_lists` a `kind`, rebuild its status as `OPEN`, `FINISHED`, `ARCHIVED`, move
its sources from `sourceSnapshot` into a `basket_sources` table, build
`BasketCoverageService`, make every "is this basket open" query ask for a `GENERATED`
basket, and delete the overlap rule, with the client and the back office following the
renamed status.

### Context

- `GeneratedList` (`core/src/app/entities/generated-list.entity.ts`) has `ownerUserId`,
  `name`, `status`, `generatedAt`, `sourceSnapshot` (`:67`), `defaultTargetListId` (`:78`),
  `idempotencyKey`. The Postgres enum type is `generated_list_status`
  (`db/migrations/1756001000000-GeneratedLists.ts:45`).
- `GeneratedListSourceSnapshot` is
  `{ profileId, pricingProfileId, sources: { zoneId, listId }[] }`
  (`libs/luna-shopper/contracts/src/lib/messages/generated-list.messages.ts`). **Its
  `sources` are the lists the run resolved, never what the request named.**
  `GeneratedListService.create` writes `resolved.sources` after `narrow()`
  (`generated-list.service.ts:227-234`, `:1167`), so a request for a whole zone is stored as
  that zone's lists on that day.
- Readers of the snapshot, all of them: `toGeneratedListView` and `toBasketView`
  (`generated-list.mappers.ts:41-43`, `:230`, `:245`), `sourceNames`
  (`generated-list-basket.service.ts:155`), `searchScope` (`:424`), `runSources`
  (`generated-list-origins.service.ts:253`).
- `GeneratedListStatus` and `LIVE_GENERATED_LIST_STATUSES`
  (`libs/luna-shopper/contracts/src/lib/enums/generated-list.enums.ts:19-49`) are read in
  twenty files of core. Section 5 lists them.
- The overlap rule is `dropOverlaps` (`generated-list.service.ts:392-441`) over
  `LIVE_OVERLAP_SQL` (`generated-list.sql.ts:187`), and its second use is
  `carriedElsewhere` (`generated-list-origins.service.ts:330`), which answers
  `OriginUnavailableReason.CLAIMED` (`:372`) and refuses an adoption (`:852`).
- velista keeps its own copy of the enum and imports nothing from contracts
  (`libs/velista/models/src/lib/enums.ts:241-296`). A renamed value does not break its
  build. It maps to `'UNKNOWN'` at run time, which is worse. The back office does the same
  (`libs/luna-shopper-admin/feature-people/src/lib/baskets.ts`).
- `core/src/migrate.ts` runs every pending migration in one transaction (`0130`
  section 13).

### Target state

Every acceptance criterion in section 12 holds. No `LIVE` row exists yet, because `0136`
creates them, so the specs insert one as a fixture. `npx nx run-many -t lint test` is green
for core, gateway, contracts, the admin projects and the velista projects in scope, with
`openapi.json` and the wire types regenerated.

### Scope

- Work only in:
  - `core/src/app/entities/` (`generated-list.entity.ts`, new `basket-source.entity.ts`,
    `index.ts`)
  - one new migration and `db/migrations/index.ts`, and `db/seed/` if the seed writes a
    basket
  - a new `core/src/app/baskets/` folder (`basket-coverage.service.ts`,
    `basket-coverage.sql.ts`, `basket-coverage.module.ts`, `open-basket.sql.ts`, specs)
  - `core/src/app/generated-lists/` for the sites named in sections 4 to 7
  - `core/src/app/lists/trips/` and `core/src/app/lists/suggestions/` for their SQL and the
    parameters their services pass
  - `core/src/app/admin/dashboard.service.ts`, `admin-list.service.ts`
  - `libs/luna-shopper/contracts` (enums, messages, schemas)
  - `apps/luna-shopper-backend/gateway/src/app/generated-lists/` (DTO descriptions, one
    comment)
  - the velista and back office files of section 9, and nothing else in either
  - `apps/velista-luna-e2e/src/support/api.ts`
  - the generated `openapi.json` and `wire-types.ts`
- Do NOT touch: `generated_list_lines`, `generated_list_line_origins`,
  `generated_list_line_options`, `line_settlements`, the settle, the reopen, the split, the
  composition of a run (it still copies lines until `0136`), `defaultTargetListId` (`0136`
  drops it), `seesZoneData`, participants and links (`0140`), the table names (`0144`), any
  route path.

### Constraints

- New tables, columns, types, files and contract names say `basket`. Existing names that
  say `GeneratedList` stay until `0144` (`0130` section 3). `GeneratedListStatus` keeps its
  name and changes its values. `BasketKind` is new and is born with its name.
- An enum is **rebuilt**, never extended (`0130` section 13).
- "Open" is stated once as a SQL fragment and once as a function. No query spells the
  predicate by hand.
- Raw SQL quotes every camelCase column, and every changed query is proven by an
  integration spec.
- Only make changes directly requested.

### Action boundaries

- Proceed with in scope edits, the migration, specs and the two generators.
- Stop and ask if any `sourceSnapshot` on the slot's database does not parse as the
  contract shape, instead of guessing a backfill for it.
- Stop and ask before deleting any row. The migration in section 8 deletes none going up.

### Progress evidence

Report after the migration with its up, down and up run, after `BasketCoverageService` with
its integration spec, after the status and kind predicates with the trips, claims and
suggestions specs, after the overlap rule is gone, and after the client and back office
follow, each with the spec run.

### Session strategy

One session. The backend half is one track, because the enum rename and the predicates
touch the same files. The client and back office follow (section 9) is an independent
track that can go to one subagent once the contract change is committed, with the bounded
deliverable "the files in section 9, green specs, nothing else".

## 1. What is being built

| Piece                                                        | Where                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `BasketKind`, `generated_lists.kind`, one `LIVE` per owner   | contracts, entity, migration                            |
| status `OPEN`, `FINISHED`, `ARCHIVED`, `isOpenBasket`        | contracts, entity, migration, twenty call sites         |
| `generated_lists.pricingProfileId`                           | entity, migration, `searchScope`                        |
| `basket_sources`, its backfill, `sourceSnapshot` dropped     | new entity, migration, the run, five readers            |
| `BasketCoverageService.listsOf`, `coveringBaskets`           | new `core/src/app/baskets/`                             |
| `OPEN_GENERATED_BASKET`, asked by six queries and the sweep  | new `baskets/open-basket.sql.ts`, the SQL files         |
| the overlap rule and `CLAIMED`, deleted                      | the run, the origins service, contracts                 |
| velista, the back office and the e2e helper follow           | section 9                                               |

## 2. Kind

```ts
/** What a basket is (plan 0133). */
export enum BasketKind {
  /** One per person, covering every list they can write. Never finished. Built by 0136. */
  LIVE = 'LIVE',
  /** Made on purpose, with a name, sources and people. Finished by its owner. */
  GENERATED = 'GENERATED',
}
```

In `libs/luna-shopper/contracts/src/lib/enums/generated-list.enums.ts`, exported from the
barrel, with its JSON schema enum beside `GeneratedListStatus`'s.

`generated_lists.kind`: Postgres type `basket_kind`, `NOT NULL`, no default on the column
once the migration is done, so an insert that forgets it fails.

| Constraint or index                | Definition                                                                                                   | Why                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `uq_generated_lists_live_owner`    | `UNIQUE ("ownerUserId") WHERE "kind" = 'LIVE'`                                                               | one permanent basket a person, by the database            |
| `ck_generated_lists_live_shape`    | `CHECK ("kind" <> 'LIVE' OR ("name" IS NULL AND "status" = 'OPEN' AND "idempotencyKey" IS NULL))`            | it has no name, it is never finished, no run composed it  |

`GeneratedListService.update` (`:794`) refuses a `name` or a `status` on a `LIVE` basket
with a `ValidationException` naming the field, before the constraint has to. `delete`
(`:853`) refuses one with `ConflictException('The basket that is always there cannot be
deleted')`. `deleteForUser` (`:898`) is unchanged: an account's deletion takes every basket.

`GeneratedListView`, `GeneratedListSummaryView`, `SharedGeneratedListCoreView`, the basket
view and `AdminBasketView` (`admin-core.messages.ts:571`) gain `kind: BasketKind`, required.

## 3. Status

```ts
export enum GeneratedListStatus {
  /** Somebody is still going to shop it, or is shopping it now. */
  OPEN = 'OPEN',
  /** The trip is over. Refuses every write, and its owner can open it again. */
  FINISHED = 'FINISHED',
  /** Finished and hidden from the default listing. */
  ARCHIVED = 'ARCHIVED',
}

/** Whether this basket still takes writes. */
export function isOpenBasket(status: GeneratedListStatus): boolean {
  return status === GeneratedListStatus.OPEN;
}
```

`LIVE_GENERATED_LIST_STATUSES` and `isLiveGeneratedList` are **deleted**, not aliased. A set
of one value is not a set, and the old name now says something false.

This is decision 8 of `0130` section 11. `DRAFT` and `ACTIVE` were one state with two
spellings: plan `0092` section 3.2 found that the overlap check tested `ACTIVE` "and
therefore never fired" (`generated-list.sql.ts:156-163`), and nothing has written `ACTIVE`
since except the client's reopen (`libs/velista/.../basket-page.ts:783`).

The Postgres type is rebuilt as `basket_status` (section 8). The mapping is `DRAFT` and
`ACTIVE` to `OPEN`, `COMPLETED` to `FINISHED`, `ARCHIVED` to itself.

## 4. Sources

### 4.1 The table

New entity `BasketSource`, file `core/src/app/entities/basket-source.entity.ts`, table
`basket_sources`. It does not extend `BaseEntity`: a source is written once with its basket
and never edited, exactly as a provenance row is
(`generated-list-line-origin.entity.ts:17-20`).

| Column      | Type          | Null | Notes                                                                                  |
| ----------- | ------------- | ---- | -------------------------------------------------------------------------------------- |
| `id`        | `uuid`        | no   | primary key, generated                                                                 |
| `createdAt` | `timestamptz` | no   | `@CreateDateColumn`                                                                    |
| `basketId`  | `uuid`        | no   | `REFERENCES "generated_lists"(id) ON DELETE CASCADE`                                   |
| `zoneId`    | `uuid`        | no   | `REFERENCES "zones"(id) ON DELETE CASCADE`                                             |
| `listId`    | `uuid`        | yes  | `REFERENCES "shopping_lists"(id) ON DELETE CASCADE`. **Null means every list of the zone** |

Foreign keys, where the origins table has none, because the two record different things. An
origin is history and must outlive what it names. A source is a rule that is evaluated
today, and a rule about a list that no longer exists says nothing.

| Index                       | Definition                                                          | Serves                                   |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `uq_basket_sources_zone`    | `UNIQUE ("basketId", "zoneId") WHERE "listId" IS NULL`              | one whole zone row a zone                |
| `uq_basket_sources_list`    | `UNIQUE ("basketId", "listId") WHERE "listId" IS NOT NULL`          | one row a list                           |
| `ix_basket_sources_list`    | `("listId") WHERE "listId" IS NOT NULL`                             | `coveringBaskets`, by list               |
| `ix_basket_sources_zone`    | `("zoneId") WHERE "listId" IS NULL`                                 | `coveringBaskets`, by whole zone         |
| `ix_basket_sources_basket`  | `("basketId")`                                                      | `listsOf`                                |

Two rules no constraint can hold, held by the run and pinned by specs:

- A `LIVE` basket has no source rows. Its coverage is not a list of sources.
- A basket never holds a whole zone row **and** a list row of that same zone. The whole zone
  row wins and the list rows are not written.

### 4.2 What a run writes

`GeneratedListService.create` (`:182`) composes exactly as today, from
`narrow(writable, sources)`. What changes is what it **records**: the sources as they were
named, not the lists they resolved to, so that a whole zone stays a whole zone and follows a
list added to that zone next month (`0130` section 3, "coverage", and the audit's gap G4).

| The run was given                          | Rows written                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `req.sources`                              | one row per named source that narrows to at least one writable list now                       |
| a profile's sources                        | the same, from `profile.sources`                                                              |
| nothing, or a profile with none (`ALL`)    | one whole zone row per zone in which the caller holds `WRITE` on at least one list now        |

A source that narrows to nothing writes no row, which is plan `0050` section 2's rule kept:
"a source is only ever a narrowing", and one that names nothing is silently nothing.

`ALL` freezes the **set of zones** at creation and nothing finer. A `GENERATED` basket is a
chosen set, and a zone joined afterwards is not in it. The basket that follows everything is
the `LIVE` one.

The rows are written inside `write`'s transaction (`:551-617`), after the basket row and
before its lines. `resolveSources` (`:293`) returns the named sources beside the resolved
ones, and `pricingProfileId` goes to its own column.

### 4.3 `pricingProfileId`

`generated_lists."pricingProfileId" uuid NULL`, no foreign key, exactly as every profile
reference in this table's history (the snapshot held a bare id). Null on a basket composed
before plan `0078`, and on every `LIVE` basket, where it means "the owner's default profile,
resolved at read time" and `0136` does the resolving.

`searchScope` (`generated-list-basket.service.ts:414-426`) reads the column. The comment
about a snapshot stored before plan `0078` moves with it.

### 4.4 What replaces each reader of the snapshot

| Reader                                                          | After                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `toGeneratedListView` (`generated-list.mappers.ts:245`)         | `sources: BasketSourceView[]` and `kind`. `readSnapshot` (`:40-44`) is deleted                                                                         |
| `toBasketView` (`:230`)                                         | `sources`, under the same `seesZoneData` redaction the snapshot had                                                                                    |
| `sourceNames` (`generated-list-basket.service.ts:149-163`)      | the names of `coverage.listsOf(list)` **intersected with the origin lists**, which is plan `0114` section 11.2 unchanged                               |
| `searchScope` (`:424`)                                          | the column                                                                                                                                             |
| `runSources` (`generated-list-origins.service.ts:252-254`)      | the ids of `coverage.listsOf(list)`. `fromRun` on an origin row now means "this basket covers that list today"                                         |

```ts
/** One source of a basket, as it was named. */
export interface BasketSourceView {
  zoneId: string;
  /** Null means every list of the zone the owner can write. */
  listId: string | null;
}
```

`GeneratedListSourceSnapshot`, `sourceSnapshot` on both views and their schemas
(`generated-list.schemas.ts:42-45`, `:138-169`, `:400-401`,
`generated-list-sharing.schemas.ts:391`, `:446`) are deleted. `profileId` and
`pricingProfileId` leave the wire with them. Before deleting, grep `libs/velista` and
`libs/luna-shopper-admin` for a reader of either: on 2026-09-19 the only client read of the
snapshot was its `sources` (`basket-mappers.ts:687-705`).

## 5. Coverage

New folder `core/src/app/baskets/`, the first code that says `basket`.
`BasketCoverageModule` stands alone, as `LineClaimModule` does and for the same reason: the
lists module needs it in `0139`, the generated lists module needs it now, and a module both
import cannot import either. It registers `GeneratedList`, `BasketSource` and nothing else.

```ts
export interface CoveredList {
  listId: string;
  zoneId: string;
}

@Injectable()
export class BasketCoverageService {
  /**
   * The lists this basket reads, now (0130, section 3). Never stored.
   * LIVE: every list its owner holds WRITE on.
   * GENERATED: those, narrowed by basket_sources.
   */
  listsOf(basket: Pick<GeneratedList, 'id' | 'kind' | 'ownerUserId'>): Promise<CoveredList[]>;

  /**
   * The open baskets that cover this list, now, each with its owner. The reverse of
   * `listsOf`. The owner is answered because `0139` addresses the owner's `user:` room as
   * well as the basket's room: the home card counts a basket somebody else is shopping.
   */
  coveringBaskets(listId: string): Promise<CoveringBasket[]>;
}

export interface CoveringBasket {
  basketId: string;
  ownerUserId: string;
}
```

`listsOf` is one query, `BASKET_COVERAGE_SQL`, `$1` the basket:

```sql
SELECT sl.id AS "listId", sl."zoneId" AS "zoneId"
FROM "generated_lists" gl
JOIN "zone_memberships" m ON m."userId" = gl."ownerUserId"
JOIN "shopping_lists" sl ON sl."zoneId" = m."zoneId"
WHERE gl.id = $1
  AND (${WRITABLE_LIST})
  AND (
    gl."kind" = 'LIVE'
    OR EXISTS (
      SELECT 1 FROM "basket_sources" bs
      WHERE bs."basketId" = gl.id
        AND bs."zoneId" = sl."zoneId"
        AND (bs."listId" IS NULL OR bs."listId" = sl.id)
    )
  )
ORDER BY sl."zoneId", sl."updatedAt" DESC, sl.id
```

`WRITABLE_LIST` is imported from `generated-list.sql.ts:30`, where it stays until `0144`.
It is the single definition of "a list this person can draw a basket from", and coverage
must not grow a second one. The order is `WRITABLE_LISTS_SQL`'s (`:56-63`).

`coveringBaskets` is one query, `COVERING_BASKETS_SQL`, `$1` the list:

```sql
SELECT gl.id AS "basketId", gl."ownerUserId" AS "ownerUserId"
FROM "shopping_lists" sl
JOIN "zone_memberships" m ON m."zoneId" = sl."zoneId"
JOIN "generated_lists" gl ON gl."ownerUserId" = m."userId"
WHERE sl.id = $1
  AND gl."status" = 'OPEN'
  AND (${WRITABLE_LIST})
  AND (
    gl."kind" = 'LIVE'
    OR EXISTS (
      SELECT 1 FROM "basket_sources" bs
      WHERE bs."basketId" = gl.id
        AND bs."zoneId" = sl."zoneId"
        AND (bs."listId" IS NULL OR bs."listId" = sl.id)
    )
  )
```

It is `listsOf` read from the other end, on purpose: the two share their three predicates
word for word, so a spec can prove that a basket is in `coveringBaskets(L)` exactly when `L`
is in `listsOf(basket)` and the basket is open. It ignores the claim window. A basket past
the window is finished by the sweep within one tick, and until then it still shows the line.

Nothing calls `coveringBaskets` in this plan. `0139` is its caller, and it is built here
because it is the other half of one rule and is tested against the same fixtures.

## 6. "Open" asked the same way everywhere

New file `core/src/app/baskets/open-basket.sql.ts`:

```ts
/**
 * A basket that claims lines and counts as a trip in progress: made on purpose, and open.
 * `gl` is the alias of "generated_lists". The permanent basket is never one of these.
 */
export const OPEN_GENERATED_BASKET = `gl."kind" = 'GENERATED' AND gl."status" = 'OPEN'`;

/** A basket that is a trip at all, open or over. */
export const GENERATED_BASKET = `gl."kind" = 'GENERATED'`;
```

| Query                                                                  | Today                                                                   | After                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| the sweep (`generated-list-sweep.service.ts:116-123`)                  | `status IN (live)`, `generatedAt < cutoff`                              | `kind: GENERATED`, `status: OPEN`, the same cutoff. It writes `FINISHED` (`:131`)                                           |
| `LINE_CLAIMS_SQL` (`line-claim.sql.ts:45-64`)                          | `gl.status::text = ANY($2::text[])`                                     | `${OPEN_GENERATED_BASKET}`. `$2` goes, `$3` becomes `$2`, and `readLineClaims` (`:130`) loses its `liveStatuses` argument   |
| `TRIPS_CTE` (`trips.sql.ts:192-222`)                                   | `live` is `status = ANY($3) AND generatedAt >= $4`                      | `live` is `${OPEN_GENERATED_BASKET} AND gl."generatedAt" >= $3`. The basket half joins only `${GENERATED_BASKET}` rows      |
| `basketRowsCte` (`trips.sql.ts:54-91`)                                 | joins `generated_list_lines` alone                                      | both halves join `"generated_lists" gl` and ask `${GENERATED_BASKET}`                                                       |
| `loose` (`trips.sql.ts:126-134`)                                       | `NOT EXISTS` a basket line with that id                                 | `NOT EXISTS` a basket line with that id **whose basket is `${GENERATED_BASKET}`**. A `LIVE` basket's purchases are loose    |
| `SUGGESTION_CANDIDATES_SQL` (`suggestions.sql.ts:32`, status at `:52`) | the status array                                                        | `${OPEN_GENERATED_BASKET}`                                                                                                  |
| `SUGGESTION_RECENT_TRIPS_SQL` (`:95`, `:106`)                          | `NOT (status = ANY($2))`                                                | `${GENERATED_BASKET} AND gl."status" <> 'OPEN'`                                                                             |
| `SUGGESTION_LAST_ASKED_SQL` (`:138`, `:153`)                           | the same                                                                | the same                                                                                                                    |
| `ORDER_HISTORY_SQL` (`generated-list.sql.ts:301-344`)                  | `status = ANY($2)` with `PAST_TRIP_STATUSES`                            | `${GENERATED_BASKET}` and the two ended statuses. `PAST_TRIP_STATUSES` (`generated-list-order.service.ts:17`) is `FINISHED`, `ARCHIVED` |
| `listMine` (`generated-list.service.ts:651-688`)                       | every basket of the owner                                               | `gl.kind = :generated`. The history lists baskets that were made, and the permanent one has its own door (`0136`)           |
| `dashboard.service.ts:118-131`                                         | `total`, `draft`, `completed`                                           | `total`, `open`, `finished` over `GENERATED` baskets, and a new `live` count. The contract at `admin-dashboard.messages.ts:160-161` follows |

**Every positional parameter that follows a removed one is renumbered**, in the SQL and in
the array its service builds: `trips.service.ts:109-126` (the `window` array and both
calls), `suggestions.service.ts:92` and its neighbours, `line-claim.service.ts` (`claimsOf`,
`claimOf`). The integration specs of plans `0052`, `0122`, `0123` and `0110` pass with their
fixtures' statuses renamed and nothing else changed, which is the proof that the rewrite
moved no rule.

`SHARED_BASKETS_SQL` (`generated-list-members.sql.ts:58-66`) keeps `gl."status" <>
'ARCHIVED'` and gains no kind predicate. A permanent basket shared with a named person
belongs in that person's "shared with me".

`GeneratedListSharingService.listAccepts` (`:980-985`) becomes `isOpenBasket(list.status)`.
The remaining call sites of `isLiveGeneratedList` are a rename and nothing more:
`generated-list.service.ts` (`update` `:796`, `:822`, `delete` `:859`),
`generated-list-line.service.ts:66`, `generated-list-basket.service.ts:201`,
`generated-list-settle.service.ts:101`, `generated-list-reopen.service.ts:116`,
`generated-list-outstanding.service.ts`, `generated-list-origin-settled.service.ts`,
`generated-list-origins.service.ts:481`, `generated-list-split.service.ts`,
`generated-list-line-rename.service.ts`, `line-claim.service.ts`, `trips.service.ts`,
`suggestions.service.ts`. Find the rest with
`grep -rn "isLiveGeneratedList\|LIVE_GENERATED_LIST_STATUSES\|GeneratedListStatus\." apps libs`.

`update` (`:794-844`) keeps its claim announcements. `wasLive` and `isLive` become "open
**and** `GENERATED`", so a `LIVE` basket never announces or releases a claim.

## 7. The overlap rule is deleted

Plan `0050` section 3 and plan `0092` section 3.2 are reversed, by `0130` section 10: "the
overlap rule and the `CLAIMED` refusal... Lost: nothing".

| Deleted                                                                                       | Where                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `dropOverlaps`, and its call in `create`                                                      | `generated-list.service.ts:392-441`, `:212-216`               |
| `LIVE_OVERLAP_SQL`, `LiveOverlapRow`                                                          | `generated-list.sql.ts:145-198`, `:380-384`                   |
| `skipped` on `GeneratedListRunResult`, `GeneratedListSkippedLineView`, their schemas          | `generated-list.messages.ts`, `generated-list.schemas.ts`     |
| `carriedElsewhere`, its two calls, the `CLAIMED` branch of `unavailability`                   | `generated-list-origins.service.ts:292`, `:330-372`, `:852`   |
| `OriginUnavailableReason.CLAIMED`                                                             | `generated-list.enums.ts:141`, the schema enum                |
| the sentence about skipped lines on `POST /v1/generated-lists`                                | `gateway/.../generated-list.controller.ts:75`                 |

`GeneratedListRunResult` stays as `{ list: GeneratedListView }`. `0136` replaces the run,
and a wrapper with one field is cheaper to leave for one plan than to unwrap twice.

**The claim is not deleted.** "Marta is buying this" on a zone line (plan `0052`) stays
exactly as it is, and a second basket taking a claimed line simply becomes the newest
claimant, which `LINE_CLAIMS_SQL`'s `DISTINCT ON` already decides (`line-claim.sql.ts:40-43`).
What goes is the **refusal**.

## 8. The migration

One file, `<next timestamp>-BasketKindStatusAndSources.ts`. Everything below runs in the one
transaction `migrate.ts` opens, and it is written so that it can.

Up, in this order:

1. `CREATE TYPE "basket_kind" AS ENUM ('LIVE', 'GENERATED')`. Add
   `"kind" "basket_kind" NOT NULL DEFAULT 'GENERATED'`, then `ALTER COLUMN "kind" DROP
   DEFAULT`. Every existing basket was made on purpose.
2. `CREATE TYPE "basket_status" AS ENUM ('OPEN', 'FINISHED', 'ARCHIVED')`. Drop the column
   default, then
   `ALTER COLUMN "status" TYPE "basket_status" USING (CASE "status"::text WHEN 'DRAFT' THEN
   'OPEN' WHEN 'ACTIVE' THEN 'OPEN' WHEN 'COMPLETED' THEN 'FINISHED' ELSE 'ARCHIVED'
   END)::"basket_status"`, set the default to `'OPEN'`, `DROP TYPE "generated_list_status"`.
   A new type, so nothing here uses a value added to an existing one.
3. Add `"pricingProfileId" uuid NULL`, filled from
   `NULLIF("sourceSnapshot"->>'pricingProfileId', '')::uuid`.
4. Create `basket_sources` with its foreign keys and five indexes.
5. Backfill it:

   ```sql
   INSERT INTO "basket_sources" ("basketId", "zoneId", "listId")
   SELECT DISTINCT gl.id, (s->>'zoneId')::uuid, (s->>'listId')::uuid
   FROM "generated_lists" gl
   CROSS JOIN LATERAL jsonb_array_elements(
     COALESCE(gl."sourceSnapshot"->'sources', '[]'::jsonb)
   ) s
   JOIN "zones" z ON z.id = (s->>'zoneId')::uuid
   JOIN "shopping_lists" sl ON sl.id = (s->>'listId')::uuid
   ```

   The two joins drop a source whose zone or list is gone, which the foreign keys
   refuse anyway. **Every backfilled row names a list.** The snapshot stored resolved lists
   (Context), so whether an old run asked for a whole zone is not recoverable, and an old
   basket does not start following lists added to its zones. State that in a comment.
6. `DROP COLUMN "sourceSnapshot"`.
7. The `LIVE` constraints of section 2: `uq_generated_lists_live_owner`,
   `ck_generated_lists_live_shape`.

Down, in reverse: drop the two constraints. **Delete every `LIVE` row**, because the earlier
schema has no way to say what one is, and its cascades take the participants and links with
it. Re-add `"sourceSnapshot" jsonb NOT NULL DEFAULT '{}'`, rebuilt as
`{ profileId: null, pricingProfileId, sources: [...] }` from `basket_sources`, with a whole
zone row expanded to the lists that zone holds at that moment. Drop `basket_sources` and
`"pricingProfileId"`. Rebuild `generated_list_status` with `OPEN` to `DRAFT`, `FINISHED` to
`COMPLETED`. Drop `"kind"` and `basket_kind`.

Lossy going down, stated in the file: `ACTIVE` does not come back (nothing read it),
`profileId` comes back null (section 4.4), a whole zone source comes back as today's lists
of that zone, and `LIVE` baskets are deleted.

The entity follows: `kind`, `status` with the new enum and `enumName: 'basket_status'`,
`pricingProfileId`, no `sourceSnapshot`. Its class comment is rewritten. The paragraph
"`sourceSnapshot` is not decoration" (`:31-33`) is replaced by one on `basket_sources`, and
"`ownerUserId` is the only user who may read it" (`:23-25`) gains the kind.

## 9. The client and the back office follow

The wire renames three status values, drops `sourceSnapshot`, `skipped` and `CLAIMED`, and
adds `kind`. Neither client imports contracts, so nothing fails to compile and everything
fails at run time. These files change, and nothing else in either project:

**velista**

| File                                                                                   | Change                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/velista/models/src/lib/enums.ts:241-296`                                         | `GENERATED_LIST_STATUSES` is `OPEN`, `FINISHED`, `ARCHIVED`, `UNKNOWN`. `LIVE_GENERATED_LIST_STATUSES` and `isLiveGeneratedList` become `isOpenBasket(status: string)`. `WritableGeneratedListStatus` is `'OPEN' \| 'FINISHED'`. A new `BASKET_KINDS` with an `UNKNOWN` fallback |
| `libs/velista/models/src/lib/enums.ts:338-342`                                         | `BASKET_ORIGIN_UNAVAILABLE_REASONS` loses `'CLAIMED'`                                                                                           |
| `libs/velista/models/src/lib/basket-view.ts:10`, `:713`, `:818-819`                    | imports follow. `sources` is `{ zoneId; listId: string \| null }[]`. `kind` on `BasketView`                                                     |
| `libs/velista/models/src/lib/generated-list-view.ts:99-107`                            | `GeneratedListSkippedLine` and `GeneratedListRun.skipped` are deleted. `kind` on the summary                                                    |
| `libs/velista/data-access/src/lib/mapping/mappers.ts:42`, `:1296-1331`                 | `toGeneratedListSkippedLine` is deleted. `kind` is mapped                                                                                       |
| `libs/velista/data-access/src/lib/mapping/basket-mappers.ts:687-705`                   | reads `raw['sources']`, with a nullable `listId`                                                                                                |
| `libs/velista/data-access/src/lib/generated-lists/generated-list-store.ts:9`, `:146`   | `isOpenBasket`                                                                                                                                  |
| `generated-list-memory.ts:103`, `basket-memory.ts:379`, `:507`, `testing/store-doubles.ts:32`, `:1549`, `:2200` | the fixtures write the new values, and the `CLAIMED` branch of the memory gateway goes                                 |
| `libs/velista/feature-shopping-lists/src/lib/basket-page/basket-page.ts:783`           | `setStatus(this._id, 'OPEN')`                                                                                                                   |
| `.../finish-sheet/finish-sheet.ts:115`                                                 | `'FINISHED'`                                                                                                                                    |
| `.../shopping-lists-page/shopping-lists-page.ts:26`, `:434-439`                        | `isOpenBasket`, and `finished` is `status === 'FINISHED'`                                                                                       |
| `.../line-lists-summary/line-lists-summary.ts:168`                                     | the `CLAIMED` reason and its copy key go, from both `libs/velista/ui/assets/i18n/*.json`                                                        |
| `apps/velista-luna-e2e/src/support/api.ts:203-231`                                     | the status union, and `finishOpenBaskets` tests `'OPEN'` and writes `'FINISHED'`. Its comment no longer cites the overlap rule. It stays, because an open basket still claims lines |

`select-home-state.ts:165` and `zone-guards.ts:113` test a **zone's** `'ACTIVE'` and are not
touched. Angular changes follow the `nx-portfolio-angular-developer` skill. No screen
changes what it draws.

**The back office**

| File                                                                          | Change                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `libs/luna-shopper-admin/feature-people/src/lib/baskets.ts:13-20`             | `BASKET_STATUS_OPTIONS` has three values, and a `kind` column        |
| `.../feature-people/src/lib/people-seed.ts:278`, `:303`, `basket-detail-page.ts` | the seed and the page follow                                      |
| `.../feature-people/src/lib/people-dashboard-view.ts:134-135`                 | `open`, `finished`, `live`                                           |
| `.../data-access/src/lib/dashboard/dashboard-seed.ts:158`                     | the seeded statuses                                                  |
| the `people.baskets.status.*` keys of the admin i18n files                    | three keys, and `people.baskets.kind.*`                              |

`wire-types.ts` is regenerated, never edited.

## 10. Not in this plan

- A `LIVE` row being created, read or served: `0136`.
- Basket lines, origins, options and the run's composition: `0136`.
- `line_settlements.basketId`: `0134`. Until then a `LIVE` basket's purchases are told apart
  from a trip's by the join in section 6.
- `basket_trip_rows`: `0135`.
- Editing a basket's sources after it was made. Nothing asks for it.
- The fan out that calls `coveringBaskets`: `0139`.
- Renaming `generated_lists` and `GeneratedListStatus`: `0144`.

## 11. Tests

Unit:

1. `isOpenBasket` over the three values.
2. `update` refuses a name and a status on a `LIVE` basket, and `delete` refuses one.
3. `create` records what was named: a whole zone request writes one null `listId` row, a
   list request one list row, `ALL` one whole zone row per writable zone, a source that
   narrows to nothing writes none, and a whole zone beside one of its lists writes the zone
   row alone.
4. `create` no longer skips a line another open basket of the same owner carries, and its
   result has no `skipped`.
5. The origins sheet offers a line another basket carries, and an adoption of it succeeds.
6. The sweep finishes an old open `GENERATED` basket to `FINISHED` and leaves a `LIVE`
   fixture of the same age alone.
7. `update` on a `LIVE` fixture announces no claim in either direction.

Integration, real database, through the integration target:

8. **The migration**: a database holding one basket in each of the four old statuses, one
   with a pre `0078` snapshot, one naming a deleted list, migrates up to the mapped
   statuses, the right `pricingProfileId`, and source rows for the surviving lists alone.
   Down and up again keeps them.
9. `uq_generated_lists_live_owner` refuses a second `LIVE` row for one owner, and
   `ck_generated_lists_live_shape` refuses a named one and a finished one.
10. `listsOf`: a `LIVE` fixture covers every writable list of its owner across two zones and
    no list the owner only reads. A `GENERATED` basket with a whole zone row covers a list
    created in that zone afterwards. One with a list row does not.
11. `listsOf` drops a list the moment its owner loses `WRITE`, with no write to the basket.
12. `coveringBaskets(L)` holds a basket exactly when `L` is in `listsOf(basket)` and the
    basket is open, across every fixture of tests 10 and 11, a finished basket and an
    archived one.
13. A deleted list or zone takes its source rows with it.
14. The claim, the trips, the three suggestion reads and the order history ignore a `LIVE`
    fixture that carries the same lines, and a purchase made through it is a loose
    purchase. The existing integration specs of plans `0052`, `0110`, `0122` and `0123`
    pass with only their fixture statuses renamed.

Client and back office:

15. The velista mappers read the new status values, `kind`, and `sources` with a null
    `listId`, and an unknown value of either enum falls back to `UNKNOWN`.
16. `wire-types.spec.ts` and `openapi-document.spec.ts` are green.

## 12. Acceptance criteria

- [ ] A basket says whether it is `LIVE` or `GENERATED`, and the database allows one `LIVE`
      basket a person, unnamed and never finished.
- [ ] The status is `OPEN`, `FINISHED` or `ARCHIVED` everywhere: core, contracts, velista,
      the back office and the e2e helper. `ACTIVE`, `DRAFT`, `COMPLETED`,
      `isLiveGeneratedList` and `LIVE_GENERATED_LIST_STATUSES` appear nowhere outside a
      migration.
- [ ] `sourceSnapshot` is gone. A basket's sources are rows, a whole zone is one row, and
      `coveringBaskets` answers which open baskets cover a list in one query.
- [ ] The sweep, the claim, the trips, the suggestions, the walk order and the history ask
      for a `GENERATED` basket through one shared fragment.
- [ ] A run refuses no line for being in another basket, and the zone line's claim still
      works.
- [ ] No basket line, origin, settlement or route path changed.
- [ ] `openapi.json` and the wire types are current.

## 13. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-realtime luna-shopper/contracts luna-shopper-admin/models
npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists velista/ui
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
grep -rn "isLiveGeneratedList\|LIVE_GENERATED_LIST_STATUSES\|sourceSnapshot\|'COMPLETED'\|'DRAFT'" apps libs --include=*.ts | grep -v "/migrations/\|harvest\|run"
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Confirm every project name with `npx nx show projects` first, the back office's included,
because `run-many` drops a name it does not know. Only `nx build` type checks (memory note
on Nx workspace traps), so build core, the gateway and velista once. Run the integration
specs through their own target against a slot, run the migration up, down and up on that
slot's core database, boot core and the gateway on it, then give the slot back.
