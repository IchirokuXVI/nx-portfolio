> **PR:** [#220](https://github.com/IchirokuXVI/nx-portfolio/pull/220)

# 0081 A leaflet is a source

Backlog `0001` section 5.3 named the leaflet as the third runtime flavour behind one adapter
interface. `PriceSourceKind.OFFICIAL_LEAFLET` exists and nothing writes it. This plan is the
writer.

An admin uploads a JSON document describing one supermarket leaflet and every offer printed in it.
The harvester validates it against a versioned schema. It matches each offer to a product the
catalog knows, by the name the chain printed last time. It writes the leaflet's price for a chosen
scope with the leaflet's own validity window. Offers that match nothing go to a queue an admin
works through. The admin half is admin plan `0010`. Reverting an import is plan `0082`.

**The output of an import is identical to the output of a crawl. Only the fetching differs.** An
uploaded document instead of HTTP. That is the owner's argument for putting this in the harvester,
and the code agrees with him. The write path to catalog exists there
(`catalog-client.service.ts`, audited as a `SERVICE` actor per plan `0075` section 3). So do the
run machinery with its progress and its lock, and the review queues in the back office. Putting
the import in catalog rebuilds all of it.

Depends on `0080` for the dated `ItemPrice` row, its validity window and its `sourceRunId`, and
on `0079` for a product with a Spanish name and no English one. Nothing in this plan reads a
leaflet PDF. `tmp/leaflet` produces the JSON. This plan consumes it.

## 1. A run with no source

`HarvestRunMode` gains `LEAFLET_IMPORT`. A run in that mode has `supermarketId` set and
**`sourceId: null`**.

`SupermarketSource` is fetching configuration: an adapter key, politeness, workers, a rate. An
upload fetches nothing and has none of those. `harvest_runs.sourceId` is already nullable
(`harvest-run.entity.ts`), exactly as `supermarketId` is nullable for a store discovery run. So a
chain that publishes only leaflets works with no `SupermarketSource` row at all, a chain with a
storefront keeps its one row, and the unique index on `supermarketId` stands. **No change to
`SupermarketSource`.** The brief proposed more than one source per chain, and this is why it is
not needed.

`run-executor.service.ts` gains a fourth `case` beside the three at lines 114 to 131, dispatching
to a `LeafletImportRunner` with `requireSource` not called. `validate` in
`harvest-run.service.ts` (lines 228 to 268) gains a branch: a `LEAFLET_IMPORT` run needs a
`supermarketId`, a `priceScopeId`, and a document.

Two consequences, stated because they are real:

- **The per chain lock applies.** `uq_harvest_run_active`
  (`1756200000000-InitialHarvesterSchema.ts`, lines 109 to 112) refuses a second active run for a
  chain. An import of a Mercadona leaflet during an eighteen minute discovery is answered 409 with
  the active run's id and waits. That is right: both write refs and aliases for that chain, and an
  import takes seconds once its turn comes.
- **`HARVEST_ENABLED` gates it.** `spawn` refuses every mode when the flag is false
  (`harvest-run.service.ts`, lines 90 to 96). Plan `0038` section 8.1 gives that switch a
  politeness purpose, and an upload touches no third party. It stays gated anyway. One switch that
  means "this pod starts runs" is simpler than two, and an upload that writes prices is a run.
  Section 11 turns the flag on where it is off.

## 2. `source_aliases`: the name the chain printed

The owner's requirement, in his words: the leaflet name must be recorded, so it resolves exactly
next time. Names are matched against the name already stored for the chain, never against the
catalog product name. One product appears in many leaflets and each names it differently.
Accepting a product into the catalog changes its name and brand at will, and that must not change
the name stored for the chain.

That is a table of aliases, chain scoped, many to one item, in the harvester database:

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `supermarketId` | uuid, opaque. |
| `aliasKey` | varchar. Section 2.1. |
| `printedName` | varchar. `product.name` exactly as printed. |
| `printedFormat` | varchar null. `product.format.raw` exactly as printed. |
| `printedBrand` | varchar null. `product.brand` when the extractor read one. |
| `itemId` | uuid null, opaque. Set on `ACTIVE` only. |
| `candidateItemId` | uuid null. What the fuzzy rung proposed, for the queue to show. |
| `candidateEntryId` | uuid null. A `SourceCatalogEntry` the fuzzy rung proposed, when no item exists yet. |
| `status` | `SourceAliasStatus`: `ACTIVE`, `CANDIDATE`, `UNRESOLVED`, `REJECTED`. |
| `matchedBy` | `ItemSourceMatch`. `NAME_SIZE` for a fuzzy proposal, `MANUAL` for an accepted one. |
| `confidence` | numeric(4,3). Below 1 only for `NAME_SIZE`. |
| `timesSeen` | integer. |
| `firstSeenAt`, `lastSeenAt` | timestamptz. |
| `firstRunId`, `lastRunId` | uuid null. The run that created it, the run that last saw it. |

Unique on (`supermarketId`, `aliasKey`). Indexed on `status` for the queue and on `firstRunId`
for plan `0082`.

**Accepting an alias sets `itemId` and never touches `printedName`.** The owner's rule falls out
of the schema. An admin who accepts a queued row and renames the item to "Cerveza Alhambra
Tradicional 33 cl" with brand "Alhambra" changes `items`. The alias still reads what the leaflet
printed, and the next leaflet that prints the same string hits the same row.

**Why not `SourceCatalogEntry` with a synthesized `externalId`.** That was the first proposal,
and it corrupts data. `mercadona.client.ts` lines 150 to 153 interpolate a stored `externalId`
raw into `GET /products/${externalId}/`, from `refresh.runner.ts` line 109 for every `ACTIVE`
ref, and lines 117 and 160 turn the 404 into `available: false`. A synthesized id on a Mercadona
item marks a real product out of stock on the next refresh. `ItemSourceRef` is unique on
(`itemId`, `supermarketId`), so it can hold one name per product per chain, and the owner wants
many. And `SourceCatalogEntry` rows enter the discovery matcher as candidates
(`matching.ts` lines 23 to 27). A separate table has none of those problems.

**Backlog `0008` section 6 wants this table.** Its `ItemReceiptAlias` has the same shape for the
same reason: a till prints `LECHE SEMI HACENDADO` for a product the storefront calls something
else, several strings over time, and a column forces an overwrite. When that plan is picked up it
adds a `kind` column here and writes receipt aliases beside leaflet ones.

### 2.1 The key

`aliasKey = normalizeName(product.name) + '|' + normalizeName(product.format.raw ?? '')`, with
`normalizeName` from `matching.ts` lines 38 to 45: NFD, strip accents, lower case, collapse
punctuation. The same function the discovery matcher uses, so the two agree.

**Brand is not in the key.** In `eljamon.pdftext.json`, `product.brand` is present on 0 of 219
offers. In the vision output it is present on 43 of 48. A key that includes brand resolves a
product one way from one extractor and another way from the other. Brand is stored on the row
for the queue to show and for nothing else.

**Format is in the key.** The owner decided that two offers with the same printed name are told
apart by their format. Measured on the leaflet: zero collisions on name plus `format.raw` in both
outputs, one collision on name alone (an extraction artifact, `le sale a`, twice). `format.raw` is
absent on 10 of 219 offers, and those fall back to the name alone.

**Two offers with one key in one document** go to the queue as `UNRESOLVED` with a
`DUPLICATE_KEY` warning, and neither writes a price. That is the residual case the owner routed to
the queue.

## 3. The ladder

Per offer, stopping at the first rung that answers:

1. **An `ACTIVE` alias with this `aliasKey`.** Write the price to its `itemId`. `timesSeen`,
   `lastSeenAt` and `lastRunId` move.
2. **A `REJECTED` alias.** Skip the offer, count it, record a `REJECTED_ALIAS` warning. The owner
   decided this string is not a product he tracks, and a run does not get to reopen that.
3. **A `CANDIDATE` or `UNRESOLVED` alias already queued.** Touch its timestamps and skip. It is
   already waiting for a person.
4. **No alias.** Try a fuzzy match. First against the catalog's own items through
   `ItemMatchIndex` (`matching.ts` lines 47 to 66), which already buckets items by normalized
   name, brand and size. Then, for a chain with a discovery snapshot, against
   `SourceCatalogEntry` by the same key, which proposes an entry the admin can promote with
   `sourceEntry.createItem`. A hit inserts a `CANDIDATE` with `candidateItemId` or
   `candidateEntryId`. No hit inserts `UNRESOLVED`. **Neither writes a price.**

Backlog `0001` section 6.2 is the rule and the reason: a bad fuzzy match writes a wrong price onto
a real product that users then shop on, which is worse than having no price. Every automated path
here stops one step short of that. The only thing that ever creates an `ACTIVE` alias is an admin
accepting one.

**Accepting a queued alias writes the price it was queued for.** The run is over by then. The
offer sits in the run's stored document (section 7). `sourceAlias.accept` binds the alias. Then it
reads every non reverted `LEAFLET_IMPORT` run for that chain whose validity is still open. It
finds the offers with this key and writes their prices with each run's own id. Without that, an
admin who works the queue has to upload the document a second time to get the prices he just
resolved.

## 4. The contract schema

`tmp/leaflet/leaflet.schema.json` is the extractor's schema, and `tmp/leaflet` stays its producer.
A schema that lives only in `tmp/` drifts: the extractor changes a field, nothing in the build
notices, and the first document that reaches the gateway fails on a shape nobody reviewed. So the
import contract is a copy, narrowed and versioned, in
`libs/luna-shopper/contracts/src/schemas/leaflet/leaflet-import-1.0.schema.ts`, with
`$id: https://ichirokuxvi.com/schemas/leaflet-import-1.0.json` and `schema_version` a `const`.
A new version is a new file and a new const. The gateway accepts every version the harvester
can read.

What is narrowed, and why:

- **`source.sha256` is required.** Section 7's dedupe keys on it. The extractor already computes
  it, and the `tmp` schema marks it optional only because it was written before anything read it.
- **`source.extraction`, `pages`, `bbox`, `source.extraction.render_dpi` are optional.** They
  describe how the document was produced. The import does not read them.
- **`offers[].raw_text` and `offers[].confidence` stay, optional.** They are what an admin wants
  when a queued row is in front of him: every text fragment the extractor assigned to the tile,
  and how sure it was. The queue shows both.
- **`warnings` stays.** The extractor's own dropped tiles are carried into the run's warnings
  (section 7), so the admin sees what the extractor lost beside what the import skipped.
- `additionalProperties: false` throughout, as in the source schema.

Validation runs twice. The gateway validates before the document crosses the broker, with
`validateSchema` from `contracts/src/schemas/validator.ts`, and answers a 400 problem document
listing every failure by `offers[].id` and JSON path. The harvester validates again at run start,
because it owns the schema version and a broker message is not a trusted input.

**`retailer.chain_id` is a hint, never a lookup key.** The admin picks the `supermarketId`, and
the upload screen shows `retailer.name` and `chain_id` beside the picker so a wrong pick is
visible. Two documents from two extractors spell one chain two ways, and a slug in a file is not
an identity.

## 5. Validity

`validity.starts_on` and `ends_on` are `date` values and nullable. A leaflet's dates are local
days in Spain.

- `validFrom` is `starts_on` at 00:00 `Europe/Madrid`.
- `validUntil` is the day after `ends_on` at 00:00 `Europe/Madrid`, exclusive.
- **The admin's override is required when either is null**, and offered always. The spawn
  refuses a run with a null bound.

No code in this backend names a timezone today. A small helper computes the UTC instant of local
midnight through `Intl.DateTimeFormat` with `timeZone: 'Europe/Madrid'`. That is what makes a
leaflet spanning the last Sunday of October keep its dates across the clock change.

**Lidl publishes three days before the prices apply.** A run on Thursday writes rows with
`validFrom` on Sunday. `0080`'s resolution excludes them until then, `nextBoundaryAt` on each
affected `supermarket_items` row is that `validFrom`, and the sweep flips them on Sunday with no
further write. A query for the price effective today is what the materialized row already answers.

## 6. The three import rules

Measured on `eljamon.pdftext.json` (219 offers) and `eljamon.vision.json` (48 offers, four sampled
pages). Every one of the 219 offers carries a promotion object.

### 6.1 Basis

| `pricing.basis` | Count of 219 | What is written |
| --- | --- | --- |
| `unit`, `piece` | 96 | `price` |
| `pack` | 30 | `price` |
| `kg`, `l` | 93 | `unitPrice` with `unitPriceLabel` from `basis`, `price` null |

Catalog's `price` means what the till charges for one pack (plan `0038` section 2.4). A price per
kilogram is not that. Plan `0067` met the same shape at the fish counter and wrote it the same
way. **That is 42% of this leaflet writing no till price**, and `bestOffer` ranks on `price`, so
those rows reach no basket line. Backlog `0011` records the consequence and the design that
removes it. It is a known limitation, accepted by the owner.

`pricing.unit_price` is the small comparison line. Its `per` is one of `l`, `kg`, `unit`, `wash`,
`m`, `100ml`, `100g`. It is written to `unitPrice` and `unitPriceLabel` on every offer that
carries it, verbatim and never converted. That is the rule `0038` section 2.4 set for Mercadona's
label.

### 6.2 Quantity conditional promotions

| `promotion.type` | Count of 219 | Headline `price` means |
| --- | --- | --- |
| `price_drop` | 176 | One unit, today. Write `price`. |
| `n_for_m`, `pack_bonus` | 6 | One unit, today. Write `price`. |
| `second_unit_discount` | 20 | The second unit. Buying one costs `single_unit_price`. |
| `multibuy_total`, `multibuy_unit_price`, `buy_n_get_free` | 13 | Per unit only at the required quantity. |
| none | 4 | Write `price`. |

The Radler tile is the case: `price: 0.39`, `single_unit_price: 0.79`. A shopper buying one can
is charged 0.79. Writing 0.39 as the product's price is wrong for 36 of 219 offers.

**Rule: for `second_unit_discount`, `multibuy_unit_price`, `multibuy_total` and
`buy_n_get_free`, write `promotion.single_unit_price` as `price`.** That is present on 30 of the
36 in the pdftext output and 11 of 11 in the vision output. An offer without it goes to the queue
as `UNRESOLVED` with a `CONDITIONAL_PRICE` warning and writes nothing. The only number on such a
tile is one a shopper cannot pay for one unit.

The owner's decision 4 says promotions are stored and read by nothing. The resolver reads nothing.
The importer must still choose which number is the price, and that choice reads `promotion.type`.
Those are different acts, and the plan states both.

### 6.3 Loyalty

`loyalty.required` is true on 6 of the 48 vision offers. The pdftext output cannot see it at all:
README section 12 shows the `descuentos ifamilia` badge is artwork and the word appears nowhere in
the text layer.

**A loyalty gated offer is skipped entirely.** No price row, no flag, no eligibility rule. The
offer is counted as skipped and recorded in the run's warnings with code `LOYALTY_REQUIRED`, its
id and its printed name, so the admin sees what was dropped and why. A card price is not the price
a non member pays, and the owner decided that loyalty is stored and not implemented.

### 6.4 Stored and read by nothing

`promotion` and `loyalty` are stored verbatim as `jsonb` on a new `item_price_details` row keyed
by `itemPriceId`, one per leaflet price row, together with `offerId`, `page` and `raw_text`. Not
on `item_prices` itself: that table is read on every recompute and a jsonb blob on every row is
weight the hot path pays for nothing. Nothing reads the details table except the admin's price
history (plan `0080` section 10), which shows the promotion wording beside the row.

## 7. The document and the run

**The document is stored in `harvest_runs.input`.** The entity documents that column as "the
run's own input, kept so a re-run can repeat it exactly", and this is that. The pdftext and OCR
outputs are 337 KB and 349 KB. The vision output is 57 KB for 48 offers, about 260 KB for a full
leaflet. Postgres stores a jsonb of that size out of line and nothing reads it on a hot path.
Plan `0082` reads it to revert and section 3 reads it on accept.

**`harvest_runs` gains three columns.** `documentSha256` varchar null, `warnings` jsonb default
`[]`, and `skipped` integer default 0. `HarvestRunView` gains `warnings`, `skipped` and
`documentSha256`. Backlog `0001` section 7.2 listed `skipped` among the counters and plan `0038`
dropped it because nothing skipped anything. Now something does.

**Dedupe is per document, at the run level.**

```sql
CREATE UNIQUE INDEX uq_harvest_run_leaflet_document
  ON harvest_runs ("supermarketId", "documentSha256")
  WHERE "documentSha256" IS NOT NULL
    AND status <> 'FAILED'
    AND "revertedAt" IS NULL;
```

A second upload of the same file for the same chain is answered 409 with the earlier run's id. A
run that failed does not block a retry. A run that was reverted does not block a corrected upload,
which is plan `0082`'s requirement. `revertedAt` is added here, nullable and unwritten, because
the index has to name it and rebuilding a unique index on this table later is worse than one
column plan `0082` fills.

**Counters.** `processed` is offers seen. `created` is price rows inserted, `unchanged` is rows
confirmed, per `0080` section 2.1. `notFound` is offers queued. `skipped` is offers dropped by a
rule. `failed` is offers the runner failed to process at all. Every skip and every queue entry is
also a warning with the offer's id, so the run page reads as a list of decisions.

**The document crosses the gateway as JSON, on a route with its own body limit.** Nest's JSON
body parser defaults to 100 KB, and `gateway/src/main.ts` configures none. So every real leaflet
is refused today with a bare 413. The gateway is created with `bodyParser: false`. The default
parser is mounted explicitly at 100 KB. `POST /v1/admin/harvest/leaflets` is mounted before it
with its own `json({ limit })`. The limit comes from a `LEAFLET_MAX_BYTES` setting, default 2 MB,
validated by Joi like every other number. `voice-recording.interceptor.ts` is the precedent for a per route cap
read through configuration and for a refusal that names the number rather than a bare 413.
Multipart is not used: the admin produces JSON, the schema validates JSON, and a form part around
it adds a parse step for nothing. NATS carries 8 MB (`nats.conf`, `values.yaml`), so the broker
needs nothing.

The route is a new controller, `admin/harvest/leaflets` version 1, beside the four in
`harvest.controller.ts`. Its body is `{ supermarketId, priceScopeId, validFrom?, validUntil?,
document }`. It validates, then sends `harvest.spawn` with mode `LEAFLET_IMPORT`, and answers the
`PENDING` run like the existing spawn route at line 83.

## 8. What a run does, in order

1. Validate the document against the schema version it names.
2. Insert the run with `documentSha256`, or answer 409 from the index above.
3. Resolve validity: the document's dates or the admin's override, to `Europe/Madrid` instants.
4. For each offer, in document order: apply section 6.3, then section 6.2, then section 6.1 to
   decide what number, if any, to write. Then climb the ladder of section 3.
5. Write prices in batches of 200 through `itemPrice.addBatch` with `sourceKind:
   OFFICIAL_LEAFLET`, `sourceRunId: run.id`, `validFrom`, `validUntil` and the row's details.
6. Upsert aliases, with `timesSeen`, `lastSeenAt`, `lastRunId` and `firstRunId` set on insert.
7. Write the warnings and counters, and finish `COMPLETED`.

The harvester holds `itemId`, `supermarketId` and `priceScopeId` opaquely and writes through
`CatalogClient`, as every run does. A `NATIONAL` scope receives the rows when the admin chose
one, and `0080` section 6 carries them to every scope of the chain.

## 9. Testing

- **The schema**: the three committed outputs in `tmp/leaflet` pass. A document with no `sha256`
  fails naming the path. An unknown `schema_version` fails.
- **The rules** over the real offers, as fixtures copied into the harvester's `__fixtures__`: the
  Radler tile writes 0.79, a `second_unit_discount` with no `single_unit_price` queues, every
  `kg` offer writes `price: null` and `unitPrice` with label `kg`, every loyalty offer writes
  nothing and produces one warning, `price_drop` writes `price`.
- **The ladder**: an `ACTIVE` alias writes, a `REJECTED` one skips with a warning, a queued one is
  touched and not duplicated, a fuzzy hit is `CANDIDATE` and writes nothing, two offers with one
  key both queue.
- **Accept writes the queued price** with the run's id, and does not write for a reverted run.
- **The key**: brand changes nothing, format changes everything, accents and case change nothing.
- **Validity**: `Europe/Madrid` midnights across the October clock change, a future `validFrom`
  produces a row that is not effective today and a `nextBoundaryAt` equal to it.
- **The run**: a second upload of one digest is 409, after a revert it is accepted, an import
  during a discovery of the same chain is 409, and the lock releases when either finishes.
- **The gateway**: a 337 KB document is accepted, a document over the limit is refused with the
  number in the problem document, and `openapi-document.spec.ts` is green on the regenerated
  file.
- Integration, in the `test-integration` target against a slot: the El Jamon pdftext output
  imported for a chain with three `ACTIVE` aliases seeded, then the prices read back through the
  gateway at the chosen scope.

## 10. What this does not do

- It does not read a PDF. `tmp/leaflet` and the model runs in its README are the producer, and
  the owner has said the extraction is manual for now.
- It does not decide whether a leaflet outranks a crawl. `0080` section 3 states the priority the
  owner set.
- It does not import weighed goods into a basket line. Backlog `0011`.
- It does not revert. Plan `0082`.
- It does not draw a screen. Admin plan `0010`.

## 11. Exit criteria

- A `LEAFLET_IMPORT` run exists with `sourceId: null`, needs no `SupermarketSource`, and is
  refused with a 409 while another run for that chain is active.
- `source_aliases` records the printed name and format per chain, many aliases per item, and
  accepting an alias sets `itemId` and leaves `printedName` untouched.
- An `ACTIVE` alias writes an `OFFICIAL_LEAFLET` price with the leaflet's window and the run's id.
  A fuzzy match never writes a price. A rejected alias is not asked again.
- The import schema lives in `contracts`, versioned, with `sha256` required, and the three
  committed outputs in `tmp/leaflet` validate against it.
- A per kilogram offer writes a unit price and no till price. A second unit tile writes the single
  unit price or queues. A loyalty gated offer writes nothing and appears in the run's warnings.
- `promotion` and `loyalty` are stored verbatim and no code path outside the admin history reads
  them.
- The document is stored on the run. A second upload of the same digest is refused until the
  first run is reverted. The gateway accepts a 350 KB document on that route and no other.
- **Enablement.** `harvestEnabled: true` in `values.staging.yaml` and `values.production.yaml`.
  An `actorId` provisioned through `provision-release.sh` in both clusters, and the same uuid
  rendered into catalog's `SERVICE_ACTOR_IDS`. `mercadonaEnabled` left false. Without the actor
  id `CatalogClient.actor()` throws (`catalog-client.service.ts` lines 73 to 78) and no import can
  write, which is the state of both clusters today.
- `openapi.json` and `wire-types.ts` are regenerated and committed, and
  `npx nx affected -t lint test` is green.
