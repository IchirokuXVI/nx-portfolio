> **PR:** [#598](https://github.com/IchirokuXVI/nx-portfolio/pull/598)

# 0174: DIA, an online price per fulfilment store

> Prerequisite reading: `0089` (a chain that declares its own scopes from its data), `0106` (a
> store list read in one request), `0107` (place trust), `0108` (Mercadona's warehouses: a
> walk given the scopes it walks, and availability per scope), `0116` (every shop holds its own
> `STORE` scope), `0118` (`scopeCopies`), `0153` (a chain's `NATIONAL` default scope), `0169`
> (El Jamón, the newest adapter and the checklist this plan follows), `0173` (the category tree
> this adapter files products under). In the code: `mercadona-catalog.runner.ts`,
> `mercadona-store-discovery.runner.ts`, `category-resolution.ts`, `run-report.ts` and
> `ADAPTER_CAPABILITIES` in `harvest.messages.ts`.

DIA is not a seeded chain. It exists on staging because an operator created it by hand during
plan `0150`, and a chain created in the back office gets a `NATIONAL` default scope since
`0153`. Its leaflets already have a layout note (`libs/luna-shopper/tools/leaflet/chains/src/dia/layout.md`),
and `tools/price-spike/adapters.mjs` still holds a `dia` stub that throws "browser automation
required". That stub was a guess, and section 2 measures what the site really refuses.

Every number below was measured against the live site on 2026-09-29, in about 3,500 requests
over three probe sessions. The probe scripts and the small data files are committed under
`apps/luna-shopper-backend/harvester/docs/research/dia/`.

## Brief for the agent

### Objective

Add the `dia-api` source: a framework free library `@portfolio/luna-shopper/dia`, a
`STORE_DISCOVERY` case that reads DIA's shops and links each one to the online fulfilment store
that prices its area, and a `CATALOG_DISCOVERY` case that walks the online catalog once per
fulfilment store and writes the **regular** (non member) price, availability per store, and DIA's
category ids for every product.

### Context

- The shop is `https://www.dia.es`, a Vike/Vue front end over plain JSON APIs under `/api/v1/`.
  Akamai sits in front and refuses any request whose headers do not look like a browser's
  (section 2).
- **An online price belongs to a fulfilment store, not to a shop.** A postal code maps to one
  `physical_store_id`, and about 50 of them serve Spain. Most share one price list, and
  Catalonia differs on sugary drinks (section 3).
- The owner decided the scopes: the chain's `NATIONAL` default scope, one `LOCAL_AREA` scope per
  fulfilment store, and the `STORE` scope every shop always holds. This is Mercadona's shape
  (`0108`), with a national row added (section 3.2).
- The owner decided the price: **the regular price, never the Club Dia price** (section 4).
- Runners write through `RunReport` (`scope`, `product`, `place`, `availability`,
  `assortmentComplete`), never through `CatalogClient` (plan `0103`).
- A new adapter key is registered in `ADAPTER_KEYS` and `ADAPTER_CAPABILITIES`, dispatched from
  `CatalogDiscoveryRunner.runnerFor` and the `cases` table of `StoreDiscoveryRunner`. Section 9
  lists every place, and plan `0169` section 7 is the model.
- `supermarket_sources` needs no migration and no seed. The row is written from the back office,
  off by default, and per chain settings live in its `config` jsonb. **Do not add an environment
  variable.**

### Target state

- `nx run luna-shopper/dia:test` passes against checked in fixtures with no network.
- A `STORE_DISCOVERY` run of a `dia-api` source reports the DIA shops (about 2,400), each with an
  address, postal code, coordinates and weekly hours, and each served shop carries the `scopeKey`
  of its fulfilment store. A run given `postalCodes` reads only the shops of those codes.
- A `CATALOG_DISCOVERY` run given a list of fulfilment scopes reports one observation per listed
  product with one regular price per walked scope, availability per walked scope, and the DIA
  category ids of every leaf the product was listed under.
- A product created from a DIA source row lands on the `0173` leaf its DIA category maps to.
- The run report names every page and every scope that failed.
- `openapi.json` and `wire-types.ts` are regenerated and committed.

### Scope

Work only in:

- `libs/luna-shopper/dia/` (new), and its alias in `tsconfig.base.json`
- `apps/luna-shopper-backend/harvester/src/app/harvest/`: two new runners and their specs, the
  two dispatch tables, `harvest.module.ts`, `PROVIDER_ADAPTERS` in `discovered-place.service.ts`,
  `SOURCE_KIND_BY_ADAPTER` in `run-executor.service.ts`, and `category-resolution.ts` with its two
  callers (section 7)
- `libs/luna-shopper/contracts`: `ADAPTER_KEYS`, `ADAPTER_CAPABILITIES` and their spec
- `apps/luna-shopper-backend/gateway/src/app/harvest/harvest.dto.ts`, the description strings
  that list adapters by hand, then the regenerated `openapi.json`
- `libs/luna-shopper-admin/models` (regenerated `wire-types.ts` only) and the one entry in
  `ADAPTER_ORDER` in `libs/luna-shopper-admin/feature-harvest/src/lib/sources-page.ts`
- `apps/luna-shopper-backend/harvester/docs/research/dia/`: add the fixture capture notes
- `apps/luna-shopper-backend/tools/price-spike/adapters.mjs`: delete the `dia` stub or point it
  at the library, whichever the file's other adapters do since `0169`

Do not touch: the category tree or its seed (that is `0173`), the leaflet tooling, the reference
seed, price policies, `effective-price.ts`, the scope resolver for shoppers, or any Helm values
file.

### Constraints

- **Build after `0173` and after PR #535 (El Jamón) has merged.** This plan registers its key in
  the same tables #535 edits, and it files products under `0173`'s slugs. If either is not on
  `dev` when you start, stop and say so.
- The library is framework free: no Nest, no TypeORM, no database. Node's global `fetch`
  (undici), never `node:https`, which Akamai refuses (section 2).
- Every request awaits the run's `acquire` gate. The client also keeps its own minimum interval
  of 500 ms, so it never exceeds 2 requests per second whatever the source row says (section 10).
- The request headers are decision D1 (section 2). Do not change them to "fix" a 403 without
  reading that section.
- The price written is the regular price of section 4. A Club Dia price is never written as a
  price. It goes in `extra.loyalty` only.
- No automated match binds a site product to a catalog product (plan `0081`). The ingest records
  the price, and only an `ACTIVE` entry publishes it.
- Only make changes directly requested.

### Action boundaries

Stop and ask before:

- sending headers other than those of section 2, or adding a browser (Playwright) to this adapter
- declaring a scope of any kind other than `LOCAL_AREA` from a runner, or creating a second
  `NATIONAL` scope for the chain
- changing the spawn validation in `harvest-run.service.ts` (section 6.6 says when you need
  to, and that is a question for the owner)
- enabling the source or starting a run on staging or production
- walking more than three fulfilment scopes in one run, or running a full store discovery more
  than once, while you build (the fixtures and one rehearsal are the evidence)

### Progress evidence

- Fixture specs for every parser in section 8, listed in section 11.
- Runner specs with `RecordingRunReport`, as the Mercadona and LIDL runner specs do.
- One rehearsal on an ephemeral Luna slot: a store discovery given three postal codes (`28041`,
  `08001`, `44200`), then a catalog run over the scopes it declared (at most three). Paste both
  run reports into the PR: shop counts, scope keys, product count, price differences between the
  walked scopes, and every failure the reports name.
- `nx affected -t lint test` green for the touched projects.

## 1. What the site gives, and what it does not

| Fact | Value |
| --- | --- |
| Category tree | `GET /api/v1/common-aggregator/menu-data`: two levels, 29 roots, 251 leaves (plus a "Todo" child per root carrying the root's own id) |
| Listing | `GET /api/v1/plp-back/reduced/<root slug>/<leaf slug>/c/L<code>?page=N`, JSON, 20 rows per page, fixed |
| Products listed | 5,718 unique in the default session (Madrid), 5,616 in Barcelona, 6,104 in both |
| Listing walk | about 280 leaves, about 500 requests, 182 s at 2.8 per second |
| Product id | `sku_id` (also `object_id`), a number as a string |
| EAN | **none**, not in the listing, not in the detail (`/api/v1/pdp-back/<sku>`), not in the schema.org data |
| Brand | `brand` on the listing row (984 distinct, missing on 160 rows) |
| Size | not a field: it is printed at the end of `display_name` (section 6.4) |
| Price per scope | yes: about 50 fulfilment stores, three price groups among 17 postal codes (section 3) |
| Stock per scope | `units_in_stock` on every row, and the assortment differs per scope |
| Online offer dates | none. `promotions[]` is text only |
| Shops | one gzip file, 3,234 records: 2,434 DIA and 800 Clarel |
| Shop fields in the file | `idTienda`, `codigoTienda`, `tipoTienda`, `codigoProvincia`, `posicionX` (latitude), `posicionY` (longitude), `tieneFolleto`, `fechaVigenciaFolleto`, `especial` |
| Shop detail | one request per shop: address, postal code, town, phone, weekly and holiday hours, leaflet ids, fresh counters |
| Shop name | none. Every DIA shop is "DIA" |
| Shop search | none on the server. The store page geocodes addresses in the browser |

The listing row carries everything a price run needs: `display_name`, `brand`, `url` (the
product's category path), `image`, `prices`, `promotions`, `units_in_stock`, `weight_in_grams`,
`average_weight`. The detail page adds ingredients, nutrition and the manufacturer, which the
catalog does not store, so **this adapter reads no product pages**.

## 2. Access: Akamai, and decision D1

Measured on 2026-09-29, same URL, same minute:

| Client and headers | Result |
| --- | --- |
| `curl`, no browser headers | 403, even for `robots.txt` |
| `curl` or Node `fetch`, the harvester's `HARVEST_USER_AGENT` | 403 |
| the same, with a Chrome User-Agent that appends `LunaShopper/0.1 (+https://velista.app)` | 403 |
| `curl`, Chrome User-Agent plus `Accept`, `Accept-Language`, `sec-ch-ua*` and `Sec-Fetch-*` | 200 |
| Node global `fetch`, Chrome User-Agent, `Accept`, `Accept-Language` | 200 |
| `node:https`, the same headers | 403 (Akamai fingerprints that client) |

**Akamai refuses every User-Agent that names us.** Plan `0169` made "carry an honest User-Agent,
never a browser one" a constraint, and every adapter so far obeys it, Carrefour included (its
headless Chromium sends `HARVEST_USER_AGENT`). DIA cannot be read that way.

**D1: the DIA client sends an unmodified Chrome User-Agent and the matching browser headers.**
This is the first adapter to do so, and it is the owner's decision, recorded in this plan's PR.
Keep the header set in one constant in `dia.client.ts` with a comment that points here, so it is
one place to review and one place to remove. Everything else about the adapter stays polite: the
rate of section 10, `robots.txt` respected (section 10), and no request the public site does not
make itself.

If the owner does not approve D1, this plan stops here. There is no other route: a browser needs
the same User-Agent to pass.

## 3. Price scopes

### 3.1 A fulfilment store is a `LOCAL_AREA` scope

- `GET /api/v1/common-aggregator/check-service?postal_code=NNNNN` answers 200
  `{"physical_store_id":"13835"}`, or 206 with an empty body when the code has no online service.
- `physical_store_id` equals the shop file's `codigoTienda` (54 of 54) and the detail's
  `tiendaCodigo`. It is **not** `idTienda`.
- 50 distinct stores answered over 57 served postal codes, roughly one per province. The three
  big city hubs (13835 Madrid, 959 Barcelona, 2354 Sevilla) have no leaflet and read "closed until
  31/12/2026": they are warehouses, not walk in shops.

So a fulfilment store is what Mercadona's warehouse is (`0108`): a `LOCAL_AREA` scope, priority
200, `externalKey` = the store code, label `{ es: 'Dia online, tienda <code> (<town>)', en: 'Dia
online, store <code> (<town>)' }`, the town from that store's detail when the file holds it and
omitted otherwise. `STORE` is not possible: a store scope names one shop, and catalog refuses a
shop naming another shop's store scope (`requestedStack`).

### 3.2 The chain's `NATIONAL` scope

A visitor who never gives a postal code sees the prices of postal code 28041, store 13835. That
is the price list DIA shows the whole country by default, so it is an honest national price, not
an operator's summary. **A catalog run writes the prices of the anonymous session's store twice:
under that store's scope key, and with `scopeKey: null`**, which the ingest sends to the run's
default scope, the chain's `NATIONAL` one.

- The run finds that store itself: a fresh session, then `GET /api/v1/common-aggregator/header-data`
  (`cart.postal_code`), then `check-service` on that code. Report it as `nationalFrom`.
- It writes the national row only when that store is among the scopes it walks, and only when the
  run has a default scope. Otherwise the report says `nationalFrom: null` and why.
- Never declare the national scope by key. It has `externalKey: null`, and a declaration creates a
  second one (plan `0169`, section 2).

A shop whose postal code has no online service (small towns, Ibiza, Vitoria, Melilla, measured)
gets no `scopeKey`. Its stack is its own `STORE` scope, and the fall through reaches `NATIONAL`
(`lessSpecificScopesOf` always adds it). So such a shop quotes the default online price. That is
the best the site states for it, and section 12 parks anything better.

### 3.3 What the scopes hold, measured

Three price groups among 17 served postal codes, over the 406 products of the 14 leaves where
Madrid and Barcelona differ:

- Madrid (default), 15001, 20001, 25001 Lleida, 30800, 33001, 41001, 46001, 48001, 50001, 07001,
  06800: one list.
- 08001, 17001, 43001: 37 to 46 products differ, almost all sugary drinks (Coca-Cola 2 l 2.69
  against 2.15). Lleida prices like Madrid, so a zone is not the autonomous community.
- 29001 and 51001 Ceuta: 2 products differ.

The assortment differs far more than the price: 488 products are only in Madrid and 386 only in
Barcelona. Store every scope, never collapse two that agree today (`0108`, D6). A run that wants
to save requests uses `scopeCopies`, which already exists.

### 3.4 An unserved postal code fails silently

`PUT /api/v1/common-aggregator/save-shipping-address?new_postal_code=X` (body `null`) answers 204
when X is served. When it is not, it answers 206 and **the session keeps 28041**, so the walk
that follows reads Madrid's prices. The client therefore confirms every session before walking:
after the PUT, `header-data` must show X as `cart.postal_code`, and `check-service` on X must
answer the scope's own store code. Either mismatch skips that scope with a named warning. It is
never walked under a borrowed postal code.

## 4. The regular price

Measured on all 5,718 rows of the default session:

| Row | Count |
| --- | --- |
| no club, no promotion, `strikethrough_price == price` | 5,497 |
| `is_club_price` and `is_promo_price`, `strikethrough_price > price` | 120 |
| no club, no promotion, a club only multi buy promotion attached ("2ª ud 50%") | 96 |
| `is_promo_price` without club, a promotion for everybody | 5 |

- `is_club_price` is never true without `is_promo_price`, and no row has a null
  `strikethrough_price`.
- A club only multi buy leaves `price` equal to `strikethrough_price`.
- `price_per_unit` is computed on `price`, so on a club row it is the **club** unit price (114 of
  116 club rows match `price` by arithmetic, none match `strikethrough_price`). The detail has no
  regular unit price either.

The rule, in `price.ts`:

- **regular price** = `is_club_price ? strikethrough_price : price`
- **regular unit price** = `price_per_unit` when `is_club_price` is false, and
  `round2(price_per_unit × strikethrough_price / price)` when it is true (**D2**, below)
- a promotion for everybody (`is_promo_price` without club) is what every shopper pays, so its
  `price` is the regular price at that moment, and `strikethrough_price` goes in
  `extra.previousPrice`
- a club row writes `extra.loyalty = { program: 'CLUB_DIA', price, unitPrice: price_per_unit }`
  and `extra.previousPrice` nothing
- `promotions[]` text goes in `extra.promotion` verbatim, with `only_club_dia` kept on each entry

`toItemPriceDetails` already keeps `extra.loyalty` and `extra.promotion` verbatim, so the admin's
price history shows them. No shopper sees them. That is the precedent of plan `0081`, section 6.3
("loyalty is stored and not implemented") and plan `0089`, section 11 (no Lidl Plus prices).

**D2: the unit price of a club row is scaled, once, by the same ratio as the price.** The rule
that a unit price is stored verbatim and never recomputed exists because Mercadona's own
derivation disagrees with the chain. Here the chain's own number is for a different price, so
writing it verbatim is wrong in the other direction. The scale is exact up to one cent of
rounding, applies to about 120 rows, and each such price carries `extra.unitPriceScaled: true` so
it can be found. If the owner rejects D2, write `unitPrice: null` on those rows instead.

Every price is `currency: 'EUR'` with `validFrom` and `validUntil` null: the site states no dates.

`measure_unit` maps to `unitPriceLabel` verbatim (`KILO`, `LITRO`, `UNIDAD`, `100 ML.`, `100 GR.`,
`LAVADO`, `DOCENA`, `METRO`). Do not convert `100 ML.` to litres.

## 5. Store discovery

### 5.1 The shop file

1. `GET /tiendas/buscador-tiendas-folletos` and read the hidden input `#gz`: its value names the
   current file, for example `tiendas.v2747.json.gz`.
2. `GET /clubdia/ES/<that file>`: 70 KB gzip, 3,234 records.

Keep `tipoTienda` 0 (DIA). Drop `tipoTienda` 1 (Clarel, 800 records, a perfumery banner with no
leaflets) and count it in the report. Do not hard code the version number: it changes.

`codigoProvincia` equals the first two digits of the shop's postal code (67 of 67 checked).

### 5.2 The shop detail

`GET /tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id=<idTienda>` returns JSON
(22 samples). The fields a place uses:

| Field | Becomes |
| --- | --- |
| `tiendaCodigo` | `externalRef` (it equals the file's `codigoTienda` and the scope key numbering) |
| `direccionPostal` | `street` |
| `codigoPostal` | `postalCode` |
| `localidad` | `city` |
| `telefono` | `tags.phone` |
| `horariosTienda` (`{"1": "09:00 - 21:30", …}`) | `openingHours`, section 5.5 |
| `festivosTienda`, `horariosAperturaFestivo` | `tags['dia:holidays']`, verbatim |
| `toolTipsPerecederos` | `tags['dia:fresh']`, verbatim (fresh counters: meat, fish, fruit, bakery) |
| `servicioDomicilio` | `tags['dia:homeDelivery']` |
| `folletoId`, `documentoFolletoId`, `validezFolleto2` | `tags['dia:leaflet']`, verbatim |
| `fechaApertura`, `inicioCierreTemp`, `finCierreTemp` | section 5.4 |

Coordinates come from the file (`posicionX` latitude, `posicionY` longitude), because the detail
has none. `idTienda` goes in `tags['dia:idTienda']`, `codigoProvincia` in `tags['addr:province']`.
A place carries no name, as Mercadona's do (plan `0106`). Provider `DIA`.

### 5.3 Filtered by postal code

**Yes, with one extra step, because the file has no postal code.** The server offers no search,
so the runner narrows the file itself:

1. Read the file once.
2. For each requested postal code, take its centroid from `SPAIN_POSTAL_CODE_CENTROIDS`
   (`@portfolio/luna-shopper/postal-codes/dataset`) and keep the DIA shops in the same province
   (`codigoProvincia` = the code's first two digits) within `source.config.postalCodeRadiusMetres`
   (default 5,000) of it.
3. Read the detail of those candidates only, and keep the shops whose `codigoPostal` is one of the
   requested codes, exactly. That is the rule every chain runner already follows (`0106`, D4).
4. A requested code with no centroid, or with no shop left after step 3, goes in
   `postalCodesWithNoShop`. A code with no centroid is also named in `postalCodesWithoutCentroid`.

Measured candidates of type 0 around a centroid: 28041 has 12 within 2 km and 98 within 5 km,
08001 has 14 and 55, 41001 has 20 and 48. So a postal code costs 1 file request, 15 to 100
detail requests, and one `check-service` per distinct code kept. The postal code queue
(`postal-code-discovery.service.ts`) asks every `listsItsOwnStores` source per queued code, so it
pays this per code. Say in the PR whether that is acceptable. Do not add a cache unless the owner
asks (the same question `0169` section 7 left open).

A run with no `postalCodes` reads every DIA shop's detail: about 2,434 detail requests plus one
`check-service` per distinct postal code (inferred about 1,500), about 33 minutes at 2 per
second.

### 5.4 What a run keeps and drops

- Drop Clarel records (section 5.1), counted.
- Drop a shop whose detail carries a `fechaApertura` in the future: it is temporarily closed, and
  the three hubs of section 3.1 are among them. Name each in `droppedRecords` with the reason
  `temporarily-closed` and the date. The next run picks it up once it reopens.
- A detail that fails is named in `failedShops` and the shop is not reported. Never report a place
  without a postal code from this source.

### 5.5 Opening hours

`horariosTienda` keys `1` to `7` are Monday to Sunday (inferred from the samples: confirm it on a
fixture shop whose Sunday differs from its weekdays, and stop and ask if the mapping is not
Monday first). Render them as an OpenStreetMap `opening_hours` string, joining consecutive days
with equal hours (`Mo-Sa 09:00-21:30; Su 10:00-15:00`). A value the parser cannot read keeps the
raw object in `tags['dia:hours']` and leaves `openingHours` null, named in the report.

### 5.6 Linking a shop to its fulfilment store

For every distinct postal code among the kept shops, one `check-service` call:

- 200 with a store code: `report.scope()` declares the `LOCAL_AREA` scope of section 3.1 (once per
  code of store), and every shop on that postal code carries `scopeKey` = the store code, plus
  `tags['dia:fulfilmentStore']`.
- 206: no scope key. The shop's postal code goes in `postalCodesWithoutOnlineService`.

This is Mercadona's `resolveWarehouse` per postal code (`mercadona-store-discovery.runner.ts`),
with one request per code rather than per shop.

## 6. The catalog walk

### 6.1 The run's input

As Mercadona's (`0108`): `priceScopeIds`, the `LOCAL_AREA` fulfilment scopes to walk (the
walkable band of section 9), plus optionally `priceScopeId`, the chain's `NATIONAL` scope, as the
default for section 3.2, and optionally `scopeCopies`. A scope is walkable only once a store
discovery declared it, so **the first DIA run is a store discovery**.

### 6.2 A postal code for each scope

A session is set by postal code, and a scope is keyed by store code. For each walked scope:

1. `source.config.scopePostalCodes["<store code>"]` when set.
2. Otherwise the store's own postal code: find the file record whose `codigoTienda` equals the
   key, read its detail, take `codigoPostal`. The shop file is read once per run for this.
3. Confirm with `check-service` that the code answers this store (section 3.4). A mismatch or a
   store not in the file skips the scope, named in `skippedScopes` with the reason.

That the hub's own postal code answers the hub was measured for 13835 (28041). Confirm it for
every scope of the rehearsal and report it.

### 6.3 One session per scope

1. `GET /api/v1/common-aggregator/header-data` starts the session (`session_id` cookie). The
   client keeps its cookies itself, since Node's `fetch` has none.
2. `PUT save-shipping-address?new_postal_code=<code>` with body `null`, expecting 204.
3. Confirm per section 3.4.
4. Walk.

Scopes are walked one after another, never in parallel: the session is server state.

### 6.4 The walk

1. `GET /api/v1/common-aggregator/menu-data` once per run. Walk every leaf of the menu except
   the "Todo" children and `L150` Ofertas. **Walk the leaves `0173` did not copy too** (Novedades,
   Frutas de temporada): some products are listed nowhere else, and section 7 files them.
2. Per leaf, page 1, then `?page=N` until `pagination.total_pages`. A page past the end answers
   200 with no rows. A leaf that answers 301 has moved: follow `Location` once and name it in
   `movedLeaves`.
3. Per product, merge every leaf it appeared under into one observation (892 products sit in two
   leaves, 154 in three or four).

Per product, one `SourceObservation`:

- `externalId`: `sku_id`
- `name` and `sizeFormat`: `display_name` split at its trailing format. Read the fixtures first
  and follow `@portfolio/luna-shopper/eljamon`'s `size.ts`: `sizeFormat` is the removed text
  verbatim, `unitSize` the number in the printed unit, `packCount` when the name prints a pack.
  A name whose format the parser cannot read keeps the whole name, `unitSize` and `sizeFormat`
  null, and is counted in `unparsedSizes` with examples. Products sold by weight carry
  `weight_in_grams` and `average_weight`: keep both in `extra`.
- `brand`: `brand`, or null
- `ean: null`
- `categoryPath`: `[root name, leaf name]` in Spanish, of the first leaf the product appeared under
- `extra.diaCategoryIds`: every leaf id the product appeared under, in walk order
- `url`: `https://www.dia.es` + `url`
- `prices`: one per walked scope, section 4, `scopeKey` = the store code, plus the national row of
  section 3.2 when it applies
- `extra.image`: `image`, as an absolute URL

### 6.5 Availability

Per walked scope, as `0108` requires of a run over several warehouses:

- listed with `units_in_stock > 0`: available
- listed with `units_in_stock == 0`: not available
- not listed in this scope's walk but listed in another scope's walk of the same run: not
  available in this scope

`report.assortmentComplete` is never claimed: the sitemap names 7,578 products and a walk lists
about 5,700 (the rest are out of stock or delisted, sampled).

### 6.6 The default scope beside a scope list

The spawn accepts `priceScopeId` beside `priceScopeIds` (`harvest-run.service.ts`, the `walk`
block), and the ingest sends `scopeKey: null` to `defaultPriceScopeId`. Confirm in a spec that a
`dia-api` spawn with both is accepted and that a national row lands in the `NATIONAL` scope. If
the spawn refuses a default scope outside the walkable band, stop and ask: that is a decision
about the band, not about this adapter.

### 6.7 What a run reports

`setReport` for the catalog run:

- `nationalFrom` (section 3.2), `scopes` (each with its postal code, `listed`, `inStock`, and the
  leaves read), `skippedScopes` (named, with the reason)
- `leaves` (each with its printed `total_items` and the rows read), `movedLeaves`
- `listed`, `clubPrices`, `promotions`, `unitPriceScaled`, `unparsedSizes` (count and examples)
- `priceDifferences`: per pair of walked scopes, how many products differ in regular price
- `failedPages`, named, never only counted
- `requests`

For the store run: `shopsInFile`, `clarelDropped`, `candidates`, `detailsRead`, `shopsKept`,
`droppedRecords` (named), `failedShops` (named), `postalCodesWithNoShop`,
`postalCodesWithoutCentroid`, `postalCodesWithoutOnlineService`, `scopesDeclared`, `requests`.

Stages: `STORES` and `SCOPES` for store discovery, `SCOPES`, `LIST` and `INGEST` for the catalog.
`setTotalPlanned` once the menu is read (leaves × scopes), `heartbeat` between pages,
`report({ failed: 1 })` per failed page. A catalog run of 50 scopes is about 3 hours, so the
heartbeat matters more here than anywhere else (the stale reaper fires after 900 s).

## 7. Categories

`categorySlugsFor` sends every chain through the Mercadona table today. It gains the source's
adapter key and the entry's `extra`:

- `dia-api`: map each id in `extra.diaCategoryIds` through `DIA_CATEGORY_SLUGS`
  (`libs/luna-shopper/dia/src/lib/categories.ts`), keep the distinct slugs in order, at most 10
  (`ITEM_CATEGORY_MAX`). No id maps: `uncategorised`.
- every other adapter: as today.

Both callers already hold the entry (`source-entry.service.ts`, `source-entry-batch.service.ts`),
and the source row gives the adapter key.

`DIA_CATEGORY_SLUGS` is generated from `apps/luna-shopper-backend/harvester/docs/research/dia/dia-map.json`,
written with plan `0173`: every copied DIA root and leaf maps to its own slug, and every DIA node
`0173` did not copy maps to the leaf its only products belong under (Frutas de temporada to
`other-fruits`), or is absent when its products all sit in copied leaves. A spec asserts that
every slug in the table is a leaf of the reference taxonomy. A new DIA leaf that is not in the
table maps to nothing: name it in the catalog report as `unmappedLeaves` so an operator can add
it. DIA reuses ids with a new meaning (`L2110` was "otras bebidas" a year ago and is "Kombucha y
aguas vitaminadas" now), so the report also names every walked leaf whose Spanish name differs
from the one recorded in the table, as `renamedLeaves`.

## 8. `@portfolio/luna-shopper/dia`

Laid out as `libs/luna-shopper/eljamon`: `project.json` named `luna-shopper/dia` with `test`,
`lint` and `capture-fixtures`, no tags, `src/lib/__fixtures__/` with a `README.md`, and
`tools/capture-fixtures.ts`. It depends on nothing.

| File | Holds |
| --- | --- |
| `dia.client.ts` | `DiaClient`: the D1 header constant, the cookie jar, `menu()`, `listing(path, page)`, `startSession(postalCode)` with the confirmation of section 3.4, `checkService(postalCode)`, `anonymousStore()`, `storeFile()`, `storeDetail(idTienda)`, a `requests` counter, `DiaHttpError`. Options as `ElJamonClient`'s: `userAgent` is **not** among them (D1), `acquire`, `fetchImpl`, `sleepImpl`, `retries`, `backoffBaseMs`, `minIntervalMs` (default 500), `signal`. |
| `menu.ts` | `parseMenu(json)`: roots, leaves, ids, Spanish names, paths |
| `listing.ts` | `parseListing(json)`: rows, pagination |
| `price.ts` | section 4 |
| `size.ts` | section 6.4 |
| `stores.ts` | `parseStoreFile(gz)`, `parseStoreDetail(json)`, the radius filter of section 5.3, the drops of section 5.4 |
| `hours.ts` | section 5.5 |
| `categories.ts` | `DIA_CATEGORY_SLUGS` and the names it was generated with (section 7) |

The `index.ts` doc comment states the framework free constraint and D1, as the other source
libraries state theirs.

## 9. Registering `dia-api`

1. `ADAPTER_KEYS` and `ADAPTER_CAPABILITIES` in `harvest.messages.ts`:

   ```ts
   'dia-api': {
     writesPrices: true,
     // A walk is given the fulfilment stores it walks, and the store code is
     // the scope's own externalKey (plan 0174, section 3.1).
     scopesItsOwn: true,
     // The shop file lists every shop (plan 0174, section 5).
     listsItsOwnStores: true,
     // The detail carries no EAN, so a backfill has nothing to read.
     hasProductPages: false,
     // The listing carries everything a price run needs, so there is no
     // detail phase to skip (plan 0174, section 1).
     skipsKnownDetails: false,
     printedLocale: 'es',
     // The LOCAL_AREA band alone, as mercadona-api.
     walkablePriorities: <the same band value mercadona-api uses>,
   },
   ```

   Add the new key to the loops in `harvest.messages.spec.ts`.
2. `CatalogDiscoveryRunner.runnerFor`: a case sending `dia-api` to `DiaCatalogRunner`.
3. `StoreDiscoveryRunner.cases`: `'dia-api': dia`.
4. `harvest.module.ts`: both runners as providers.
5. `PROVIDER_ADAPTERS` in `discovered-place.service.ts`: `DIA: 'dia-api'`.
6. `SOURCE_KIND_BY_ADAPTER`: `'dia-api': OFFICIAL_API`, as Mercadona and LIDL.
7. The adapter lists written by hand in `harvest.dto.ts` descriptions, then
   `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types`.
8. `ADAPTER_ORDER` in `sources-page.ts`: after `eljamon-web`.

## 10. Politeness, blocking and cost

- **At most 2 requests per second.** One Akamai edge address stopped accepting connections for
  about 7 minutes after about 1,280 requests at 2.8 per second, while the other edge addresses
  kept answering. About 2,200 more requests at 2 per second ran clean. 4 per second was never
  tried. The client's `minIntervalMs` of 500 holds this whatever the source row says.
- **Retries.** A 429, a 5xx, a connection error or a timeout is retried with backoff of 30, 60 and
  120 seconds, because the one block seen was a refused connection, not a status. A 403 is
  retried once after 60 seconds, then fails the request. **Five failed requests in a row stop the
  run** with the last error named, rather than failing every remaining page at full speed, which
  is what happened to Mercadona on the VPS (2026-09-25).
- **Robots.** `robots.txt` does not disallow `/api/`, the shop file or the shop detail. The walk
  uses `?page=N` on the API, never the disallowed `/pag-N`, `?filters=`, `?sort=`, `/search`,
  `/en/` or `*/ofertas/L*` paths.
- **The VPS is untested.** Every number here came from a home connection. Mercadona serves this
  machine and blocks the production VPS for minutes at a time. The rehearsal is on a slot, so
  before the owner enables the source in a cluster, one store detail and one listing page must be
  fetched from the harvester pod (`kubectl exec`). Say so in the PR, and do not do it yourself.
- **Cost at 2 per second:**

| Run | Requests | Time |
| --- | --- | --- |
| catalog, one scope | about 505 (500 listing, 5 session and confirmation) | about 4 min |
| catalog, all 50 scopes | about 25,000 | about 3.5 h |
| store discovery, every shop | about 4,000 | about 33 min |
| store discovery, one urban postal code | 20 to 100 | under 1 min |

The owner chose 50 scopes over a baseline and a diff, so a full price refresh is a long run.
`scopeCopies` and walking a subset per run are how an operator spreads it.

## 11. Testing

- `dia` library, against fixtures captured by `capture-fixtures` (never by hand): the menu in
  Spanish, two listing pages of one leaf, a listing with a club row, a promotion row and a club
  only multi buy, the last page of a leaf, the shop file, three shop details (a normal shop, a
  closed hub with `fechaApertura`, a shop with a leaflet and fresh counters), `check-service` 200
  and 206, `header-data` before and after a PUT.
- `price.spec.ts`: every row kind of section 4, the D2 scale, a club row's `extra.loyalty`.
- `size.spec.ts`: at least 30 real names from the fixtures, including sold by weight and packs.
- `stores.spec.ts`: Clarel dropped, a hub dropped as temporarily closed, the radius and province
  filter, the exact postal code rule.
- `hours.spec.ts`: equal days joined, a closed day, an unreadable value.
- `categories.spec.ts`: every slug is a reference leaf, Frutas de temporada maps to `other-fruits`.
- `dia.client.spec.ts`: the session confirmation refusing a 206, the retry and the five in a row
  stop, the minimum interval, the cookie jar.
- Runner specs with `RecordingRunReport`: the national row written only when its store is walked
  and a default scope is given, availability false for a product another scope listed, a skipped
  scope, a moved leaf, `unmappedLeaves`.
- `category-resolution.spec.ts`: a `dia-api` entry with two DIA ids lands on two slugs, and every
  other adapter behaves as before.
- An opt in live spec, `LUNA_LIVE_SOURCE_TEST=1`, asserts field names only, as
  `lidl/src/lib/live-source.spec.ts` does.

## 12. What this plan does not do

- No Club Dia price in any scope a shopper reads. If the owner wants member prices later, they are
  already in `extra.loyalty`.
- No product pages, so no ingredients or nutrition.
- No leaflets. DIA's leaflets are per shop PDFs with dated validity (`/tiendas/folleto-pdf/<id>`),
  about fifteen variants among 25 shops sampled, and they belong to the leaflet import path of
  plan `0081`.
- No price for a physical shop of its own. A shop quotes its fulfilment store, or the national
  price where there is no online service.
- No cache of the shop file across postal code runs (section 5.3).
- No change to the Mercadona table or any other chain's category mapping.

## 13. Exit criteria

- Everything in the brief's target state holds.
- The rehearsal reports are in the PR, with the per scope postal code confirmation of section 6.2
  and the national store of section 3.2.
- The PR states D1 and D2 in its description, so the owner approves them where the change is.
