> **PR:** [#535](https://github.com/IchirokuXVI/nx-portfolio/pull/535)

# 0169: El Jamón, one price list for every shop

> Prerequisite reading: `0085` (a catalog read from HTML with no EAN), `0089` (a chain that
> lists its own stores, section 9), `0106` (a store list read in one request), `0107` (place
> trust), `0116` (every shop holds its own `STORE` scope), `0119` (what a run writes and
> fetches), `0153` (El Jamón's `NATIONAL` default scope). In the code: `lidl-catalog.runner.ts`,
> `lidl-store-discovery.runner.ts`, `deza-catalog.runner.ts`, `run-report.ts` and
> `ADAPTER_CAPABILITIES` in `harvest.messages.ts`.

El Jamón is already a seeded chain (`catalog/src/app/db/reference/stores.ts`, slug `el-jamon`,
brand key `Q6135982`) with a `NATIONAL` default scope since `0153`, and its leaflets already
reach the harvester through `FILE_IMPORT` (leaflet CLI plan `0004`). What it lacks is a source
that reads the chain's own site. `backlog/0001` named the adapter `eljamon-web`, and
`tools/price-spike/adapters.mjs` still holds an `elJamon` stub that throws "adapter not
written".

Every number below was measured against the live site on 2026-09-29.

## Brief for the agent

### Objective

Add the `eljamon-web` source: a framework free library `@portfolio/luna-shopper/eljamon`, a
`STORE_DISCOVERY` case that reads the chain's 366 shops from its store locator, and a
`CATALOG_DISCOVERY` case that walks the online catalog of 6,853 products and writes one price per
product into the chain's `NATIONAL` scope. The source writes no availability, because the site
publishes none.

### Context

- The shop is `https://www.supermercadoseljamon.com`: Liferay 6.1 with the Comerzzia ecommerce
  portlets, all server rendered HTML, no JSON API. `robots.txt` disallows only `/api/` and the
  `Scrapy` and `MJ12bot` user agents.
- The store locator is a separate WordPress site,
  `https://portal.supermercadoseljamon.com/Localizador/`, with the "WP Multi Store Locator Pro"
  plugin. One POST to its `admin-ajax.php` returns every shop (section 3).
- **The price is the same in every shop.** Five postal codes in five provinces and one pickup
  shop showed identical prices and an identical assortment (section 2).
- Runners write through `RunReport` (`scope`, `product`, `place`, `availability`,
  `assortmentComplete`), never through `CatalogClient` (plan `0103`). A price with
  `scopeKey: null` goes to the run's default scope.
- A new adapter key is registered in `ADAPTER_KEYS` and `ADAPTER_CAPABILITIES`. The dispatch
  lives in `CatalogDiscoveryRunner.runnerFor` and the `cases` table of `StoreDiscoveryRunner`.
  Section 7 lists every place.
- `supermarket_sources` needs no migration and no seed. The row is written from the back
  office, off by default. Per chain settings live in its `config` jsonb. **Do not add an
  environment variable.**

### Target state

- `nx run luna-shopper/eljamon:test` passes against checked in fixtures with no network.
- A `STORE_DISCOVERY` run of an `eljamon-web` source reports 366 places stamped with the El
  Jamón chain, and a run given `postalCodes` reports only the shops on those codes.
- A `CATALOG_DISCOVERY` run with the chain's `NATIONAL` scope as its default reports one
  observation per listed product, each with one price, and never calls `report.availability`.
- The run report names every category page and product page that failed.
- `openapi.json` and `wire-types.ts` are regenerated and committed.

### Scope

Work only in:

- `libs/luna-shopper/eljamon/` (new), and its alias in `tsconfig.base.json`
- `apps/luna-shopper-backend/harvester/src/app/harvest/`: two new runners, their specs, the two
  dispatch tables, `harvest.module.ts`, `PROVIDER_ADAPTERS` in `discovered-place.service.ts`
- `libs/luna-shopper/contracts`: `ADAPTER_KEYS`, `ADAPTER_CAPABILITIES` and their spec
- `apps/luna-shopper-backend/gateway/src/app/harvest/harvest.dto.ts`, the description strings
  that list adapters by hand, then the regenerated `openapi.json`
- `libs/luna-shopper-admin/models` (regenerated `wire-types.ts` only) and the one entry in
  `ADAPTER_ORDER` in `libs/luna-shopper-admin/feature-harvest/src/lib/sources-page.ts`, which
  the `Record` type makes a compile error without
- `apps/luna-shopper-backend/harvester/docs/research/eljamon/` for the probes of section 9
- `apps/luna-shopper-backend/tools/price-spike/adapters.mjs`: delete the `elJamon` stub or
  point it at the library, whichever the file's other adapters do

Do not touch: the leaflet tooling, the reference seed, price policies, `effective-price.ts`,
the scope resolver for shoppers, or any Helm values file.

### Constraints

- The library is framework free: no Nest, no TypeORM, no database, no HTTP or DOM dependency.
  Node's `fetch` and hand written regex decoding, as `@portfolio/luna-shopper/deza` does.
- Every request awaits the run's `acquire` gate and carries an honest User-Agent from
  `app-config.ts`. Never send a browser User-Agent.
- No automated match binds a site product to a catalog product (plan `0081`). The ingest
  records the price, and only an `ACTIVE` entry publishes it.
- The source writes no availability, positive or negative. Do not derive any from the
  JSON-LD `availability` field (section 2.3).
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- declaring a price scope from the runner, or creating a second `NATIONAL` scope for the chain
- writing any El Jamón place with a `scopeKey`
- enabling the source or starting a run on staging or production
- any request rate above 4 per second, or a full catalog walk run more than once while you
  build (the fixtures and one rehearsal on an ephemeral slot are the evidence)

### Progress evidence

- Fixture specs for every parser in section 6, listed in section 10.
- Runner specs with `RecordingRunReport`, as the LIDL and DEZA runner specs do.
- One rehearsal of both runs on an ephemeral Luna slot, with the two run reports pasted into
  the PR: the place count, the product count, and every failure the report names.
- `nx affected -t lint test` green for the touched projects.

## 1. What the site gives, and what it does not

| Fact | Value |
| --- | --- |
| Shops in the store locator | 368 records: 366 "Supermercados El Jamón", 2 "Cash Lepe" |
| Records per province | Huelva 118, Sevilla 92, Córdoba 75, Cádiz 57, Málaga 17, Granada 7, Jaén 2 |
| Shop fields | latitude, longitude, street, town, province, postal code, opening hours as text |
| Shop id in the locator | none |
| Shops offering online pickup | 72, each with a numeric id, in a `<select>` on every shop page |
| Products in the online catalog | 6,853 (`sitemap.xml` lists 6,853 product URLs, and the eleven top level categories sum to 6,853) |
| Products per listing page | 20, fixed (a larger `pageSize` is ignored) |
| Product id | the article code in the URL, `/detalle/-/Producto/<slug>/<code>` |
| EAN | none, the basket's "barcode" argument repeats the article code |
| Price per shop | none, one price list for the whole chain |
| Stock per shop | none |

## 2. One price list for every shop

A visitor chooses a postal code before the listings show prices. Measured:

- Postal codes 21440 (Lepe), 41010 (Sevilla), 14013 (Córdoba), 11205 (Algeciras) and 18140
  (La Zubia), and pickup shop `400` (Córdoba), showed the same 40 prices across two categories,
  and the same article counts (182 and 59).
- Postal code 28001 (Madrid) answers `{"resultado":"ko","mensaje":"Actualmente no servimos
  pedidos online en este código postal..."}`. So the postal code decides whether the area is
  served, not which prices it sees.

**So a run writes one price per product, with `scopeKey: null`, into the default scope the run
is given**, which is the chain's `NATIONAL` scope from `0153`. This is the Carrefour path:
`scopesItsOwn: false`, and the spawn already refuses a price run with no default scope.

The runner declares no scope. The seeded `NATIONAL` scope has `externalKey: null`, and
`RunScopeResolver` matches declarations by `externalKey`, so a declared national scope
creates a second one beside the seeded one.

**This is the chain's online price.** Whether a physical shop charges the same is not
something the site states. The price is recorded as an `OFFICIAL_WEB` source row beside the
leaflet's `OFFICIAL_LEAFLET` rows, and `price_policies` decide which one a shopper sees (plan
`0080`). This plan does not change that decision.

### 2.1 The shop stack must reach the national price

Plan `0116` gives every shop its own `STORE` scope in every stack. An El Jamón shop imported by
section 3 holds that `STORE` scope with no prices in it. Before you finish, read how an imported
shop's stack is built and confirm with a spec or a rehearsal read that such a shop resolves the
`NATIONAL` price. If it does not, stop and ask: that is a decision about scope stacks, not about
this adapter.

### 2.2 What a listing row shows

Once a postal code is set, each row reads:

```
DOÑA ANA  arroz bomba, 1kg   POR SÓLO  3,99 €  3,49 €  3,49 €/Kilo
```

That is brand, name with size after the last comma, the previous price when the product is on
offer, the current price, and the unit price with its unit (`Kilo`, `Litro`, `Unidad`). A row
with one price before the unit price is not on offer. The separator before `€` is a
non breaking space.

### 2.3 What a product page shows

Every product page carries a schema.org `Product` in `application/ld+json`: `name`, `image`,
`brand.name`, `offers.price` (the current price, as `"3.49"`), `sku` and
`offers.availability`. It is present without a session. **`availability` is `'InStock'` on
every page sampled, written in single quotes inside the JSON, so it is a template literal and
not data.** It is not availability.

The page also carries the category breadcrumb, ingredients and nutrition. It carries no EAN.

## 3. Shop discovery

One request, no key, no session:

```
POST https://portal.supermercadoseljamon.com/Localizador/wp-admin/admin-ajax.php
action=make_search_request
store_locatore_search_input=Lepe
store_locatore_search_lat=37.2547   store_locatore_search_lng=-7.2044
lat=37.2547                          lng=-7.2044
store_locatore_search_radius=1000
store_locator_category=
```

The answer is HTML holding `var locations = {"center":…,"locations":[…]};`. Each location is
`{lat, lng, infowindow}`, and `infowindow` is HTML: the name in `<h3>`, then street, town,
province, `Spain`, postal code, then the hours after `Horario:`. The list is ordered by
distance from the centre, and the farthest shop (Motril) is 332 km away, so a 1000 km radius
from Lepe returns the whole chain. The origin and radius go in `source.config` with these
values as defaults.

- **`externalRef` is `<postalCode>:<normalized street>`.** The locator has no id. That key is
  unique across all 368 records and every record has a postal code. Coordinates are not used,
  because a corrected pin then reads as a new shop. `DiscoveredPlace` is unique on
  `(provider, externalRef)`, with provider `ELJAMON`.
- **Drop the two "Cash Lepe" records** and name them in the report. They are the group's cash
  and carry banner, not El Jamón shops.
- **A count check.** The document states no total, so the runner cannot check completeness
  against the chain. It reports the number read, and a run that reads fewer than 300 shops is a
  warning, because the chain had 366 on 2026-09-29.
- **No `scopeKey` on any place**, by section 2. A place stamps the chain from `input.chain`, as
  LIDL's does.
- A run given `input.postalCodes` reads the whole document once and keeps the shops on those
  codes, and reports `postalCodesWithNoShop`, as `mercadona-store-discovery.runner.ts` does.
- The opening hours are one free text line per shop. Keep them verbatim in the place's
  opening hours field if the place shape has one, and do not parse them.

The 72 pickup shop ids are not read. They are the ecommerce's own ids and name a different,
smaller set. Section 11 parks them.

## 4. The session, and why the locator page cannot start it

Prices appear only in a session that has a postal code. The session is two requests:

1. `GET /` (or any category or product page) starts a `JSESSIONID`.
2. `GET /delegate/seleccionarCodPostalAjaxServletFood?accion=enviarCodPostal&cp=21440&locale=es`
   sets the postal code. An empty body means success. A JSON body is a failure.

**A session whose first page was `/localiza-tu-tienda` answers `{"result":"sessionko"}` to step
2**, every time, although it holds a `JSESSIONID`. The locator page does not start a shop
session. So the client starts from `/` and never from any other page.

The client keeps its cookies itself (Node's `fetch` has no cookie jar): `JSESSIONID`, and the
`GCLB` cookie that Google's load balancer sets to keep a session on one backend. The postal
code is `source.config.postalCode`, default `21440`. On `sessionko` the client starts a new
session once and then fails the run.

## 5. The catalog walk

### 5.1 List

The eleven top level categories are the links `/categorias/<slug>/<two digits>` on `/`. Walk
those, not the 94 second level ones: the second level sums to 6,840, so 13 products are
reachable only from their top level category.

Page 1 is `GET /categorias/<slug>/<code>`. It prints `<n> Artículos`, which gives the page
count at 20 per page. Page N is a POST of the listing form:

```
POST /categorias/<slug>/<code>?p_p_id=ProductosFoodPortlet_WAR_comerzziaportletsfood
  &p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&p_p_col_id=column-2&p_p_col_count=1
  &_ProductosFoodPortlet_WAR_comerzziaportletsfood_accion=buscar
  &_ProductosFoodPortlet_WAR_comerzziaportletsfood_operacion=paginar
  &_ProductosFoodPortlet_WAR_comerzziaportletsfood_pagina=<N>

filters=<the JSON in the page's hidden "filters" input, with "page": N>
modoCuadricula=cuadriculaP
idPortlet=
```

**Send the `filters` JSON.** The same URL as a bare GET or an empty POST returns the home
page's carousel (45 unrelated products), not page N. Copy the JSON from page 1's hidden input
rather than building it, and change only `page`.

The whole walk is about 350 listing requests. A page whose rows repeat a code already seen in
the same category ends that category, as a guard against a page number the server clamps.

### 5.2 Detail, for new products only

A listing row has no category path below the top level and no image. A product this source has
not seen before gets one product page: the breadcrumb gives the category path, the JSON-LD the
image, brand and price. A known product skips it (`skipsKnownDetails: true`, plan `0119`
section 3), so the first walk reads about 6,850 product pages and later walks read only what
is new. At the default 4 requests per second the first walk takes about half an hour, which is
the size of a Mercadona catalog discovery.

When the listing's current price and the JSON-LD price disagree, keep the listing's and warn.
The listing is what a signed in shopper sees with the session's postal code.

### 5.3 What a run reports

Per product, one `SourceObservation`:

- `externalId`: the article code
- `name`, `brand`, `unitSize`, `sizeFormat`, `packCount`: section 6
- `ean: null`
- `categoryPath`: from the breadcrumb, or the top level category name when no detail was read
- `url`: the product page
- `prices`: one entry, `scopeKey: null`, `price`, `currency: 'EUR'`, `unitPrice`,
  `unitPriceLabel` (`Kilo`, `Litro`, `Unidad`), `validFrom` and `validUntil` null (the site
  states no offer dates)
- `extra.previousPrice` when the row shows one

No `report.availability`, no `report.assortmentComplete`, no `report.scope`.

## 6. `@portfolio/luna-shopper/eljamon`

Laid out as `libs/luna-shopper/deza`: `project.json` named `luna-shopper/eljamon` with `test`,
`lint` and `capture-fixtures`, no tags, `src/lib/__fixtures__/` with a `README.md`, and
`tools/capture-fixtures.ts`. It depends on nothing, as DEZA does.

| File | Holds |
| --- | --- |
| `eljamon.client.ts` | `ElJamonClient`: the session of section 4, `listStores()`, `topCategories()`, `walkCategory(code, onPage)`, `getProduct(path)`, a `requests` counter, `ElJamonHttpError`. Options as `DezaClientOptions`: `baseUrl`, `locatorUrl`, `postalCode`, `userAgent`, `acquire`, `fetchImpl`, `sleepImpl`, `retries`, `backoffBaseMs`, `minIntervalMs`, `signal`. Backoff with jitter on 429 and 5xx. |
| `html.ts` | entity decoding, including `&#x2f;` style hex entities, which every link on the site uses |
| `stores.ts` | `parseLocations(html)` and the `externalRef` rule of section 3 |
| `listing.ts` | `parseListingPage(html)`: rows, the article count, and the `filters` JSON |
| `product.ts` | `parseProductPage(html)`: JSON-LD, breadcrumb |
| `price.ts` | Spanish decimals and the unit label |
| `size.ts` | the size after the last comma of the name: `1kg`, `330ml`, `500g aprox.`, `pk 3`, `ud`, `kg` (sold by weight) |

The `index.ts` doc comment states the framework free constraint and the dependencies, as the
other source libraries do.

## 7. Registering `eljamon-web`

1. `ADAPTER_KEYS` and `ADAPTER_CAPABILITIES` in
   `libs/luna-shopper/contracts/src/lib/messages/harvest.messages.ts`:

   ```ts
   'eljamon-web': {
     writesPrices: true,
     // One price list for the whole chain (plan 0169, section 2), written into
     // the default scope the spawn is given, which is the chain's NATIONAL one.
     scopesItsOwn: false,
     // The store locator returns every shop in one request (section 3).
     listsItsOwnStores: true,
     // The product pages carry no EAN, so a backfill has nothing to read.
     hasProductPages: false,
     // A new product gets one product page for its category path (section 5.2).
     skipsKnownDetails: true,
     printedLocale: 'es',
     walkablePriorities: null,
   },
   ```

   Add the new key to the loops in `harvest.messages.spec.ts`.
2. `CatalogDiscoveryRunner.runnerFor`: a case sending `eljamon-web` to `ElJamonCatalogRunner`.
3. `StoreDiscoveryRunner.cases`: `'eljamon-web': elJamon`.
4. `harvest.module.ts`: both runners as providers.
5. `PROVIDER_ADAPTERS` in `discovered-place.service.ts`: `ELJAMON: 'eljamon-web'`.
6. `SOURCE_KIND_BY_ADAPTER` needs nothing: the default, `OFFICIAL_WEB`, is right.
7. The adapter lists written by hand in `harvest.dto.ts` descriptions, then
   `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types`.
8. `ADAPTER_ORDER` in `sources-page.ts`: place it after `deza-web`.

`postal-code-discovery.service.ts` asks every `listsItsOwnStores` source on each postal code.
With this source enabled, that is one locator request per postal code in the queue. Say in the
PR whether that is acceptable or whether the runner must cache the document for the length of
one pass. Do not build a cache unless the owner asks.

## 8. The run and its report

Stages, as the other runners name them: `STORES` for store discovery, then `LIST`, `DETAIL` and
`INGEST` for the catalog. Call `setTotalPlanned` once the eleven counts are read, `heartbeat`
between pages, and `report({ failed: 1 })` per failed page or product. The failure ratio and
the stale reaper are the executor's and stay as they are. Use `runWorkerPool` for the detail
phase with `source.workers`. The listing is serial per category, because a page's `filters`
come from the session's previous page.

`setReport` for the catalog run:

- `postalCode`, `categories` (each with its printed count and the rows read)
- `listed`, `onOffer`, `detailRead`, `detailFailed`
- `failedPages` and `failedProducts`, each named, never only counted
- `priceDisagreements` (section 5.2), named
- `requests`

For the store run: `shopsRead`, `shopsKept`, `droppedRecords` (named), `postalCodesWithNoShop`,
`requests`.

Never write a number that claims the catalog is complete. The sum of the printed counts is what
the site said, and the report says it in those words.

## 9. Politeness and research notes

- Default `maxRequestsPerSecond` is 4, from the source row, as every source.
- Commit the probe scripts that produced the facts in section 1 under
  `apps/luna-shopper-backend/harvester/docs/research/eljamon/` with a `README.md`, as LIDL's
  are.
- An opt in live spec, `LUNA_LIVE_SOURCE_TEST=1`, asserts field names only, as
  `lidl/src/lib/live-source.spec.ts` does.

## 10. Testing

Library, fixtures captured with `capture-fixtures`, never edited by hand:

- `stores.spec.ts`: the locator response gives 366 shops after dropping two, every `externalRef`
  is unique, accents decode, a record with no postal code is dropped and named.
- `listing.spec.ts`: a page with a product on offer and one not, the article count, the
  `filters` JSON, the non breaking space before `€`, a sold by weight row.
- `product.spec.ts`: JSON-LD with the single quoted `availability`, breadcrumb, a page with no
  JSON-LD returns null and does not throw.
- `size.spec.ts`: one case per form in section 6.
- `eljamon.client.spec.ts` with a `fetchImpl` fake: the session starts from `/`, a
  `sessionko` answer restarts once and then throws, cookies are sent back, page N is a POST
  carrying `filters` with `page: N`, 429 backs off.

Harvester:

- `eljamon-store-discovery.runner.spec.ts`: places carry the chain and no `scopeKey`, the
  postal code filter, the report.
- `eljamon-catalog.runner.spec.ts`: one observation per row, one price with `scopeKey: null`
  no availability and no scope declared, a known product reads no detail, a failed page is
  named in the report.
- The dispatch specs (`catalog-discovery.runner.spec.ts`, the store discovery equivalent) send
  `eljamon-web` down its own path.
- `harvest-run.service.spec.ts`: a catalog run of `eljamon-web` with no `priceScopeId` is
  refused, a store run needs no postal code.
- The shop stack check of section 2.1.

## 11. What this plan does not do

- **No availability.** The site has none per shop, and the JSON-LD field is a template
  constant.
- **No pickup shop ids.** The 72 ecommerce ids can key a later mapping of online pickup
  shops to catalog locations. Nothing reads them yet.
- **No leaflet change.** Leaflet prices stay as they are, side by side with this source's.
- **No EAN.** Products bind to catalog products through curation, as DEZA's do.
- **No schedule and no cluster change.** The source row stays off until the owner enables it.

## 12. Exit criteria

- Every item of "Target state" in the brief holds.
- The PR shows both rehearsal reports and states the answer to section 2.1 and the question at
  the end of section 7.
