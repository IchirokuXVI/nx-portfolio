# 0084 A shop of theirs is a shop of ours

The catalog can say that a chain carries a product. From an automated source it cannot say that
**this shop** carries it.

`SupermarketLocationItem.available` is the column for that claim. Plan `0038` section 5.2 wrote it
nullable and its own comment reserves it for a person: "the scope's `available` is what an automated
source can populate, and this one is what a person can". Plan `0080` section 2 restated the split
when it moved prices to a dated table.

Plan `0085` crawls a source that answers exactly the per shop question, for ten shops, and carries
no prices at all. Two things are missing before that answer has anywhere to go: a way to say which
of the source's shops is which of ours, and an availability column an automated source is allowed to
write. This plan builds both.

Depends on `0080` for `PriceSourceKind` as a provenance vocabulary and for the shape of
`supermarketItem.setAvailability`. Plan `0085` depends on this. Admin plan `0011` draws the screen.

## 1. The sentence that stops being true

"An automated source can only ever populate availability at the scope level" was a finding about
one source, not about sources. Mercadona's availability signal is a 404 on a warehouse scoped
detail call (plan `0038` section 5.2), and a warehouse cannot answer which aisle a product is in or
whether one particular shop stocks it. So the sentence was true of everything the code had.

DEZA is the counterexample. Its product listing states, per product, which of its shops carry it,
by name, in the page. It is an automated source whose only availability claim is per shop, and it
makes no claim at all at the scope level.

**So the column stays where it is and gains provenance**, which is the same move plan `0038`
section 5.3 made for the price when a second writer appeared. Nothing is relocated. A person and a
crawl now write one column, and the row records which of them did.

## 2. `supermarket_location_items` gains three columns

| Column | Type | Notes |
| --- | --- | --- |
| `availabilitySourceKind` | `price_source_kind` null | Who last wrote `available`. |
| `availabilityObservedAt` | timestamptz null | When that writer stated it. |
| `availabilitySourceRunId` | uuid null | The harvest run that wrote it. Opaque, never joined. |

**All three are nullable with no default.** A row that exists before this migration was written by
a person or by nothing, and the migration cannot tell which. A default of `ADMIN` claims the
first and protects rows nobody typed. A default of `OFFICIAL_WEB` claims the second and lets a
crawl overwrite a person. Null means "no provenance recorded", and section 3 gives it the safe
reading.

**`available` keeps its nullable boolean and its meaning.** Null is still "no store specific
information, use the scope's". A crawl that has never seen a shop leaves it null rather than
writing false, because absence of a crawl is not absence of a product.

**Why this is not a dated table.** Plan `0080` built `item_prices` as intervals because a price is
compared over time, and the history is the product. Availability is a boolean whose history nobody
reads, at a row count of products times shops rather than products times scopes. One current value
with provenance is the whole requirement. `availabilitySourceRunId` still lets plan `0082` find what
a run touched, which is the one backward looking question that is asked.

## 3. An automated fetch never overwrites a person

Plan `0038` section 6.5 is the rule, applied to this column:

- `availabilitySourceKind` is `ADMIN`: an automated writer **skips the row** and reports the
  disagreement on the run. It does not overwrite and it does not clear.
- `availabilitySourceKind` is null **and** `available` is not null: treated as `ADMIN`. Only a person
  ever wrote it, because nothing else writes it.
- `availabilitySourceKind` is null and `available` is null: free. The automated writer takes it.
- `availabilitySourceKind` is any automated kind: the newer observation wins, whatever kind it is.
  Two crawls of one chain do not need a priority ladder between them.

**A person always wins, and there is no protection window.** Plan `0080` section 4.2 gave the
`ADMIN` price a `protectedUntil` because a price the owner typed goes stale and the automated value
eventually deserves to return. Availability does not go stale in that way: an owner who marked a
product absent from one shop marked a fact about that shop, and a crawl that disagrees is either
wrong or is news the owner wants to see rather than have applied. The disagreement is reported.
Backlog `0001` can add a window if the report turns out to be noise.

**Nothing reads the column differently.** `SUPERMARKET_LOCATION_ITEM_PATTERNS.get` and
`listByLocation` return what they returned. This plan changes the writers and the row, not the
readers.

## 4. `supermarketLocationItem.setAvailability`

A new pattern beside `upsert`, shaped after `supermarketItem.setAvailability` from plan `0080`
section 9:

```
{ supermarketLocationId, sourceKind, sourceRunId, observedAt, entries: { itemId, available }[] }
```

answering `{ written, skipped, conflicts }`, where `conflicts` names the items whose row belonged to
a person. Platform admin and service gated, as every catalog write is under plan `0072`.

**It is a batch because the caller has one shop and thousands of products.** A crawl of DEZA
produces ten calls, one per shop. Per item calls are tens of thousands of NATS round trips for
one run, which is the mistake `ItemMatchIndex` exists to avoid on the read side.

**Absence is a claim, and the parameter that says so.** The DEZA listing shows, for each product,
the shops that carry it. A shop missing from that list does not stock the product. That is the
strongest thing the source gives and throwing it away leaves the run unable to say anything
negative. So `entries` carries `available: false` rows, and the caller is expected to send a value
for every product it resolved, not only the positive ones.

`upsert` keeps `positionInStore` and stays the operator's route for the rest of the row. It no
longer writes `available`. An operator who sets availability by hand goes through
`setAvailability` with `sourceKind: ADMIN`, so a hand written value records its own provenance and
becomes protected by section 3.

## 5. The scope wide flag follows from the shops

`SupermarketItem.available` is "whether the scope carries this product at all". Once the shops of a
scope have answers, that flag is derivable: true when any location in the scope says true, false
when every location that has an opinion says false, unchanged when none has one.

**Catalog derives it inside the same handler**, not the caller. Both tables belong to catalog, the
relation between them is an invariant rather than a policy, and a harvester that computed it
becomes a second place the rule lives. A source with no per shop signal keeps writing
`supermarketItem.setAvailability` directly, and the two writers do not collide because they write
different scopes of different chains.

The derivation obeys section 3 at its own level: a scope flag whose `priceSourceKind` on the
materialized row was set by a person is not recomputed from shops.

## 6. `source_locations`: which shop of theirs is which of ours

A table in the harvester database, shaped after `source_aliases` from plan `0081` section 2 and for
the same reason.

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `supermarketId` | uuid, opaque. |
| `externalId` | varchar. The source's own key for the shop. |
| `printedName` | varchar. What the source displayed, exactly. |
| `supermarketLocationId` | uuid null, opaque. Set on `ACTIVE` only. |
| `status` | `SourceLocationStatus`: `ACTIVE`, `UNMAPPED`, `IGNORED`. |
| `matchedBy` | `ItemSourceMatch`. `NAME_SIZE` for the default name match, `MANUAL` when a person set it. |
| `firstSeenAt`, `lastSeenAt` | timestamptz. |
| `firstRunId`, `lastRunId` | uuid null. |

Unique on (`supermarketId`, `externalId`). Indexed on `status`.

**The key is the source's own code, not the name it prints.** DEZA labels each shop `T1` to `T7`,
`C1`, `C2` and `Z1` in the markup and prints "Ronda del Marrubial" beside it. Only the first
survives a rename. A mapping keyed on the display name is a mapping that silently detaches the day
marketing retitles a shop, and detaches into `UNMAPPED`, which reads as "they closed it".

**The default is an exact name match and nothing cleverer.** On first sight of a shop, compare
`normalizeName(printedName)` against `normalizeName` of the chain's location labels and addresses
(`matching.ts` lines 38 to 45, the same function everything else uses). Exactly one hit maps it
`ACTIVE` with `matchedBy: NAME_SIZE`. Zero hits or more than one leaves it `UNMAPPED`.

**`UNMAPPED` is skipped, counted and never guessed.** The run writes no availability for that shop
and finishes. The row is what the back office shows, so the operator sees a shop waiting to be
mapped rather than a silence. This is the owner's rule: an unknown location needs no action from the
run.

**`IGNORED` exists because a source lists places we do not sell from.** DEZA publishes eighteen
centres, of which ten appear in the product listing and the rest are warehouses, cafeterias, a
bakery and a beauty salon. A shop marked `IGNORED` stops appearing in the queue and stops being
counted as missing. Marking it is a person's act and a run never does it.

**Why not a column on `SupermarketLocation`.** The same argument plan `0081` section 2 makes about
`SourceCatalogEntry`. A column holds one name per location and a chain names one shop several ways
over time. It also teaches catalog a source's vocabulary, and catalog is the thing that must not
know which chains we happen to crawl. A separate table in the harvester has neither problem, and it
is the table admin plan `0011` draws.

## 7. The routes

Beside the alias routes plan `0081` adds, all platform admin gated:

- `sourceLocation.list`: by chain, filterable by status, for the queue.
- `sourceLocation.map`: bind one row to a `supermarketLocationId`, setting `ACTIVE` and
  `matchedBy: MANUAL`.
- `sourceLocation.unmap`: back to `UNMAPPED`, leaving what was already written alone.
- `sourceLocation.ignore` and `sourceLocation.unignore`.

**Mapping a shop does not backfill it.** The availability the run skipped stays skipped until the
next run. That is deliberate and it is the opposite of `sourceAlias.accept` in plan `0081`, which
does write the price it was queued for. A price sits in the run's stored document and is a small
number of offers. A shop's availability is one boolean per product across the whole assortment, the
run did not store it, and a crawl of one chain is minutes rather than an upload. Re running is
cheaper than keeping the snapshot.

## 8. Migration

One migration in the catalog database adding three nullable columns, and one in the harvester
database creating `source_locations` with its enum. Both are additive and neither backfills.
`data-source.ts` needs the new entity registered, which is the step a secondary entry point is
easy to miss.

## 9. Testing

- The provenance ladder in section 3, all four cases, as a table driven unit test over the write.
- An `ADMIN` row survives a crawl and appears in `conflicts`.
- A row with null kind and a non null `available` is treated as `ADMIN`.
- `setAvailability` with a `false` entry writes false rather than clearing to null.
- The scope derivation in section 5: any true makes the scope true, all false makes it false, no
  opinion leaves it alone.
- The default name match maps on exactly one hit and leaves `UNMAPPED` on zero and on two.
- A renamed shop keeps its mapping, because the key is the code. This is the test that states why
  the key is the code.
- An integration test over the batch write with a few thousand entries, in `*.integration.spec.ts`,
  which needs `LUNA_INTEGRATION` and a slot.

## 10. Exit criteria

- An automated source writes per shop availability and a person's value survives it.
- A run reports every disagreement it declined to write.
- The scope flag agrees with the shops beneath it.
- An unmapped shop of a source is visible in the back office and blocks nothing.
- `supermarketLocationItem.upsert` no longer writes `available`.
