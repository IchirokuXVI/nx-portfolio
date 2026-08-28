# 0001 (backlog) Supermarket price sources and the harvester

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.

Follows 0012, which shipped the catalog service (items, supermarkets, locations, per location
prices) as owner curated data entered by hand. This plan keeps hand entry as one input among
several and adds the machinery to keep prices fresh automatically: a scheduled, abortable,
progress reporting **harvester** service, a price model that stores every source of a price side
by side, and the item classification that makes "find me the cheapest milk" a real query.

Reference chains for the research: Mercadona, Lidl, DIA, Deza, El Jamón. They are examples, not
the target list. **The design assumes an open ended number of supermarkets**, most of which will
never have an automated source, so "no implementation" is a first class state and not a gap.

Companion code for the spike: `apps/luna-shopper-backend/tools/price-spike/`.

## 1. What the research established

### 1.1 Source availability

None of these chains publish an official, documented, terms of service blessed API. What exists
is what their own storefronts call.

| Chain | Source | Effort | Notes |
| --- | --- | --- | --- |
| Mercadona | `tienda.mercadona.es/api/` | Low | Unauthenticated JSON, warehouse scoped via `wh`. The only genuinely easy one. |
| DIA | `dia.es` storefront | High | JSON backed but behind bot protection; working scrapers all drive undetected Chrome. |
| El Jamón | `supermercadoseljamon.com` | Medium | Real online store, ~7k references, no documented API. Custom adapter needed. |
| Lidl | weekly leaflet PDF | Medium | No public grocery catalog. `lidl.es` is bazaar/non food, and the Lidl Plus API is per user OAuth returning receipts and coupons, not a catalog. The published leaflet is the only price surface. |
| Deza | weekly leaflet PDF | Medium | Corporate site only: locations, no e-commerce, no prices. The weekly folleto is the whole public surface. |

Four of five chains land in four different buckets (easy JSON, hostile JSON, plain HTML, PDF) and
none share an approach. That spread is the reason the fetching layer is a plugin interface with
declared capabilities rather than one crawler with per chain branches.

**The leaflet PDF is a real source, not a dead end.** Once prices can carry an OCR provenance
(section 2.3), Lidl and Deza stop being "no data" and become "leaflet only, weekly, with a
validity window". That is worse data than an API and much better than nothing, and it is the
single biggest reason the price model had to stop assuming one price per item per store.

### 1.2 Mercadona specifics

- `GET /api/categories/?lang=es&wh=<wh>` gives the category tree.
- `GET /api/categories/<id>/?lang=es&wh=<wh>` gives a leaf category with its products.
- `GET /api/products/<id>/?lang=es&wh=<wh>` gives product detail. **This is the per item fetch
  the daily refresh uses**, which is why an item must already carry the chain's product id.
- `PUT /api/postal-codes/actions/change-pc/` with `{"new_postal_code":"28001"}` returns the
  header `x-customer-wh`, the warehouse serving that postal code. This is the postal code to
  price scope resolver.
- There is **no text search** on the REST API. Search is a separate Algolia index
  (`products_prod_<wh>_es`) whose public app id and search key are embedded in the storefront
  bundle and **rotate**. Either walk the category tree (slow, no secrets) or re-discover the
  credentials from the live bundle at run time. The spike does both.
- Prices live under `price_instructions`: `unit_price` (pack price), `bulk_price` (per reference
  unit), `reference_format`, `size_format`, `unit_size`. **`bulk_price` and `reference_format`
  are the normalized unit price** that section 3.3 needs for cross size comparison, available for
  free from this source.

The missing text search is not a Mercadona quirk, it is the common case. Assume a source cannot
be asked "where is item X"; assume it can only be walked and then indexed. Section 7.1 turns that
into a discovery run followed by cheap per item refreshes.

### 1.3 Prices are not uniform within a chain

No, and the shape of the exception differs per chain. This is the finding that matters for the
data model.

- **Mercadona** is close to uniform but not uniform. Price is set per **warehouse**, not per
  store, and warehouses do diverge: press comparisons found 29 of 30 tracked products identical
  across Madrid, Barcelona, Valencia, Sevilla and Bilbao, with Coca-Cola 1.25 L at 1.49 € in four
  of them and 1.72 € in Barcelona. The Canaries and Balearics diverge further (IGIC rather than
  IVA). So: one price per warehouse, many stores per warehouse.
- **DIA** is the opposite case: roughly 1,400 of its stores are franchises. DIA sets a maximum
  price the franchisee must respect but does not stop them pricing below it, so genuine per store
  variation exists, and the online shop is a third price list on top of that.
- **Lidl** prices nationally, with island exceptions.
- **El Jamón** and **Deza** are regional chains; expect the online list (where it exists) to be
  its own price list, distinct from the shelf.

Industry corroboration: the Soysuper comparator models prices across more than 4,700 postal
codes rather than per chain, which is the same conclusion reached from the other direction.

### 1.4 Where the item list comes from

- **Per chain**: walk the chain's own category tree. Mercadona yields its full assortment
  (roughly 5,000 references) as JSON with no auth. DIA and El Jamón yield theirs through a
  browser driven adapter.
- **Canonical identity across chains** is the hard part: chain SKUs do not interoperate, and
  Mercadona's own brand products have no external equivalent at all. Join on **EAN/barcode**
  where available, and use **Open Food Facts** (`world.openfoodfacts.org/api/v2/product/<ean>`,
  open licence, strong Spanish coverage) as a source for the canonical `Item` (name, brand,
  image, category) rather than curating all of it by hand.
- Own brand products stay owner curated `Item` rows with no EAN, matched to their chain by a
  hand entered reference.

## 2. The price model

0012 has shipped, so every change here is a **new append only migration**, never an edit to
`1756000500000-InitialCatalogSchema`.

### 2.1 Price scope

`SupermarketItem` is currently keyed on (`itemId`, `supermarketLocationId`), one price row per
physical store. That is finer than any obtainable data: Mercadona would give 50 identical rows
per warehouse and nothing upstream distinguishes them.

Introduce a **price scope** between `Supermarket` and `SupermarketLocation`:

**PriceScope**
- `id`, `supermarketId`
- `kind` (`PriceScopeKind`: `NATIONAL` | `WAREHOUSE` | `POSTAL_CODE` | `STORE`)
- `externalKey` (the chain's own code for it, for example `mad1`), nullable
- `label` (localized)
- unique (`supermarketId`, `kind`, `externalKey`)

`SupermarketLocation` gains `priceScopeId`; many locations map to one scope. Prices are keyed on
(`itemId`, `priceScopeId`) instead of location.

A chain with no obtainable data is simply a `Supermarket` with one `STORE` kind scope per
location and manually entered prices. The model needs no special case for it.

The migration creates one `STORE` kind scope per existing location and backfills, so today's rows
survive unchanged in meaning; the collapse to coarser scopes only happens when Mercadona style
warehouse scopes are introduced deliberately.

### 2.2 Position moves, price stays

`positionInStore` and per store availability are genuinely per store even when price is not, so
they split out into **SupermarketLocationItem** (`itemId`, `supermarketLocationId`,
`positionInStore`, `available`), keyed on (`itemId`, `supermarketLocationId`). Do not force price
and aisle onto one granularity.

### 2.3 Many prices per item and scope, one per source kind

**A price is not a single value with a single origin.** The same product at the same scope can be
known from the chain's API, from its website, from OCR of its weekly leaflet, from a user
photographing a till receipt, from users simply reporting what they saw, and from the app owner
typing it in. **All of them are stored. None of them overwrite another.**

`SupermarketItem` stops carrying `price` directly. Prices move to:

**ItemPrice**
- `id`, `itemId`, `priceScopeId`
- `sourceKind` (`PriceSourceKind`, below)
- `price`, `currency`
- `unitPrice`, `unitOfMeasure` (normalized, for example € per litre; see 3.3)
- `observedAt` (when the price was true, not when the row was written)
- `validFrom`, `validUntil` (nullable; leaflets and promotions have windows)
- `sourceRunId`, `sourceUrl`, `sourceRef` (nullable provenance detail)
- `submissionCount` (user kinds only; derived from `PriceSubmission`, see 2.6), `confidence`
  (0 to 1; OCR confidence or user consensus)
- unique (`itemId`, `priceScopeId`, `sourceKind`)

One current row per kind per item per scope. Superseded values are not deleted, they roll into
`PriceObservation` history (2.5).

**PriceSourceKind** and how it is shown to users:

| `sourceKind` | Public class | Meaning |
| --- | --- | --- |
| `OFFICIAL_API` | Official | The chain's own API. |
| `OFFICIAL_WEB` | Official | The chain's own storefront HTML. |
| `OFFICIAL_LEAFLET` | Leaflet | OCR of the chain's published PDF folleto. |
| `ADMIN` | Verified | Typed in by the app owner. |
| `USER_RECEIPT` | Community | Submitted by a user, backed by a photo of a physical ticket. |
| `USER_REPORTED` | Community | Submitted by a user with nothing backing it. |

**The stored kind and the shown class are deliberately different things.** `OFFICIAL_API` and
`OFFICIAL_WEB` both display as "Official" because an end user has no use for the distinction, but
they are stored apart because *we* do: when a chain's API and its website disagree, that is a bug
worth seeing, and an adapter switching from one to the other is a change worth tracking. Every
adapter declares which kind it writes; no adapter may write a kind it does not own, and no
adapter may write a user kind at all.

`PriceSourceClass` (`OFFICIAL` | `LEAFLET` | `VERIFIED` | `COMMUNITY`) is derived from the kind
and lives in `contracts` next to it, so the mapping is one shared rule rather than per client
presentation logic.

### 2.4 The effective price

Users see one price, so something has to choose. That choice is **a stored policy, not hard coded
priority**, because it will change as user submission arrives and as trust in each source is
learned.

**PricePolicy**, one row per `sourceKind`, owner editable:
- `sourceKind`, `priority` (lower wins), `maxAgeDays` (nullable), `minSubmissions` (nullable),
  `enabled`

Defaults:

| Kind | Priority | Max age | Extra condition |
| --- | --- | --- | --- |
| `ADMIN` | 10 | none | none |
| `OFFICIAL_API` | 20 | 7 days | none |
| `OFFICIAL_WEB` | 30 | 7 days | none |
| `OFFICIAL_LEAFLET` | 40 | its `validUntil` | must be inside its validity window |
| `USER_RECEIPT` | 50 | 14 days | none |
| `USER_REPORTED` | 60 | 7 days | `submissionCount >= 3` |

Resolution: **filter to eligible rows first, then take the highest priority, then the most
recently observed.** Eligibility is what stops a stale winner from shadowing a fresh loser, which
pure priority ordering would do: a two month old API price should lose to yesterday's receipt,
and under this rule it does, because it is not eligible at all.

`SupermarketItem` becomes the **materialized effective price** for (`itemId`, `priceScopeId`):
`effectivePrice`, `effectiveUnitPrice`, `effectiveSourceKind`, `effectiveObservedAt`,
`effectiveFrom`. It is recomputed whenever an `ItemPrice` row for that key changes. Keeping it
materialized rather than computing it per query is what lets search sort by price at scale (3.4).

**Expiry needs a sweep.** A leaflet passing its `validUntil` changes the effective price with no
write to trigger a recompute, so a scheduled job recomputes keys with a crossed eligibility
boundary. Without it, expired leaflet prices would sit at the top forever.

**On the owner's manual price.** `ADMIN` outranks everything, which is the point of typing it in.
But it does not silently win forever: when a higher confidence source disagrees with a live
`ADMIN` price, the back office surfaces it ("your manual 1.29 € is overriding an official 1.19 €
observed today") so the override is a decision the owner keeps making rather than one they made
once and forgot. An `ADMIN` price may also be given a `validUntil` when it is known to be
temporary. This replaces the price lock flag an earlier draft of this plan used, which was a
cruder answer to the same problem.

### 2.5 Price history

**PriceObservation**, append only: `itemId`, `priceScopeId`, `sourceKind`, `price`, `unitPrice`,
`currency`, `observedAt`, `runId`, `sourceUrl`.

Only insert **on change** within a kind; an unchanged price bumps `lastConfirmedAt` on the
`ItemPrice` row instead, so a daily run over a stable assortment adds almost no rows. Cheap to
write now and impossible to backfill later, which is the argument for building it here even
though nothing reads it yet. Read APIs and charts are out of scope.

### 2.6 User submissions

The two community kinds in 2.3 are **aggregates**, one row per item and scope. The individual
things users send need their own table, because an aggregate cannot be moderated, attributed, or
recomputed after a bad submission is removed.

**PriceSubmission** (catalog database)
- `id`, `itemId`, `priceScopeId`
- `submittedByUserId` (opaque, from the token)
- `kind` (`USER_RECEIPT` | `USER_REPORTED`)
- `price`, `currency`
- `observedAt` (when the user says they saw it), `submittedAt`
- `receiptImageRef`, `receiptOcrText`, `ocrConfidence` (nullable; ticket backed submissions only)
- `status` (`PriceSubmissionStatus`: `PENDING` | `ACCEPTED` | `REJECTED` | `SUPERSEDED`)
- `rejectionReason`, `moderatedByUserId`, `moderatedAt`

**One table covers both flavors**, separated by `kind`: a price read off a photographed till
receipt, and a price a user simply typed in. They differ in what backs them, not in shape, and
the receipt columns are just null for the typed ones. Splitting them into two tables would
duplicate the moderation, aggregation and abuse handling that both need identically.

The `ItemPrice` row for a user kind is **derived, never written directly**: recomputed from the
`ACCEPTED` submissions for that item, scope and kind, with `submissionCount` as their count,
`price` as their consensus over a recent window, and `confidence` from how much they agree. This
is what makes moderation meaningful. Rejecting a submission recomputes the aggregate and the
effective price follows, which is impossible if users write the aggregate directly.

Submissions are the one part of the price model **written by ordinary users rather than the app
owner or the harvester**, so they are the only path here that needs rate limiting per user (0004
section 8), abuse handling, and a moderation queue. They are also user generated content and are
stored exactly as entered (0004 section 12).

**This plan reserves the table and the aggregation rule; it does not build the writers.** The
submission endpoints, image upload and storage, receipt OCR, moderation UI and abuse handling
belong to the later plan in section 13. Defining the table here is what keeps that plan from
being a schema redesign.

## 3. Classification and search

The goal, stated concretely: a user typing **"Milk"** into a list gets the best price across every
kind of milk; a user typing **"Pascual Milk"** gets prices for that brand only. Both need to be
comparable across pack sizes and across the stores that user actually shops at. The flat
`ItemCategory` enum from 0012 cannot do this.

### 3.1 Category tree

**Category**: `id`, `parentId`, `name` (localized), `slug`, `path` (materialized path for subtree
queries), `icon`. A real hierarchy (`Dairy > Milk > Whole milk`) rather than one flat level.

The `ItemCategory` enum shipped in 0012 and is on the wire, so it is not deleted: its values
become the seeded root level of the tree and the enum is marked deprecated in `contracts`, with
`Item.categoryId` becoming the live field. This is a wire visible change and gets a version bump
on the affected catalog controllers, per the independent per controller versioning in 0004.

### 3.2 Product group

A category is a browsing structure. **"Milk" as a thing you can buy** is a different concept and
needs its own entity.

**ProductGroup**: `id`, `categoryId`, `name` (localized), `slug`, `referenceUnit`
(`UnitOfMeasure`, the unit its members are compared in), `synonyms` (localized string array).

`Item` gains `productGroupId`. Every Pascual, Central Lechera, Hacendado and own brand milk points
at the one `Milk` group, which declares that they are comparable and that the comparison happens
in litres.

**This is the entity that makes the weekly basket possible.** Without it, "cheapest milk" is a
text search over product names and depends on every chain naming things similarly, which they do
not. With it, it is a lookup of one group's members and their effective prices.

It also has a consequence in **core**: a `ListLine` should be able to reference a *group* and not
only a specific item. "Milk" on a shopping list is a real, common, deliberately unspecific line,
and resolving it to a concrete product is exactly what the basket optimizer does later. So
`ListLine` gains a nullable `productGroupId` alongside the nullable `itemId` from 0007, with the
rule that at most one of the two is set. That is a core migration and is called out here because
it is the one part of this plan that reaches outside catalog and the harvester.

### 3.3 Attributes and the normalized unit price

`Item` gains `unitSize` and `unitOfMeasure` (1, `LITER`), `ean` (nullable, unique when present),
and a small `attributes` jsonb for the facets that distinguish members of a group (fat content,
lactose free, organic, packaging). Attributes are for filtering and display, never for identity.

Every `ItemPrice` carries `unitPrice` normalized to its group's `referenceUnit`, computed on
write from `price` and the item's `unitSize`. **Comparing pack prices is meaningless** across a
1 L carton and a 6 x 1 L pack, and the whole feature rests on the comparison being meaningful.
Mercadona hands us `bulk_price` directly (1.2); everywhere else it is derived, and an item with no
usable size cannot participate in group ranking and is flagged for curation.

### 3.4 Search

Postgres full text search, not a separate search engine. At a few tens of thousands of items one
more stateful dependency to operate buys nothing that a GIN index does not already give.

- Per locale `tsvector` columns (`search_es`, `search_en`) built from item name, brand, group name
  and synonyms, and the category path, with the matching Postgres text search configuration per
  language. GIN indexed, refreshed by trigger on write.
- `pg_trgm` alongside for typo and partial tolerance, which plain `tsvector` handles badly for
  brand names.
- A localized **synonym** list on `ProductGroup` (`leche` / `milk`, `desnatada` / `skimmed`) so
  the two locales reach the same group. Backend localization is a requirement here, not just a
  frontend concern (0004 section 12).

Two read shapes, because the two example queries are genuinely different:

- **`catalog.searchItems`**: ranked items with their effective price at the requested scopes. This
  answers "Pascual Milk".
- **`catalog.searchOffers`**: ranked **groups**, each with its cheapest eligible member per scope
  and the unit price that made it cheapest. This answers "Milk", and it is the query the list UI
  runs when a user types a bare word.

Both take a **set of `priceScopeId`s**, derived from the supermarket locations the user or zone
actually shops at. A price at a store nobody visits is noise, and passing the scope set in is what
keeps results honest.

Ranking: text relevance first, then exact brand or group match boost, then availability, then unit
price ascending. Results always carry `effectiveSourceKind` and `effectiveObservedAt` so the UI
can show a community price as a community price.

### 3.5 What this unlocks, and what is out of scope

The stated purpose is generating the cheapest weekly shop by splitting a basket across stores.
This plan builds everything that makes that computable: per scope effective prices, normalized
unit prices, product groups, list lines that can name a group, and a scope aware search.

**The optimizer itself is out of scope and needs its own plan.** It is a real optimization problem
and not a query: minimising basket cost against the cost of visiting more stores, respecting
availability, and handling groups where a user will accept some substitutes and not others. Doing
it badly (always the global cheapest, ignoring that it means five stops) would be worse than not
doing it. Noted in section 13.

## 4. Why the harvester is its own service

**Decision: a new `luna-shopper-backend-harvester` service with its own database.**

It is a genuinely different runtime shape from every existing service:

- **Resource profile.** Catalog answers request/reply NATS calls in milliseconds under a small
  memory limit. A DIA adapter drives headless Chromium and a leaflet adapter runs OCR over a PDF:
  hundreds of megabytes resident, minutes per run, and an image several hundred megabytes larger.
  Putting that in catalog means every catalog replica carries Chromium, an OCR engine, and their
  memory ceiling.
- **Blast radius.** Adapters parse hostile third party HTML and OCR noisy scans. Parse failures,
  hangs, memory leaks and bot protection bans are expected operating conditions. None of that
  belongs in the process that answers user reads.
- **Rollout.** A catalog deploy must be free to roll at any time (0002 section 6). A crawl in
  flight would be killed by every catalog rollout, and conversely a long run would sit in the
  drain window and delay it. Separating them means a catalog deploy never aborts a run.
- **Scaling.** Catalog scales with read traffic. The harvester is pinned to one replica because it
  holds an in process scheduler (7.6). Those cannot be the same deployment.

### 4.1 What lives where

**The automation configuration belongs to the harvester and nothing else needs to know it.** When
a chain is crawled, how politely, with which adapter, and how its products map to external ids are
all facts about the harvesting mechanism, not about the catalog. Catalog should not grow columns
that only exist because a crawler exists.

**Harvester database** (new): `SupermarketSource` (adapter, schedule, politeness, credential
references), `HarvestRun`, `SourceCatalogEntry` (discovery snapshots), `ItemSourceRef` (external
identity mapping).

**Catalog database** (existing): `Item`, `ProductGroup`, `Category`, `Supermarket`,
`SupermarketLocation`, `SupermarketLocationItem`, `PriceScope`, `ItemPrice`, `PricePolicy`,
`SupermarketItem` (the materialized effective price), `PriceObservation`.

The seam is the same one already used everywhere in this system: the harvester holds opaque
`itemId`, `supermarketId` and `priceScopeId` values and never joins across the boundary. It reads
the items it must refresh through catalog's paginated NATS reads (cached for the duration of a
run) and writes prices back through catalog's write subjects.

This costs a third Postgres instance and a third migration chain, which is a real operational
cost and is accepted deliberately. It also resolves a wart an earlier draft carried, where
discovery snapshots (pure harvest working data) sat in the catalog database only to avoid adding a
database. Putting the automation config where it belongs takes that with it.

**Authentication to catalog.** The harvester holds a dedicated `HARVESTER_ACTOR_ID` (a uuid)
listed in catalog's `PLATFORM_ADMIN_USER_IDS`. Every write it makes carries that id, so the
existing platform admin gate applies unchanged and harvest writes are attributable in the log
exactly like the owner's own writes. No new authorization machinery.

### 4.2 Alternatives considered and rejected

- **Inside catalog.** Rejected for every reason above. It is the cheaper thing to build and the
  more expensive thing to operate.
- **Kubernetes CronJob per source.** Superficially attractive (no idle pod, k8s owns the schedule,
  natural process isolation) and rejected on three counts. "Spawnable at will" from the back office
  would mean the app creating Jobs through the k8s API, which needs cluster RBAC granted to an
  application pod. Abort would mean deleting a pod, which cannot flush anything. And per
  supermarket schedules read from database rows would mean templating Helm from data, which does
  not work for an open ended supermarket list. A long lived Deployment with an in process
  scheduler is the right shape.
- **A serverless or queue worker per item.** Rejected: throughput is not the problem (a few
  thousand fetches a night), politeness and per source sequencing are, and those are easier to
  hold in one process.

## 5. Sources and adapters

### 5.1 SupermarketSource

One row per supermarket that has, or might have, an automated source. **Lives in the harvester
database.** It references `supermarketId` opaquely and catalog never reads it.

- `id`, `supermarketId` (unique; one source per chain)
- `adapterKey` (string, for example `mercadona-api`, `dia-browser`, `eljamon-web`,
  `deza-leaflet`, or the reserved `manual`)
- `enabled` (disabled means the scheduler ignores it and manual spawn is refused)
- `timezone` (IANA, default `Europe/Madrid`)
- `timeOfDay` (`HH:mm`, default `00:00`)
- `daysOfWeek` (set of `DayOfWeek`, default all seven)
- `jitterMinutes` (default 15)
- `discoveryIntervalDays` (default 7; how stale a discovery snapshot may get)
- `requestDelayMs`, `maxConcurrency` (politeness knobs, section 9)
- `config` (jsonb, adapter specific: base URL, postal codes to resolve, leaflet URL pattern, the
  **name** of a Kubernetes Secret when credentials are needed, never a credential value)
- `lastRunAt`, `lastSuccessAt`, `consecutiveFailures`

Schedule is stored as (`timeOfDay`, `daysOfWeek`, `timezone`) rather than a raw cron string
because that is what a back office form can render and validate, and because a named timezone is
what makes "midnight" survive DST. The cron expression handed to the scheduler is derived from
those three fields.

`adapterKey` is deliberately **not** an enum in `contracts`, unlike every other constant set in
this project. Adapters are a code registry that ships with the harvester, not a wire level
constant set, and a new supermarket usually needs no new adapter at all. It is stored as a string
and validated against the registry when a run is planned; an unknown key becomes a source health
warning rather than a crash. `harvest.adapters` lets the back office render a dropdown of what the
deployed harvester actually supports.

### 5.2 The adapter interface

One adapter per chain behind a common interface, with **declared capabilities** so the run planner
adapts instead of branching on chain names:

```ts
interface SourceCapabilities {
  discovery: boolean; // can walk the whole assortment
  textSearch: boolean; // can be asked "find X" by name
  fetchByExternalId: boolean;
  leaflet: boolean; // publishes a periodic priced document
  providesEan: boolean;
  providesUnitPrice: boolean;
  resolvesScopes: boolean; // can map a postal code to a price scope key
}

interface SupermarketSourceAdapter {
  readonly key: string;
  readonly capabilities: SourceCapabilities;
  /** The single PriceSourceKind every price from this adapter is written as. */
  readonly writes: PriceSourceKind;

  discover?(ctx: RunContext): AsyncIterable<SourceProduct>;
  search?(ctx: RunContext, query: ItemQuery): Promise<SourceProduct[]>;
  fetch(ctx: RunContext, ref: ItemSourceRef): Promise<SourceProduct | NotFound>;
  fetchLeaflet?(ctx: RunContext): AsyncIterable<SourceProduct>;
  resolveScope?(ctx: RunContext, postalCode: string): Promise<string>;
}
```

`RunContext` carries the resolved scope, the abort signal, the politeness limiter, the run logger
and the correlation id. `SourceProduct` is the normalized shape: external id, name, brand, EAN if
known, size and unit, price, unit price if the source gives one, currency, availability, validity
window, source URL, observed at, confidence.

Capabilities are how "the implementation might vary" becomes data rather than conditionals.
`textSearch: false` (Mercadona) means unresolved items cannot be resolved on demand and must wait
for a discovery run. `leaflet: true` with `discovery: false` (Deza, Lidl) means the only run mode
available is the leaflet one. `resolvesScopes: false` means the owner creates scopes by hand.

`writes` is declared, not chosen per call, so a price's provenance is a property of the adapter
rather than something an adapter can get wrong per item.

### 5.3 Three runtime flavors, one interface

HTTP/JSON adapters (Mercadona) run in process with `undici` and cost almost nothing. Browser
adapters (DIA, El Jamón) drive Playwright. Leaflet adapters fetch a PDF and run OCR over it, which
is CPU heavy and bursty rather than network heavy. All three implement the same interface, so if
their resource shapes diverge enough the expensive ones can be split into a second deployment
behind the same NATS subjects without touching the interface. Until then, one image carrying both
Chromium and the OCR engine, which is what makes this image the largest in the system.

Leaflet OCR quality is the reason `ItemPrice.confidence` exists and the reason `OFFICIAL_LEAFLET`
sits below the live sources in the default policy: a misread decimal point should not outrank a
number fetched from an API.

### 5.4 No implementation is a real state

A supermarket with no obtainable source gets either no `SupermarketSource` row at all, or one with
`adapterKey: 'manual'`. In both cases:

- The scheduler never fires for it.
- A manual spawn is **refused with a clear message**, not silently accepted and completed with
  zero items.
- Its prices come from `ADMIN` and, later, the user kinds. Nothing about the rest of the system
  changes.
- The back office lists it alongside the automated chains with an explicit "manual only" state.

This is the expected case for most supermarkets, not the exception. Adding a supermarket that will
never be crawled must require no code.

## 6. Item identity at a source

### 6.1 ItemSourceRef

The join between a catalog `Item` and its identity at one chain, in the harvester database. **This
is what makes the daily run cheap**: with a ref, refreshing one item is one request; without one,
it is a walk of the entire assortment.

- `id`, `itemId` (opaque), `supermarketId` (opaque)
- `externalId` (the chain's product id or SKU), nullable
- `externalUrl` (direct product URL or API path), nullable
- `matchedBy` (`ItemSourceMatch`: `EAN` | `EXTERNAL_ID` | `URL` | `SEARCH` | `NAME_SIZE` |
  `MANUAL`)
- `status` (`ItemSourceRefStatus`: `ACTIVE` | `CANDIDATE` | `UNRESOLVED` | `GONE`)
- `confidence` (0 to 1, only meaningful for fuzzy matches)
- `lastResolvedAt`, `lastSeenAt`
- unique (`itemId`, `supermarketId`)

Identity is **chain scoped**; price is **scope scoped**. A Mercadona product id is the same in
every warehouse even though its price is not, so a ref is one row per chain, reused across every
`PriceScope` of that chain.

### 6.2 The matching ladder

Tried in order, stopping at the first that produces a match:

1. **EAN/barcode** against the discovery snapshot. Strongest, and the only one that works across
   chains.
2. **External id already on the item**, where the chain's SKU is what the owner recorded.
3. **Exact URL** already recorded on the ref.
4. **Text search**, only if `capabilities.textSearch`.
5. **Normalized name plus brand plus pack size** against the discovery snapshot, fuzzy, reusing
   the same normalization the catalog search uses (3.4) so the two agree.
6. **Manual**: the owner pastes the product URL or id into the back office.

Steps 1 to 3 produce `status: ACTIVE` and are used immediately. Steps 4 and 5 produce
`status: CANDIDATE` and are **never used to write a price** until the owner confirms them. A bad
fuzzy match writes a wrong price onto a real product that users then see and shop on, which is
worse than having no price, so the automated path stops one step short of that.

### 6.3 Review queue and the discovery snapshot

**SourceCatalogEntry** is what a discovery run writes: `supermarketId`, `externalId`, `name`,
`brand`, `ean`, `sizeText`, `url`, `price`, `unitPrice`, `lastSeenAt`. It exists so matching can be
re-run offline, repeatedly, without re-crawling. Re-tuning the matcher then costs nothing and
touches no third party.

Everything that ends `CANDIDATE` or `UNRESOLVED` lands in a review queue the owner works through
in the back office: confirm, reject, or paste a URL. An item whose ref goes `GONE` (the source
returns not found twice running) also lands there, because a delisted product is a curation
decision, not something to delete automatically.

The snapshot is also the raw material for **creating** catalog items, not just matching them: a
discovery entry with an EAN that matches no item is a candidate new `Item`, enriched from Open
Food Facts (1.4) and assigned to a `ProductGroup` by the owner.

## 7. Runs

### 7.1 Four modes

- **DISCOVERY**: walk the assortment, write `SourceCatalogEntry`, then match against catalog items
  to create or refresh refs. Expensive and rare (`discoveryIntervalDays`, default weekly). This is
  the answer to sources with no text search: pay the full walk occasionally, then never again per
  item.
- **RESOLVE**: for items with no `ACTIVE` ref, try search (if supported) or re-match against the
  existing snapshot. Cheap, no full walk. Runs after a discovery, or on demand after the owner adds
  items.
- **REFRESH**: the daily one. For every catalog item with an `ACTIVE` ref for this supermarket,
  fetch it by ref and write an `ItemPrice` of the adapter's declared kind for each enabled scope.
  **Cost is proportional to the items the owner actually tracks, not the chain's assortment.**
- **LEAFLET**: fetch and OCR the current published leaflet, writing `OFFICIAL_LEAFLET` prices with
  the leaflet's validity window. Typically weekly and on the day the chain publishes, which is why
  `daysOfWeek` exists. For Lidl and Deza this is the only mode available.

A scheduled run is REFRESH (or LEAFLET for leaflet only sources), preceded automatically by a
DISCOVERY when the snapshot is older than `discoveryIntervalDays`.

### 7.2 HarvestRun

- `id`, `supermarketId`, `sourceId`
- `mode` (`HarvestRunMode`), `trigger` (`HarvestRunTrigger`: `SCHEDULE` | `MANUAL`)
- `status` (`HarvestRunStatus`: `PENDING` | `RUNNING` | `COMPLETED` | `FAILED` | `ABORTED` |
  `STALE`)
- `requestedAt`, `startedAt`, `finishedAt`, `heartbeatAt`
- `totalPlanned`, `processed`, `updated`, `unchanged`, `notFound`, `skipped`, `failed`
- `stage` and `stageLabel` (human readable, for the progress bar)
- `abortRequestedAt`, `abortedBy`
- `error` (last error summary), `correlationId`, `requestedByUserId`

State machine: `PENDING -> RUNNING -> COMPLETED | FAILED | ABORTED`, plus `RUNNING -> STALE` from
the reaper. Terminal states are never left.

### 7.3 One active run per supermarket, enforced by the database

```sql
CREATE UNIQUE INDEX uq_harvest_run_active
  ON harvest_runs ("supermarketId")
  WHERE status IN ('PENDING', 'RUNNING');
```

A spawn while a run is active fails on the insert and is returned as `409 Conflict` carrying the
active run's id: *"a run is already active, stop it first"*. This is a **database constraint, not
an in memory flag**, so it holds across harvester restarts, across a second replica if one ever
exists, and between the scheduler and a manual spawn racing at the same instant.

The lock is per supermarket, not global, so two chains can crawl concurrently. That is the right
granularity for an open ended supermarket list.

### 7.4 Abort

**There is one abort, and it is graceful.** `harvest.abort` sets `abortRequestedAt`; the run then:

1. cancels the in flight request or page load through its `AbortSignal`, so it does not sit waiting
   on a slow fetch before reacting,
2. stops crawling (no further items are fetched),
3. flushes the pending write batch to catalog,
4. closes browser contexts, OCR workers and connections,
5. finalizes the run row with its counters and ends `ABORTED`.

Everything observed before the abort is kept. Prices already fetched are valid data and there is
no reason to throw them away, so there is no "discard what you have" mode. Abort is fast because
step 1 makes it fast, not because it skips step 3.

**If the process cannot do this**, because it was force killed, ran out of memory, or the node
died, then nothing else happens: the open batch is lost, the run row is left `RUNNING`, and the
stale reaper (7.8) later marks it `STALE` and **logs the error**. No recovery is attempted and none
is designed. A lost partial run costs one night of freshness on one chain and the next scheduled
run fixes it, so recovery machinery would be complexity bought for nothing.

`SIGTERM` (a normal deploy) runs exactly the abort path above inside the shutdown drain window
(0004 section 7), so a rollout costs at most the current batch.

### 7.5 Progress reporting

Two layers, deliberately:

- **Persisted checkpoint.** Counters, `stage`, `stageLabel` and `heartbeatAt` are written to the
  run row every batch flush or every 10 seconds. This is what survives a page reload or a harvester
  restart, and it is cheap because it rides along with a write that is already happening.
- **Live stream.** The harvester publishes `harvest.run.progress` to NATS on every checkpoint.

For the live half, **phase one is polling** `harvest.run.get` from the back office every couple of
seconds. It needs zero new plumbing and the audience is one person. **Phase two, if polling feels
bad**, is an `admin:harvest` room in the realtime service (0009), which already owns fan out and
already has an SSE fallback; the only new part is an admin check on subscribe instead of a zone
membership check. Do not build a second push path in the gateway.

### 7.6 Scheduling

`@nestjs/schedule` with **dynamic cron jobs** registered from the harvester's own
`SupermarketSource` rows via `SchedulerRegistry.addCronJob`, using the derived cron expression and
the row's IANA timezone. Because the config now lives in this service's own database, the registry
is rebuilt directly on write with no cross service event needed, with a periodic reload as a
backstop.

The harvester runs at **one replica with the `Recreate` strategy** so two schedulers never coexist.
The database lock in 7.3 means a second replica would not cause duplicate runs, but it would cause
duplicate timers and pointless conflicts, so pinning is simpler than leader election.

### 7.7 Concurrency and staggering

An open ended supermarket list all firing at 00:00 is a real failure mode. Two defenses:

- `jitterMinutes` per source, so the actual fire time is the configured time plus a stable offset
  within that window. Stable per source, not re-rolled each night, so the schedule stays
  predictable.
- `HARVEST_MAX_CONCURRENT_RUNS` (default 2). Runs beyond the cap are created as `PENDING` and
  started as slots free. A `PENDING` run holds the per supermarket lock, which is correct: the
  supermarket already has a run coming.

Browser and leaflet runs count double against the cap, because their memory and CPU cost is what
the cap exists to bound.

### 7.8 Failure, heartbeat, shutdown

- **Per item failures do not fail the run.** They increment `failed`, log with the item id and the
  source URL, and the run continues. A run ends `FAILED` only when the source itself is unusable
  (auth wall, total connection failure) or when `failed` exceeds a configured fraction of
  `totalPlanned`.
- **Backoff.** 429 and 5xx trigger exponential backoff with jitter inside the politeness limiter.
  Repeated 429s end the run as `FAILED` rather than grinding on; being rate limited is the source
  asking to be left alone.
- **Consecutive failures.** Past a threshold the scheduler stops firing a source automatically and
  flags it in the back office. A chain that changed its site should notify the owner, not retry
  nightly forever.
- **Stale reaper.** A scheduled sweep marks `RUNNING` runs whose `heartbeatAt` is older than
  `HARVEST_STALE_AFTER` (default 15 minutes) as `STALE`, logs the abandoned run with its last known
  stage and counters, and releases the lock. This is the only recovery path for a force killed
  harvester, and it follows the reaper pattern already used in 0011 section 3.

## 8. Admin surface

New NATS subjects, all platform admin gated, exposed through the gateway under `/v1/admin/...`
following the existing per controller versioning.

On **catalog** (reference data and prices):
- `category.*`, `productGroup.*` (create, update, delete, list, tree)
- `priceScope.*` (create, update, delete, list)
- `itemPrice.*` (upsert, upsertBatch, list, delete) and `pricePolicy.*` (get, update)
- `catalog.searchItems`, `catalog.searchOffers` (open to authenticated users, not admin only)

On the **harvester** (automation, owner only):
- `supermarketSource.*` (upsert, get, list, setEnabled)
- `itemSourceRef.*` (list, listUnresolved, confirm, reject, setManual)
- `harvest.spawn` (`{ supermarketId, mode }`), returns the run or a conflict
- `harvest.abort` (`{ runId }`)
- `harvest.run.get`, `harvest.run.list`
- `harvest.adapters` (the registry and each adapter's capabilities)

`itemPrice.upsertBatch` matters: a run must not make one round trip per item.

New enums in `contracts`: `PriceSourceKind`, `PriceSourceClass`, `PriceScopeKind`,
`PriceSubmissionStatus`, `HarvestRunMode`, `HarvestRunTrigger`, `HarvestRunStatus`,
`ItemSourceRefStatus`, `ItemSourceMatch`, `DayOfWeek`. Note there is no abort mode enum, because
there is one abort.

## 9. Politeness and legal posture

Prices are public facts and not copyrightable, and PR Aviation v Ryanair (CJEU, 2015) held that a
site's terms cannot bind a scraper where the underlying data is unprotected. That is not blanket
permission: what remains is contractual terms of use, database *sui generis* rights over a
substantial extraction of a catalog, and trademark or asset reuse. The practical posture is
personal and comparative use, and it turns into concrete operating rules:

- **Fetch by reference, not by walking.** The whole ref design exists so the daily run touches a
  few hundred URLs, not five thousand. This is the politeness measure that matters most.
- **Rate limit per source**, `requestDelayMs` and `maxConcurrency`, defaulting conservatively (one
  request per second, concurrency 2). Honour `robots.txt`.
- **Identify honestly** with a user agent naming the app and a contact address.
- **Cap discovery.** `discoveryIntervalDays` has a floor; a full walk is not something anyone
  triggers casually.
- **Leaflets are published documents.** Fetching the weekly PDF a chain publishes for customers is
  the gentlest source available and should be preferred where both exist.
- **Global kill switch**: `HARVEST_ENABLED=false` stops the scheduler and refuses spawns, for when
  a chain asks or something goes wrong.
- **Do not copy their assets.** `Item.imageUrl` comes from Open Food Facts (open licence) or the
  owner, never from chain product photography or leaflet imagery, and images are not rehosted.
- **Attribute every price** with its source kind and observation time (2.3), which is also what
  makes the data honest to users.
- One adapter per chain, so a source that has to be dropped is dropped without touching anything
  else.
- **User submitted prices are user generated content**, stored as entered and never auto
  translated (0004 section 12), and carry whatever moderation the later plan that introduces them
  decides.

## 10. Deployment and configuration

New project `apps/luna-shopper-backend/harvester/` (`luna-shopper-backend-harvester`), following
0002:

- `src/Dockerfile`, multi stage from the repo builder image. The runtime stage needs Chromium and
  its system libraries plus the OCR engine, which makes this the largest image in the system.
  Non root user, `SIGTERM` handled.
- `build:docker` target with `imageName` `nx-portfolio/luna-shopper-backend-harvester` and
  development/production configurations, mirroring the other services.
- Helm entry under `apps` for production and staging, gated by `staging.enabled`. **Internal
  ClusterIP, no reverse proxy route** (its only callers are the gateway and its own scheduler).
  `replicas: 1`, `strategy: Recreate`, a higher memory and CPU limit than the other services, and
  **a pre upgrade migration Job** now that it owns a database.
- A third PostgreSQL instance for the harvester, added to `docker-compose.yml` for local
  development alongside the auth and core databases.
- Config: `PORT`, `NATS_URL`, `HARVESTER_DB_URL`, `LOG_LEVEL`, `HARVESTER_ACTOR_ID`,
  `HARVEST_ENABLED`, `HARVEST_SCHEDULER_ENABLED`, `HARVEST_MAX_CONCURRENT_RUNS`,
  `HARVEST_STALE_AFTER`, `HARVEST_USER_AGENT`, `HARVEST_BATCH_SIZE`.
- **Staging does not crawl.** `HARVEST_SCHEDULER_ENABLED=false` in staging, manual spawn only.
  Staging and production would otherwise hit the same third party sites twice a night for no
  benefit.
- `HARVESTER_ACTOR_ID` is appended to catalog's `PLATFORM_ADMIN_USER_IDS` in both environments.

## 11. Testing

- **No adapter test touches the network.** Recorded fixtures (real JSON, HTML and a sample leaflet
  PDF captured once, checked in under the adapter's `__fixtures__`) replay through the adapter, so
  a chain changing its markup shows up as a failing parse test with a diffable fixture.
- **A `fake` adapter** with configurable item counts, latencies and failure injection is the
  vehicle for every run lifecycle test: spawn, conflict on double spawn, abort flushes what it has,
  heartbeat and stale reaping, concurrency cap queueing, scheduler firing. None of it needs a real
  source.
- **Price resolution tests** are table driven over `PricePolicy`: for a given set of `ItemPrice`
  rows and a clock, assert which kind wins. Stale official beaten by fresh receipt, expired leaflet
  dropped, community price below `minSubmissions` ignored, admin override winning and being flagged
  when a fresher official price disagrees.
- **Search tests** assert the two example queries directly: "Milk" returns every milk group member
  ranked by unit price, "Pascual Milk" narrows to one brand, and both work in Spanish and English.
- **Matcher tests** run against a checked in `SourceCatalogEntry` snapshot with known good and known
  bad pairs, so a matcher change is measured rather than guessed.
- Integration tests follow 0010 and 0013: disposable stack, seeded catalog, fake adapter, assert
  the resulting `ItemPrice`, `SupermarketItem` and `PriceObservation` rows including provenance.

## 12. Open decisions

- **Live progress transport.** Poll first (7.5); the realtime `admin:harvest` room only if polling
  is not good enough. Recommendation: ship the poll, defer the room.
- **OCR engine.** Tesseract locally versus a hosted vision API. Local keeps the no external
  dependency posture and costs image size and accuracy; decide when the first leaflet adapter is
  written, behind the adapter interface either way.
- **Category tree source.** Seeded by hand, or derived from Open Food Facts categories, or from the
  chains' own trees. Leaning hand seeded and shallow, since it is a browsing aid and the
  `ProductGroup` does the real work.
- **Price history read surface.** The table is written from day one, nothing reads it yet.

## 13. Out of scope, and the plans that would follow

- **The basket optimizer** (3.5): the actual "cheapest weekly shop across several stores"
  computation. Needs its own plan; this one only makes it possible.
- **User submitted prices**: the submission endpoints, receipt photo upload and storage, OCR of
  user receipts, the moderation queue and abuse handling. The price model already defines the
  `PriceSubmission` table (2.6), the two user kinds, their policy entries and the rule that turns
  accepted submissions into an aggregate, so that plan adds writers and moderation, not a schema
  redesign.
- **Open Food Facts ingestion** as an item source (not a price source): the EAN join is the seam
  where it attaches.

## 14. Exit criteria

- `PriceScope` exists, prices are keyed on (`itemId`, `priceScopeId`), and `positionInStore` has
  moved to a location keyed row, all through a new append only migration.
- Every source of a price is stored side by side and none overwrites another; each carries its
  source kind, observation time, validity window and the run that produced it.
- A `PriceSubmission` table exists for both ticket backed and hand typed user submissions, and the
  community price a user sees is derived from the accepted ones rather than written directly, so
  rejecting a submission changes the price.
- Which price a user sees is decided by an editable policy of priority plus eligibility, not by
  hard coded ordering, and an owner override is visible as an override rather than silently
  permanent.
- Items belong to a category tree and a product group, carry a normalized unit price, and are
  searchable in English and Spanish: "Milk" returns every comparable milk ranked by unit price
  across the user's chosen stores, "Pascual Milk" narrows to that brand.
- Fetching is one adapter per chain behind a common interface with declared capabilities and a
  declared price source kind; chains with no source are explicit manual only sources, and adding a
  supermarket without an adapter needs no code.
- All automation configuration lives in the harvester and no other service has a column, field or
  message that exists only because crawling exists.
- Each supermarket configures its own schedule (time, days, timezone) and its own politeness
  limits, and the scheduler is built from those rows.
- A daily refresh fetches only items with a resolved reference for that chain; a discovery run is
  what creates those references for sources that cannot be searched; a leaflet run is a first class
  mode for chains that publish nothing else.
- A run can be spawned by hand at any time, reports progress that survives a page reload, and can
  be aborted once and gracefully, keeping everything observed up to that point.
- A second run for the same supermarket is refused while one is active, enforced by a database
  constraint rather than process state.
- A force killed harvester leaves no supermarket permanently locked, and the abandoned run is
  logged rather than recovered.
- Every price obtainable automatically can also be entered by hand, and every supermarket works
  with no automation at all.
