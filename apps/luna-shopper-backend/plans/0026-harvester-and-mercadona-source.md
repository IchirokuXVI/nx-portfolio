# 0026 The harvester service, and Mercadona as its first source

Backlog 0001 designs the whole price sourcing machine. This plan builds the **ingest half** of it
and leaves the **price modelling half** in the backlog.

Built here: the harvester service and its database, price scopes, two source libraries (Mercadona's
storefront API and OpenStreetMap for physical stores), store discovery, catalog discovery that
records EAN and brand per product, a single item refresh open to every user behind a global
cooldown, and the catalog schema those need.

Left in backlog 0001: `ItemPrice`, `PriceObservation`, `PricePolicy` and `PriceSubmission` (the
multi source price model), `ProductGroup`, the category tree and the rewritten search, leaflet OCR,
browser driven adapters, and the scheduler.

Everything in section 2 was measured against the live APIs on 2026-08-27. Where a number appears,
it came from a run, not from documentation.

## 1. The two decisions that shape everything else

**The fetching runs in a new `luna-shopper-backend-harvester` service with its own Postgres**, per
backlog 0001 section 4, built in its minimal form: HTTP and JSON only, no Chromium and no OCR
engine, so it is not yet the largest image in the system.

The deciding argument is measured rather than architectural. A catalog discovery run is **4,232
product detail requests** on top of a 151 request tree walk (section 2.5), which is roughly 20 to
25 minutes of continuous fetching. Catalog must be free to roll at any time (plan 0002 section 6),
and a rollout would kill that run every time. The cost accepted in exchange is a third database, a
Helm entry and a CI target.

**A refresh that arrives while the cooldown is closed is refused**, with the stored price, its
observation time, and the seconds remaining. Not queued, not silently served as a success. Section
6.3.

## 2. What the sources actually return

### 2.1 Mercadona: the endpoints this plan uses

Four, all unauthenticated JSON, under `https://tienda.mercadona.es/api/`.

| Call | Purpose |
| --- | --- |
| `PUT /postal-codes/actions/change-pc/` with `{"new_postal_code":"14013"}` | Returns header `x-customer-wh`, the warehouse serving that postal code. Stateless: no cookie or session needed. |
| `GET /categories/?lang=<l>&wh=<wh>` | The category tree, two levels. |
| `GET /categories/<id>/?lang=<l>&wh=<wh>` | One level 1 category, expanded to its level 2 children **with their products inline**. |
| `GET /products/<id>/?lang=<l>&wh=<wh>` | Product detail. The only place `ean` and `brand` exist. |

There is no product list endpoint and no text search. The assortment is obtained by walking the
tree, which is the "a source cannot be asked where item X is" case backlog 0001 section 1.2
anticipated.

Measured against `wh=4661`: **26 top level categories, 151 level 1 categories to fetch, 4,232
unique products, 31 seconds** for the walk itself.

### 2.2 Postal code 14013 resolves to warehouse `4661`

Verified, along with enough others to show the shape of the value:

| Postal code | Warehouse |
| --- | --- |
| 14013 (Córdoba) | `4661` |
| 28001 (Madrid) | `mad3` |
| 08001 (Barcelona) | `bcn1` |
| 41001 (Sevilla) | `svq1` |
| 46001 (Valencia) | `vlc1` |
| 35001 (Las Palmas) | `4701` |
| 07001 (Palma) | `3842` |

**The warehouse key is a string in two different shapes**, a numeric code and a city slug, so
`PriceScope.externalKey` is `varchar` and never an integer.

### 2.3 The items really are localized, and `LocalizedText` already covers it

`lang` is honoured for product names and category names alike. Product 4241:

| `lang` | `display_name` |
| --- | --- |
| `es` | Aceite de oliva 0,4º Hacendado |
| `en` | Light olive oil Hacendado |
| `ca` | Oli d'oliva 0,4º Hacendado |
| `gl`, `pt`, `va`, `eu` | falls back to the Spanish string |

**No schema change is needed.** `Item.name` is already `jsonb` holding `LocalizedText { en, es }`,
and Mercadona fills both from its own data rather than from a machine translation.

**Recommendation: do not add Catalan.** `LocalizedText` is `{ en: string; es: string }` in
`contracts` and backs every localized field in every service; widening it for a locale Velista does
not serve would touch the whole contract surface to store a string nothing reads. Recorded here so
that if Velista ever adds `ca`, this source is known to carry it and the ingest needs one more
fetch rather than a redesign.

The **cost** of the second language is what makes it a design decision rather than a free win:
fetching `es` and `en` for every product doubles a discovery run from 4,232 requests to 8,464.
Section 6.2 resolves that by fetching only `es` during discovery and `en` once, at the moment an
`Item` is actually created.

### 2.4 The price fields, and the one rule that matters

Under `price_instructions`:

- `unit_price`: the price of the pack. This is the price.
- `unit_size`, `size_format`: pack size and its unit. `size_format` is `kg`, `l`, `ud` or `m`
  (2,369 / 1,317 / 544 / 2).
- `bulk_price`: **the normalized price per reference unit**, the number that makes a 1 L carton
  comparable with a 6 x 1 L pack.
- `reference_format`: the label shown next to `bulk_price`. Observed: `kg` (2,182), `L` (816),
  `ud` (697), `100 ml` (405), `100 g` (97), `lv` (24), `dc` (8), `m` (2), `dz` (1).
- `is_pack` (442), `total_units`, `pack_size`, `drained_weight`, `tax_percentage`, `iva`,
  `previous_unit_price`, `price_decreased`.

**Store `bulk_price` verbatim and never recompute it.** The obvious derivation
`unit_price / unit_size` reproduces it for 3,760 of 4,232 products. A second rule,
`unit_price / total_units`, covers 326 more (coffee capsules and cereal bars, normalized per
capsule rather than per kilo). **110 products, 2.6%, match neither** and are inconsistent with
their own stated size. Deriving would silently disagree with the chain on one product in forty, in
the field whose only purpose is comparison.

**And `reference_format` is a display label, not a machine unit.** A product with
`size_format: 'l'`, `unit_size: 0.4`, `unit_price: 1.80` carries `bulk_price: 4.50`, which is per
**litre**, while `reference_format` reads `100 ml`. `100 g` likewise carries a per kilogram number.
`lv` means *lavados*, washing machine loads, on a per litre number. `dc` and `dz` (*docena*) sit on
per egg numbers. It is a price tag for a human and cannot be parsed into a unit.

So the unit price is stored as a number plus **the source's own label as text** (section 5.3), not
as a `UnitOfMeasure`. Forcing these into the enum would mean inventing a mapping the source does
not have.

### 2.5 EAN and brand exist only on the detail endpoint

Products embedded in a category response carry `id`, `slug`, `display_name`, `packaging`,
`thumbnail`, `share_url`, `published`, `categories` and the full `price_instructions`. They do
**not** carry `ean` and do **not** carry `brand`.

EAN coverage on detail was 40 of 40 in a random sample; brand 37 of 40 (one empty string, two
nulls, all novelty products). Detail fetches took **0.15 s each unthrottled**.

This is the arithmetic behind the whole shape of this plan. Capturing EAN and brand for the
assortment means one detail request per product, so discovery is **4,232 requests, not 151**, and
takes tens of minutes rather than half a minute. That is a background job with progress and abort,
which is a service, which is section 4.

### 2.6 Assortment varies by warehouse; price barely does

25 random products against `4661`, `mad3` and `bcn1`: every price identical, except one product
returning **404 in `bcn1`**. At this scale the per warehouse variation that matters is **whether
the product is carried**, not what it costs.

A 404 from a detail call is therefore a normal state meaning "not stocked in this warehouse". It is
a value, not an error, and it sets availability rather than failing a run.

**This does not make price scopes optional.** "Identical across three warehouses in a 25 product
sample" is evidence about the common case, not a guarantee, and the exceptions are known and
structural: the Canaries and the Balearics apply IGIC rather than IVA, and the press comparison
cited in backlog 0001 section 1.3 found Coca-Cola 1.25 L at 1.49 € in four cities and 1.72 € in
Barcelona. A schema that assumes uniformity has no way to represent the exception when it arrives,
and the exception is where a shopping app earns its keep. Scopes are built here (section 5.1).

### 2.7 Physical stores come from OpenStreetMap, not from Mercadona

Mercadona's store finder lives at `info.mercadona.es/es/supermercados`. It is **behind bot
protection**: the first request returned HTML, and after a handful more the host began answering
403 to the same client. It is a different property from `tienda.mercadona.es/api/`, which stayed
friendly throughout.

Chasing it would mean a browser driven adapter, per chain, for every chain. **OpenStreetMap answers
the same question for every chain at once**, which is what the requirement ("if there is any way to
get all supermarkets at once, that's better; same for other supermarket franchises") actually asks
for. Measured through the Overpass API:

- Every supermarket within 3 km of the 14013 centre: **26 results across 17 brands**, including
  four of backlog 0001's five reference chains (Mercadona, Deza, Dia, El Jamón, Lidl).
- Every Mercadona in Spain, one query: **1,609 elements**.
- Every Mercadona in Andalucía with full tags: **353 elements**, which is the sample the coverage
  table below comes from.

Tag coverage over those 353:

| Tag | Coverage |
| --- | --- |
| geometry (node position or way centre) | **100%** |
| `brand`, `brand:wikidata`, `shop` | **100%** |
| `name` | 99.4% |
| `website` | 70.0% |
| `opening_hours` | 37.4% |
| `addr:street` | 35.1% |
| `addr:postcode` | **32.9%** |
| `addr:city` | 28.9% |
| `addr:housenumber` | 21.5% |

**The consequence is that discovery is geographic and never filtered on `addr:postcode`.** Two
thirds of stores would vanish from a postcode filter, and position is the one thing every element
has.

`brand:wikidata` is the chain identity, not `brand`. In the 14013 area, `Dia` and `Maxi Dia` share
`Q925132`, and `ALDI` and `Aldi` share `Q41171373`, so name matching would split one chain into
several. It cuts the other way too: `Carrefour` (`Q217599`) and `Carrefour Express` (`Q2940190`)
carry different QIDs, which is arguably correct since their prices differ, but it means the QID is
a **good default identity that the owner must be able to override**, not an oracle.

35 of the 75 elements in the wider search carry no brand tag at all. Those are independent shops,
and they are precisely backlog 0001 section 5.4's "no implementation is a real state": a
`Supermarket` row with manual prices and no source.

### 2.8 The postal code and the radius answer two different questions

This is the finding that most changed the design.

Asking Nominatim for postal code 14013 returns a point (37.8587, -4.7863) **and a bounding box
spanning most of Córdoba city**. Querying supermarkets in that bounding box returns 75 elements and
12 Mercadonas, and **not one of those 12 is actually in 14013**: the ones that carry a postcode at
all read 14004, 14007, 14011 and 14014.

So "the Mercadona supermarkets in postal code 14013" is not a well posed question against this
data, and forcing it would produce either nothing (postcode filter, two thirds untagged) or all of
Córdoba (bounding box). What the requirement actually means is "the stores I can shop at", which is
a **radius around a point**.

The clean split, and it is clean:

- **The postal code determines the price scope**, through Mercadona's own resolver: 14013 to
  warehouse `4661` (2.2). This is authoritative, because it is the chain answering a question about
  its own pricing.
- **A radius around the postal code's centre determines the store list**, through OpenStreetMap
  (2.7). This is approximate, community sourced, and about geography rather than about price.

Two questions, two sources, neither pretending to answer the other.

## 3. The two libraries

Both are plain Nx TypeScript libraries beside `contracts`, `platform` and `test-fixtures`. Both
depend on `contracts` and on nothing else.

### 3.1 `@portfolio/luna-shopper/mercadona`

The Mercadona storefront API, grouped behind one boundary so that **nothing else in Luna Shopper
ever learns what Mercadona's JSON looks like**. That is the library's entire reason to exist.

```ts
/** One Mercadona product, already normalized. No TypeORM, no Nest, no catalog. */
export interface MercadonaProduct {
  externalId: string;            // "4241"
  ean: string | null;            // detail only
  name: { es: string; en?: string };
  brand: string | null;          // detail only
  unitSize: number | null;
  unit: UnitOfMeasure | null;    // from size_format; null for 'm'
  category: ItemCategory;
  price: number;                 // unit_price
  unitPrice: number | null;      // bulk_price, verbatim
  unitPriceLabel: string | null; // reference_format, verbatim
  currency: 'EUR';
  available: boolean;
  sourceUrl: string;             // share_url
  observedAt: Date;
}

export class MercadonaClient {
  static resolveWarehouse(postalCode: string, o?): Promise<string>;
  constructor(options: MercadonaClientOptions); // warehouse, delay, retries, UA, fetchImpl, signal
  listCategories(lang): Promise<MercadonaCategory[]>;
  listCategoryProducts(categoryId: number, lang): Promise<MercadonaListProduct[]>;
  getProduct(externalId: string, lang): Promise<MercadonaRawProduct | null>; // null on 404
  fetchProduct(externalId: string, langs): Promise<MercadonaProduct | null>;
  walkCatalog(): AsyncIterable<MercadonaListProduct>;
}
```

Normalization (the category mapping of 5.6, the unit mapping, the `bulk_price` rule of 2.4) lives
in a pure `normalize.ts`, taking raw JSON and returning `MercadonaProduct`, testable against
checked in fixtures with no network at all.

### 3.2 `@portfolio/luna-shopper/osm-places`

Nominatim for geocoding a postal code, Overpass for the query. Named after the provider because the
provider's data model (elements, tags, ODbL) leaks into the result shape and pretending otherwise
would be dishonest; a second provider gets its own library and a shared result type.

```ts
export interface DiscoveredPlace {
  provider: 'OSM';
  externalRef: string;            // "node/1156230891"
  brandKey: string | null;        // brand:wikidata, e.g. "Q377705"
  brandName: string | null;       // brand
  name: string | null;
  latitude: number;
  longitude: number;
  street: string | null;          // addr:street + addr:housenumber
  city: string | null;
  postalCode: string | null;
  website: string | null;
  openingHours: string | null;
  tags: Record<string, string>;   // kept whole; see 5.5
}

export class OsmPlacesClient {
  geocodePostalCode(pc: string, country: string): Promise<{ lat: number; lon: number }>;
  findSupermarkets(centre, radiusMetres: number): Promise<DiscoveredPlace[]>;
}
```

`findSupermarkets` issues one Overpass query, `nwr["shop"="supermarket"](around:R,lat,lon); out
center tags;`, and returns every element with its position resolved (a `way` uses its `center`).
It does not filter by brand: filtering happens after, in the harvester, because the run is
chain agnostic by design.

### 3.3 Why both are framework free

Backlog 0001 puts this code behind `SupermarketSourceAdapter` in the harvester. These libraries sit
one layer below that: the adapter interface is about **how a run is planned**, and the library is
about **what a source's JSON means**. Keeping them apart means the adapter registry can land later
without touching either library.

The hard constraint that makes it work: **no TypeORM entity, no repository, no Nest decorator, no
`Item`, no `SupermarketItem`, no database.** A library takes coordinates or a warehouse code and
returns plain records. The harvester maps them to rows.

`MercadonaClient` deliberately shadows the future adapter's method names: `resolveWarehouse` is
`resolveScope`, `walkCatalog` is `discover`, `fetchProduct` is `fetch`, `MercadonaProduct` is
`SourceProduct`. There is no `search`, because the API has none.

### 3.4 HTTP, and no new dependency

Node 20's global `fetch`. The repository has no HTTP client dependency today and this plan adds
none. Each client owns a serial request queue with a configurable delay, exponential backoff with
jitter on 429 and 5xx, 404 as a value rather than an error, an honest `User-Agent` naming the app
with a contact address, and an `AbortSignal` threaded through every call. That signal is what
section 6.5's abort is built on, and it is free at this point rather than retrofitted.

## 4. The harvester service

### 4.1 Shape

`apps/luna-shopper-backend/harvester/`, project `luna-shopper-backend-harvester`, following plan
0002: multi stage `src/Dockerfile` from the repo builder image, non root, `SIGTERM` handled,
`build:docker` target with `imageName` `nx-portfolio/luna-shopper-backend-harvester`, Helm entry
under `apps` for production and staging gated by `staging.enabled`, **internal ClusterIP with no
route** (its callers are the gateway and itself), `replicas: 1` with `strategy: Recreate`, and a
pre upgrade migration Job now that it owns a database.

A third PostgreSQL instance joins `docker-compose.yml` beside the auth and core databases.

Config: `PORT`, `NATS_URL`, `HARVESTER_DB_URL`, `LOG_LEVEL`, `HARVESTER_ACTOR_ID`,
`HARVEST_ENABLED`, `HARVEST_USER_AGENT`, `HARVEST_BATCH_SIZE`, `MERCADONA_ENABLED`,
`MERCADONA_USER_REFRESH_INTERVAL_MS` (default 300000), `OVERPASS_URL`, `NOMINATIM_URL`.

**No scheduler.** Backlog 0001 section 7.6's dynamic cron registry is not built: every run in this
plan is started by a person. The schedule columns (`timeOfDay`, `daysOfWeek`, `timezone`,
`jitterMinutes`) are therefore **not** added to `supermarket_sources`, because a column nothing
reads is a column that will be wrong by the time something does.

**Authentication to catalog** is backlog 0001 section 4.1 unchanged: the harvester holds a
dedicated `HARVESTER_ACTOR_ID` uuid listed in catalog's `PLATFORM_ADMIN_USER_IDS`, so every write
it makes passes the existing platform admin gate and is attributable in the log exactly like the
owner's own writes. No new authorization machinery.

### 4.2 The harvester database

| Table | Columns |
| --- | --- |
| `supermarket_sources` | `id`, `supermarketId` (opaque, unique), `adapterKey` (`mercadona-api`, `osm-places`, `manual`), `enabled`, `config` jsonb, `requestDelayMs`, `lastRunAt`, `lastSuccessAt`, `consecutiveFailures` |
| `harvest_runs` | `id`, `supermarketId` (nullable, see below), `sourceId`, `mode`, `trigger`, `status`, `requestedAt`, `startedAt`, `finishedAt`, `heartbeatAt`, `totalPlanned`, `processed`, `created`, `updated`, `unchanged`, `notFound`, `failed`, `stage`, `stageLabel`, `abortRequestedAt`, `error`, `correlationId`, `requestedByUserId` |
| `source_catalog_entries` | `supermarketId`, `externalId`, `name`, `brand`, `ean`, `unitSize`, `sizeFormat`, `price`, `unitPrice`, `unitPriceLabel`, `categoryPath`, `url`, `lastSeenAt`; unique (`supermarketId`, `externalId`) |
| `item_source_refs` | `itemId` (opaque), `supermarketId` (opaque), `externalId`, `externalUrl`, `matchedBy`, `status`, `confidence`, `lastResolvedAt`, `lastSeenAt`; unique (`itemId`, `supermarketId`) |
| `discovered_places` | `id`, `runId`, `provider`, `externalRef`, `brandKey`, `brandName`, `name`, `latitude`, `longitude`, `street`, `city`, `postalCode`, `website`, `openingHours`, `tags` jsonb, `status`, `supermarketLocationId` (nullable, set on import), `firstSeenAt`, `lastSeenAt`; unique (`provider`, `externalRef`) |
| `source_fetch_budgets` | `key` (pk), `lastFetchAt`, `minIntervalMs` |

`harvest_runs.supermarketId` is nullable because a **store discovery run belongs to a postal code
and a radius, not to a chain**: it discovers many chains at once (2.7), and several of them will
not exist as `Supermarket` rows until the run finishes.

One active run per supermarket, enforced by the database exactly as backlog 0001 section 7.3
specifies, so it holds across restarts and between two callers racing:

```sql
CREATE UNIQUE INDEX uq_harvest_run_active
  ON harvest_runs ("supermarketId")
  WHERE "supermarketId" IS NOT NULL AND status IN ('PENDING', 'RUNNING');
```

Store discovery runs are excluded from the lock by the null, and get their own single row guard on
`mode = 'STORE_DISCOVERY'`.

The seam is the one used everywhere in this backend: the harvester holds **opaque** `itemId`,
`supermarketId`, `supermarketLocationId` and `priceScopeId` values, never joins across the
boundary, and reads and writes catalog only through NATS.

## 5. Catalog schema changes

One append only migration on the single 0025 baseline. Plan 0025 reset the history and restored the
append only rule immediately, so this migration adds and backfills rather than editing
`1756000500000-InitialCatalogSchema`, even though no production database exists yet.

### 5.1 `PriceScope`

Backlog 0001 section 2.1, built as specified.

**`price_scopes`**: `id`, `supermarketId`, `kind` (`PriceScopeKind`: `NATIONAL` | `WAREHOUSE` |
`POSTAL_CODE` | `STORE`), `externalKey` (`varchar`, nullable), `label` (`jsonb`, `LocalizedText`),
unique (`supermarketId`, `kind`, `externalKey`).

Mercadona gets one `WAREHOUSE` scope with `externalKey = '4661'`. A chain with no obtainable data
gets one `STORE` scope per location and hand entered prices, and needs no special case anywhere.

**Assigning a location to a scope.** The warehouse is resolved from a *postal code*, and section
2.7 measured that only 33% of OSM stores carry one. So: where the store's own postal code is known,
resolve it; where it is not, assign the scope of the postal code the discovery run was centred on,
and flag the location for review. Section 2.6 is what makes this acceptable rather than sloppy:
within one city the price difference is not measurable, and the flag means the guess is visible
rather than silent.

### 5.2 Prices move from the location to the scope

`SupermarketItem` is re-keyed from (`itemId`, `supermarketLocationId`) to
(`itemId`, `priceScopeId`). This is the change that stops Mercadona writing 12 identical rows for
Córdoba.

`positionInStore` is genuinely per store even when price is not, so it splits out into
**`supermarket_location_items`** (`itemId`, `supermarketLocationId`, `positionInStore`,
`available`), keyed on (`itemId`, `supermarketLocationId`), per backlog 0001 section 2.2.

**One deviation from the backlog, and the measurement behind it.** Backlog 0001 section 2.2 puts
availability on the per store row. Section 2.6 measured that Mercadona's availability signal (a 404
on detail) is **warehouse scoped, not store scoped**, so an automated source can only ever populate
it at the scope level. Availability therefore stays on `SupermarketItem` as the scope wide answer,
and `supermarket_location_items.available` is a **nullable per store override** meaning "someone
checked this specific shop". Null means "no store specific information, use the scope's". Two
columns, two different claims, neither pretending to be the other.

Migration order, all in one transaction:

1. create `price_scopes`
2. insert one `STORE` scope per existing `supermarket_location`, `externalKey` = the location id
3. add `priceScopeId` to `supermarket_locations`, backfill, set `NOT NULL`
4. add `priceScopeId` to `supermarket_items`, backfill through the location, set `NOT NULL`
5. create `supermarket_location_items`, copy `positionInStore` and `available` across
6. drop `supermarketLocationId` and `positionInStore` from `supermarket_items`
7. add unique (`itemId`, `priceScopeId`)

Today's rows survive unchanged in meaning. The collapse to coarser scopes happens only when a
warehouse scope is created deliberately.

### 5.3 `Item` and `SupermarketItem`

| Table | Column | Type | Why |
| --- | --- | --- | --- |
| `items` | `ean` | `varchar` null, unique when present | The only identifier that joins across chains, and the reason discovery fetches detail per product. |
| `items` | `unitSize` | `numeric(12,4)` null | Without it `defaultUnit` says nothing. |
| `supermarket_items` | `unitPrice` | `numeric(12,4)` null | Mercadona's `bulk_price`, verbatim (2.4). |
| `supermarket_items` | `unitPriceLabel` | `varchar` null | The source's own `reference_format`. **Text, not `UnitOfMeasure`** (2.4). |
| `supermarket_items` | `priceObservedAt` | `timestamptz` null | Without it a price has no age. |
| `supermarket_items` | `priceSourceKind` | `price_source_kind`, default `ADMIN` | Where the number came from. |

`brand` already exists on `items` and needs no migration; what changes is that discovery now
populates it, which is why detail fetching is not optional.

`priceSourceKind` earns its place concretely rather than architecturally: **the first import writes
over rows a human may have typed in.** Without it the import cannot tell which rows are safe to
overwrite and the owner cannot see afterwards what happened. It ships with backlog 0001's full
value set (`OFFICIAL_API`, `OFFICIAL_WEB`, `OFFICIAL_LEAFLET`, `ADMIN`, `USER_RECEIPT`,
`USER_REPORTED`) because adding values to a Postgres enum later is a migration and defining them
now is free. Existing rows default to `ADMIN`, which is true.

**This is still not `ItemPrice`.** One price row per item per scope, one source wins by
overwriting, no history, no policy, no eligibility. What these columns buy is the ability to answer
"where did this number come from and when", which is the precondition for backlog 0001 section 2
rather than a piece of it. The rule that uses them is section 6.4.

### 5.4 `Supermarket`

| Column | Type | Why |
| --- | --- | --- |
| `externalBrandKey` | `varchar` null, unique when present | The chain's stable identity, here the Wikidata QID (`Q377705`). Dedupes chains across discovery runs and across providers. |

Section 2.7 is the argument: matching on the `brand` name splits `Dia` from `Maxi Dia`. It is
nullable because independent shops have no QID, and owner editable because the QID splits
`Carrefour` from `Carrefour Express`, which may or may not be what the owner wants.

### 5.5 `SupermarketLocation`

| Column | Type | Why |
| --- | --- | --- |
| `priceScopeId` | `uuid` not null | 5.1. |
| `postalCode` | `varchar` null | The entity has `address`, `city` and `country` but no postal code, which is a plain gap independent of any of this. |
| `externalRef` | `varchar` null, unique when present | `node/1156230891`. Dedupe key for re-running discovery. |
| `externalProvider` | `varchar` null | `OSM`. Meaningless to store a ref without saying whose. |

**`externalRef` is not a reliable primary identity.** An OSM element changes id and type when
someone upgrades a shop from a `node` to a mapped building `way`, so re-discovery matches on
`externalRef` first and then falls back to "same brand within 50 metres", and a location that
matches neither is offered as new rather than silently duplicated.

The full OSM tag bag stays in `discovered_places.tags` in the harvester database, not on the
catalog location. Catalog holds the fields it has a use for; the provider's raw payload is harvest
working data.

### 5.6 Categories, and where the mapping lives

Mercadona has 26 top level categories against our 12 `ItemCategory` values, so this is lossy by
construction. Two things reduce the damage.

**Map from the deepest category on the product, not the root.** `Charcutería y quesos` holds both
cured meat and cheese; mapping from the root files every cheese under `MEAT`.

**The table lives in the Mercadona library, not in the database**, so re-mapping costs a re-import
rather than a migration.

| Mercadona | `ItemCategory` |
| --- | --- |
| Fruta y verdura | `PRODUCE` |
| Carne | `MEAT` |
| Marisco y pescado | `SEAFOOD` |
| Panadería y pastelería | `BAKERY` |
| Congelados | `FROZEN` |
| Huevos, leche y mantequilla; Postres y yogures | `DAIRY` |
| Agua y refrescos; Bodega; Zumos | `BEVERAGES` |
| Aperitivos; Azúcar, caramelos y chocolate | `SNACKS` |
| Aceite, especias y salsas; Arroz, legumbres y pasta; Cacao, café e infusiones; Cereales y galletas; Conservas, caldos y cremas | `PANTRY` |
| Limpieza y hogar | `HOUSEHOLD` |
| Bebé; Cuidado del cabello; Cuidado facial y corporal; Fitoterapia y parafarmacia; Maquillaje | `PERSONAL_CARE` |
| Mascotas; Pizzas y platos preparados | `OTHER` |
| Charcutería y quesos, subcategories 53, 54, 56 (the three cheese ones) | `DAIRY` |
| Charcutería y quesos, everything else | `MEAT` |

`Mascotas` and `Pizzas y platos preparados` landing in `OTHER` is the clearest evidence that the
flat enum is not enough, which is backlog 0001 section 3.1's argument. This plan does not fix it; it
records the damage in one table so the fix has a starting point.

`size_format: 'm'` (two products, foil and cling film) has no `UnitOfMeasure` value.
**Recommendation: do not import them**, rather than add a `METER` value for two products.

### 5.7 What is deliberately not ingested

- **Product images.** Mercadona's own photography. Backlog 0001 section 9 rules it out: `imageUrl`
  comes from Open Food Facts or the owner, never from a chain, and is never rehosted. It stays null
  for imported items.
- **`packaging`** (`Garrafa`, `Brik`). Spanish only, and it belongs to the `attributes` jsonb that
  arrives with product groups. Storing it now in a column that later moves is worse than waiting.
- **`tax_percentage`, `iva`.** Nothing in the app reasons about VAT.
- **`price_decreased`, `previous_unit_price`.** Empty across all 4,232 products when measured, so
  there is nothing to model and nothing to test.
- **`nutrition_information`, `suppliers`, `origin`, `legal_name`, `mandatory_mentions`.** Genuinely
  interesting, out of scope, and Open Food Facts is the intended source for that class of data
  because its licence permits it.

### 5.8 `contracts`

New enums in `catalog.enums.ts`: `PriceSourceKind`, `PriceScopeKind`, `HarvestRunMode`
(`STORE_DISCOVERY` | `CATALOG_DISCOVERY` | `REFRESH`), `HarvestRunTrigger`, `HarvestRunStatus`,
`ItemSourceRefStatus`, `ItemSourceMatch`, `DiscoveredPlaceStatus`.

New views and requests for price scopes, the harvester subjects, discovered places, and the refresh
result. `ItemView` gains `ean` and `unitSize`; `SupermarketItemView` gains `priceScopeId`,
`unitPrice`, `unitPriceLabel`, `priceObservedAt`, `priceSourceKind`, and loses
`supermarketLocationId` and `positionInStore`; `SupermarketLocationView` gains `priceScopeId`,
`postalCode`, `externalRef` and `externalProvider`; `SupermarketView` gains `externalBrandKey`.

JSON schemas for every one of them per plan 0010. `SupermarketItemView` losing two fields is a
**breaking** wire change, so that controller takes a version bump under plan 0004's per controller
versioning; everything else is additive.

**`openapi.json` must be regenerated and committed in the same change**
(`npx nx run luna-shopper-backend-gateway:openapi`). The gateway's `openapi-document.spec.ts` fails
on a stale document, so forgetting it is a red PR rather than silent drift.

## 6. Runs

### 6.1 `STORE_DISCOVERY`

Input `{ postalCode, country, radiusMetres, brandKeys? }`. Steps:

1. Geocode the postal code through Nominatim to a **centre point**, discarding the bounding box
   (2.8).
2. One Overpass query for every `shop=supermarket` within the radius.
3. Upsert each element into `discovered_places` by (`provider`, `externalRef`), bumping
   `lastSeenAt`.
4. Report them grouped by `brandKey`, with a count and a sample, marking which already correspond
   to a known `Supermarket`.

**The run creates nothing in catalog.** A radius over a city returns 75 places of which half are
independent corner shops (2.7), and auto-creating those would fill the catalog with rows nobody
asked for. Import is a second, explicit step (`place.import`), which is also where the owner's own
hand entered supermarkets already fit without any new mechanism.

Importing a place: find or create the `Supermarket` by `externalBrandKey`, resolve the price scope
(5.1), create the `SupermarketLocation` with position, address fields, `externalRef` and
`externalProvider`, and write `supermarketLocationId` back onto the `discovered_places` row so a
re-run recognizes it.

### 6.2 `CATALOG_DISCOVERY`

The expensive one, for Mercadona. Input `{ supermarketId, priceScopeId }`.

1. Walk the category tree, level 1 by level 1 (151 requests), collecting products.
2. For each unique product, fetch detail **in `es` only** to capture `ean` and `brand`
   (4,232 requests).
3. Upsert `source_catalog_entries`.
4. Match against catalog items and refresh `item_source_refs`.

**Why `es` only.** Section 2.3: fetching both languages doubles the run to 8,464 requests. The
snapshot exists for matching and for candidate review, and the Spanish name is sufficient for both.
The English name is needed only when an `Item` is actually created, so it is fetched then, for that
one product. A discovery run therefore costs 4,383 requests and an item creation costs one more.

**Timing, and why it is a background job.** At the measured 0.15 s per request the fetching alone
is about 11 minutes, and at a politer 300 ms delay it is roughly 22 minutes. `requestDelayMs`
defaults to 1,000 for the small paths and discovery uses its own, lower, delay with concurrency 1.
Either way this is tens of minutes, which is why it cannot live in a service that redeploys.

**Matching ladder**, a shortened backlog 0001 section 6.2 with only the steps possible here:

1. `item_source_refs.externalId` already recorded, giving `ACTIVE`.
2. `ean` equal to a catalog item's, giving `ACTIVE`.
3. Normalized name plus brand plus size, giving **`CANDIDATE`**.

Steps 1 and 2 are used immediately. Step 3 is **never used to write a price** until the owner
confirms it: a bad fuzzy match writes a wrong price onto a real product that users then shop on,
which is worse than having no price. Text search is not a step, because the API has none.

Entries matching no item are candidate new `Item` rows the owner reviews. **This is the path that
populates the database**, and it is deliberately a review queue rather than a bulk insert of 4,232
products nobody chose.

### 6.3 `REFRESH`, and the global cooldown

Open to every authenticated user, capped at **one fetch per five minutes across the whole
platform**. This is not an abuse limit keyed on the caller, so `@nestjs/throttler` cannot express
it: that guard keys on the client IP and stores counters **in memory per replica**, so N gateway
replicas would allow N fetches per window. There is no Redis in this stack.

The cap is therefore a **row in the harvester database**, claimed atomically:

```sql
UPDATE source_fetch_budgets
   SET "lastFetchAt" = now()
 WHERE key = $1
   AND "lastFetchAt" <= now() - make_interval(secs => $2 / 1000.0)
RETURNING "lastFetchAt";
```

Zero rows returned means the window is closed. One statement, atomic under concurrency, correct
across replicas and restarts, and no new infrastructure. The harvester is pinned to one replica
anyway, but the correctness does not depend on that, which is the point.

**The slot is claimed before the fetch and is not released if the fetch fails.** Releasing it would
turn a failing source into a hammering loop, which is the opposite of what the cap is for.

**Discovery runs use a different budget key.** A discovery walk makes thousands of requests over
twenty minutes; sharing one budget would starve every user refresh for the duration. The honest
reading of the five minute cap is that it stops the public endpoint being a free proxy to
Mercadona, not that it is the whole of our politeness, so `mercadona:user-refresh` and the run's own
politeness limiter are separate. A user refresh works normally while a run is in progress.

**One claim buys one fetch of one (item, scope) pair.** The request carries an optional
`priceScopeId`; when absent it resolves to the item's only scope, or the scope of the zone the
caller shops in, and is refused as ambiguous when neither settles it.

Refused response, per the decision in section 1:

```json
{ "refreshed": false, "retryAfterSeconds": 143,
  "price": 1.29, "unitPrice": 1.29, "unitPriceLabel": "L",
  "observedAt": "2026-08-27T09:14:02Z", "priceSourceKind": "OFFICIAL_API" }
```

Carried on a `429` through the gateway's existing problem details shape, with `Retry-After`. The
client can render a countdown and still show the price it already has. A per IP gateway throttle
sits on top so that one client cannot spend its time collecting 429s.

### 6.4 Not clobbering a manual price

Using the columns from 5.3:

- `OFFICIAL_API` over a row whose `priceSourceKind` is `ADMIN` **does not overwrite the price**. It
  reports the fetched value as a disagreement and leaves the row alone.
- `OFFICIAL_API` over a row that is already `OFFICIAL_API`, or over a row with no price, overwrites
  and updates `priceObservedAt`.
- The owner overrides by editing through `supermarketItem.upsert`, which sets `ADMIN` and pins it.

A two case, hard coded version of backlog 0001 section 2.4's stored `PricePolicy`, hard coded
because two kinds are reachable. When `ItemPrice` and `PricePolicy` arrive this rule is **deleted**,
not extended. It is not written as a foundation for them.

### 6.5 Progress, abort and failure

- **Counters, `stage`, `stageLabel` and `heartbeatAt`** are written to the run row every batch and
  at least every 10 seconds. This is what survives a page reload, and it rides along with a write
  that is already happening.
- **Live progress is polling** `harvest.run.get`, per backlog 0001 section 7.5 phase one. The
  realtime `admin:harvest` room stays deferred. Do not build a second push path in the gateway.
- **Abort is graceful and there is one of it.** `harvest.abort` sets `abortRequestedAt`; the run
  cancels the in flight request through its `AbortSignal`, stops fetching, flushes what it has,
  and finalizes as `ABORTED`. Everything observed before the abort is kept, because prices already
  fetched are valid data. `SIGTERM` runs the same path inside the shutdown drain window.
- **Per item failures do not fail the run.** They increment `failed` and log with the external id
  and URL. A run fails only when the source is unusable or `failed` crosses a configured fraction
  of `totalPlanned`. Repeated 429s end the run rather than grinding on.
- **A stale reaper** marks `RUNNING` runs whose `heartbeatAt` is older than `HARVEST_STALE_AFTER`
  (default 15 minutes) as `STALE`, logs them, and releases the lock. This is the only recovery path
  for a force killed harvester and none other is designed: a lost run costs one refresh cycle.

## 7. The surface

On the **harvester**, platform admin gated, through the gateway under `/v1/admin/harvest/`:

- `harvest.spawn` `{ mode, supermarketId?, priceScopeId?, postalCode?, radiusMetres? }`, returning
  the run or a `409` carrying the active run's id.
- `harvest.abort` `{ runId }`; `harvest.run.get`, `harvest.run.list`.
- `place.list`, `place.import`, `place.reject` (6.1).
- `itemSourceRef.list`, `.listUnresolved`, `.confirm`, `.reject`, `.setManual` (6.2).
- `sourceEntry.list`, `sourceEntry.createItem` (promote a discovery entry to a catalog `Item`).
- `supermarketSource.upsert`, `.get`, `.list`, `.setEnabled`.

On **catalog**, platform admin gated: `priceScope.create`, `.update`, `.delete`, `.list`, and
`supermarketItem.upsertBatch` so a run does not make one round trip per item.

Open to any authenticated user: `catalog.refreshItem` (6.3), exposed as
`POST /v1/catalog/items/:itemId/refresh`.

## 8. Politeness, and the licences

### 8.1 Mercadona and robots.txt

`https://tienda.mercadona.es/robots.txt` reads, for every user agent:

```
Allow: /$          Allow: /favicon.ico    Allow: /sitemap.xml    Allow: /product
Disallow: /        Disallow: /api         Disallow: /legal
```

**`/api` is disallowed**, so this plan is in tension with backlog 0001 section 9's "honour
robots.txt", and pretending otherwise would be dishonest.

What is actually true: robots.txt is a convention addressed to crawlers building indexes, not a
contract and not a technical control, and the CJEU position backlog 0001 section 9 cites (PR
Aviation v Ryanair, 2015) concerns terms of use rather than robots directives. Note that
`/product`, the human page the API's own `share_url` points at, **is** allowed, so the objection is
to automated bulk access rather than to the data.

Rather than argue it, the plan constrains the behaviour so the objection does not apply: no
scheduler, so every request happens because a person asked; discovery is a rare owner action, not a
nightly crawl; a serial queue with a conservative delay and backoff on 429; an honest User-Agent
with a contact address, and specifically **not** the Chrome impersonation the public reference
implementations use; no asset copying (5.7); personal comparative use; and `MERCADONA_ENABLED`,
default false in staging so staging and production never hit the same third party twice for the
same data. If Mercadona ever asks, the flag goes false and the catalog keeps working on hand
entered prices, which is the property backlog 0001 section 5.4 designs for.

### 8.2 OpenStreetMap, Nominatim and Overpass

Different posture entirely, because the data is openly licensed and the access is sanctioned. It
still has rules, and they are stricter about *how* than about *whether*.

- **ODbL.** OSM data requires attribution ("© OpenStreetMap contributors") wherever discovered
  store data is shown, and it carries share-alike obligations on a derived database. For a personal
  app this is satisfied by attribution in the UI; it is recorded here because the obligation is real
  and would need revisiting before publishing this data.
- **Nominatim usage policy**: at most one request per second, a genuine User-Agent with contact,
  no bulk geocoding, and results may be cached. This plan geocodes **one postal code per discovery
  run**, so it sits far inside the policy, and the resolved centre is cached on the run.
- **Overpass** is a volunteer funded service. One query per discovery run, a bounded radius, an
  honest User-Agent, and `OVERPASS_URL` configurable so a self hosted instance can be pointed at
  without a code change if usage ever grows.
- **The tag bag is stored as fetched** in `discovered_places.tags` rather than being reshaped, so
  provenance stays intact and a mapping change is visible rather than lost.

## 9. Testing

**No test touches the network.** A capture script writes real fixtures under each library's
`__fixtures__/`.

- **Mercadona normalization** over fixtures chosen for the awkward cases: `bulk_price` equal to
  `unit_price / unit_size`, a coffee capsule equal to `unit_price / total_units`, one of the 110
  that matches neither, `reference_format: '100 ml'`, `size_format: 'm'`, a product with no EAN,
  and a 404. Assert the exact `MercadonaProduct`, so a shape change is a failing test with a
  diffable fixture.
- **OSM normalization** over a captured Overpass response: a `node` and a `way` (centre
  resolution), an element with no `brand`, `Dia` and `Maxi Dia` collapsing to one `brandKey`, and
  an element with no address tags.
- **Client tests** inject `fetchImpl` and assert delay, backoff, abort and 404 to null.
- **Category mapping** asserts the whole 5.6 table including the cheese override.
- **The cooldown** is the one that deserves a real database: two concurrent claims against a live
  Postgres, asserting exactly one wins and the loser's `retryAfterSeconds` is correct. An in memory
  fake cannot prove the property that matters.
- **Migration test** seeds the pre-migration shape, runs the 5.2 migration, and asserts every
  existing `SupermarketItem` still resolves to the same price through its new `STORE` scope, and
  that `positionInStore` survived the move.
- **Run lifecycle** against a fake adapter with configurable counts and failure injection: spawn,
  conflict on double spawn, abort flushes what it has, heartbeat, stale reaping.
- **Overwrite rules** (6.4): an `ADMIN` row is not overwritten and is reported as a disagreement,
  an `OFFICIAL_API` row is, a 404 sets availability without touching the price.
- **One opt in live test** per library, skipped unless `LUNA_LIVE_SOURCE_TEST=1`, asserting only
  that the field names still exist. Never runs in CI; it exists so a stale fixture says so.

## 10. What still belongs to backlog 0001

| Deferred | Why it is safe to defer |
| --- | --- |
| `ItemPrice`, `PriceObservation`, `PricePolicy`, `PriceSubmission` | Prices stay single valued on `SupermarketItem` with a source kind and an observation time, which are the same fields renamed when the multi source model lands. The 6.4 rule is deleted, not migrated. |
| `ProductGroup`, category tree, `tsvector` search | Nothing here writes a category tree; `Item.category` keeps its enum and 5.6 records the loss. |
| Leaflet OCR, browser adapters (DIA, El Jamón) | The library boundary in section 3 is where they attach. No interface changes. |
| The scheduler (backlog 0001 section 7.6) | No schedule columns are added, so none are wrong when it arrives. |
| The realtime `admin:harvest` room | Polling is phase one by the backlog's own recommendation. |
| The basket optimizer | Needs product groups first. |

## 11. Open decisions

- **Discovery language.** Section 6.2 fetches `es` only and pays one extra request per created
  item. If the review queue turns out to want English names while browsing candidates, the run
  doubles to 8,464 requests and roughly 45 minutes. Recommendation: `es` only, revisit if the
  queue is genuinely unusable in English.
- **Default discovery radius.** 3 km returned 26 supermarkets around 14013 and the wider box
  returned 75. Recommendation: default 3 km, owner adjustable, because the review step makes a
  small over-fetch cheap and a large one tedious.
- **Whether `place.import` should auto-create the chain.** Creating `Supermarket` rows for 17
  brands from one run is convenient and clutters the catalog with chains the owner will never
  shop at. Recommendation: import is per place and creates the chain on demand.
- **How many items to import first.** Deliberately unspecified. Suggestion: the twenty or so
  products of a real weekly shop, enough to exercise every branch in 5.3 and small enough to
  eyeball.
- **`Item.name.en` when Mercadona has no English string.** Falls back to Spanish, so an English
  speaking user sees Spanish. Refusing to import is worse. Recommendation: fall back and flag for
  curation. How often this happens has not been measured; it is one line in the capture script.

## 12. Exit criteria

- `luna-shopper-backend-harvester` exists with its own database, its own migration chain, a Helm
  entry, a compose entry, and no route of its own.
- `@portfolio/luna-shopper/mercadona` and `@portfolio/luna-shopper/osm-places` import nothing from
  Nest or TypeORM and are tested against checked in fixtures with no network access.
- `PriceScope` exists, prices are keyed on (`itemId`, `priceScopeId`), `positionInStore` lives on a
  location keyed row, and every pre-existing price still resolves to the same value through a
  `STORE` scope.
- Postal code 14013 resolves to warehouse `4661`, and a Mercadona `WAREHOUSE` scope carries that
  key.
- A store discovery run over 14013 returns the supermarkets around it grouped by chain, creates
  nothing on its own, and the owner can import chosen places into `Supermarket` and
  `SupermarketLocation` rows; hand entered supermarkets keep working unchanged.
- A catalog discovery run walks Mercadona, fetches detail per product, and records EAN and brand for
  the assortment, reporting progress that survives a page reload and stopping cleanly when aborted.
- Items created from the snapshot carry a Spanish name, an English name, a brand, an EAN and a unit
  size; their prices carry the source's own unit price and label, an observation time, and
  `priceSourceKind` of `OFFICIAL_API`.
- Any authenticated user can refresh one item, at most once per five minutes across the whole
  platform, enforced in the database rather than in a per replica counter; a refused refresh returns
  the stored price, its observation time, and the seconds remaining.
- A price previously entered by the owner is not overwritten by a fetch, and the disagreement is
  reported.
- `bulk_price` is stored verbatim and never recomputed.
- No product image, nutritional block or supplier list from Mercadona is stored anywhere, and OSM
  derived data carries its attribution.
- One append only migration makes every catalog change and leaves
  `1756000500000-InitialCatalogSchema` untouched; `openapi.json` is regenerated and committed; and
  `npx nx affected -t lint test` is green.
