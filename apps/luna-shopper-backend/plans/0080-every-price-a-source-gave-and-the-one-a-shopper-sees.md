# 0080 Every price a source gave, and the one a shopper sees

`SupermarketItem` holds one price per product per scope. One source wins by overwriting. There
is no history. A price a person typed in is pinned against every automated fetch forever (plan
`0038`, section 6.5). Backlog `0001` sections 2.3 to 2.6 designed the model that replaces
that. This plan builds it, rewritten for what the code and the owner learned since.

**It absorbs backlog `0001` sections 2.3, 2.4, 2.5 and 2.6.** Backlog `0001` stays in
`plans/backlog/`. That follows the precedent plan `0038` set when it cherry picked the ingest
half. Section 14 lists what this plan takes from those four sections unchanged, what it changes,
and what it deletes rather than migrates.

**Nothing here reads a leaflet.** The kind `OFFICIAL_LEAFLET`, a validity window on a price row
and a policy row for that kind all exist in this plan. A price model that cannot hold a dated
price is not one. The import that writes such a row is a later plan and is not named here.

Depends on `0078` for nothing, and `0079` for nothing. It ships after both because the owner
wants the basket priced first. Backlog `0004` and backlog `0008` depend on this.

## 1. Three decisions that shape everything else

**One dated table holds every price, and a run that repeats a price writes no row.** Backlog
`0001` kept a current row per kind in `ItemPrice`. It rolled superseded values into a second
table, `PriceObservation`. Once a price stops overwriting there is no superseding to record, so
the second table has no job. An `ItemPrice` row is an interval: `observedAt` is the first time a
source said this number, `lastObservedAt` the last. A run that sees the same number bumps the
second timestamp. So row volume follows price changes, not runs. Section 2 has the arithmetic.

**Which price is shown is a pure function of stored rows and the clock.** Nothing is decided at
write time and remembered. The owner's override rule caused the oscillation in the brief. Here
it is stored as a fact on the `ADMIN` row and re evaluated on every read. Undo, replay and
reimport then need no side table of what a run changed, because a run changes only its own rows.
Section 4 is the rule.

**The answer is materialized on `SupermarketItem`, with the next moment it changes beside it.**
Search sorts by price at scale. It cannot resolve six rows per product per query. The existing
columns keep their names and their meaning as "the price a shopper sees". Search, the scoped
catalog and basket pricing keep working. A sweep recomputes the rows whose next boundary is in
the past, and it is safe on two replicas. Section 7.

## 2. `item_prices`

One row per number a source gave, per product, per scope, per kind.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | From `BaseEntity`. |
| `itemId` | uuid | FK `items`, cascade. |
| `priceScopeId` | uuid | FK `price_scopes`, cascade. |
| `sourceKind` | `price_source_kind` | The enum from plan `0038` section 5.3, unchanged. |
| `price` | numeric(12,2) null | What the till charges for one pack. |
| `currency` | varchar(3) null | |
| `unitPrice` | numeric(12,4) null | The source's own figure, verbatim, never recomputed. |
| `unitPriceLabel` | varchar null | Text, never a unit (plan `0038` section 2.4). |
| `observedAt` | timestamptz | The first time this source stated this number. |
| `lastObservedAt` | timestamptz | The last time it stated it. Equal to `observedAt` on insert. |
| `validFrom` | timestamptz null | The row applies from here. Null means from `observedAt`. |
| `validUntil` | timestamptz null | Exclusive. Null means until superseded. |
| `sourceRunId` | uuid null | The harvest run that wrote it. Opaque, never joined. |
| `lastObservedRunId` | uuid null | The run that last moved `lastObservedAt`. Equal to `sourceRunId` on insert. Plan `0082` reads it. |
| `overrides` | jsonb null | `ADMIN` rows only, section 4.2. |
| `protectedUntil` | timestamptz null | `ADMIN` rows only, section 4.2. |

**`sourceRunId` is on every row from the first migration.** The undo plan deletes by it. A column
added later starts empty. No query can attribute the rows written before it to a run. So the one
thing undo needs is the one thing a backfill cannot produce. `lastObservedRunId` is there for the
same reason: a run that only confirmed a row still touched it, and plan `0082` withdraws that
confirmation when the run is reverted.

**`available` is not on this table.** It stays on `supermarket_items` as the scope wide fact plan
`0038` section 5.2 made it: whether the scope carries the product at all. A 404 from a detail
call sets it and states no price. A price row that also carried an availability claim invites
the question of what a leaflet row says about stock, and the answer is nothing. Availability
gets its own write, `supermarketItem.setAvailability`, section 9.

### 2.1 Insert on change

A write of (item, scope, kind, price, currency, unitPrice, unitPriceLabel, validFrom, validUntil)
reads the current row of that (item, scope, kind). Equal on every value: `lastObservedAt` moves
forward and nothing else happens. Different, or no current row: a new row is inserted with
`observedAt = lastObservedAt = now`. The old row is left exactly as it was.

Backlog `0001` section 2.5 stated this rule for `PriceObservation`. Here it is the rule of the
one table, and it is what makes a daily run cheap. Plan `0038` section 5.7 measured
`price_decreased` and `previous_unit_price` as empty across all 4,232 Mercadona products on the
day it looked. That is a chain whose prices move rarely. At one product in twenty changing a
month, a daily refresh of the full assortment writes about 2,500 rows a year. At one in twenty
a day it writes 77,000. Both are small. A row per observation is 1.5 million a year for the same
assortment, for nothing anybody reads.

A `USER_RECEIPT` row from the reference seed carries the receipt date as `observedAt`. A rerun
of the seed finds the same value and moves `lastObservedAt` nowhere, because the date it offers
is not later. The seed is idempotent for free.

### 2.2 The current row is one index away

```sql
CREATE INDEX ix_item_prices_current
  ON item_prices ("itemId", "priceScopeId", "sourceKind", "observedAt" DESC);
```

The current row per kind is `DISTINCT ON ("itemId", "priceScopeId", "sourceKind") ... ORDER BY
"itemId", "priceScopeId", "sourceKind", "observedAt" DESC`. Resolution reads at most six rows
per key, one per kind, and a NATIONAL key beside them (section 6). A second index on
`("sourceRunId")` serves undo. A third on `("itemId", "priceScopeId", "observedAt" DESC)` serves
the history list.

**Nothing on this table is unique except `id`.** Two rows of one kind for one key with different
`observedAt` are the history. A source that changes its mind twice in a day writes two rows, and
that is a fact worth keeping.

## 3. `price_policies`

One row per `sourceKind`, seeded by the migration, owner editable.

| Kind | `priority` | `maxAgeDays` | Extra |
| --- | --- | --- | --- |
| `OFFICIAL_LEAFLET` | 10 | null | Eligible only inside `validFrom` to `validUntil`. |
| `OFFICIAL_API` | 20 | 7 | |
| `OFFICIAL_WEB` | 30 | 7 | |
| `ADMIN` | 40 | null | Section 4.2 lifts it above everything while it is protected. |
| `USER_RECEIPT` | 50 | null | Section 12 says why null. |
| `USER_REPORTED` | 60 | null | `enabled: false` until backlog `0008` writes it. |

Lower wins. **A leaflet outranks a crawl**, which reverses backlog `0001` section 2.4. That
section put the leaflet below live sources because OCR misreads decimal points. The owner decided
the reversal, and the reasoning belongs to the plan that imports leaflets. What this plan states
is the consequence for the model: a leaflet row is eligible only inside its window, so an expired
leaflet fails on its own and the crawl wins with no special case.

**`ADMIN` has no `maxAgeDays`.** The brief modelled "seven days" as a max age of seven on this
row. Backlog `0001` section 5.4 says most supermarkets will never have an automated source. For
every one of those, the owner's price is the only truth, and a max age makes it stale a week after
it was typed. Seven days is the length of a protection window against a repeated automated value,
and it lives on the row that is protected, not in the policy.

The table is `price_policies` with `sourceKind` unique, `priority`, `maxAgeDays`, `enabled`.
Backlog `0001`'s `minSubmissions` is not built (section 14). NATS subjects `pricePolicy.list` and
`pricePolicy.update`, platform admin gated. A policy change recomputes every materialized row,
which is a full pass of `supermarket_items` and is rare enough to be a synchronous loop behind
the update.

## 4. Which price a shopper sees

For one (item, scope), take the current row per kind, plus the current rows at the chain's
NATIONAL scope (section 6). Then:

1. **Filter to eligible rows.** Its policy is enabled. `now` is inside `[validFrom, validUntil)`
   where either is set. Its age, `now - lastObservedAt`, is within `maxAgeDays` where set. An
   `ADMIN` row passes the protection test of section 4.2 or is past it.
2. **Take the highest priority.** An `ADMIN` row inside its protection window and still
   undisputed ranks above every priority in the table. Otherwise the policy's `priority` orders
   the kinds.
3. **Break ties by the most recent `lastObservedAt`.** Two rows of one kind for one key at two
   scopes are the inheritance case. There the narrower scope wins before recency is asked.
4. **Nothing eligible: the stale tier**, section 5.

That is backlog `0001` section 2.4's "filter first, then priority, then recency" with two
additions, the protection test and the stale tier.

### 4.1 The rule the owner set, and the defect it had

The owner's rule, in his words:

> Prices from a harvester run will be shown to users only IF: it is the newest price AND (the
> price has changed since the last run OR 7 days have passed after an admin, user or ticket price
> was set OR the leaflet price has expired).

The intent is right. A crawl that repeats what it already said carries no information and must
not displace a number a person just typed. The defect is that "changed since the last run" is a
property of an event, and a price computed from an event flips as the events go by:

| Day | Crawl observes | Changed since last run | Shown |
| --- | --- | --- | --- |
| 4 | 1.19 | | 1.19 |
| 5 | admin types 1.29 | | 1.29 |
| 6 | 1.35 | yes | 1.35 |
| 7 | 1.35 | no | 1.29 again, with nothing having changed |
| 12 | 1.35 | no, but 7 days passed | 1.35 again |

The first proposed fix judged "new information" once, at write time, and closed the `ADMIN` row by
setting its `validUntil`. That is rejected here for three reasons. An automated write reaching
into another kind's row is a side effect undo has to know about. Undo is a hard delete of a run's
own rows, by the owner's decision, and knows nothing else. `validUntil` on an `ADMIN` row is the
owner's field, for a price known to be temporary. A crawl rewriting it loses what the owner
meant. And a write time judgement needs the source's previous value at write time, which is a
history lookup inside a 4,232 row batch.

### 4.2 The override snapshot

When an `ADMIN` row is inserted, the service records on it what it is overriding:

- `overrides`: one entry per automated kind (`OFFICIAL_API`, `OFFICIAL_WEB`, `OFFICIAL_LEAFLET`)
  that has a current row for this key at that instant. Each entry maps the kind to that row's
  `price` and `unitPrice`. An empty object records that there was none.
- `protectedUntil`: `observedAt + 7 days`.

**The protection test.** While `now < protectedUntil`, the `ADMIN` row is eligible and ranks
first on one condition: every automated kind with a current row is in `overrides`, with the same
`price` and `unitPrice`. A kind with a current row and no entry disagrees the moment it appears.
A kind whose current row differs from its entry disagrees. A kind in `overrides` with no current
row any more is ignored. After `protectedUntil` the row competes at priority 40 like any other.

The read is pure. It compares stored rows to a stored snapshot and the clock. Walk the table:

| Day | Crawl observes | `overrides` | Undisputed | Shown |
| --- | --- | --- | --- | --- |
| 4 | 1.19 | | | 1.19 |
| 5 | admin types 1.29 | `{ OFFICIAL_API: 1.19 }` | yes | 1.29 |
| 6 | 1.35 | | no, 1.35 is not 1.19 | 1.35 |
| 7 | 1.35 | | no | 1.35 |
| 12 | 1.35 | | protection over, priority 40 | 1.35 |

Day 7 does not flip back, because the comparison is against the snapshot and not against the
previous run. Day 12 changes nothing visible, because the crawl already won on day 6.

**Day 8, where the crawl returns to its old value.** Say day 8 observes 1.19 again. The current
`OFFICIAL_API` row is 1.19, equal to the entry, so the `ADMIN` row is undisputed again and 1.29
is shown until day 12. That is the right answer. The owner typed 1.29 while the chain said 1.19,
and the chain is saying 1.19 again. A crawl that repeats the value the owner overrode carries
exactly the information the owner already had. That is the owner's own sentence about repeated
values. The seven days then run out and the crawl takes over on ordinary terms.

**The case the single kind snapshot got wrong.** An earlier draft stored one kind. The owner's
Lidl case breaks it: the owner overrides a web crawl on Monday, and a leaflet arrives on
Wednesday. With one kind recorded, the leaflet is a different kind, the condition stays true, and
the leaflet waits out the week. With an entry per kind and "no entry means disagreement", the
leaflet has no entry, disagrees at once, and is shown on Wednesday. A source reporting for the
first time is new information by construction.

**What the snapshot also buys.** Backlog `0001` section 2.4 wanted the back office to say "your
manual 1.29 is overriding an official 1.19 observed today". The row says what it overrode, so the
admin price screen (section 10) draws that line from the row with no extra read.

## 5. Nothing eligible: stale, not absent

Backlog `0001` filtered ineligible rows out and stopped. Under that rule a product whose only
price is an `OFFICIAL_API` row from three weeks ago, in a chain whose crawl stopped, shows no
price at all. Plan `0069` decided the catalog is always readable, and most chains will never have
an automated source at all. A number with a date on it beats a blank.

**When step 1 leaves nothing, the effective price is the newest row of any kind by
`lastObservedAt`, flagged `stale: true`.** Disabled kinds are excluded. An expired leaflet is
included: with nothing else to show, the last price anybody printed is the honest answer, and the
flag says it is old.

**The flag travels.** `ItemOfferView` and `SupermarketItemView` gain `stale: boolean`. Velista
infers staleness today in `libs/velista/feature-shopping-lists/src/lib/settle-sheet/settle-sheet.ts`,
lines 459 to 467, from `offer.sourceKind === 'ADMIN'` and the oldest `offer.observedAt` across a
line's options. That inference cannot know the policy and will disagree with the server on the
first product whose kind has no max age. `ProductOffer` in `libs/velista/models/src/lib/domain.ts`
(lines 393 to 410) gains `stale`. `toProductOffer` in
`libs/velista/data-access/src/lib/mapping/mappers.ts` (lines 495 to 520) reads it. The settle
sheet's banner reads the flag instead of the date. The date still travels for display.

## 6. A national price reaches every scope of its chain

This is the finding that matters most in the set. The owner says most leaflets are nationwide,
and `PriceScopeKind.NATIONAL` exists for exactly that. But
`apps/luna-shopper-backend/catalog/src/app/catalog/scope-resolver.service.ts` climbs to a chain's
NATIONAL scope **only for chains rung one did not answer**. The doc says so at lines 44 to 46 and
the code does so at lines 213 to 250. A shopper with a Mercadona warehouse near them resolves
`4661` and never NATIONAL. A price written to NATIONAL is read by nobody who has that chain nearby, which is
everybody the price is for.

**The fix is in the effective price computation, not in the resolver.** Take (item, S) where S is
not NATIONAL. Step 1 of section 4 takes the current rows at S **and** the current rows at the
NATIONAL scope of S's chain. Two rows of one kind, one at each: the narrower scope wins. A
regional leaflet at a warehouse scope beats the national one for that kind, in that warehouse.
The national one still stands everywhere else.

Why not add NATIONAL to what the resolver answers. `offersFor` in `item.service.ts`, lines 561 to
590, picks one row per item across the caller's scopes by `price ASC`. Say `4661` and NATIONAL
are both resolved. A NATIONAL leaflet at 1.49 then loses to a crawl at 1.35 in `4661` on price
alone, while the policy says the leaflet outranks the crawl. The materialized row for `4661` is
computed from `4661`'s rows and never sees the national one. The policy has to see both rows for
one key, and the only place that sees both is the computation. Handling it there also keeps rung
two of the resolver exactly as it is. That rung already answers NATIONAL for a chain with no shop
nearby.

**What it costs.** A write at a NATIONAL scope recomputes (item, NATIONAL) and (item, S) for every
scope S of that chain. It creates a `supermarket_items` row for any S that has none. A chain with
one warehouse scope fans out to two rows. A chain with three hundred `STORE` scopes and two
hundred nationally priced products carries sixty thousand rows, which is a small table. Creating
a scope for a chain recomputes every item that has a NATIONAL row there, so a scope made later
inherits on arrival.

## 7. The materialized row and the sweep

`supermarket_items` keeps every column it has, with its meaning sharpened to "the effective
price": `price`, `currency`, `unitPrice`, `unitPriceLabel`, `priceObservedAt` (the effective
row's `lastObservedAt`), `priceSourceKind`, `available`. It gains:

| Column | Notes |
| --- | --- |
| `itemPriceId` | uuid null. The row section 4 chose. Null when there is no row at all. |
| `stale` | boolean, default false. Section 5. |
| `validUntil` | timestamptz null. The effective row's, so a client can say "until Sunday". |
| `nextBoundaryAt` | timestamptz null. The earliest instant at which the answer changes with no write. |

Search (`item.service.ts` lines 365 to 374 and 645 to 654), `offersFor`, `getMany` and the basket
read all read the columns that keep their names, and none of them changes. `si."available"`
stays the filter it is.

**`recompute(itemId, priceScopeId)`** runs section 4 and writes the row. It runs inside the
transaction of the write that made it necessary. Four writes do. An `item_prices` insert or
delete, for that key. A NATIONAL write, for every scope of the chain. A policy update, for every
row. A scope creation, for every nationally priced item of that chain.

**`nextBoundaryAt`** is the minimum, over the rows the computation looked at, of four instants: a
`validFrom` still in the future, a `validUntil` not yet reached, an `ADMIN` row's
`protectedUntil`, and `lastObservedAt + maxAgeDays` for a kind with a max age. The brief counted
three kinds of boundary. The fourth, max age, is the one backlog `0001` section 2.4's sweep
already needed. A plan that forgets it shows a seven day old crawl price as eligible forever.

**The sweep.** Catalog has no scheduler, and neither has any service in this backend. The
harvester's `postal-code-discovery.worker.ts` (lines 66 to 82) is the precedent: `setInterval`
from `onModuleInit`, `unref` so a tick never holds the process open, cleared on destroy. An
`EffectivePriceSweep` in catalog does the same every sixty seconds:

```sql
SELECT "id", "itemId", "priceScopeId"
FROM supermarket_items
WHERE "nextBoundaryAt" <= now()
ORDER BY "nextBoundaryAt"
LIMIT 500
FOR UPDATE SKIP LOCKED;
```

inside one transaction, then `recompute` for each and commit. Catalog runs **two replicas**
(`k8s/helm/values.yaml`, line 229). `SKIP LOCKED` gives each replica different rows, and
`recompute` is idempotent, so the worst case of two sweeps meeting is wasted work and never a
wrong answer. A partial index carries it:

```sql
CREATE INDEX ix_supermarket_items_next_boundary
  ON supermarket_items ("nextBoundaryAt")
  WHERE "nextBoundaryAt" IS NOT NULL;
```

A row with no boundary is never scanned, and most rows have none.

## 8. The migration

`1756700000000-ItemPrices.ts`, append only on the chain in
`apps/luna-shopper-backend/catalog/src/app/db/migrations/`, in one transaction:

1. Create `item_prices` and its three indexes.
2. Create `price_policies` and insert the six rows of section 3.
3. Add `itemPriceId`, `stale`, `validUntil`, `nextBoundaryAt` to `supermarket_items`, and the
   partial index.
4. For every `supermarket_items` row with `price` or `unitPrice` not null, insert one
   `item_prices` row: the seven value columns copied, `sourceKind` from `priceSourceKind`,
   `observedAt` and `lastObservedAt` from `priceObservedAt` where set and from `createdAt`
   otherwise, `sourceRunId` null, no window. An `ADMIN` row gets `overrides: {}` and
   `protectedUntil` null: nothing typed before this plan was typed against a snapshot, and
   inventing one is inventing history.
5. Set `itemPriceId` on each source row to the row it produced, and `nextBoundaryAt` to
   `lastObservedAt + 7 days` for `OFFICIAL_API` and `OFFICIAL_WEB` rows, null otherwise.

Every pre existing row resolves to the same price after the migration as before it. It is the
only row for its key and its kind is enabled. The migration test follows the pattern of
`db/price-scope-migration.integration.spec.ts`. It seeds the pre migration shape, runs the
migration, and asserts exactly that for every row. It also asserts that an `OFFICIAL_API` row
eight days old is marked stale by the first sweep and not before.

## 9. The writers that change

**Contracts.** `SUPERMARKET_ITEM_PATTERNS.upsert`, `upsertBatch` and `delete` go, with
`UpsertSupermarketItemRequest`, `SupermarketItemBatchEntry`, `UpsertSupermarketItemBatchRequest`,
`UpsertSupermarketItemBatchResult` and `SupermarketItemPriceDisagreement`
(`catalog.messages.ts` lines 887 to 948, `catalog.schemas.ts` lines 677 to 721). In their place:

- `itemPrice.add`: one row, `{ itemId, priceScopeId, sourceKind, price, currency, unitPrice,
  unitPriceLabel, observedAt?, validFrom?, validUntil?, sourceRunId? }`. An `ADMIN` add computes
  the snapshot server side and refuses a caller supplied one.
- `itemPrice.addBatch`: `{ priceScopeId, sourceKind, sourceRunId, entries }`, answering
  `{ inserted, confirmed }`. Inserted is a new row, confirmed is a bumped `lastObservedAt`. The
  run counters `updated` and `unchanged` map onto them.
- `itemPrice.list`: the history for one (item, scope), newest first, paged.
- `itemPrice.delete`: one row by id, platform admin, recompute follows. Plan `0077` lets the
  operator change a row, and a typed price with a typo is a row the operator removes.
- `supermarketItem.setAvailability`: `{ priceScopeId, entries: { itemId, available }[] }`.

`SUPERMARKET_ITEM_PATTERNS.get`, `listByItem`, `listByLocation`, `listByScope` and `adminList`
stay as reads of the materialized row, with the view reshaped in section 11.

**`decidePriceWrite` is deleted, not migrated.** That is `supermarket-item.service.ts` lines 420
to 431 and its two call sites at lines 102 to 118 and 189 to 195. The `skipped` accumulation and
the `ConflictException` for "a price entered by the owner already exists" go with it. Plan `0038`
section 10 anticipated exactly this deletion. An automated row and an `ADMIN` row now coexist,
and section 4 decides between them on every read.

**The harvester.** `refresh.runner.ts` lines 102 to 147 build `SupermarketItemBatchEntry` rows
and a list of unavailable items. It builds `itemPrice.addBatch` entries with
`sourceRunId: context.runId` and calls `supermarketItem.setAvailability` for the 404s. The
disagreement log at lines 178 to 184 goes with the field it reads. `catalog-client.service.ts`
lines 194 to 207, `upsertPrices`, becomes `addPrices` and gains the run id. A `CATALOG_DISCOVERY`
run that writes prices for a scope does the same.

**The reference seed.** `seed-reference-catalog.ts` lines 337 to 369 read the existing rows and
keep the `ADMIN` ones aside (lines 338 to 345). Then they upsert the rest with deterministic ids.
It becomes one `itemPrice.addBatch` per store scope with `sourceKind: USER_RECEIPT`, `observedAt`
the receipt date, and no run id. The `ADMIN` filter and `report.preserved` are deleted. An
owner's row is not in the seed's way any more. It outranks the seed's row whenever the policy says
so. Plan `0067` section 7's sentence "it refuses to overwrite a price whose source is `ADMIN`" is
retired with it.

**Audit.** Every `item_prices` insert and delete goes through `CatalogAuditService.write` with
`recordCreate` and `recordDelete`, as `upsertBatch` does today (lines 212 to 233). A confirmation
records nothing, which is plan `0075` section 4's first mitigation applied to the new shape. The
materialized row is derived and its changes are not audited separately.

## 10. The admin price screen

The moment `item_prices` lands, the back office's price path writes to a shape that no longer
exists. `libs/luna-shopper-admin/feature-catalog/src/lib/prices.ts` binds
`Wire.CatalogSupermarketItemView` directly (fields at lines 78 to 161). `PriceFormPage` creates
and edits one row through `admin/catalog/supermarket-items` (`catalog-admin.controller.ts` line
476, version 2). `REVERT_TO_HARVESTED` (lines 16 and 220 to 225) clears a typed price so a run
writes again. All three describe a world with one row per key.

**The screen becomes two.** Neither is a plain descriptor, and admin plan `0005` section 4
already said prices were not one.

- **Effective prices**, the listing. Read only rows of `supermarket_items`: product, scope,
  price, unit price, `sourceKind`, `observedAt`, `stale`, `validUntil`. Filters by scope, by
  kind and by `stale`. "What have I overridden" is the `ADMIN` filter, as today. A row opens the
  second screen.
- **A price and its history**, for one (item, scope). The effective row at the top. Below it the
  `itemPrice.list` rows, newest first, each with kind, value, `observedAt`, `lastObservedAt`,
  window and run id. An **add a price** form, which is `PriceFormPage` with its scope notice
  kept and its verb changed: it inserts an `ADMIN` row and never edits one. Beside an `ADMIN`
  row inside its protection window, the line backlog `0001` asked for, drawn from `overrides`:
  "overriding an official 1.19 observed on Tuesday". A **remove** action on any row, which is
  `itemPrice.delete` with a confirmation, replacing `REVERT_TO_HARVESTED`.

**Editing a price is inserting a price.** An operator who typed 1.29 and meant 1.92 removes the
row and adds another. The history shows both, which is the point of a history. The generic
form's edit path is not offered for `item_prices`.

**Price policies** get one generic descriptor over `pricePolicy.list` and `pricePolicy.update`,
edit only, six rows, with `priority`, `maxAgeDays` and `enabled`. It is the smallest screen in
the back office and it needs no design.

Both screens are in this plan's exit criteria. `wire-types.ts` is regenerated and the descriptor
specs in `catalog-descriptors.spec.ts` and `catalog-screens.spec.ts` follow.

## 11. The wire, the rename and the version floor

The meaning of `SupermarketItemView` changes from "the price" to "the price chosen among several",
and a client that reads it as before misreads a stale number as fresh. The owner accepted
renaming public fields on one condition: an old build cannot silently keep working.

**`SupermarketItemView`** (`catalog.messages.ts` lines 466 to 495) keeps `id`, `itemId`,
`priceScopeId`, `price`, `currency`, `unitPrice`, `unitPriceLabel`, `available`. `priceObservedAt`
becomes `observedAt`, `priceSourceKind` becomes `sourceKind`, and `stale`, `validUntil` and
`itemPriceId` are added. **`ItemOfferView`** (lines 386 to 397) takes the same two renames and
`stale`. Those are the names velista already uses on its own side of the mapper. `mappers.ts`
lines 512 to 518 rename both today. The wire and the domain stop disagreeing.

**The supermarket items controllers take a version bump**, from v2 to v3. That is
`catalog/supermarket-items` and `admin/catalog/supermarket-items`, per plan `0004`'s per
controller versioning and the precedent plan `0038` section 5.8 set for the same view. Search,
offers and the basket read embed `ItemOfferView` and stay additive on their own routes. An old
client ignores `stale` and reads two renamed fields as absent, which is a missing price and never
a wrong one. `openapi.json` and `wire-types.ts` are regenerated.

**The floor.** `MIN_CLIENT_VERSION` is off in both clusters (`values.yaml` line 334). This plan
sets `lunaShopperBackend.gateway.minClientVersion` in `values.production.yaml` to the release
that ships it. A velista build from before it is answered `client_too_old` and reloads. Two
limits, stated because they are real. Staging builds identify themselves as `staging`, which is
not a version, so the floor retires nothing there (`values.yaml` lines 330 to 333). Staging
deploys every remote from the same push, and that is the protection it has. And the guard serves
a request with no version header at all (`min-client-version.guard.ts` lines 80 to 86).

**The admin app sends no version header**, so the guarantee today covers velista only. It gains
one. A second interceptor beside `adminAuthInterceptor` in
`apps/luna-shopper-admin/src/app/app-providers.ts` (line 64) sets `CLIENT_VERSION_HEADER` from
`@portfolio/luna-shopper/platform`. The value is an `APP_VERSION` provided the way velista
provides its own: `apps/velista/src/app/app-providers.ts` line 123, substituted at build time in
`webpack.prod.config.ts` lines 92 to 93. The admin then reads the floor like velista does.

## 12. What staging looks like the day this ships

Plan `0067`'s reference seed is on in staging and off in production, changed by commit
`ece89552` today. It writes every price as `USER_RECEIPT` with the receipt's date, and the
receipts are from August 2026. Backlog `0001` gave that kind a max age of fourteen days. Under
that number, every price in staging is stale on the day this plan deploys, and the whole
catalog wears the badge.

**Decision: `USER_RECEIPT` and `USER_REPORTED` carry no max age until backlog `0008` adds
their writers.** The fourteen and seven days were designed to age out crowd noise. There is no
crowd. The only writer of `USER_RECEIPT` is a curated seed, checked against the receipts' own
totals. A number that guards against nothing is a number that only does harm. Backlog `0008`
sets the max age in the same change that opens the kind to the public. Its section 3.1 already
names this plan as what it waits for.

So staging shows a priced catalog with observation dates in August, visible on every offer.
Nothing is marked stale until a harvest runs there and its rows age. The stale tier is exercised
by the unit tests of section 15 and by the migration test, not by staging's seed.

## 13. Two corrections to `CLAUDE.md`

Both belong to this plan because both sentences stop being true when it ships.

**The harvester's state.** `CLAUDE.md` says the harvester is "switched off in production and in
staging". It is not. `values.staging.yaml` sets `enabled: true`, `harvestEnabled: true`,
`mercadonaEnabled: false`, per k8s plan `0008`. `values.production.yaml` sets `enabled: true`
since `ece89552` with no `harvestEnabled`, so the pod runs and refuses every spawn. Both clusters
leave `actorId` empty, so no run can write to catalog in either. The paragraph is rewritten to
say that, and the three switch table keeps its rows.

**The rule that is deleted.** `CLAUDE.md` states: "An automated fetch never overwrites a price a
person typed in (plan 0038, section 6.5). It reports the disagreement instead. When `ItemPrice`
and `PricePolicy` arrive that rule is deleted, not extended." This plan is their arrival. The
bullet is replaced by the new rule in one sentence: every source's price is stored side by side, and
`price_policies` plus the `ADMIN` row's protection window decide which one is shown. The
`bulk_price` bullet beside it is untouched.

## 14. What this takes from backlog `0001`, changes, and deletes

| Backlog `0001` | Here |
| --- | --- |
| 2.3 `ItemPrice`, one current row per kind, unique on (item, scope, kind) | **Changed.** Dated rows, no uniqueness, insert on change. |
| 2.3 `submissionCount`, `confidence` | **Deleted.** Nothing writes them. Backlog `0008` owns the writer that will. |
| 2.3 `PriceSourceClass` | **Deleted.** The kinds ship to clients as they are. Velista already maps them. |
| 2.3 "no adapter may write a user kind" | Kept. `addBatch` refuses a user kind from a run. |
| 2.4 `PricePolicy` | Kept, minus `minSubmissions`, with the priorities of section 3. |
| 2.4 filter, priority, recency | Kept, plus the protection test and the stale tier. |
| 2.4 the sweep | Kept, with `nextBoundaryAt` and `SKIP LOCKED`. |
| 2.4 `ADMIN` outranks everything, flagged in the back office | **Changed.** Outranks while protected and undisputed, then priority 40. The flag is the snapshot. |
| 2.4 an `ADMIN` row may carry `validUntil` | Kept, and it is the owner's field alone. |
| 2.5 `PriceObservation` | **Deleted.** Section 1. |
| 2.6 `PriceSubmission` and the aggregation rule | **Not built.** Stays with backlog `0008`. The two user kinds are ordinary rows any authorized writer inserts. |

From plan `0038`: section 6.5 and `decidePriceWrite` deleted, as its section 10 anticipated, and
`SupermarketItemPriceDisagreement` deleted with them. From plan `0067`: section 7's `ADMIN`
preservation deleted. From the brief: the write time closing of an `ADMIN` row and `maxAgeDays`
on `ADMIN`, both replaced by section 4.2.

## 15. Testing

- **Resolution, table driven** (backlog `0001` section 11): a set of rows, a policy, a clock,
  an expected effective row and flag. The cases are the oscillation table of section 4.1 as a
  sequence of days. Day 8. The Lidl case. A leaflet inside and outside its window. A seven day
  old crawl beaten by a fresher one. A chain with only an `ADMIN` row at day 30. The stale tier
  picking an expired leaflet over nothing. A disabled kind never chosen. `USER_RECEIPT` with no
  max age.
- **Inheritance**: a NATIONAL row reaches a warehouse scope. A warehouse row of the same kind
  beats it there and not elsewhere. A scope created after the NATIONAL write inherits on
  creation.
- **`nextBoundaryAt`**: every boundary kind produces the right instant, and a row with none
  carries null.
- **The sweep**: two workers on one table each take distinct rows, and running the sweep twice
  changes nothing the second time.
- **Insert on change**: a repeated value moves `lastObservedAt` only, a changed value inserts,
  the seed rerun writes no row.
- **The migration test** of section 8.
- **Writers**: `refresh.runner.spec.ts` sends `sourceRunId` and a separate availability batch,
  and the harvester's `catalog-client.service.spec.ts` follows.
- **Velista**: `mappers.spec.ts` reads `stale`, `observedAt` and `sourceKind` off the wire, and
  `settle-sheet.spec.ts` draws the banner from the flag.
- **Admin**: descriptor and screen specs for the two screens and the policy descriptor.
- **Gateway**: `openapi-document.spec.ts` on the regenerated document, and the v3 routes.

## 16. Exit criteria

- Every price a source gives is a row in `item_prices` with its kind, its observation interval,
  its window and its run. No write ever changes another row's values.
- A repeated observation writes no row, and a year of daily Mercadona refreshes grows the table
  by the number of price changes.
- Which price a shopper sees is decided on every read from stored rows and the clock, by an
  editable policy plus the `ADMIN` row's own protection snapshot. The oscillation table does not
  oscillate, and a source reporting for the first time displaces an `ADMIN` price at once.
- A product whose every price is ineligible still shows its newest one, flagged stale, and
  velista draws that flag rather than inferring it.
- A price written to a chain's NATIONAL scope is the effective price in every scope of that
  chain that has no narrower row of the same kind. A shopper who resolves any of those scopes
  sees it.
- `supermarket_items` keeps its columns. Search, the scoped catalog and the basket read are
  unchanged in behaviour. `nextBoundaryAt` and a `SKIP LOCKED` sweep keep them current on two
  replicas.
- Every pre existing price resolves to the same value after the migration.
- `decidePriceWrite`, `SupermarketItemPriceDisagreement` and the seed's `ADMIN` filter are gone,
  and the harvester writes with a run id.
- The back office lists effective prices and shows a price's history. It adds an `ADMIN` row with
  the line saying what it overrides, removes a row, and edits the six policy rows.
- `SupermarketItemView` and `ItemOfferView` carry `observedAt`, `sourceKind` and `stale`. The
  supermarket items controllers are v3. `MIN_CLIENT_VERSION` is set in production, and the admin
  app sends its version.
- `USER_RECEIPT` has no max age, staging shows the seed's prices unflagged with their August
  dates visible, and backlog `0008` records that it sets the number.
- `CLAUDE.md` describes the harvester's real state in each cluster and no longer states the
  overwrite rule.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test` is green.
