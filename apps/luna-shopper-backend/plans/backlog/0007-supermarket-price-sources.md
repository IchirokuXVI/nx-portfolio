# 0007 (backlog) Supermarket price sources

> **Status: backlog. Not scheduled for development.**
> Plans in `plans/backlog/` are designed and agreed but are not part of the build order, and
> nothing in them has been built. They carry their own numbering starting at `0001`, separate
> from the sequence in `plans/`. When one is picked up it moves into `plans/` and takes the next
> free number there, so parking a design never burns a number in the build sequence.
>
> This one is a **research spike rather than a design**, and it is here because its findings were
> absorbed rather than because it is waiting to be built: backlog 0001 turned them into the price
> sourcing design, and plan 0038 builds the ingest half of that against the Mercadona source this
> spike found. It is kept for the source survey, which is the part nothing else records: which
> chains were reachable, which were not, and why.

Research spike answering three questions for the catalog service (0012): which Spanish chains
expose usable price data, at what granularity prices actually vary, and where a product list can
come from. Reference chains: Mercadona, Lidl, DIA, Deza, El Jamón.

Companion code: `apps/luna-shopper-backend/tools/price-spike/`.

## 1. Source availability

None of these chains publish an official, documented, terms-of-service-blessed API. What exists
is what their own storefronts call.

| Chain | Source | Effort | Notes |
| --- | --- | --- | --- |
| Mercadona | `tienda.mercadona.es/api/` | Low | Unauthenticated JSON, warehouse-scoped via `wh`. The only genuinely easy one. |
| DIA | `dia.es` storefront | High | JSON-backed but behind bot protection; working scrapers all drive undetected Chrome. |
| El Jamón | `supermercadoseljamon.com` | Medium | Real online store, ~7k references, no documented API. Custom adapter needed. |
| Lidl | — | N/A | No public grocery catalog. `lidl.es` is bazaar/non-food. Lidl Plus API is per-user OAuth, returns receipts and coupons, not a catalog. |
| Deza | — | N/A | Corporate site only: locations, no e-commerce, no prices. Weekly PDF folleto is the whole public surface. |

### Mercadona specifics

- `GET /api/categories/?lang=es&wh=<wh>` — category tree.
- `GET /api/categories/<id>/?lang=es&wh=<wh>` — leaf category with its products.
- `GET /api/products/<id>/?lang=es&wh=<wh>` — product detail.
- `PUT /api/postal-codes/actions/change-pc/` with `{"new_postal_code":"28001"}` — the response
  header `x-customer-wh` gives the warehouse serving that postal code. This is the postal-code
  to price-scope resolver.
- There is **no text search** on the REST API. Search is a separate Algolia index
  (`products_prod_<wh>_es`) whose public app id and search key are embedded in the storefront
  bundle and **rotate**. Either walk the category tree (slow, no secrets) or re-discover the
  credentials from the live bundle at runtime. The spike does both.
- Prices live under `price_instructions`: `unit_price` (pack price), `bulk_price` (per reference
  unit), `reference_format`, `size_format`, `unit_size`.

## 2. Do all stores of a chain share a price?

No, and the shape of the exception differs per chain. This is the finding that matters for the
data model.

- **Mercadona** is close to uniform but not uniform. Price is set per **warehouse**, not per
  store, and warehouses do diverge — press comparisons found 29 of 30 tracked products identical
  across Madrid, Barcelona, Valencia, Sevilla and Bilbao, with Coca-Cola 1.25 L at 1.49 € in four
  of them and 1.72 € in Barcelona. The Canaries and Balearics diverge further (IGIC rather than
  IVA). So: one price per warehouse, many stores per warehouse.
- **DIA** is the opposite case: roughly 1,400 of its stores are franchises. DIA sets a maximum
  price the franchisee must respect but does not stop them pricing below it, so genuine per-store
  variation exists, and the online shop is a third price list on top of that.
- **Lidl** prices nationally, with island exceptions.
- **El Jamón** and **Deza** are regional chains; expect the online list (where it exists) to be
  its own price list, distinct from the shelf.

Industry corroboration: the Soysuper comparator models prices across more than 4,700 postal
codes rather than per chain, which is the same conclusion reached from the other direction.

### Consequence for 0012

`SupermarketItem` is currently keyed on (`itemId`, `supermarketLocationId`) — one price row per
physical store. That is finer than any obtainable data: Mercadona would give 50 identical rows
per warehouse, and nothing upstream distinguishes them.

Introduce a **price scope** between `Supermarket` and `SupermarketLocation`:

- `PriceScope` — `id`, `supermarketId`, `kind` (`national` | `warehouse` | `postal-code` |
  `store`), `externalKey` (e.g. `mad1`), `label`.
- `SupermarketLocation` gains `priceScopeId`; many locations map to one scope.
- `SupermarketItem` is keyed on (`itemId`, `priceScopeId`) instead of location.
- `positionInStore` stays on a location-scoped row — aisle genuinely is per store even when price
  is not. Split it out of `SupermarketItem` rather than forcing both onto one granularity.

A chain with no obtainable data (Deza) is simply a `Supermarket` with one `store`-kind scope per
location and manually entered prices; the model does not need a special case for it.

## 3. Where the item list comes from

- **Per chain**: walk the chain's own category tree. Mercadona yields its full assortment
  (roughly 5,000 references) as JSON with no auth. DIA and El Jamón yield theirs through a
  browser-driven adapter.
- **Canonical identity across chains** is the hard part: chain SKUs do not interoperate, and
  Mercadona's own-brand products have no external equivalent at all. Join on **EAN/barcode**
  where available, and use **Open Food Facts** (`world.openfoodfacts.org/api/v2/product/<ean>`,
  open licence, strong Spanish coverage) as the canonical `Item` source — name, brand, image,
  category — rather than curating that by hand.
- That maps cleanly onto 0012: `Item` is Open Food Facts keyed by EAN, `SupermarketItem` carries
  the per-scope chain SKU and price. Own-brand products stay owner-curated `Item` rows with no
  EAN.

## 4. Legal position

Prices are public facts and not copyrightable, and PR Aviation v Ryanair (CJEU, 2015) held that
a site's terms cannot bind a scraper where the underlying data is unprotected. That is not a
blanket permission: the risks that remain are contractual terms of use, database *sui generis*
rights over a substantial extraction of a catalog, and trademark/asset reuse (do not hotlink or
republish their product photography). Practical posture for this app: personal and comparative
use, cache aggressively and crawl gently, honour `robots.txt`, attribute the source and
timestamp every price, and keep each chain behind its own adapter so a single source can be
dropped without touching the rest.

## 5. Exit criteria

- Catalog ingestion is expressed as one adapter per chain behind a common interface, with chains
  that have no source represented as explicit unavailable adapters rather than silent gaps.
- `PriceScope` exists and Mercadona ingestion populates warehouse-kind scopes from postal codes.
- Every stored price carries its source and the time it was observed.
- A price with no obtainable source can still be entered by the app owner.
