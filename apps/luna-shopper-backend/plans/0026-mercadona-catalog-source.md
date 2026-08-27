# 0026 Mercadona as the first real catalog source

Backlog 0001 designs the whole price sourcing machine: a separate harvester service with its own
database, an adapter registry, price scopes, a multi source price model with a stored resolution
policy, product groups, and a rewritten search. It is a large plan and none of it is built.

This plan takes the **smallest honest slice of it that puts real data in the catalog database**:
one supermarket (Mercadona), one location (postal code 14013, Córdoba), and a real fetch against
Mercadona's own storefront API. Everything else in backlog 0001 stays in the backlog.

The point of the slice is not the data. It is that **the part of backlog 0001 that is expensive to
get wrong is the normalization**, the question of what a chain's JSON means and which of its fields
belong in our schema. That question is answered once, in a library, and the answer survives the
harvester being built later. The wiring around it is throwaway and is deliberately kept thin.

Everything in section 2 was measured against the live API on 2026-08-27, not read from
documentation. Where a number appears, it came from a run.

## 1. Scope

**Built here:**

- A library, `@portfolio/luna-shopper/mercadona`, that knows how to talk to
  `tienda.mercadona.es/api/` and returns normalized, framework free product records.
- The schema changes those records need (section 4), as one append only migration on top of the
  0025 baseline.
- An import service in catalog that calls the library and writes `Item` and `SupermarketItem` rows,
  reachable through a platform admin gated NATS subject.
- One seeded Mercadona `Supermarket` and one `SupermarketLocation` at postal code 14013.

**Not built here, and still backlog 0001's:**

- The harvester service, its database, its scheduler, `HarvestRun`, abort, progress, the stale
  reaper, and the concurrency cap.
- The adapter registry and `SupermarketSourceAdapter` interface. There is one source, so there is
  no registry to select from yet.
- `PriceScope`, `ItemPrice`, `PriceObservation`, `PricePolicy`, `PriceSubmission`. Prices stay on
  `SupermarketItem`, one row per item per location, exactly as 0012 shipped them.
- `ProductGroup`, the category tree, `tsvector` search, and the unit price ranking that they exist
  to serve.
- Every chain that is not Mercadona.

The rule that keeps this from becoming a fork of backlog 0001: **nothing built here may make any
of the deferred items harder to build.** Section 10 is the audit of that claim.

## 2. What the API actually returns

### 2.1 The endpoints this plan uses

Four, all unauthenticated JSON.

| Call | Purpose |
| --- | --- |
| `PUT /api/postal-codes/actions/change-pc/` with `{"new_postal_code":"14013"}` | Returns header `x-customer-wh`, the warehouse serving that postal code. |
| `GET /api/categories/?lang=<l>&wh=<wh>` | The category tree, two levels, in the requested language. |
| `GET /api/categories/<id>/?lang=<l>&wh=<wh>` | A level 1 category, expanded to its level 2 children **with their products inline**. |
| `GET /api/products/<id>/?lang=<l>&wh=<wh>` | Product detail. |

There is no product list endpoint and no text search on this API. The assortment is obtained by
walking the tree, which is exactly the "sources cannot be asked where item X is" case backlog 0001
section 1.2 anticipated.

Measured cost of the full walk against `wh=4661`: **26 top level categories, 151 level 1 categories
to fetch, 4,232 unique products, 31 seconds.** That is cheap enough that the walk is not something
this plan needs to optimize, cache, or schedule.

### 2.2 Postal code 14013 resolves to warehouse `4661`

Verified. Some other postal codes, to show the shape of the value:

| Postal code | Warehouse |
| --- | --- |
| 14013 (Córdoba) | `4661` |
| 28001 (Madrid) | `mad3` |
| 08001 (Barcelona) | `bcn1` |
| 41001 (Sevilla) | `svq1` |
| 46001 (Valencia) | `vlc1` |
| 35001 (Las Palmas) | `4701` |
| 07001 (Palma) | `3842` |

**The warehouse key is a string and comes in two shapes**, a numeric code and a city slug. Anything
that stores it stores `varchar`, never an integer. This matters because backlog 0001 gives
`PriceScope.externalKey` exactly this value later.

### 2.3 The items really are localized, and the schema already handles it

The `lang` query parameter is honoured for both product names and category names. Product 4241:

| `lang` | `display_name` |
| --- | --- |
| `es` | Aceite de oliva 0,4º Hacendado |
| `en` | Light olive oil Hacendado |
| `ca` | Oli d'oliva 0,4º Hacendado |
| `gl`, `pt`, `va`, `eu` | falls back to the Spanish string |

So Mercadona gives us genuine Spanish, English and Catalan. Category names localize the same way
(`Aceite, especias y salsas` / `Oils, spices & sauces` / `Oli, espècies i salses`).

**No schema change is needed for this.** `Item.name` is already `jsonb` holding
`LocalizedText { en, es }` (plan 0012, and plan 0004 section 12 makes English plus Spanish the
platform minimum). The ingest fetches each product twice, once with `lang=es` and once with
`lang=en`, and fills both keys from the source rather than leaving one machine translated or
duplicated. That is a cost of one extra request per item, not a migration.

**Recommendation: do not add Catalan.** `LocalizedText` is typed `{ en: string; es: string }` in
`contracts` and is used by every localized field in every service. Widening it for a locale the
frontend does not serve would touch the whole contract surface and every existing row, to store a
string nothing reads. It is noted here so that if Velista ever adds `ca`, this source is known to
carry it and the ingest needs a third fetch, not a redesign.

### 2.4 The price fields, and the one rule that matters

Prices live under `price_instructions`. The fields worth naming:

- `unit_price`: the price of the pack you put in the basket. This is the price.
- `unit_size` and `size_format`: the pack size and its unit. `size_format` is one of `kg`, `l`,
  `ud`, `m` (observed: 2,369 / 1,317 / 544 / 2).
- `bulk_price`: **the normalized price per reference unit**, the number that makes a 1 L carton
  comparable with a 6 x 1 L pack. This is the field backlog 0001 section 3.3 needs and expects to
  have to derive everywhere else.
- `reference_format`: the label Mercadona puts next to `bulk_price`. Observed values: `kg` (2,182),
  `L` (816), `ud` (697), `100 ml` (405), `100 g` (97), `lv` (24), `dc` (8), `m` (2), `dz` (1).
- `is_pack` (442 products), `total_units`, `pack_size`, `drained_weight`, `tax_percentage`, `iva`,
  `previous_unit_price`, `price_decreased`.

**The rule: store `bulk_price` verbatim and never recompute it.** The obvious derivation
`unit_price / unit_size` reproduces `bulk_price` for 3,760 of 4,232 products. A second rule,
`unit_price / total_units`, covers 326 more (coffee capsules and cereal bars, where Mercadona
normalizes per capsule rather than per kilo). **110 products, 2.6%, match neither** and are simply
inconsistent with their own stated size. Deriving the unit price would therefore silently disagree
with the chain on one product in forty, in a field whose entire purpose is comparison. Taking the
number the source publishes is both cheaper and more correct.

**And `reference_format` is a display label, not a machine unit.** For a product with
`size_format: 'l'`, `unit_size: 0.4`, `unit_price: 1.80`, the `bulk_price` is `4.50`, which is per
**litre**, while `reference_format` reads `100 ml`. Same for `100 g`, which carries a per kilogram
number. `lv` means *lavados* (washing machine loads) and sits on a `bulk_price` that is per litre.
`dc` and `dz` (*docena*) sit on per egg numbers. The label is for a human reading a price tag and
cannot be parsed into a unit.

The consequence for the schema is section 4.2: the unit price column is a number plus **the
source's own label stored as text**, not a number plus a `UnitOfMeasure` enum value. Forcing these
into the enum would mean inventing a mapping the source does not have and would corrupt the one
genuinely useful number the API gives away for free.

### 2.5 The list endpoint does not carry EAN or brand

Products embedded in a category response carry `id`, `slug`, `display_name`, `packaging`,
`thumbnail`, `share_url`, `published`, `categories` and the full `price_instructions`. They do
**not** carry `ean` and do **not** carry `brand`. Both appear only on `GET /api/products/<id>/`.

EAN coverage on the detail endpoint was 40 of 40 in a random sample; brand 37 of 40 (the three
misses are an empty string and two nulls, all on novelty products). Detail fetches took 0.15 s
each, which puts a full detail pass over the whole assortment at roughly **11 minutes serial**.

This is why the ingest is two phased even at this small scale: walk the tree to find candidates,
then fetch detail only for the items actually being imported. It is also the reason `Item.ean` is
worth adding now rather than later (section 4.1): the EAN is free from a request we are already
making, and it is the only identifier that will ever join a Mercadona product to a DIA one.

### 2.6 Assortment varies by warehouse; price barely does

25 random products fetched against `4661`, `mad3` and `bcn1`: every price identical, except one
product that returned **404 in `bcn1`**. That is the finding, and it is not the one the naive
reading expects. The per warehouse variation that matters at this scale is **whether the product is
carried at all**, not what it costs.

A 404 from a product detail call is therefore a normal, expected state and means "not stocked in
this warehouse". It maps onto the existing `SupermarketItem.available = false` and needs no new
column and no error handling beyond not treating it as a failure.

This also justifies deferring `PriceScope`. With one location, prices keyed on the location are
already correct. The moment a second Mercadona location is added the schema still holds, because
the price is the same; it only becomes wrong when a location in the Canaries or the Balearics is
added, and that is when backlog 0001 section 2.1 gets built.

## 3. What maps into the database

### 3.1 Field by field

| Source | Target | Notes |
| --- | --- | --- |
| `display_name` (`lang=es`) | `Item.name.es` | |
| `display_name` (`lang=en`) | `Item.name.en` | Second fetch. Falls back to the Spanish string if absent. |
| `brand` | `Item.brand` | Detail only. Empty string normalizes to `null`. |
| `ean` | `Item.ean` | **New column** (4.1). Detail only. |
| `id` | `Item.sku` | The Mercadona product id, as a string. See 4.1 for why `sku` and not a new ref table. |
| `unit_size` | `Item.unitSize` | **New column** (4.1). |
| `size_format` | `Item.defaultUnit` | `kg` to `KILOGRAM`, `l` to `LITER`, `ud` to `UNIT`. `m` has no enum value; see below. |
| deepest `categories` entry | `Item.category` | Mapped per 3.2. |
| `unit_price` | `SupermarketItem.price` | |
| `bulk_price` | `SupermarketItem.unitPrice` | **New column** (4.2). Verbatim, per 2.4. |
| `reference_format` | `SupermarketItem.unitPriceLabel` | **New column** (4.2). Text, per 2.4. |
| constant `'EUR'` | `SupermarketItem.currency` | The API states no currency. |
| `published`, and whether detail 404s | `SupermarketItem.available` | |
| fetch time | `SupermarketItem.priceObservedAt` | **New column** (4.2). |
| constant `OFFICIAL_API` | `SupermarketItem.priceSourceKind` | **New column** (4.2). |

`size_format: 'm'` covers exactly two products (aluminium foil and cling film, priced per metre).
`UnitOfMeasure` has no metre. They would fall to `UNIT` with `unitSize` still recorded, which is
wrong in a harmless way. **Recommendation: do not import them**, and do not add a `METER` enum
value for two products. If household rolls become interesting, the enum gains a value in the plan
that makes them interesting.

### 3.2 Categories

Mercadona has 26 top level categories against our 12 `ItemCategory` values, so this is lossy by
construction. Two things make it less bad than it sounds.

First, **map from the deepest category on the product, not the root.** `Charcutería y quesos`
contains both cured meat and cheese, which land in different `ItemCategory` values, and mapping
from the root would put every cheese under `MEAT`.

Second, **the mapping table lives in the library, not in the database**, so re-mapping later costs
a re-import and not a migration.

Root level defaults:

| Mercadona | `ItemCategory` |
| --- | --- |
| Fruta y verdura | `PRODUCE` |
| Carne | `MEAT` |
| Marisco y pescado | `SEAFOOD` |
| Panadería y pastelería | `BAKERY` |
| Congelados | `FROZEN` |
| Huevos, leche y mantequilla | `DAIRY` |
| Postres y yogures | `DAIRY` |
| Agua y refrescos | `BEVERAGES` |
| Bodega | `BEVERAGES` |
| Zumos | `BEVERAGES` |
| Aperitivos | `SNACKS` |
| Azúcar, caramelos y chocolate | `SNACKS` |
| Aceite, especias y salsas | `PANTRY` |
| Arroz, legumbres y pasta | `PANTRY` |
| Cacao, café e infusiones | `PANTRY` |
| Cereales y galletas | `PANTRY` |
| Conservas, caldos y cremas | `PANTRY` |
| Limpieza y hogar | `HOUSEHOLD` |
| Bebé | `PERSONAL_CARE` |
| Cuidado del cabello | `PERSONAL_CARE` |
| Cuidado facial y corporal | `PERSONAL_CARE` |
| Fitoterapia y parafarmacia | `PERSONAL_CARE` |
| Maquillaje | `PERSONAL_CARE` |
| Mascotas | `OTHER` |
| Pizzas y platos preparados | `OTHER` |
| Charcutería y quesos | split, below |

Subcategory overrides:

| Mercadona subcategory | `ItemCategory` |
| --- | --- |
| Queso curado, semicurado y tierno (54) | `DAIRY` |
| Queso lonchas, rallado y en porciones (56) | `DAIRY` |
| Queso untable, fresco y especialidades (53) | `DAIRY` |
| everything else under Charcutería y quesos | `MEAT` |

`Mascotas` and `Pizzas y platos preparados` landing in `OTHER` is the clearest evidence that the
flat enum is not enough, which is the argument backlog 0001 section 3.1 already makes. This plan
does not fix it; it records the damage in one table so the fix has a starting point.

### 3.3 What is deliberately not ingested

- **Product images.** `thumbnail` and `photos` are Mercadona's own product photography. Backlog
  0001 section 9 rules them out explicitly: `Item.imageUrl` comes from Open Food Facts or the
  owner, never from a chain, and is never rehosted. `imageUrl` stays `null` for imported items.
- **`packaging`** (`Garrafa`, `Paquete`, `Brik`). Spanish only, no English counterpart, and it
  belongs to the `attributes` jsonb that backlog 0001 section 3.3 introduces alongside product
  groups. Storing it now in a column that later moves is worse than not storing it.
- **`tax_percentage` and `iva`.** Real, but nothing in the app reasons about VAT.
- **`price_decreased` and `previous_unit_price`.** Both were empty across all 4,232 products at the
  time of measurement, so there is nothing to model and no way to test what we would build.
- **`nutrition_information`, `suppliers`, `origin`, `legal_name`, `mandatory_mentions`.** Present on
  the detail response, genuinely interesting, and out of scope. Open Food Facts is the intended
  source for that class of data (backlog 0001 section 1.4) and it is open licensed, which
  Mercadona's copy is not.
- **`similars` and `xselling`.** Recommendation endpoints. Nothing consumes them.

## 4. Schema changes

One append only migration on top of the single 0025 baseline. Plan 0025 reset the history and
restored the append only rule immediately; this is the first migration written under it, and it
does not touch `1756000500000-InitialCatalogSchema`.

### 4.1 `Item`

| Column | Type | Why |
| --- | --- | --- |
| `ean` | `varchar` null, unique when present | The only identifier that joins across chains. Free from a detail call we already make. Backlog 0001 section 3.3 adds exactly this. |
| `unitSize` | `numeric(12,4)` null | The pack size, without which `defaultUnit` says nothing. Backlog 0001 section 3.3 adds exactly this. |

**The Mercadona product id goes in the existing `Item.sku` column.** This looks like a shortcut and
is in fact what backlog 0001 section 6.2 already sanctions: step 2 of the matching ladder is
"external id already on the item, where the chain's SKU is what the owner recorded". `sku` is
nullable, unused, and there is exactly one chain, so a per chain `ItemSourceRef` table would be a
table with one meaningful column and no second row shape to justify it.

This is the one place the plan is knowingly taking on debt, so it is worth being precise about the
size of it: **the debt is paid the day a second chain is added**, at which point `ItemSourceRef`
lands (in the harvester database, per backlog 0001 section 4.1) and a migration moves the `sku`
values into it. That migration reads one column of a few hundred rows. It is not a schema redesign
and it is not blocked by anything built here.

### 4.2 `SupermarketItem`

| Column | Type | Why |
| --- | --- | --- |
| `unitPrice` | `numeric(12,4)` null | Mercadona's `bulk_price`, stored verbatim (2.4). This is the number that makes prices comparable across pack sizes, and it is the single most valuable field the source gives away. |
| `unitPriceLabel` | `varchar` null | The source's own `reference_format` string. **Text, not `UnitOfMeasure`** (2.4). |
| `priceObservedAt` | `timestamptz` null | When the price was true. Without it a price has no age and there is no way to tell a number fetched this morning from one typed in last year. |
| `priceSourceKind` | `price_source_kind` enum, default `ADMIN` | Where the number came from. |

`priceSourceKind` is the one forward looking addition in this plan, and the argument for it is
concrete rather than architectural: **the first import will write over rows a human may have typed
in.** Without a provenance column there is no way for the import to know which rows are safe to
overwrite, and no way for the owner to see afterwards what happened. Two columns bought now prevent
a category of silent data loss.

The enum ships with backlog 0001's full value set (`OFFICIAL_API`, `OFFICIAL_WEB`,
`OFFICIAL_LEAFLET`, `ADMIN`, `USER_RECEIPT`, `USER_REPORTED`) even though only two are reachable
today, because adding values to a Postgres enum later is a migration and defining them now is free.
Existing rows default to `ADMIN`, which is true: everything in the database today was typed in.

**What this is not.** This is not `ItemPrice`. There is still one price row per item per location,
one source wins by overwriting, and there is no history, no policy and no eligibility. Backlog 0001
section 2 is untouched. What these four columns give is the ability to answer "where did this
number come from and when", which is the precondition for that plan rather than a piece of it.

### 4.3 `SupermarketLocation`

| Column | Type | Why |
| --- | --- | --- |
| `postalCode` | `varchar` null | The entity has `address`, `city` and `country` but no postal code, which is a plain gap independent of Mercadona. |
| `externalScopeKey` | `varchar` null | The chain's own code for the price area serving this location. Here, `4661`. |

`externalScopeKey` is what the import needs in order to know which `wh` to ask for, and it is
precisely the value backlog 0001 section 2.1 stores as `PriceScope.externalKey`. Recording it on
the location now means the future `PriceScope` migration can group locations by a value it already
has instead of asking the owner to re-enter it. Section 2.2 is the reason it is `varchar`.

### 4.4 `contracts`

- `PriceSourceKind` enum, in `catalog.enums.ts`, with the six values above.
- `ItemView` gains `ean` and `unitSize`. `SupermarketItemView` gains `unitPrice`, `unitPriceLabel`,
  `priceObservedAt` and `priceSourceKind`. `SupermarketLocationView` gains `postalCode` and
  `externalScopeKey`.
- The create and update request shapes gain the same optional fields.
- New subject group `CATALOG_IMPORT_PATTERNS` (section 6.2).
- JSON schemas in `src/schemas/messages/catalog.schemas.ts` for every changed view and request, per
  plan 0010, plus the enum in `enums.schemas.ts`.

These are wire visible additions to catalog views, so the affected controllers take a version bump
under the per controller versioning from plan 0004. They are additive, so no existing client
breaks.

**`openapi.json` must be regenerated and committed in the same change**
(`npx nx run luna-shopper-backend-gateway:openapi`). The gateway's `openapi-document.spec.ts` fails
on a stale document, so forgetting this is a red PR rather than silent drift.

### 4.5 The migration

`apps/luna-shopper-backend/catalog/src/app/db/migrations/<ts>-MercadonaSourceFields.ts`, in the
style of the existing baseline: raw `queryRunner.query` DDL, named constraints, a reversible `down`.

```sql
CREATE TYPE "price_source_kind" AS ENUM (
  'OFFICIAL_API', 'OFFICIAL_WEB', 'OFFICIAL_LEAFLET',
  'ADMIN', 'USER_RECEIPT', 'USER_REPORTED'
);

ALTER TABLE "items"
  ADD COLUMN "ean" varchar,
  ADD COLUMN "unitSize" numeric(12,4);
CREATE UNIQUE INDEX "uq_items_ean" ON "items" ("ean") WHERE "ean" IS NOT NULL;

ALTER TABLE "supermarket_items"
  ADD COLUMN "unitPrice" numeric(12,4),
  ADD COLUMN "unitPriceLabel" varchar,
  ADD COLUMN "priceObservedAt" timestamptz,
  ADD COLUMN "priceSourceKind" "price_source_kind" NOT NULL DEFAULT 'ADMIN';

ALTER TABLE "supermarket_locations"
  ADD COLUMN "postalCode" varchar,
  ADD COLUMN "externalScopeKey" varchar;
```

The partial unique index on `ean` is deliberate: unique when present, and many items legitimately
have none (Mercadona own brand fresh produce, and every item the owner types in by hand).

### 4.6 What is explicitly not added

`PriceScope`, `ItemPrice`, `PriceObservation`, `PricePolicy`, `PriceSubmission`,
`SupermarketLocationItem`, `ItemSourceRef`, `SourceCatalogEntry`, `SupermarketSource`,
`HarvestRun`, `Category`, `ProductGroup`, the `tsvector` columns, and the `attributes` jsonb.

All of them are backlog 0001's, all of them are append only additions when they arrive, and none of
them is made harder by the four small changes above. Section 10 checks that claim table by table.

## 5. The library

### 5.1 Where it lives

`libs/luna-shopper/mercadona`, alias `@portfolio/luna-shopper/mercadona`, a plain Nx TypeScript
library alongside `contracts`, `platform` and `test-fixtures`. It depends on `contracts` for the
enums and on nothing else.

### 5.2 The public surface

```ts
/** One Mercadona product, already normalized. Contains no TypeORM and no Nest. */
export interface MercadonaProduct {
  externalId: string;            // "4241"
  ean: string | null;
  name: { en: string; es: string };
  brand: string | null;
  unitSize: number | null;       // price_instructions.unit_size
  unit: UnitOfMeasure | null;    // mapped from size_format; null for 'm'
  category: ItemCategory;
  price: number;                 // price_instructions.unit_price
  unitPrice: number | null;      // price_instructions.bulk_price, verbatim
  unitPriceLabel: string | null; // price_instructions.reference_format, verbatim
  currency: 'EUR';
  available: boolean;
  sourceUrl: string;             // share_url
  observedAt: Date;
}

export interface MercadonaClientOptions {
  warehouse: string;
  requestDelayMs?: number;   // default 1000
  maxRetries?: number;       // default 3
  userAgent?: string;
  fetchImpl?: typeof fetch;  // injected in tests
  signal?: AbortSignal;
}

export class MercadonaClient {
  static async resolveWarehouse(postalCode: string, o?): Promise<string>;
  constructor(options: MercadonaClientOptions);
  listCategories(lang: MercadonaLang): Promise<MercadonaCategory[]>;
  listCategoryProducts(categoryId: number, lang): Promise<MercadonaListProduct[]>;
  getProduct(externalId: string, lang): Promise<MercadonaRawProduct | null>; // null on 404
  fetchProduct(externalId: string): Promise<MercadonaProduct | null>;        // es + en, normalized
  walkCatalog(): AsyncIterable<MercadonaListProduct>;                        // the full tree walk
}
```

`fetchProduct` is the one the import uses per item: two requests (`lang=es`, `lang=en`), normalized
into `MercadonaProduct`, `null` when the warehouse does not carry it. `walkCatalog` is the discovery
half and is used to find candidates and to build test fixtures.

Normalization (the category mapping of 3.2, the unit mapping, the `bulk_price` rule of 2.4) lives
in a pure `normalize.ts` beside the client, taking raw JSON and returning `MercadonaProduct`, so it
is testable against a checked in fixture with no network at all.

### 5.3 Why it is framework free

Backlog 0001 puts this code in the harvester service, behind `SupermarketSourceAdapter`. This plan
puts it in a library called from catalog, which is a deliberate deviation and needs to survive the
harvester landing.

It survives if, and only if, **the library contains no catalog knowledge**: no TypeORM entity, no
repository, no Nest decorator, no `Item`, no `SupermarketItem`, no database at all. It takes a
warehouse code and returns normalized records. Catalog does the mapping to rows and the writing.

Given that, moving to the harvester later is: the harvester imports the same library, wraps it in a
`MercadonaAdapter` implementing `SupermarketSourceAdapter`, and catalog's import service is deleted.
**The expensive part, which is knowing what Mercadona's JSON means, is written once and moves for
free.** Any Nest or TypeORM dependency inside the library would break that, which is why it is a
constraint and not a style preference.

`MercadonaClient` deliberately shadows the future adapter's shape: `resolveWarehouse` is
`resolveScope`, `walkCatalog` is `discover`, `fetchProduct` is `fetch`, `MercadonaProduct` is
`SourceProduct`. There is no `search`, because the API has none.

### 5.4 HTTP, and no new dependency

Node 20's global `fetch` (undici, built in). The repository currently has no HTTP client dependency
at all and this plan does not add one. The client owns:

- **A serial request queue** with `requestDelayMs` between requests, default 1,000 ms, matching
  backlog 0001 section 9's conservative default. There is no concurrency knob because there is no
  volume that needs one.
- **Retry with exponential backoff and jitter** on 429 and 5xx, capped at `maxRetries`. Repeated
  429s abort with a clear error rather than grinding on.
- **404 as a value, not an error.** `getProduct` returns `null` (section 2.6).
- **An honest `User-Agent`** naming the app and carrying a contact address, per backlog 0001
  section 9.
- **`AbortSignal` throughout**, so a caller can stop a walk. This is the mechanism backlog 0001
  section 7.4 builds abort on top of, available from the start at no cost.

## 6. Calling it from catalog

### 6.1 `MercadonaImportService`

A new provider in `CatalogModule`, next to the existing services. It:

1. Loads the `SupermarketLocation`, reads its `externalScopeKey`, and refuses with a clear domain
   error if the location has none.
2. Constructs a `MercadonaClient` for that warehouse.
3. For each requested external id, calls `fetchProduct`.
4. Upserts the `Item` by `sku` (the Mercadona id), then the `SupermarketItem` for
   (`itemId`, `supermarketLocationId`).
5. Returns a per item result: created, updated, unchanged, not stocked, or skipped with a reason.

It calls `PlatformAdminService.requireAdmin` first, like every other catalog write. There is no new
authorization: this is the app owner importing reference data, which is what catalog writes already
are.

Item matching order, a shortened version of backlog 0001 section 6.2 with only the steps that are
possible here: `sku` equal to the Mercadona id, then `ean`, then create. Names are never matched on;
a fuzzy name match writing a wrong price onto a real product is exactly the failure backlog 0001
section 6.2 refuses to automate, and it stays refused.

### 6.2 The subjects

Two, both platform admin gated, exposed through the gateway under `/v1/admin/catalog/`:

- `catalogImport.mercadonaSearch` `{ userId, query, limit }`: runs a walk and returns matching
  candidates with their external id, name, brand, price and unit price. **Read only, writes
  nothing.** This is how the owner finds the id of the product they want, given that the API has no
  text search: the walk is 31 seconds and the result is filtered in memory.
- `catalogImport.mercadona` `{ userId, supermarketLocationId, externalIds[] }`: imports those
  products. Bounded list, no "import everything" mode.

Both are synchronous request and reply. The walk fits inside a NATS request timeout only because it
is 31 seconds against a single chain; **this is precisely the property that stops being true at the
second supermarket**, and it is the honest reason the harvester exists rather than a reason to argue
with backlog 0001.

### 6.3 Not clobbering a manual price

The rule, using the columns from 4.2:

- Writing `OFFICIAL_API` over a row whose `priceSourceKind` is `ADMIN` **does not overwrite the
  price**. It records the fetched price in the response as a disagreement and leaves the row alone.
- Writing `OFFICIAL_API` over a row that is already `OFFICIAL_API`, or over a row with no price,
  overwrites freely and updates `priceObservedAt`.
- The owner overrides by editing the row through the existing `supermarketItem.upsert`, which sets
  `ADMIN`, and thereby pins it.

This is a two case version of backlog 0001 section 2.4's stored `PricePolicy`, hard coded because
there are two reachable kinds. When `ItemPrice` and `PricePolicy` arrive, this rule is deleted and
replaced by the policy table; it is not a foundation for it, and it is not written as one.

## 7. Seeding the one Mercadona location

The demo world fixture (`libs/luna-shopper/test-fixtures/src/lib/demo-world.ts`) already contains a
Mercadona supermarket with one location, used by the seeder and the integration tests. **That row
stays exactly as it is.** It is fixture data with a fixed uuid, it is deleted and reinserted by
every seed run, and pointing a real import at it would mean the next seed silently wipes the
imported prices.

Instead, a separate small seed adds the real pair, with its own fixed uuids so it is idempotent and
distinguishable:

- `Supermarket`: name `{ en: 'Mercadona', es: 'Mercadona' }`, `websiteUrl`
  `https://www.mercadona.es`.
- `SupermarketLocation`: `city` `Córdoba`, `country` `ES`, `postalCode` `14013`,
  `externalScopeKey` `4661`, `label` `{ en: 'Córdoba 14013', es: 'Córdoba 14013' }`.

Whether this belongs in the demo seeder or in a separate reference seeder is section 11's first
open decision.

## 8. robots.txt, and being straight about it

`https://tienda.mercadona.es/robots.txt` reads, for all user agents:

```
Allow: /$
Allow: /favicon.ico
Allow: /sitemap.xml
Allow: /product
Disallow: /
Disallow: /api
Disallow: /legal
```

**`/api` is disallowed.** Backlog 0001 section 9 says "honour robots.txt", so this plan is in
tension with its own parent, and saying otherwise would be dishonest.

What is actually true: robots.txt is a convention addressed to crawlers building indexes, it is not
a contract and not a technical control, and the CJEU position noted in backlog 0001 section 9 (PR
Aviation v Ryanair, 2015) is about terms of use rather than about robots directives. Note also that
`/product`, the human facing page the API's own `share_url` points at, **is** allowed, so the
objection is to automated bulk access rather than to the data.

Rather than argue the point, the plan constrains the behaviour so the objection does not apply:

- **No scheduled crawling.** There is no scheduler in this plan. Every request happens because the
  owner clicked something.
- **Bounded volume.** An import is a bounded list of external ids. The only unbounded call is one
  category walk of 151 requests, and it is what the storefront itself does to render its menu.
- **One request per second, serial**, with backoff on 429. A browsing human generates more.
- **An honest User-Agent with a contact address.** No pretending to be Chrome, which is what the
  reference implementations do and what this plan deliberately does not copy.
- **No asset copying.** Section 3.3.
- **Personal, comparative use.** One user, one household, a few hundred products.
- **A kill switch**, `MERCADONA_SOURCE_ENABLED`, default true locally and **false in staging**
  (staging and production hitting the same third party for the same data is the pointless case
  backlog 0001 section 10 already rules out).

If Mercadona ever asks, the switch goes to false and the catalog keeps working on hand entered
prices, which is the property backlog 0001 section 5.4 designs for and which this plan preserves.

## 9. Testing

**No test touches the network.** A one off capture script writes real fixtures under
`libs/luna-shopper/mercadona/src/lib/__fixtures__/`: the category tree in `es` and `en`, one
expanded category, and a handful of product details chosen to cover the awkward cases, specifically
one where `bulk_price` equals `unit_price / unit_size`, one coffee capsule where it equals
`unit_price / total_units`, one of the 110 that matches neither, one with `reference_format` of
`100 ml`, one with `size_format` of `m`, one with no EAN, and one 404.

- **Normalization tests** run `normalize.ts` over those fixtures and assert the exact
  `MercadonaProduct`. A Mercadona shape change becomes a failing test with a diffable fixture.
- **Client tests** inject `fetchImpl` and assert the retry, delay, abort and 404 to `null`
  behaviour without a real socket.
- **Category mapping tests** assert the full 3.2 table, including the cheese override.
- **Import service tests** use a stub client and assert the 6.3 rules: an `ADMIN` row is not
  overwritten and is reported as a disagreement, an `OFFICIAL_API` row is, a 404 sets `available`
  false and leaves the price alone.
- **Integration tests** follow plans 0010 and 0013: disposable stack, migration applied, import run
  against a stub client, assert the resulting `Item` and `SupermarketItem` rows including
  `priceSourceKind`, `priceObservedAt`, `unitPrice` and `unitPriceLabel`.
- **A single opt in live test**, skipped unless `MERCADONA_LIVE_TEST=1`, fetches product 4241 and
  asserts only that the field names it depends on are still present. It never runs in CI. It exists
  so that when the fixtures go stale, the failure says so.

## 10. What moves when the harvester lands

The audit promised in section 1.

| Built here | What backlog 0001 does to it |
| --- | --- |
| `@portfolio/luna-shopper/mercadona` | Unchanged. The harvester imports it and wraps it in `MercadonaAdapter`. |
| `MercadonaImportService` in catalog | Deleted. The harvester owns runs. |
| `catalogImport.*` subjects | Deleted, replaced by `harvest.spawn` and the item source ref subjects. |
| `Item.ean`, `Item.unitSize` | Kept. Backlog 0001 section 3.3 adds exactly these. |
| `Item.sku` holding the Mercadona id | Migrated into `ItemSourceRef.externalId` in the harvester database. One column, a few hundred rows. |
| `SupermarketItem.unitPrice`, `unitPriceLabel` | Move to `ItemPrice.unitPrice`. `unitPriceLabel` survives as the source's own label alongside the machine unit. |
| `SupermarketItem.priceSourceKind`, `priceObservedAt` | Move to `ItemPrice` as the same fields. `SupermarketItem` becomes the materialized effective price and carries `effectiveSourceKind` and `effectiveObservedAt`, which is these columns renamed. |
| `SupermarketLocation.externalScopeKey` | Read by the `PriceScope` migration to group locations. Then nulled or kept as a hint. |
| `SupermarketLocation.postalCode` | Kept. Independently useful. |
| `PriceSourceKind` in contracts | Kept, unchanged, already the full value set. |
| The 6.3 overwrite rule | Deleted, replaced by `PricePolicy`. |
| The fixtures under `__fixtures__` | Move with the library. Backlog 0001 section 11 asks for exactly this. |

Nothing in the left column requires a destructive migration, and nothing blocks a right column
item. The debt is one column move and two deletions.

## 11. Open decisions

- **Where the real Mercadona rows are seeded.** Adding them to `demoWorld` is the least new
  machinery and the most confusion, since that fixture is deleted and reinserted on every seed and
  is meant to be disposable. A separate `seedReference` step is cleaner and is more moving parts.
  Recommendation: separate step, because the whole point of these rows is that they are not demo
  data.
- **Whether `catalogImport.mercadonaSearch` should cache the walk.** 31 seconds per search is
  tolerable for one person and unpleasant if they search three times. A five minute in memory cache
  of the walk is a dozen lines. Recommendation: ship without it, add it if it annoys.
- **How many products to import first.** The plan does not say, on purpose. Suggestion: the twenty
  or so products of an actual weekly shop, which is enough to exercise every branch in 3.1 and small
  enough to eyeball for correctness.
- **`Item.name.en` when Mercadona has no English string.** Section 2.3 falls back to the Spanish
  string, which means an English speaking user sees Spanish. The alternative is refusing to import
  such products, which is worse. Recommendation: fall back and flag the item for curation. Measuring
  how often this happens is a one line addition to the capture script and has not been done.

## 12. Exit criteria

- `libs/luna-shopper/mercadona` exists, imports nothing from Nest or TypeORM, and turns
  `tienda.mercadona.es` JSON into `MercadonaProduct` records under test against checked in fixtures
  with no network access.
- Postal code 14013 resolves to warehouse `4661` through the library, and that value is stored on
  the seeded location as `externalScopeKey`.
- A single Mercadona `Supermarket` and one `SupermarketLocation` at 14013 exist in the catalog
  database, separate from the demo world fixture.
- An owner authenticated call imports a bounded list of Mercadona products and creates `Item` rows
  with a Spanish name, an English name, a brand, an EAN and a unit size, and `SupermarketItem` rows
  with a price, the source's own unit price and label, an observation time and `priceSourceKind` of
  `OFFICIAL_API`.
- A product the warehouse does not carry is recorded as unavailable rather than failing the import.
- A price previously entered by the owner is not overwritten by an import, and the disagreement is
  reported back.
- `bulk_price` is stored verbatim and is never recomputed from `unit_price` and `unit_size`.
- No product image, nutritional block or supplier list from Mercadona is stored anywhere.
- One append only migration adds every column in section 4 and leaves
  `1756000500000-InitialCatalogSchema` untouched.
- `openapi.json` is regenerated and committed, and `npx nx affected -t lint test` is green.
