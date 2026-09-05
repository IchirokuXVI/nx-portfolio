# 0086 One source product, however the source said it

A Mercadona walk and a leaflet upload are the same act with a different first step. One fetches
4,232 products over eighteen minutes and the other reads 219 offers out of a file, and from that
point on both hold the same thing: a list of products as a chain described them, each with a name,
maybe a brand, maybe a size, maybe an EAN, maybe a price. What happens next must not depend on
which first step it was.

Today it does. The two runs write different tables, resolve products through different rungs, feed
different queues, and only one of them writes a price. This plan makes the second half of every run
**one** piece of code over **one** table, deletes the owner facing run mode that only existed
because the walk threw its prices away, and leaves the back office with one queue.

The owner's brief, in five sentences. A leaflet import is a harvester run that skips the crawl.
Both create identical records and use the same queue. The walk already fetches every product's
price, so it writes it, and the bulk refresh is redundant. The chain's original name is kept for
every product, because a product without an EAN has nothing else to resolve through. And the
upload is not a leaflet tool: it is how the result of a harvester run that happened somewhere else
gets in, whether an extractor read a leaflet, a person typed a chain's prices, or a walk ran on a
machine that is allowed to crawl.

Depends on `0080` for the price rows a run writes, `0082` for the revert it has to keep working,
and `0085` for the key a nameless product already has. It replaces `0081`'s document and moves
`0081`'s three import rules out of the harvester, stated in section 6.
Admin plan `0014` draws the one queue and the import.

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
import's stored document and writes the offers it finds, with each run's own id and each run's own
scope, which is how two leaflets of one chain for two regions both get their price in.

`CATALOG_DISCOVERY` with `deza-web` (`deza-catalog.runner.ts`) is the odd one that already points
the way. DEZA has no product id, so its `externalId` is `entryKey(name, sizeFormat)`, a hash of
the same normalized string a leaflet alias is keyed on. Plan `0085` section 6 chose that shape so
"the two can meet". They never did, because they were in different tables.

|                     | Mercadona walk           | DEZA crawl               | Leaflet import           |
| ------------------- | ------------------------ | ------------------------ | ------------------------ |
| snapshot row        | `source_catalog_entries` | `source_catalog_entries` | none                     |
| resolution row      | `item_source_refs`       | `item_source_refs`       | `source_aliases`         |
| keyed on            | the chain's product id   | hash of name and size    | name and format          |
| unmatched row       | none, a `NOT EXISTS`     | none, a `NOT EXISTS`     | `UNRESOLVED`             |
| fuzzy rung          | name, brand, size        | name, brand, size        | items, then the snapshot |
| writes prices       | no                       | no, the site has none    | through `ACTIVE` only    |
| a person decides in | `item-refs`, `entries`   | `item-refs`, `entries`   | `leaflets/queue`         |

Three tables, three queue screens, two ladders, and the price fetched for 4,232 products written
for none of them.

## 2. The decisions

**D1. One table.** `source_catalog_entries` becomes the only record of a product a source
described, and it carries the resolution too. `item_source_refs` and `source_aliases` are dropped.
The split between "what the source said" and "what a person decided" survives as two groups of
columns on one row, stated in section 3, with the rule that a run rewrites the first group and
never the second.

**D2. A nameless product is keyed on its name.** A leaflet offer's `externalId` is
`entryKey(name, size.label)`, the sha1 DEZA already stores. Mercadona keeps the
chain's own id. Nothing parses a key: `sourceKind` on the row says what kind of observation made
it, and that is the discriminator every code path reads.

**D3. A price is observed per scope, and the row is chain wide.** A chain has several leaflets at
once because each is for a region, that is, for a price scope, and two of them print the same
product. The decision about that product is one, for the chain. The prices are one per scope. So
the row holds the decision and `source_entry_prices` holds the latest price each scope stated,
which is what lets an accept write both regions' prices as today's document re-reading does.

**D4. A walk writes the price it fetched, and the bulk `REFRESH` is deleted.** A
`CATALOG_DISCOVERY` against an adapter that yields prices takes a price scope and writes, for
every `ACTIVE` row it saw, the price it saw, exactly as a refresh did. There is no second fetch of
the same products by the owner. A per item refresh for a shopper is a different thing and stays
in backlog `0006`, restated there against this plan.

**D5. One ingest.** A runner's job ends at a list of observations. `SourceIngest` upserts the
rows, runs the ladder, records the prices per scope, writes the prices the `ACTIVE` rows are owed
in batches with the run's id and kind, and answers an outcome per observation.
`mercadona-catalog.runner.ts`, `deza-catalog.runner.ts` and the import runner keep only their
first step.

**D6. The upload is a file import, not a leaflet tool, and there is one file schema.**
`LEAFLET_IMPORT` becomes `FILE_IMPORT`. Every file is a `HarvestDocument`: a list of products as
a source described them, whoever produced it. The leaflet extractor produces one, the harvester's
own export is one, a person typing a chain's prices produces one, and any future producer has to.
The schema is designed from what the import consumes and from nothing else. It shares no shape
with the leaflet document of `0081` or with the harvester's tables, and it has no `kind` field:
the import does one thing with every file. What a producer knows and the import does not read
goes in an `extra` bag on each product, stored and shown and never interpreted. A run can be
exported and the export imported elsewhere, which is how a walk that ran on a developer's machine
reaches a cluster that is not allowed to crawl, and how a chain with no adapter at all, El Jamon
today, gets rows that look exactly like a walk's.

**D7. One queue, and accepting writes the prices the row holds.** A row in `CANDIDATE` or
`UNRESOLVED` is the queue, for every chain and every source kind. Accepting, creating or
rejecting is one set of three operations. Accepting writes every scope's price on the row that is
still valid, each stamped with the run that observed it, so the admin who works the queue after an
eighteen minute walk gets the prices that walk saw without running it again.

**D8. The name is the source's, and a person never rewrites it.** `name`, `brand`, `sizeFormat`
and `unitSize` on a row are what the chain printed or answered, verbatim. Accepting sets `itemId`
and touches none of them. The item can be renamed to anything at all and the next walk or file
that produces the same key hits the same row. This is plan `0081` section 2's rule, now holding
for a Mercadona product too, which is what makes a product without an EAN resolvable at all: its
name is its identity, so its name has to be kept as the source gave it.

**What does not change.** A fuzzy match never writes a price. Only an EAN or a person makes a row
`ACTIVE`. A `REJECTED` row is the owner's and a run does not reopen it. `bulk_price` is stored
verbatim. Every price is a row in `item_prices` stamped with a run, and `0080`'s policies decide
what a shopper sees. None of that moves.

## 3. The tables

### 3.1 `source_catalog_entries`

Unique on (`supermarketId`, `externalId`). The first group is the source's and every run rewrites
it. The second group is a person's, or the EAN rung's, and a run only reads it.

| Column                      | Notes                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                        | uuid                                                                                                 |
| `supermarketId`             | uuid, opaque                                                                                         |
| `externalId`                | varchar. The chain's id, or `entryKey(name, format)` for a source that has none (D2).                |
| `sourceKind`                | `PriceSourceKind`. `OFFICIAL_API`, `OFFICIAL_WEB` or `OFFICIAL_LEAFLET`. The discriminator.          |
| `name`                      | varchar. Verbatim, Spanish, never rewritten (D8).                                                    |
| `brand`                     | varchar null. Verbatim.                                                                              |
| `ean`                       | varchar null. Indexed. Leaflets and DEZA never fill it.                                              |
| `unitSize`                  | numeric null. `format.quantity` for a leaflet.                                                       |
| `sizeFormat`                | varchar null. The source's own size text, `size.label` from a file. In the key for D2.               |
| `categoryPath`              | jsonb. As today.                                                                                     |
| `url`                       | varchar null. As today.                                                                              |
| `extra`                     | jsonb null. The last observation's `extra` bag (section 6), for the queue to show. Never read.       |
| `timesSeen`                 | integer. Every observation adds one.                                                                 |
| `firstSeenAt`, `lastSeenAt` | timestamptz. `lastSeenAt` stays indexed: it is what a resume reads.                                  |
| `firstRunId`, `lastRunId`   | uuid null. The run that created it, the run that last observed it. `firstRunId` indexed.             |
| `itemId`                    | uuid null, opaque. Set on `ACTIVE`, and on `CANDIDATE` as the proposal.                              |
| `candidateEntryId`          | uuid null. A sibling row of this chain the fuzzy rung proposed, when it has no item yet.             |
| `status`                    | `SourceEntryStatus`: `ACTIVE`, `CANDIDATE`, `UNRESOLVED`, `REJECTED`. Indexed.                       |
| `matchedBy`                 | `ItemSourceMatch` null. `EAN`, `NAME_BRAND_SIZE`, `NAME_SIZE`, `MANUAL`. Null when nothing answered. |
| `confidence`                | numeric(4,3). 1 for `EAN` and `MANUAL`, 0.6 for a fuzzy proposal, 0 for `UNRESOLVED`.                |
| `decidedAt`                 | timestamptz null. When the status left the queue, by a person or by the EAN rung.                    |

The `price`, `unitPrice` and `unitPriceLabel` columns the table has today move to 3.2. They were
one price with no scope on a row that several scopes describe.

`SourceEntryStatus` replaces both `ItemSourceRefStatus` and `SourceAliasStatus`. It is the alias
enum under a new name, because that one already had the shape a queue needs: a row that matched
nothing is a status, not an absence. `ItemSourceRefStatus.MANUAL` goes, as it was never a status:
it said how a row became `ACTIVE`, which is `matchedBy`. `ItemSourceMatch.EXTERNAL_ID` goes too,
because nothing ever wrote it: an existing row is touched, and touching is not a match.

### 3.2 `source_entry_prices`

The latest price each scope stated for a row. Unique on (`entryId`, `priceScopeId`). A run
observing a price for a scope replaces that scope's row. A run observing no price, DEZA or a
conditional leaflet tile, writes nothing here and leaves what an earlier run said.

| Column                        | Notes                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `id`                          | uuid                                                                              |
| `entryId`                     | uuid, the row of 3.1. Cascade on delete.                                          |
| `priceScopeId`                | uuid, opaque. The scope the run was started for.                                  |
| `price`, `currency`           | numeric, varchar. The till price as the rules of `0081` left it.                  |
| `unitPrice`, `unitPriceLabel` | numeric null, varchar null. Verbatim, never recomputed.                           |
| `validFrom`, `validUntil`     | timestamptz null. A leaflet's window. Null for a storefront price.                |
| `details`                     | jsonb null. The observation's `extra` bag at the time, written onto the price row. |
| `observedAt`                  | timestamptz. When the source stated it.                                           |
| `runId`                       | uuid, indexed. The run that observed it, and the run an accept stamps.            |

**Why one table rather than the entry beside a re-keyed ref.** A ref keyed on (`supermarketId`,
`externalId`) is one to one with the entry keyed the same way. Two tables that are one to one and
always read together are one table with a join in front of it. The reason `0081` gave for a
separate alias table was three things a shared table breaks, and this plan removes all three: the
refresh that interpolated every `externalId` into a URL is deleted (D4), the unique index on
(`itemId`, `supermarketId`) that allowed one name per product per chain is dropped, and snapshot
entries entering the matcher as candidates is now a feature rather than a hazard (section 4,
rung 4).

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
every column of 3.1's first group that the source can fill, and a price block only when the source
stated a price a shopper pays for one unit.

```ts
interface SourceObservation {
  externalId: string;
  name: string;
  brand: string | null;
  ean: string | null;
  unitSize: number | null;
  sizeFormat: string | null;
  categoryPath: string[];
  url: string | null;
  observedAt: Date;
  extra: Record<string, unknown> | null;
  price: {
    price: number | null;
    currency: string;
    unitPrice: number | null;
    unitPriceLabel: string | null;
    validFrom: Date | null;
    validUntil: Date | null;
  } | null;
}
```

`price.price` is null when the source stated only a comparison figure, a per kilogram price with
no pack price, and the ingest then writes the unit price and no till price, which is what `0081`
section 6.1 decided and the one piece of it the ingest still carries.

`SourceIngest.ingest(context, { supermarketId, priceScopeId, sourceKind, observations })` then:

1. Loads the chain's rows and the catalog item index once, as both runners do today.
2. Runs section 4 per observation, upserting the row. An upsert counts `created`, `updated` or
   `unchanged` on the same rule `upsertSourceEntry` uses now.
3. Replaces the scope's `source_entry_prices` row for every observation that carries a price,
   stamped with this run.
4. Collects a price for every observation whose row is `ACTIVE` and which carries one, and writes
   them in batches of 200 through `catalog.addPrices` with the run's id and `sourceKind`,
   counting `updated` for an inserted row and `unchanged` for a confirmed one.
5. Answers one outcome per observation: the row, whether it was created, which rung answered, and
   the `itemId` when the row is `ACTIVE`.

The runners keep their first step and lose everything after it.

**Mercadona.** Walk, detail per product, one observation per detail with the price the detail
carried. A 404 is `notFound` and no observation, as today. After the ingest, and **only when the
walk finished**, availability for the scope: every `ACTIVE` row the run observed is `available:
true`, and every `ACTIVE` row of the chain of kind `OFFICIAL_API` the run did not observe is
`available: false`. That is what a refresh's 404 meant, said by the walk instead: a product the
whole tree walk did not list is not stocked in this warehouse. An aborted run asserts nothing
negative, because it did not walk the whole tree. It requires a `priceScopeId` at the spawn,
stated in section 8.

**DEZA.** Crawl, one observation per product with no price, ingest, then per shop availability
exactly as `0085` section 9 steps 5 and 6, using the `itemId` each outcome answered. Unchanged in
what it writes.

**File import.** The reader of section 6 maps the document's products onto observations one to
one, and interprets nothing: a product with a `price` is an observation with that price, a
product without one is an observation with none. A new key with no price lands in the queue
through rung 5, a known one is touched and writes nothing. Two products with one key in one
document both become observations with no price and a `DUPLICATE_KEY` warning, which is the one
rule the import keeps, because only the import can see that two products collide on the key it
computes. The document's own `warnings` are carried onto the run as they are. Then the import
runner reads the outcomes and records a warning per observation, with the codes that exist
today: `REJECTED_ALIAS` for a rejected row, `ALREADY_QUEUED` for a queued one, `CANDIDATE_MATCH`
and `NO_MATCH` for a new one. A file has hundreds of rows and a person reads that list. A walk
has 4,232 products and nobody does, so the Mercadona runner records counters only. An import
asserts nothing about availability: a file says what is in it, not what is not.

An observation's `validFrom` and `validUntil` are the product's own validity when it states one,
else the instants the spawn resolved from the document's validity and the admin's override and
stored on the run, else null, which is what a storefront price has.

## 6. The file, in and out

### 6.1 The schema

`HarvestDocument`, in `contracts` under `schemas/harvest-document/`, versioned, with a JSON
schema the gateway validates against before the broker and the harvester validates against
again at the spawn. It is designed from section 5's `SourceObservation`, which is what the import
consumes, plus what the digest index, the upload screen and the run page need. Nothing in it
comes from the leaflet document of `0081` or from a table.

**The rule for the shape.** A field is required when the import cannot do its job without it.
A field is optional when a real producer does not always have it and the import has a sensible answer
without it. A field is absent when the import never reads it, and a producer puts that in
`extra`.

```json
{
  "schema_version": 1,
  "sha256": "9f2c…",
  "producer": { "name": "leaflet-extractor", "version": "0.4.0", "produced_at": "2026-09-04T18:02:11Z" },
  "hints": { "chain_id": "…", "price_scope_id": "…", "source_kind": "OFFICIAL_LEAFLET" },
  "validity": { "from": "2026-09-10", "until": "2026-09-23" },
  "products": [
    {
      "id": "p-0001",
      "external_id": "4241",
      "name": "Leche semidesnatada Hacendado",
      "brand": "Hacendado",
      "ean": "8480000123456",
      "size": { "label": "1 L", "quantity": 1, "unit": "l" },
      "price": { "amount": 0.89, "currency": "EUR" },
      "unit_price": { "amount": 0.89, "currency": "EUR", "label": "€/L" },
      "validity": { "from": "2026-09-12", "until": "2026-09-14" },
      "observed_at": "2026-09-04T18:02:11Z",
      "category_path": ["Lácteos", "Leche"],
      "url": "https://…",
      "extra": { "page": 3, "loyalty": { "required": false }, "promotion": null, "raw_text": ["…"] }
    }
  ],
  "warnings": [
    { "message": "Tile on page 7 had no readable price", "product_id": null, "extra": { "page": 7 } }
  ]
}
```

Document level:

| Field            | Required | Consumed by                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `schema_version` | yes      | The validator. An unknown version is refused with the versions it knows.                          |
| `sha256`         | yes      | The digest index of `0081` section 7: one import of one file per chain until a revert.            |
| `producer`       | no       | The run page, shown as where the file came from. `name` required inside it, the rest optional.    |
| `hints`          | no       | The upload screen only. Each of the three optional. Never read by the harvester.                  |
| `validity`       | no       | The window for every product that states none of its own. Both bounds required inside it, as local days in Spain. |
| `products`       | yes      | The import. At least one, or there is nothing to run.                                             |
| `warnings`       | no       | The run's `warnings`, carried through. `message` required inside each, `product_id` and `extra` optional. |

Product level:

| Field           | Required | Consumed by                                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `id`            | no       | Validation feedback and warnings, so a message names a product. The index names it otherwise.               |
| `external_id`   | no       | The key (D2). Absent, the product is keyed on `name` and `size.label`.                                       |
| `name`          | yes      | The row's `name`, the key for a nameless product, rungs 3 and 4.                                             |
| `brand`         | no       | The row's `brand`, rung 3.                                                                                   |
| `ean`           | no       | The row's `ean`, rung 2. The one field that makes a row `ACTIVE` without a person.                           |
| `size`          | no       | `label` is the row's `sizeFormat` and in the key, and `unit` stands in when `label` is absent. `quantity` is `unitSize`, rung 3. |
| `price`         | no       | The till price for one unit. `amount` and `currency` required inside it. Absent means no price is written.   |
| `unit_price`    | no       | The comparison figure, verbatim. `amount` and `label` required inside it. A product with this and no `price` writes the unit price alone. |
| `validity`      | no       | This product's window, over the document's.                                                                  |
| `observed_at`   | no       | The price row's `observedAt`. Defaults to `producer.produced_at`, then to the import's start.                |
| `category_path` | no       | The row's `categoryPath`, and the category a created item defaults to.                                       |
| `url`           | no       | The row's `url`.                                                                                             |
| `extra`         | no       | Nothing. Stored on the row and on the price row, shown in the queue, never read by any rule.                 |

`extra` is a free object, and it is the whole answer to what a producer knows that the import
does not: a leaflet's loyalty block, its promotion, its page and raw text and confidence, a
chain that sells for points rather than money, a photo reference, whatever the next chain prints.
None of it changes what the import does. A product that costs points has no `price`, lands in the
queue with its `extra` visible, and a person decides. If a future rule wants to read something out
of `extra`, that is the moment it becomes a field, in a new schema version, and not before.

**What this moves out of the harvester.** `0081` section 6's three rules read a leaflet's
promotion, loyalty and basis blocks to decide which number is the price. Those blocks are `extra`
now, so the rules cannot run here, and they belong to the producer: the leaflet extractor states
a `price` only when a shopper pays that amount for one unit, states `unit_price` alone for a per
kilogram offer, and states neither for a loyalty gated or a second unit tile, putting the tile in
`warnings` or leaving it in `extra` as it sees fit. `leaflet-rules.ts`, `leaflet-validity.ts`
and the `LeafletDocument` schema are deleted from the harvester, and `LOYALTY_REQUIRED` and
`CONDITIONAL_PRICE` leave `HarvestWarningCode`, since a producer's warning arrives as text. The
extractor in `tmp/leaflet` is updated to emit this schema and apply those rules itself, which is
the producer's change and is part of this plan's build, and the three committed El Jamon outputs
are regenerated into it as fixtures.

### 6.2 In and out

**In.** `harvest.spawn` in mode `FILE_IMPORT` takes the document, the chain, the scope and the
source kind, and validates the document once more in the harvester, as the leaflet spawn does
today. `source_kind` is what the rows and the prices are stamped with. A re-imported Mercadona
walk stamps `OFFICIAL_API`, because that is what observed the price, not the upload. The digest
index of `0081` section 7 applies to every file.

**Out.** `harvest.export(runId)` answers a `HarvestDocument` holding every row of the run's
chain whose `lastRunId` is that run, with that run's price for that run's scope, the row's
`extra`, `producer` naming the harvester and the run, and the three hints filled in. The source group only: a decision is per
environment and an `itemId` means nothing on another cluster, while an EAN carries and resolves
there through rung 2. It is offered on a finished `CATALOG_DISCOVERY` or `FILE_IMPORT`, and it
is a read, so it is not gated by `HARVEST_ENABLED`: exporting from a machine that crawled to a
cluster that cannot is the point. A later run of the same chain moves rows out of that set as it
observes them again, which the admin plan says on the button.

The round trip is what makes the cluster switch of `0083` and k8s `0008` livable: a walk runs on
the compose stack where there is room for 4,383 requests, the export is uploaded to production,
and production's rows, ladder, queue and prices are exactly what a walk there produces.

## 7. Deciding a row

Three operations replace `sourceAlias.accept`, `sourceAlias.createItem`, `sourceAlias.reject`,
`sourceEntry.createItem`, `itemSourceRef.confirm`, `itemSourceRef.reject` and
`itemSourceRef.setManual`.

- **`sourceEntry.accept(entryId, itemId)`.** `ACTIVE`, `matchedBy: MANUAL`, confidence 1,
  `decidedAt` now. Then the prices.
- **`sourceEntry.createItem(entryId, overrides)`.** Creates the item from the row: `name.es` from
  `name`, `brand`, `ean`, `unitSize`, category from `categoryPath` through `resolveCategory` or
  the override, default unit from `sizeFormat` through `mapSizeFormat` or the override. The English
  name is fetched, one request, **only when `sourceKind` is `OFFICIAL_API` and the chain's
  source adapter is `mercadona-api`**, and only when that source is enabled. A leaflet row of the
  Mercadona chain is never fetched by its key, which is the hazard `0081` section 2 named and the
  reason `sourceKind` exists. An EAN the catalog already holds is refused with the existing item
  named, as today. Then binds as accept does, then the prices.
- **`sourceEntry.reject(entryId)`.** `REJECTED`, `itemId` null, `decidedAt` now. The next run that
  observes the key touches the row and asks nobody.

**The prices an accept writes are the ones on the row, one per scope.** Every `source_entry_prices`
row whose `validUntil` is null or in the future is written through `catalog.addPrices` to its own
`priceScopeId`, with its own `runId` as the run and the entry's `sourceKind` as the kind, and its
`observedAt`. That is the same rule for a walk and a leaflet: an admin who accepts a Mercadona
product on Tuesday gets the price Monday's walk saw, stamped with Monday's run, and the revert of
Monday's run takes it back with the rest. Two regional leaflets that both print the product each
get their price into their own scope, which is what today's re-reading of every open document
achieved and what D3 keeps. Today's accept parses the stored documents to find this key's offers,
which was the only way while the offer lived nowhere else. It lives in 3.2 now. The stored
document stays on the run for the digest index, for the export, and for `0082`.

`itemSourceRef.setManual` has no replacement. It linked an item to an external id by hand so that
a refresh fetched it. Nothing fetches by id any more: a walk finds every product the chain lists,
and a product no run has observed has no row, no price and nothing to link.

## 8. Revert

`0082` section 3 holds, restated for one table. On `harvest.revert(R)`, after catalog deleted
the prices stamped `R`:

- `source_entry_prices` rows with `runId = R` are deleted. They are the run's claims, and an
  accept after the revert must not write them again.
- Rows with `firstRunId = R` **and** `lastRunId = R` in `CANDIDATE` or `UNRESOLVED` are deleted.
  Nobody decided on them and no later run saw them. The second condition is new: a row this run
  created and a later run observed again is a real product a later run stands behind, and
  deleting it takes the later run's observation with it.
- Rows in `ACTIVE` or `REJECTED` survive whatever run created them. A person decided.
- Rows this run merely touched keep `timesSeen` and `lastSeenAt`.

`PRICE_WRITING_MODES` in `harvest-run.service.ts` loses `REFRESH` and names `FILE_IMPORT`.

## 9. The run modes and the spawn

`HarvestRunMode` is `STORE_DISCOVERY`, `CATALOG_DISCOVERY` and `FILE_IMPORT`. `REFRESH` is
deleted from the enum, from `run-executor.service.ts`, from the spawn's validation, from the
admin's mode list and from `harvest-seed.ts`. `refresh.runner.ts` and its spec go. When backlog
`0006` is picked up it adds a mode of its own for the one item a shopper asks about, and that
plan says what it is.

The spawn's validation for `CATALOG_DISCOVERY` reads the source's `adapterKey`, which it already
loads to refuse a disabled chain. `mercadona-api` requires `priceScopeId`, with the same sentence
a refresh used: the scope to write the prices for. `deza-web` accepts one and ignores it, because
the site prints no price and a required field that does nothing is a lie in a form.
`FILE_IMPORT` needs a chain, a scope, a source kind and a document, as the leaflet spawn does
minus the kind it assumed, and still no `SupermarketSource`. The source kind must be an official
one: no upload may write a user kind, which is the rule `catalog.addPrices` already enforces.

## 10. The surface

NATS, in `harvest.messages.ts`:

```ts
export const HARVEST_PATTERNS = { /* as today, plus */ export: 'harvest.export' } as const;

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
was the `NOT EXISTS` and the status says it now. Each row answers its `source_entry_prices` rows
inline, as the alias view answered its offer, since there is one per scope and a chain has a
handful of scopes.

Gateway, under `admin/harvest/entries`: `GET`, `POST :id/accept`, `POST :id/item`,
`POST :id/reject`. `admin/harvest/leaflets` becomes `admin/harvest/imports` and keeps its one
`POST` and its body limit, raised from 350 KB to what a 4,232 product export needs, measured
from a real one and stated in the DTO's own comment. `admin/harvest/runs/:id/export`
is a `GET` answering the document as a download. The `admin/harvest/aliases` and
`admin/harvest/item-refs` controllers are deleted.

Contracts: `SourceCatalogEntryView` gains 3.1's second group, `timesSeen`, `firstRunId`,
`lastRunId`, `sourceKind` and a `prices` array of `SourceEntryPriceView`. `SourceAliasView`,
`ItemSourceRefView`, their pages and their requests are deleted. `SourceAliasAcceptResult`
becomes `SourceEntryAcceptResult` with the same three fields: the row, `pricesWritten`, and the
item created or null. `AcceptSourceAliasRequest` and `CreateItemFromSourceAliasRequest` become
`AcceptSourceEntryRequest` and `CreateItemFromSourceEntryRequest`, the latter taking the same
optional overrides the alias one did, with every field optional because the row already holds a
default for each. `LeafletDocument` and its schema are deleted and `HarvestDocument` of 6.1
takes their place under `schemas/`, at version 1, with its own spec and fixtures.

`openapi.json` and `wire-types.ts` are regenerated, and the wire types spec is what proves it.

## 11. The migration

One migration, `1756900000000-OneSourceProduct`, in this order inside one transaction where
Postgres allows it and the enum dance outside, as `1756700000000-LeafletImport.ts` does:

1. Create `source_entry_status` and `source_entry_prices`. Add 3.1's new columns to
   `source_catalog_entries`, with `sourceKind` defaulting to `OFFICIAL_API` for the rows that
   exist, then overwritten for DEZA rows from their chain's `supermarket_sources.adapterKey`, and
   `status` defaulting to `UNRESOLVED`. A row whose `price` is not null becomes one
   `source_entry_prices` row for the chain's national scope, with `lastSeenAt` as `observedAt`
   and no run, since no walk recorded which. Then drop the three price columns.
2. Fold `item_source_refs` in. For each ref, the row of the same (`supermarketId`, `externalId`)
   takes `itemId`, `status`, `matchedBy`, `confidence`, `decidedAt` from `lastResolvedAt`.
   `MANUAL` status becomes `ACTIVE` with `matchedBy: MANUAL`. A ref whose row does not exist, which
   a `setManual` against a product no walk ever saw can have made, is counted, logged and
   dropped: there is no name to give it and nothing will fetch it. Two refs on one row, which the
   old index allowed and no run ever wrote, keep the one with the later `lastResolvedAt`.
3. Move `source_aliases` in. Each becomes a row with `externalId = sha1(aliasKey)`, which is
   exactly `entryKey(printedName, printedFormat)` because `aliasKey` was that string before the
   hash, `sourceKind: OFFICIAL_LEAFLET`, `name` from `printedName`, `sizeFormat` from
   `printedFormat`, `brand` from `printedBrand`, and the second group carried over as it is. It
   gets no price row: the alias never held one, the documents the old runs stored are in a shape
   whose rules this plan deletes, and the next import of a current leaflet fills it. A queued
   alias accepted after the migration and before that import binds and writes nothing, which the
   accept's own answer says. An alias whose key collides with a DEZA row of the same chain is the
   meeting section 3 wanted, and the alias's decision wins onto that row when the row has none.
4. Delete `harvest_runs` rows in mode `REFRESH`, rename the `LEAFLET_IMPORT` label to
   `FILE_IMPORT`, then rebuild `harvest_run_mode` without `REFRESH` and `item_source_match`
   without `EXTERNAL_ID`, by the rename and recreate the leaflet migration already does. No
   cluster has ever started a refresh: harvesting was never enabled for a chain in staging or
   production (plan `0083`), so the rows this deletes exist on developer slots only. The prices
   those runs wrote in catalog are rows of their own and stay.
5. Drop `item_source_refs`, `source_aliases`, `item_source_ref_status` and `source_alias_status`.

`down` recreates the two tables and their types and splits the rows back by `sourceKind`:
`OFFICIAL_LEAFLET` rows to aliases, decided rows of the other kinds to refs, and the national
scope's price back onto the row. It cannot restore the `REFRESH` runs, and says so.

Prove it on a throwaway Postgres before opening the pull request, with a database that holds rows
in all three tables and two leaflet runs of one chain for two scopes, through the built
`migrate.js` and the CLI path both. `migrations.integration.spec.ts` gets the same fixture.

## 12. Testing

Unit, no database:

- `source-ingest.spec.ts`: the five rungs, each in isolation. A price is collected for `ACTIVE`
  rows only. A `REJECTED` row is touched and writes nothing. A `CANDIDATE` from rung 3 and from
  rung 4 carries the right `itemId` or `candidateEntryId`. A sibling row is proposed across source
  kinds. Two runs for two scopes leave two `source_entry_prices` rows. Counters map onto the
  batch result as `refresh.runner.spec.ts` asserted.
- `mercadona-catalog.runner.spec.ts`: a walk writes prices for its `ACTIVE` rows and none for the
  rest; availability is negative only for a walk that finished; an aborted walk writes what it
  fetched and asserts no absence.
- `file-import.runner.spec.ts`: a product with a price becomes an observation with it, one
  without becomes one without, one with only a unit price writes the unit price alone, a
  duplicate key produces two with no price and a warning, a product's own validity beats the
  document's, `extra` lands on the row and on the price row untouched, the document's warnings
  reach the run, and the warnings per product are the ones the outcomes imply. The three El Jamon
  outputs regenerated into the schema serve, and one export fixture is captured from a slot's
  walk.
- `harvest-document.spec.ts`: the fixtures validate, a document with no `products`, no `sha256`
  or an unknown `schema_version` is refused naming the field, a `price` without `currency` is
  refused naming the product, and an `extra` holding anything at all is accepted.
- `harvest-export.spec.ts`: an export of a run holds the rows it observed and their prices for its
  scope, and no decision. Importing an export into an empty chain reproduces the rows.
- `deza-catalog.runner.spec.ts`: unchanged in what it asserts, moved onto the ingest.
- `source-entry.service.spec.ts`: accept writes every open scope price with its own run and the
  row's kind, not a leaflet price whose window closed, nothing for a row with no price;
  `createItem` fetches the English name for an API row of a Mercadona source and for nothing else;
  reject clears `itemId`; `name` is untouched by all three.
- `harvest-run.service.spec.ts`: a Mercadona discovery without a scope is refused, a DEZA one
  without a scope is not, a `REFRESH` mode is unknown, revert deletes by both run columns and
  deletes the run's price observations.

Integration, against a slot's Postgres through `test-integration`:

- `leaflet-import.integration.spec.ts` rewritten onto the one table, with two scopes.
- `migrations.integration.spec.ts` with rows in all three old tables, asserting the fold of
  section 11 row by row.

Then the two generated files, regenerated and committed, and `npx nx affected -t lint test build`
green. Build, not only test: the backend services type check in the build and nowhere else.

## 13. What this does not do

- It does not read a PDF, decide which price outranks which, or change what a shopper sees.
  `0080`'s policies are untouched and a leaflet still outranks a storefront where the owner said so.
- It does not decide which of a leaflet tile's numbers is the price. That was `0081` section 6,
  and it is the producer's now (6.1). The extractor's prompt change is part of this build; any
  rule about promotions a future chain prints is written there, never here.
- It does not draw the queue, the import or the export button. Admin plan `0014`.
- It does not build the shopper's per item refresh. Backlog `0006` holds it, restated against
  this plan, and it stays parked until Redis.
- It does not import till receipts. Backlog `0008` section 6 wanted a `kind` column on the alias
  table; it has one now, on the only table, and a receipt line is an observation of kind
  `USER_RECEIPT` when that plan is picked up.
- It does not schedule runs. A walk that writes prices makes a scheduled walk worth having, and
  `HarvestRunTrigger.SCHEDULED` has existed since `0038`; that is a plan of its own.

## 14. Exit criteria

- `item_source_refs` and `source_aliases` do not exist. `source_catalog_entries` carries 3.1 and
  is unique on (`supermarketId`, `externalId`). `source_entry_prices` holds one price per row per
  scope.
- A Mercadona walk against a scope writes an `OFFICIAL_API` price for every `ACTIVE` row it saw and
  scope availability for every `ACTIVE` row of the chain, negative only when the walk finished.
- A file import and a walk of the same chain produce rows of the same shape, resolved through the
  same ladder, in the same queue, and a leaflet name the owner accepted is proposed to the walk
  that later finds the product's id.
- A finished walk exports a `HarvestDocument`, and importing it into a chain with no rows
  reproduces the walk's rows, prices and ladder outcomes, stamped `OFFICIAL_API`.
- `HarvestRunMode.REFRESH` and `LEAFLET_IMPORT` do not exist anywhere in the workspace, including
  `openapi.json`. `FILE_IMPORT` accepts one schema, `HarvestDocument`, designed from what the
  import consumes, with an `extra` bag per product that is stored, shown and never read. The
  leaflet extractor emits it and its regenerated outputs validate against it.
- Accepting a queued row writes every still valid scope price the row holds, each with the run
  that observed it, for a walk and a leaflet alike. A fuzzy match never writes a price. A rejected
  row is never asked about again. `name` is never rewritten by a decision.
- `harvest.revert` deletes the run's price observations and the undecided rows the run alone
  stands behind, and nothing a person decided.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test build` is green.
