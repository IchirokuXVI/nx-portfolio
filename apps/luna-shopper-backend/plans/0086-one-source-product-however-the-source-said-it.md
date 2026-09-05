# 0086 One source product, however the source said it

A Mercadona walk and a leaflet upload are the same act with a different first step. One fetches
4,232 products over eighteen minutes and the other reads 219 offers out of a file, and from that
point on both hold the same thing: a list of products as a chain described them, each with a name,
maybe a brand, maybe a size, maybe an EAN, maybe a price. What happens next must not depend on
which first step it was.

Today it does. The two runs write different tables, resolve products through different rungs, feed
different queues, and only one of them writes a price. This plan makes the second half of every run
**one** piece of code over **one** table, deletes the run mode that only existed because the walk
threw its prices away, and leaves the back office with one queue.

The owner's brief, in four sentences. A leaflet import is a harvester run that skips the crawl.
Both create identical records and use the same queue. The walk already fetches every product's
price, so it writes it, and the refresh run is redundant. The chain's original name is kept for
every product, because a product without an EAN has nothing else to resolve through.

Depends on `0080` for the price rows a run writes, `0081` for the leaflet rules it keeps, `0082`
for the revert it has to keep working, and `0085` for the key a nameless product already has.
Admin plan `0012` draws the one queue.

## 1. What the two runs write today

Verified against the source on 2026-09-05, not against the plans.

`CATALOG_DISCOVERY` with `mercadona-api` (`mercadona-catalog.runner.ts`) walks the tree, fetches
detail per product, and writes two tables in the harvester database:

- `source_catalog_entries`, one row per product the chain lists, unique on (`supermarketId`,
  `externalId`). Name, brand, EAN, size, price, unit price. A snapshot of the assortment.
- `item_source_refs`, one row per (`itemId`, `supermarketId`), unique on that pair. The ladder:
  an existing `externalId` is touched, an EAN match gives `ACTIVE`, name plus brand plus size gives
  `CANDIDATE`. A product that matched nothing gets no row, and the "unmatched entries" queue is a
  `NOT EXISTS` over this table.

**It writes no price**, although `detail.price` and `detail.unitPrice` are in its hands for every
one of the 4,232 products. The price goes onto the snapshot row and nowhere a shopper reads.
`REFRESH` (`refresh.runner.ts`) exists to fetch those same products **again**, one request per
`ACTIVE` ref, and write what it gets. It also cannot be started from the back office: the run form
(`runs-page.ts`) has no price scope field and the spawn refuses a refresh without one.

`LEAFLET_IMPORT` (`leaflet-import.runner.ts`) reads the stored document and writes one table:

- `source_aliases`, one row per printed name plus printed format per chain, unique on
  (`supermarketId`, `aliasKey`). It holds both halves in one row: what the leaflet printed, and
  what a person decided (`itemId`, `status`). The ladder: an `ACTIVE` alias writes the price, a
  `REJECTED` one skips, a queued one is touched, and no alias tries a fuzzy match against items and
  then against the chain's snapshot entries, inserting `CANDIDATE` or `UNRESOLVED`.

It writes prices, through `ACTIVE` aliases only. Accepting a queued alias re-reads every open
import's stored document and writes the offers it finds, with each run's own id.

`CATALOG_DISCOVERY` with `deza-web` (`deza-catalog.runner.ts`) is the odd one that already points
the way. DEZA has no product id, so its `externalId` is `entryKey(name, sizeFormat)`, a hash of
the same normalized string a leaflet alias is keyed on. Plan `0085` section 6 chose that shape so
"the two can meet". They never did, because they were in different tables.

|                 | Mercadona walk           | DEZA crawl               | Leaflet import           |
| --------------- | ------------------------ | ------------------------ | ------------------------ |
| snapshot row    | `source_catalog_entries` | `source_catalog_entries` | none                     |
| resolution row  | `item_source_refs`       | `item_source_refs`       | `source_aliases`         |
| keyed on        | the chain's product id   | hash of name and size    | name and format          |
| unmatched row   | none, a `NOT EXISTS`     | none, a `NOT EXISTS`     | `UNRESOLVED`             |
| fuzzy rung      | name, brand, size        | name, brand, size        | items, then the snapshot |
| writes prices   | no                       | no, the site has none    | through `ACTIVE` only    |
| a person decides in | `item-refs`, `entries` | `item-refs`, `entries`  | `leaflets/queue`         |

Three tables, three queue screens, two ladders, and the price fetched for 4,232 products written
for none of them.

## 2. The decisions

**D1. One table.** `source_catalog_entries` becomes the only record of a product a source
described, and it carries the resolution too. `item_source_refs` and `source_aliases` are dropped.
The split between "what the source said" and "what a person decided" survives as two groups of
columns on one row, stated in section 3, with the rule that a run rewrites the first group and
never the second.

**D2. A nameless product is keyed on its name.** A leaflet offer's `externalId` is
`entryKey(product.name, product.format.raw)`, the sha1 DEZA already stores. Mercadona keeps the
chain's own id. Nothing parses a key: `sourceKind` on the row says what kind of observation made
it, and that is the discriminator every code path reads.

**D3. A walk writes the price it fetched, and `REFRESH` is deleted.** A `CATALOG_DISCOVERY`
against an adapter that yields prices takes a price scope and writes, for every `ACTIVE` row it
saw, the price it saw, exactly as a refresh did. There is no second fetch of the same products.

**D4. One ingest.** A runner's job ends at a list of observations. `SourceIngest` upserts the
rows, runs the ladder, collects the prices the `ACTIVE` rows are owed, writes them in batches with
the run's id and kind, and writes availability. `mercadona-catalog.runner.ts`,
`deza-catalog.runner.ts` and `leaflet-import.runner.ts` keep only their first step.

**D5. One queue, and accepting writes the price the row holds.** A row in `CANDIDATE` or
`UNRESOLVED` is the queue, for every chain and every source kind. Accepting, creating or
rejecting is one set of three operations. Accepting writes the price on the row, stamped with the
run that last observed it, so the admin who works the queue after an eighteen minute walk gets the
prices that walk saw without running it again.

**D6. The name is the source's, and a person never rewrites it.** `name`, `brand`, `sizeFormat`
and `unitSize` on a row are what the chain printed or answered, verbatim. Accepting sets `itemId`
and touches none of them. The item can be renamed to anything at all and the next walk or leaflet
that produces the same key hits the same row. This is plan `0081` section 2's rule, now holding
for a Mercadona product too, which is what makes a product without an EAN resolvable at all: its
name is its identity, so its name has to be kept as the source gave it.

**What does not change.** A fuzzy match never writes a price. Only an EAN or a person makes a row
`ACTIVE`. A `REJECTED` row is the owner's and a run does not reopen it. `bulk_price` is stored
verbatim. Every price is a row in `item_prices` stamped with a run, and `0080`'s policies decide
what a shopper sees. None of that moves.

## 3. The table

`source_catalog_entries`, unique on (`supermarketId`, `externalId`). The first group is the
source's and every run rewrites it. The second group is a person's, or the EAN rung's, and a run
only reads it.

| Column                        | Notes                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                          | uuid                                                                                       |
| `supermarketId`               | uuid, opaque                                                                               |
| `externalId`                  | varchar. The chain's id, or `entryKey(name, format)` for a source that has none (D2).      |
| `sourceKind`                  | `PriceSourceKind`. `OFFICIAL_API`, `OFFICIAL_WEB` or `OFFICIAL_LEAFLET`. The discriminator. |
| `name`                        | varchar. Verbatim, Spanish, never rewritten (D6).                                          |
| `brand`                       | varchar null. Verbatim.                                                                    |
| `ean`                         | varchar null. Indexed. Leaflets and DEZA never fill it.                                    |
| `unitSize`                    | numeric null. `format.quantity` for a leaflet.                                             |
| `sizeFormat`                  | varchar null. The source's own token, or `format.raw` for a leaflet. In the key for D2.    |
| `price`, `currency`           | numeric null, varchar null. The last observed till price, as the rules of `0081` left it.  |
| `unitPrice`, `unitPriceLabel` | numeric null, varchar null. Verbatim, never recomputed.                                    |
| `validFrom`, `validUntil`     | timestamptz null. A leaflet's window. Null for a storefront price.                         |
| `details`                     | jsonb null. What `0081` section 6.4 stores beside a leaflet price. Null otherwise.         |
| `categoryPath`                | jsonb. As today.                                                                           |
| `url`                         | varchar null. As today.                                                                    |
| `timesSeen`                   | integer. Every observation adds one.                                                       |
| `firstSeenAt`, `lastSeenAt`   | timestamptz. `lastSeenAt` stays indexed: it is what a resume reads.                        |
| `firstRunId`, `lastRunId`     | uuid null. The run that created it, the run that last observed it. `firstRunId` indexed.   |
| `itemId`                      | uuid null, opaque. Set on `ACTIVE`, and on `CANDIDATE` as the proposal.                    |
| `candidateEntryId`            | uuid null. A sibling row of this chain the fuzzy rung proposed, when it has no item yet.   |
| `status`                      | `SourceEntryStatus`: `ACTIVE`, `CANDIDATE`, `UNRESOLVED`, `REJECTED`. Indexed.             |
| `matchedBy`                   | `ItemSourceMatch` null. `EAN`, `NAME_BRAND_SIZE`, `NAME_SIZE`, `MANUAL`. Null when nothing answered. |
| `confidence`                  | numeric(4,3). 1 for `EAN` and `MANUAL`, 0.6 for a fuzzy proposal, 0 for `UNRESOLVED`.      |
| `decidedAt`                   | timestamptz null. When the status left the queue, by a person or by the EAN rung.          |

`SourceEntryStatus` replaces both `ItemSourceRefStatus` and `SourceAliasStatus`. It is the alias
enum under a new name, because that one already had the shape a queue needs: a row that matched
nothing is a status, not an absence. `ItemSourceRefStatus.MANUAL` goes, as it was never a status:
it said how a row became `ACTIVE`, which is `matchedBy`. `ItemSourceMatch.EXTERNAL_ID` goes too,
because nothing ever wrote it: an existing row is touched, and touching is not a match.

**Why one table rather than the entry beside a re-keyed ref.** A ref keyed on (`supermarketId`,
`externalId`) is one to one with the entry keyed the same way. Two tables that are one to one and
always read together are one table with a join in front of it. The reason `0081` gave for a
separate alias table was three things a shared table breaks, and this plan removes all
three: the refresh that interpolated every `externalId` into a URL is deleted (D3), the unique
index on (`itemId`, `supermarketId`) that allowed one name per product per chain is dropped, and
snapshot entries entering the matcher as candidates is now a feature rather than a hazard
(section 4, rung 4).

**Why `sourceKind` and not a shape of the key.** A leaflet key and a DEZA key are the same hash of
the same string, and that is the point: a DEZA leaflet printing the same name and size as the DEZA
web listing lands on **the same row**, and a name the owner accepted from the web resolves the
leaflet without a second decision. Whether the two strings actually normalize alike for a real
leaflet is a measurement for whoever builds this, not a rule. The design does not depend on it.
What the code needs to know is only whether the id can be fetched, and that is `sourceKind`.

## 4. The ladder

One ladder, in `SourceIngest`, per observation, stopping at the first rung that answers. It is
`0038` section 6.2 and `0081` section 3 laid end to end, and every rung is one that exists today.

1. **A row with this key exists.** Touch it: `timesSeen`, `lastSeenAt`, `lastRunId`, and the
   whole source group of columns. Its status is not re-derived, whatever it is. `ACTIVE` is owed a
   price. `REJECTED` writes nothing and is not asked again. `CANDIDATE` and `UNRESOLVED` are
   already waiting.
2. **The observation carries an EAN a catalog item has.** `ACTIVE`, `matchedBy: EAN`, confidence
   1, `decidedAt` now. Trusted immediately, as it always was: the EAN is the one identifier that
   joins across chains.
3. **Normalized name, brand and size match exactly one catalog item.** `CANDIDATE`, `itemId` set
   to the proposal, `matchedBy: NAME_BRAND_SIZE`, confidence 0.6. Never a price.
4. **Normalized name and size match a sibling row of this chain.** The row this chain already
   holds under the same `entryKey`, which for a leaflet is a Mercadona product the walk found, or
   for a DEZA leaflet the web listing. An `ACTIVE` sibling proposes its `itemId` as a
   `CANDIDATE` with `matchedBy: NAME_SIZE`. A sibling with no item is proposed through
   `candidateEntryId`, so the admin can create the item from the row that has the EAN and let
   both resolve. Never a price.
5. **Nothing.** `UNRESOLVED`, `matchedBy` null, confidence 0. In the queue, writing nothing.

Rung 4 subsumes what `0081` called "then the chain's discovery snapshot". It applies to every
source kind now, so a Mercadona product that a leaflet named first, and the owner accepted from the
leaflet, is proposed to the walk that later finds its id. The two rows stay two rows: a chain's
product id and a printed name are two observations of one item, resolved through two rows to the
same `itemId`, which is exactly the many names per product per chain that `0081` section 2
required and the old ref index forbade.

The leaflet ladder's rungs 2 and 3, a rejected or queued name, produced a warning per offer. That
is rung 1 here, and it stays silent in the ingest: a walk touches 4,000 unresolved rows and a
warning for each is a `warnings` column nobody reads. Section 5 says which runner turns an
outcome into a warning.

## 5. What a run does, in order

A runner produces observations. An observation is one product as the source described it, with
every column of section 3's first group that the source can fill, and `price` null when the source
stated none or the rules decided that none is written.

```ts
interface SourceObservation {
  externalId: string;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  price: number | null;
  currency: string | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  details: Record<string, unknown> | null;
  categoryPath: string[];
  url: string | null;
}
```

`SourceIngest.ingest(context, { supermarketId, priceScopeId, sourceKind, observations })` then:

1. Loads the chain's rows and the catalog item index once, as both runners do today.
2. Runs section 4 per observation, upserting the row. An upsert counts `created`, `updated` or
   `unchanged` on the same rule `upsertSourceEntry` uses now.
3. Collects a price for every observation whose row is `ACTIVE` and whose `price` is not null,
   with `observedAt` the observation time, the leaflet's window when there is one, and `details`.
4. Writes them in batches of 200 through `catalog.addPrices` with the run's id and the run's
   `sourceKind`, counting `updated` for an inserted row and `unchanged` for a confirmed one.
5. Answers one outcome per observation: the row, whether it was created, which rung answered, and
   the `itemId` when the row is `ACTIVE`.

The runners keep their first step and lose everything after it.

**Mercadona.** Walk, detail per product, one observation per detail with the price the detail
carried. A 404 is `notFound` and no observation, as today. After the ingest, and **only when the
walk finished**, availability for the scope: every `ACTIVE` row the run observed is `available:
true`, and every `ACTIVE` row of the chain the run did not observe is `available: false`. That is
what a refresh's 404 meant, said by the walk instead: a product the whole tree walk did not list
is not stocked in this warehouse. An aborted run asserts nothing negative, because it did not walk
the whole tree. It requires a `priceScopeId` at the spawn, stated in section 8.

**DEZA.** Crawl, one observation per product with `price` null, ingest, then per shop availability
exactly as `0085` section 9 steps 5 and 6, using the `itemId` each outcome answered. Unchanged in
what it writes.

**Leaflet.** The three rules of `0081` section 6 stay where they are and decide the observation's
price. A loyalty gated tile produces no observation at all, as section 6.3 already says. A
conditional tile with no single unit price produces an observation with `price` null: a new key
lands in the queue through rung 5, a known one is touched and writes nothing, which is what the
old `queue` decision did in two branches. Two offers with one key in one document both produce
observations with `price` null. The document's own extractor warnings are carried through as they
are. Then the leaflet runner reads the outcomes and records a warning per offer, with the codes
that exist today: `REJECTED_ALIAS` for a rejected row, `ALREADY_QUEUED` for a queued one,
`CANDIDATE_MATCH` and `NO_MATCH` for a new one. A leaflet has 219 offers and a person reads that
list. A walk has 4,232 products and nobody does, so the Mercadona runner records counters only.

The observation's `validFrom` and `validUntil` are the instants the spawn resolved and stored on
the run, as today.

## 6. Deciding a row

Three operations replace `sourceAlias.accept`, `sourceAlias.createItem`, `sourceAlias.reject`,
`sourceEntry.createItem`, `itemSourceRef.confirm`, `itemSourceRef.reject` and
`itemSourceRef.setManual`.

- **`sourceEntry.accept(entryId, itemId)`.** `ACTIVE`, `matchedBy: MANUAL`, confidence 1,
  `decidedAt` now. Then the price.
- **`sourceEntry.createItem(entryId, overrides)`.** Creates the item from the row: `name.es` from
  `name`, `brand`, `ean`, `unitSize`, category from `categoryPath` through `resolveCategory` or
  the override, default unit from `sizeFormat` through `mapSizeFormat` or the override. The English
  name is fetched, one request, **only when `sourceKind` is `OFFICIAL_API` and the chain's
  source adapter is `mercadona-api`**, and only when that source is enabled. A leaflet row of the
  Mercadona chain is never fetched by its key, which is the hazard `0081` section 2 named and the
  reason `sourceKind` exists. An EAN the catalog already holds is refused with the existing item
  named, as today. Then binds as accept does, then the price.
- **`sourceEntry.reject(entryId)`.** `REJECTED`, `itemId` null, `decidedAt` now. The next run that
  observes the key touches the row and asks nobody.

**The price an accept writes is the one on the row.** `price` not null, and for an
`OFFICIAL_LEAFLET` row `validUntil` still in the future, is written through `catalog.addPrices`
with `lastRunId` as the run and the row's `sourceKind` as the kind, `observedAt` set to
`lastSeenAt`. That is the same rule for a walk and a leaflet: an admin who accepts a Mercadona
product on Tuesday gets the price Monday's walk saw, stamped with Monday's run, and the revert of
Monday's run takes it back with the rest. Today's accept re-parses every open import's stored
document to find this key's offers, which was the only way while the offer lived nowhere else. It
lives on the row now. The stored document stays on the run for the digest index and for `0082`.

**What that simplification gives up, stated.** Two open leaflets printing the same product at two
prices are two observations of one row, and the later import's price is the one on it. An accept
writes that one. The earlier leaflet's price for that key is not written. The owner's queue
confirmation names the run and the price it wrote, so nothing is silent. If two overlapping
leaflets for one chain turn out to be common, the fix is a price history on the row, not a return
to parsing documents.

`itemSourceRef.setManual` has no replacement. It linked an item to an external id by hand so that
a refresh fetched it. Nothing fetches by id any more: a walk finds every product the chain
lists, and a product no run has observed has no row, no price and nothing to link.

## 7. Revert

`0082` section 3 holds, restated for one table. On `harvest.revert(R)`, after catalog deleted
the prices stamped `R`:

- Rows with `firstRunId = R` **and** `lastRunId = R` in `CANDIDATE` or `UNRESOLVED` are deleted.
  Nobody decided on them and no later run saw them. The second condition is new: a row this run
  created and a later run observed again is a real product a later run stands behind, and
  deleting it takes the later run's observation with it.
- Rows in `ACTIVE` or `REJECTED` survive whatever run created them. A person decided.
- Rows this run merely touched keep `timesSeen` and `lastSeenAt`.

`PRICE_WRITING_MODES` in `harvest-run.service.ts` loses `REFRESH` and keeps the other two.

## 8. The run modes and the spawn

`HarvestRunMode` is `STORE_DISCOVERY`, `CATALOG_DISCOVERY` and `LEAFLET_IMPORT`. `REFRESH` is
deleted from the enum, from `run-executor.service.ts`, from the spawn's validation, from the
admin's mode list and from `harvest-seed.ts`. `refresh.runner.ts` and its spec go.

The spawn's validation for `CATALOG_DISCOVERY` reads the source's `adapterKey`, which it already
loads to refuse a disabled chain. `mercadona-api` requires `priceScopeId`, with the same sentence
a refresh used: the scope to write the prices for. `deza-web` accepts one and ignores it, because
the site prints no price and a required field that does nothing is a lie in a form.
`LEAFLET_IMPORT` is unchanged.

Backlog `0006`, the public item refresh, was written as "a caller and a gate in front of a run mode
that already exists". It no longer does. That plan gets one paragraph saying so: when it is picked
up, a per item fetch is its own small runner over `SourceIngest`, one observation per tracked
product, and nothing in this plan stands in its way. It is not built here.

## 9. The surface

NATS, in `harvest.messages.ts`:

```ts
export const SOURCE_ENTRY_PATTERNS = {
  list: 'sourceEntry.list',
  accept: 'sourceEntry.accept',
  createItem: 'sourceEntry.createItem',
  reject: 'sourceEntry.reject',
} as const;
```

`SOURCE_ALIAS_PATTERNS` and `ITEM_SOURCE_REF_PATTERNS` are deleted. `sourceEntry.list` takes
`supermarketId`, an optional `status`, an optional `sourceKind`, an optional `query` over name,
brand and EAN, and pages on (`lastSeenAt`, `id`) descending, which is the order a queue reads in.
Absent `status` means the two queued ones, as the alias list did. `unmatchedOnly` is deleted: it
was the `NOT EXISTS` and the status says it now.

Gateway, under `admin/harvest/entries`: `GET`, `POST :id/accept`, `POST :id/item`,
`POST :id/reject`. The `admin/harvest/aliases` and `admin/harvest/item-refs` controllers are
deleted, and `admin/harvest/leaflets` keeps the upload alone.

Contracts: `SourceCatalogEntryView` gains section 3's second group and `timesSeen`,
`firstRunId`, `lastRunId`, `sourceKind`, `currency`, `validFrom`, `validUntil` and `details`.
`SourceAliasView`, `ItemSourceRefView`, their pages and their requests are deleted.
`SourceAliasAcceptResult` becomes `SourceEntryAcceptResult` with the same three fields: the row,
`pricesWritten`, and the item created or null. `AcceptSourceAliasRequest` and
`CreateItemFromSourceAliasRequest` become `AcceptSourceEntryRequest` and
`CreateItemFromSourceEntryRequest`, the latter taking the same optional overrides the alias one
did, with every field optional because the row already holds a default for each.

`openapi.json` and `wire-types.ts` are regenerated, and the wire types spec is what proves it.

## 10. The migration

One migration, `1756900000000-OneSourceProduct`, in this order inside one transaction where
Postgres allows it and the enum dance outside, as `1756700000000-LeafletImport.ts` does:

1. Create `source_entry_status`. Add section 3's new columns to `source_catalog_entries`, with
   `sourceKind` defaulting to `OFFICIAL_API` for the rows that exist, then overwritten for DEZA
   rows from their chain's `supermarket_sources.adapterKey`, and `status` defaulting to
   `UNRESOLVED`.
2. Fold `item_source_refs` in. For each ref, the row of the same (`supermarketId`, `externalId`)
   takes `itemId`, `status`, `matchedBy`, `confidence`, `decidedAt` from `lastResolvedAt`.
   `MANUAL` status becomes `ACTIVE` with `matchedBy: MANUAL`. A ref whose row does not exist, which
   a `setManual` against a product no walk ever saw can have made, is counted, logged and
   dropped: there is no name to give it and nothing will fetch it. Two refs on one row, which the
   old index allowed and no run ever wrote, keep the one with the later `lastResolvedAt`.
3. Move `source_aliases` in. Each becomes a row with `externalId = sha1(aliasKey)`, which is
   exactly `entryKey(printedName, printedFormat)` because `aliasKey` was that string before the
   hash, `sourceKind: OFFICIAL_LEAFLET`, `name` from `printedName`, `sizeFormat` from
   `printedFormat`, `brand` from `printedBrand`, and the second group carried over as it is. Its
   `price` stays null: the alias never held one and the next import fills it. An alias whose key
   collides with a DEZA row of the same chain is the meeting section 3 wanted, and the alias's
   decision wins onto that row when the row has none.
4. Delete `harvest_runs` rows in mode `REFRESH`, then rebuild `harvest_run_mode` without the label
   and `item_source_match` without `EXTERNAL_ID`, by the rename and recreate the leaflet migration
   already does. No cluster has ever started a refresh: harvesting was never enabled for a chain in
   staging or production (plan `0083`), so the rows this deletes exist on developer slots only.
   The prices those runs wrote in catalog are rows of their own and stay.
5. Drop `item_source_refs`, `source_aliases`, `item_source_ref_status` and `source_alias_status`.

`down` recreates the two tables and their types and splits the rows back by `sourceKind`:
`OFFICIAL_LEAFLET` rows to aliases, decided rows of the other kinds to refs. It cannot restore the
`REFRESH` runs, and says so.

Prove it on a throwaway Postgres before opening the pull request, with a database that holds rows
in all three tables, through the built `migrate.js` and the CLI path both.
`migrations.integration.spec.ts` gets the same fixture.

## 11. Testing

Unit, no database:

- `source-ingest.spec.ts`: the five rungs, each in isolation. A price is collected for `ACTIVE`
  rows only. A `REJECTED` row is touched and writes nothing. A `CANDIDATE` from rung 3 and from
  rung 4 carries the right `itemId` or `candidateEntryId`. A sibling row is proposed across source
  kinds. Counters map onto the batch result as `refresh.runner.spec.ts` asserted.
- `mercadona-catalog.runner.spec.ts`: a walk writes prices for its `ACTIVE` rows and none for the
  rest; availability is negative only for a walk that finished; an aborted walk writes what it
  fetched and asserts no absence.
- `leaflet-import.runner.spec.ts`: the three rules produce observations with the right price or
  none, a loyalty tile produces no observation, a duplicate key produces two priced at null, and
  the warnings per offer are the ones the outcomes imply. The existing fixtures serve.
- `deza-catalog.runner.spec.ts`: unchanged in what it asserts, moved onto the ingest.
- `source-entry.service.spec.ts`: accept writes the row's price with `lastRunId` and the row's
  kind, not for a leaflet row whose window closed, not for a row with no price; `createItem`
  fetches the English name for an API row of a Mercadona source and for nothing else; reject
  clears `itemId`; `name` is untouched by all three.
- `harvest-run.service.spec.ts`: a Mercadona discovery without a scope is refused, a DEZA one
  without a scope is not, a `REFRESH` mode is unknown, revert deletes by both run columns.

Integration, against a slot's Postgres through `test-integration`:

- `leaflet-import.integration.spec.ts` rewritten onto the one table.
- `migrations.integration.spec.ts` with rows in all three old tables, asserting the fold of
  section 10 row by row.

Then the two generated files, regenerated and committed, and `npx nx affected -t lint test build`
green. Build, not only test: the backend services type check in the build and nowhere else.

## 12. What this does not do

- It does not read a PDF, decide which price outranks which, or change what a shopper sees.
  `0080`'s policies are untouched and a leaflet still outranks a storefront where the owner said so.
- It does not draw the queue. Admin plan `0012`.
- It does not build the public refresh. Backlog `0006` gets a note and stays parked.
- It does not import till receipts. Backlog `0008` section 6 wanted a `kind` column on the alias
  table; it has one now, on the only table, and a receipt line is an observation of kind
  `USER_RECEIPT` when that plan is picked up.
- It does not schedule runs. A walk that writes prices makes a scheduled walk worth having, and
  `HarvestRunTrigger.SCHEDULED` has existed since `0038`; that is a plan of its own.

## 13. Exit criteria

- `item_source_refs` and `source_aliases` do not exist. `source_catalog_entries` carries section
  3 and is unique on (`supermarketId`, `externalId`).
- A Mercadona walk against a scope writes an `OFFICIAL_API` price for every `ACTIVE` row it saw and
  scope availability for every `ACTIVE` row of the chain, negative only when the walk finished.
- A leaflet import and a walk of the same chain produce rows of the same shape, resolved through
  the same ladder, in the same queue, and a leaflet name the owner accepted is proposed to the walk
  that later finds the product's id.
- `HarvestRunMode.REFRESH` does not exist anywhere in the workspace, including `openapi.json`.
- Accepting a queued row writes the price the row holds, with the run that last observed it, for a
  walk and a leaflet alike. A fuzzy match never writes a price. A rejected row is never asked
  about again. `name` is never rewritten by a decision.
- `harvest.revert` deletes the undecided rows the run alone stands behind and nothing a person
  decided.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test build` is green.
