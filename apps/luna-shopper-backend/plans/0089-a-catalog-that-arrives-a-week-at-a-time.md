> **PR:** [#239](https://github.com/IchirokuXVI/nx-portfolio/pull/239)

# 0089 A catalog that arrives a week at a time

LIDL Spain publishes its in-store assortment through a JSON search endpoint, one product page per
article, and a store service that names every shop in the country. All three answer without a key,
an account or a cookie. This is the third chain the harvester fetches from, after Mercadona
(plan `0038`) and DEZA (plan `0085`), and the first that gives a price, an EAN and a validity window
in the same read.

It is also the first whose assortment is **not a catalog**. The site publishes what is on offer this
week, not what a shop stocks. A single run reaches 153 supermarket products. The chain sells several
times that. **The catalog is built by running every week**, and section 2 is why every other decision
in this plan follows from that one fact.

Depends on `0086` for the one source product table, because a LIDL run writes prices and needs the
walk to write them. Depends on `0083`, so that a third chain arrives without a third environment
variable. Depends on `0080`, because a LIDL price is one source among several and must not overwrite
what another source said. Depends on `0079`, because LIDL prints Spanish only.

The research that produced every number below is committed at `tools/research/lidl/`, with the
probes that measured each one.

## 1. What the site gives, and what it does not

Measured on 2026-09-06 against the live site, by `tools/research/lidl/dry-run.mjs`. The complete run
took 152 seconds and 161 requests and raised no warning.

| Fact                           | Value                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| Products flagged in store      | 493                                                                      |
| Of those, supermarket products | 153 (`Food` and `F+V`), of which 132 carry a price                       |
| The other 340                  | 285 online shop articles a shop also stocks, 43 middle aisle, 12 plants  |
| EAN                            | Yes. 107 of the 132 priced products, so 81%. Section 7 for the other 19% |
| Price                          | Yes, with the previous price beside it when the article is discounted    |
| Validity window                | Yes, `startDate` and `endDate`, on all 132                               |
| Size                           | A printed string such as `500 g`, `6x200ml`, `Aprox. 950g`. All 132      |
| Price zones                    | 3: mainland, Balearics, Canaries. Decided by the postal code. Section 4  |
| Products priced by zone        | None. No grocery product carried two different real prices. Section 4.1  |
| Stores                         | 730, with coordinates, address, postcode and opening hours               |
| Per store stock                | Published and always empty. See section 1.2.                             |
| Category                       | A four level tree LIDL calls its need worlds, plus a coarse `Food` flag  |
| `robots.txt`                   | Disallows search result URLs and any URL carrying `offset` or `sort`     |

**The identity is stable and the price is not.** A product keeps its numeric id, its EAN and its URL
across runs. Its price expires, usually the coming Sunday. That is the opposite of DEZA, where the
identity had to be reconstructed from a description and no price existed at all.

### 1.1 The three services

| Service                                                                   | Answers                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `https://www.lidl.es/q/api/search`                                        | the product index as JSON, filtered to in store by `store=1` |
| `https://www.lidl.es/p/<slug>/p<id>`                                      | one product, with `eans` and the price of each region        |
| `https://live.api.schwarz/odj/stores-api/v2/myapi/stores-frontend/stores` | every store, with its price region                           |

### 1.2 Per store stock is published and always empty

`https://www.lidl.es/p/api/storestock/ES/es/<productId>?storeids=<ids>` answers 200 with one row per
store. Every row read during the research carried `storeAvailabilityIndicator: "UNKNOWN"`, for food
and for non food alike, across stores in five provinces.

**So this plan writes no per store availability.** `catalog.setLocationAvailability` exists and plan
`0084` built it, but calling it with a value the source does not know is worse than not calling it.
A LIDL price applies to a zone, and the zone is what the run states.

## 2. The assortment is a rolling window, and that is the whole shape

This is the finding the design rests on, so it carries its own evidence.

**The grocery window is exactly one week wide.** Of the 132 priced grocery products, **131 expired on
the same Sunday**, the one that ended the week they were read. One ran to March. Nothing else was
published. The wider in-store set, which carries the middle aisle this plan excludes, stretches a
week or two further, and grocery does not.

**The window is all there is, and that was tested rather than assumed.**
`tools/research/lidl/probe-coverage.mjs` searched 105 grocery terms, covering the aisles, the staples
and every LIDL own brand, and found **zero** products that the unfiltered query had not already
returned. There is no fuller listing behind a keyword, a category or a facet.

Three consequences, and none of them is optional:

- **A run is a snapshot, not a census.** The report says how many products this week held. It never
  claims a total for the chain, because the site does not publish one. This is the same honesty rule
  section 2 of plan `0085` applied to DEZA, arrived at from the opposite direction.
- **The catalog accumulates across runs.** A product that leaves the window keeps its
  `source_catalog_entries` row and its last known price. It stops being confirmed, and plan `0080`
  already decides what a shopper sees when a price goes stale. Nothing here deletes a product for
  being absent from one week.
- **The run is scheduled weekly, and the day matters.** Reading the same window twice in a week costs
  161 requests and confirms prices that have not moved. Because the grocery window ends on a Sunday,
  **a run scheduled for a Monday reads a full week and a run scheduled for a Sunday reads a window
  about to expire.** Monday is the trigger.

**A few prices start in the future, and they are written as they arrive.** Only 4 of the 153 grocery
rows are dated forward, so this is a detail rather than a second week of coverage. They carry a
`startDate` in the future and are written with it, so the price model from plan `0080` decides on
read whether the price applies yet. Nothing here holds them back and nothing here treats them as
current.

## 3. The parameters, because none of them are guessable

The endpoint is undocumented and its errors name only one missing thing at a time. Four rules, each
of which cost a round of probing:

- **`Accept: application/json` is refused with 406.** The header must be `*/*`, which is what a
  browser sends. `LidlClient` sets it and a test asserts it.
- **The query needs `assortment=ES&locale=es_ES&version=2.0.0`.** `assortment` is the country code.
  The locale is underscored, and `es`, `es-ES` and `ES` are each rejected by name. A missing `version`
  gives a bare 400 that names nothing.
- **An empty `q` returns the whole index.** With `store=1` it returns the in-store assortment. This is
  the walk. There is no browse endpoint and no category listing.
- **`fetchsize` and `offset` page it**, and the response reports `maxfetchsize: 1000`. The walk uses
  100 to keep a failed page cheap to retry.

**The product page carries fields the list does not.** `eans` and `regionsV2` exist only there. So a
run pays one request per supermarket product, which is 153 requests, and that is the larger half of
its cost. It is worth paying: the EAN is what lets plan `0086` resolve a product without an admin.

## 4. A price belongs to a zone, and a postal code decides the zone

Each product carries `regionsV2`, a map of 59 region ids to `{ regionName, regionPriceId }`, and
`regionsPrices`, a map of price id to the price. Each store carries `marketingData.offerRegion` and
`marketingData.zone`. **The region is not what sets the price. The zone is**, and that turns a 59
scope design into a 3 scope one.

### 4.1 The measurement, because the obvious model is wrong twice

The obvious model is one price scope per region, resolved from a store's postal code. Both halves of
that fail, and they fail for different reasons.

**A postal code does not decide the region.** The first two digits of a Spanish postal code are the
province, 01 through 52, so province looked like the natural key. It is not:
`tools/research/lidl/probe-postal-to-region.mjs` found **12 of the 52 provinces hold stores in more
than one region**, covering 273 of the 730 shops. Madrid (28) splits across region 28 `Madrid` and
region 56 `Vit 2`. Las Palmas (35) splits three ways, into Gran Canaria, Fuerteventura and Lanzarote.
Region names such as `Cat 2` and `Vit 2` are not provinces at all. It fails in the other direction
too: region 39 `Murcia` holds stores in provinces 03, 04 and 30.

**But a region is not what a shopper pays.** `tools/research/lidl/probe-province-price-conflict.mjs`
read the product page of **all 153 grocery products** in the window and compared every region inside
every province. **No province ever disagreed with itself, on any product.** The regions inside a
province always carried the same price, so the 12 splits are a logistics detail with no effect on a
price.

**What does vary is whether a price exists at all.** All 132 priced products carried more than one
price entry, and the report records the shape of every one of them. There is exactly one shape:

```
priceSplitShapes: [{ "shape": "none:2 + price:50", "count": 132 }]
```

Fifty provinces get the price and the two Canary ones get nothing, 132 times out of 132. **Not one
grocery product carried two different real prices anywhere in Spain.** The only products that did
were `NonFood`, the middle aisle bazar this plan excludes, and even those split by zone: a `Livarno`
lamp is 3.79 on the mainland, 4.29 in the Balearics and 3.99 in the Canaries.

**And a postal code decides the zone perfectly.** Across all 730 stores, no province reaches more
than one zone:

| Zone  | Provinces    | Stores | Grocery price          |
| ----- | ------------ | ------ | ---------------------- |
| `PEN` | the other 49 | 659    | published              |
| `BAL` | `07`         | 31     | published, same as PEN |
| `CAN` | `35`, `38`   | 40     | not published          |

**No region straddles a zone either**, which is what makes the fold from 59 region ids down to 3
zones safe. The dry run checks it on every run and reports `regionsCrossingZones`, which was 0.

### 4.2 What that buys

- **Three price scopes for the chain, not 59.** `externalKey` is `PEN`, `BAL` or `CAN`, and `label`
  is the zone name LIDL prints.
- **The scope is a pure function of the postal code the location already has.** `07` is `BAL`, `35`
  and `38` are `CAN`, everything else is `PEN`. That is `zoneForPostalCode` in the adapter library,
  a closed rule over three cases with no dataset behind it. `@portfolio/luna-shopper/postal-codes`
  is not needed and is not used here.
- **Store discovery no longer has to run first.** The three scopes are static, so a catalog run
  creates them and a location resolves to one the moment it has a postcode. Section 9 loses the
  ordering constraint it used to carry.
- **A run still groups its observations by price**, not by zone, and writes each group to the scopes
  that share it. Today grocery produces one group covering `PEN` and `BAL`. Writing it that way
  rather than as a single national price is what keeps the model honest when it stops being true.

**`PriceScopeKind` gains `REGION`.** `NATIONAL`, `WAREHOUSE`, `POSTAL_CODE` and `STORE` are the four
that exist and a zone is none of them. `NATIONAL` is the tempting one and it is wrong: a national
price would reach the 40 Canary stores, where LIDL publishes no price at all, and show a shopper in
Las Palmas a figure that does not exist there. Section 11 names the ripple.

**A zone with no price is not a price of zero.** `CAN` observations are dropped. They are not written
as null and not written as the mainland figure.

**This is one week's measurement and the guard says so.** 153 products in one window is enough to
choose the model and not enough to promise it forever. So the runner never assumes the mainland
agrees with itself: it groups by the price the source gave, and **if a group ever splits a zone, it
raises a `ZONE_PRICE_SPLIT` warning naming the product** rather than picking one price. That is how
the day LIDL starts pricing by region arrives as a warning instead of as silently wrong data.

## 5. Which products are supermarket products

The `store=1` filter answers "a shop stocks this", which is not the same question. 285 of the 493
rows are online shop articles that a shop also carries.

The clean predicate is two fields on the product page, confirmed on a 40 product sample:
`storeFacts.retail === true` and `storeFacts.online === false`. Every in-store row satisfied the
first. The second is what removes the online shop.

The site then splits them with a coarse category:

| Category       | Count | What it holds                            | In scope |
| -------------- | ----- | ---------------------------------------- | -------- |
| `Food`         | 144   | food, drink and the drugstore aisle      | yes      |
| `F+V`          | 9     | fruit and vegetables                     | yes      |
| `P+F`          | 12    | plants and cut flowers                   | no       |
| `NonFood`      | 43    | the middle aisle: tools, lamps, textiles | no       |
| `Categorías/…` | 285   | the online shop                          | no       |

**`Food` and `F+V` are the run. The rest is not.** That is 153 products, 132 of them priced.
`NonFood` is excluded because it is the weekly bazar, and a cordless drill is not a shopping list
line. `P+F` is excluded for the same reason.

**LIDL's own tagging is noisy and the run does not correct it.** Eight of the 153 carry a need world
of `Vivir y amueblar` and one carries `Deporte y ocio`. The category mapping to `ItemCategory` reads
the need world path where it is usable and falls back to `UNKNOWN`, which is what the admin queue is
for. A run does not guess a category from a product name.

## 6. `@portfolio/luna-shopper/lidl`

A new library at `libs/luna-shopper/lidl`, framework free by the same hard constraint as
`mercadona`, `deza` and `osm-places`: no TypeORM, no Nest, no database, global `fetch` only, and
every test against checked in fixtures with no network.

| File                          | Holds                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `src/index.ts`                | the public surface                                                                        |
| `src/lib/lidl.client.ts`      | `LidlClient`: HTTP, the politeness gate, retry, `walkInStore`, `getProduct`, `listStores` |
| `src/lib/normalize.ts`        | raw JSON in, plain records out. Pure, and where the tests live                            |
| `src/lib/categories.ts`       | the need world path mapped onto `ItemCategory`                                            |
| `src/lib/zones.ts`            | `zoneForPostalCode`, and the fold from 59 region ids to 3 zones. Section 4                |
| `src/lib/size.ts`             | the printed size string split into a number and a `UnitOfMeasure`                         |
| `src/lib/json.ts`             | defensive readers over third party JSON. Not exported                                     |
| `src/lib/types.ts`            | `LidlProduct`, `LidlRegionPrice`, `LidlStore`, `LidlClientOptions`                        |
| `src/lib/__fixtures__/`       | captured responses, plus the `README.md` table naming the case each pins                  |
| `src/lib/live-source.spec.ts` | the opt-in live test, gated on `LUNA_LIVE_SOURCE_TEST=1`                                  |
| `tools/capture-fixtures.ts`   | the refresh script, behind a `capture-fixtures` target, never run by CI                   |

Path alias `@portfolio/luna-shopper/lidl` in `tsconfig.base.json`. Targets `test`, `lint`,
`capture-fixtures`, matching the other three.

**The size parser is its own file because the strings are irregular.** `500 g`, `6x200ml`,
`Aprox. 950g` and `Paquete` all appear. `Paquete` is a word, not a size, and parses to null rather
than to one. A multipack such as `6x200ml` carries both a count and a unit size, and the plan keeps
the printed string on the observation as `sizeFormat` so that nothing is lost when the parse gives up.

## 7. The identity of a product

Three identifiers arrive and they do different work.

| Field       | Example         | Use                                                             |
| ----------- | --------------- | --------------------------------------------------------------- |
| `productId` | `11000491`      | the `externalId` on the source entry. Stable, and in the URL    |
| `eans`      | `4335619207615` | the EAN-13, when it is one. 107 of the 132 priced products      |
| `ians`      | `108391`        | LIDL's internal article number. Never an EAN, never used as one |

**`externalId` is the `productId` and nothing else.** It is stable across weeks and it is what the
product URL is built from.

**An eight digit `eans` value is not an EAN and is never written as one.** 15% of products carry a
short code such as `20603373`, which is LIDL's own code for a weight item. The rule is a length
check: 13 digits is an EAN, anything else is not, and the short code is kept in `extra` for an admin
to look at. Writing it into the EAN column collides with a real EAN-8 from another chain.

A product without a usable EAN goes down the path plan `0086` already built. Nothing here invents a
match, and no automated match binds a printed name to a product.

## 8. The run

`CATALOG_DISCOVERY` with `adapterKey: 'lidl-api'`. `CatalogDiscoveryRunner` gains a third case and
holds no fetching of its own, exactly as plan `0085` left it.

`LidlCatalogRunner` in `apps/luna-shopper-backend/harvest/lidl-catalog.runner.ts`, implementing
`CatalogRunner`. Four stages:

1. `LIST`. Walk `/q/api/search` with `q=`, `store=1`, `fetchsize=100`. Five requests. Keep the rows
   whose category is `Food` or `F+V`. 153 of 493.
2. `DETAIL`. One product page per kept row, for `eans` and `regionsV2`. 153 requests. A page that
   fails is a warning naming the `externalId`, not a failed run. The regions are folded to zones
   here, by section 4.
3. `INGEST`. Group the observations by price id and call `SourceIngest.ingest` once per group, with
   the price scope that group's regions resolve to. `sourceKind` is `OFFICIAL_API`.
4. `REPORT`. `context.setReport` with the counts in section 8.1.

**The run requires a price scope the way the Mercadona walk does.** `harvest-run.service.ts`
`validate()` has the rule for `mercadona-api` at line 433. LIDL needs the opposite rule: the run
resolves its own scopes from the regions it reads, so a `priceScopeId` on the request is refused
rather than required. Passing one silently writes every region's price into a single scope.

### 8.1 What the report says

```
{
  window:            { from, to },      the earliest and latest validity seen
  listed:            493,               in-store rows the index returned
  grocery:           153,               rows kept by section 5
  detailRead:        153,
  detailFailed:      0,
  priced:            132,
  unpriced:          21,                in the window, but with no price published
  withEan13:         107,
  observations:      132,               one per product, because one price is all there is
  zonesWritten:      ['PEN', 'BAL'],    CAN carried no grocery price at all
  productZonePairs:  264,               132 products against the 2 zones that have a price
  zoneSplits:        0                  products priced differently in two zones
}
```

**`unpriced` is a real count and not an error.** 21 products appear in the window with no price at
all: bananas, some beers. They are ingested as products without a price, which plan `0080` already
allows, so that the catalog knows the article exists.

**No number in the report claims a total for the chain.** Section 2.

## 9. Store discovery dispatches on the adapter too

`StoreDiscoveryRunner` today constructs an `OsmPlacesClient` directly and takes
`{ postalCode, country, radiusMetres }`. That shape exists because Mercadona publishes no store list,
so plan `0038` had to ask OpenStreetMap for one and hand the results to an admin.

**LIDL publishes its own store list, and it is better than OSM in every field that matters**: 730
shops, official names, street, postcode, province, coordinates, opening hours, and the zone. So
`STORE_DISCOVERY` gains a dispatcher of the same shape `CatalogDiscoveryRunner` already has, and
`OsmStoreDiscoveryRunner` becomes the `osm-places` case rather than the only case.

The LIDL case takes no postal code and no radius. It reads every store in three requests and writes
one `DiscoveredPlace` per shop.

**It still creates nothing in catalog.** The rule from plan `0038` section 6.1 holds: import is a
second, explicit step by an admin. A source naming its own shops does not change who decides that a
shop of theirs becomes a shop of ours, which is what plan `0084` settled.

**Neither run has to go first.** That was true of the 59 scope design and section 4 removed it. A
zone is a function of the postal code, so a catalog run creates the three scopes on its own and a
location resolves to one as soon as it has a postcode.

**The store list carries `marketingData.zone` and the run reads it anyway, as a check.** The postal
code rule and the zone LIDL prints agreed on all 730 shops. A shop where they disagree is a warning
naming the shop, because one of the two is then wrong and neither is worth guessing between.

## 10. Politeness, and the key

**One request per second, four workers, and both are the row's defaults.** `supermarket_sources`
already carries `workers` and `maxRequestsPerSecond`, and plan `0083` made the per chain switch a
row. Nothing new is configured.

`https://www.lidl.es/robots.txt` disallows search result URLs and any URL carrying `offset`, `sort`,
`idsOnly` or `productsOnly`. The walk in section 8 is that kind of URL. The rate limit is therefore
treated as a real constraint and not a formality: a full run is 161 requests spread over about three
minutes, once a week, from one client with a named user agent. `live.api.schwarz` serves no
`robots.txt`.

**The store API needs a key and it is a public one.** `x-apikey` is a fixed string shipped inside the
public store search bundle, the same value every browser sends. It is configuration
(`LIDL_STORES_API_KEY`), not a secret, and a 401 is the signal that it rotated. **Do not scrape it out
of the bundle at run time.** That turns one brittle dependency into two, and the failure is silent
rather than a 401 with a name on it.

## 11. What this does not do

- **No per store availability.** Section 1.2. The source publishes `UNKNOWN` for everything.
- **No Lidl Plus prices.** The app publishes member prices behind an account. A price a shopper
  cannot pay without an account is a different thing from a shelf price, and mixing them makes a
  basket comparison wrong.
- **No leaflets.** That path exists and is a `FILE_IMPORT` run, plan `0081`. It is a separate source
  with a separate confidence, and plan `0080` already decides which price a shopper sees when two
  sources disagree.
- **No nutrition, ingredients or allergens.** The product page publishes none.
- **No claim of completeness.** Section 2.
- **No per zone availability either.** A zone with no price says nothing about whether a shop stocks
  the product. The Canaries are not published, which is not the same claim as not stocked.
- **`PriceScopeKind.REGION` ripples.** The value is added in
  `libs/luna-shopper/contracts/src/lib/enums/catalog.enums.ts`, which needs the catalog migration that
  alters the Postgres enum, the regenerated `openapi.json`, the regenerated
  `wire-types.ts`, and the admin price scope form. That is the largest single piece of work outside
  the adapter itself and it is named here so that it is not discovered halfway.

## 12. Testing

- **`normalize.spec.ts`**, against fixtures. One search page, one product page with a single price,
  one priced on the mainland but not in the Canaries, one with no price at all, one with a short
  code instead of an EAN, one carrying three different zone prices, one store
  page. Each fixture is a whole response, verbatim, never hand edited, with the
  `__fixtures__/README.md` table naming the case it pins.
- **`size.spec.ts`**. `500 g`, `6x200ml`, `Aprox. 950g`, `1 kg`, `33cl` and `Paquete`. The last one
  parses to null, and the test says so.
- **`categories.spec.ts`**. The need world paths seen in the sample, including the eight that are
  tagged wrongly by LIDL and fall back to `UNKNOWN`.
- **`lidl.client.spec.ts`**. The `Accept: */*` header, the query parameters, the paging arithmetic,
  and that a failed detail page becomes a warning rather than a failed run.
- **`live-source.spec.ts`**, gated on `LUNA_LIVE_SOURCE_TEST=1` and `describe.skip` otherwise.
  Asserts field names only, never values, so a price change does not turn CI red.
- **`zones.spec.ts`**. `07` is `BAL`, `35` and `38` are `CAN`, `28` and `52` are `PEN`, and the
  59 region ids fold onto the three zones. A postcode of the wrong length parses to null.
- **A runner integration spec** against a slot, in the `test-integration` target, asserting that a
  product priced on the mainland and unpriced in the Canaries writes to `PEN` and `BAL` and not to
  `CAN`, and that a product priced differently in two zones raises `ZONE_PRICE_SPLIT`.

## 13. Exit criteria

- `libs/luna-shopper/lidl` exists, is framework free, and its tests pass with no network.
- `ADAPTER_KEYS` holds `lidl-api`, and `openapi.json` and `wire-types.ts` are regenerated and
  committed.
- `PriceScopeKind.REGION` exists, with its catalog migration, and the admin form offers it.
- `CatalogDiscoveryRunner` dispatches to `LidlCatalogRunner`, and `StoreDiscoveryRunner` dispatches
  to an OSM case and a LIDL case.
- A store discovery run against the compose stack writes 730 discovered places, and the zone it
  derives from each postal code matches the zone LIDL prints on that shop.
- A catalog run against the compose stack ingests the week's supermarket products, creates the three
  zone scopes, writes a price per zone group, writes no availability, and produces the report in
  section 8.1.
- The run refuses a request that names a `priceScopeId`.
- `supermarket_sources` holds a disabled `lidl-api` row for LIDL, and the run refuses to start until
  an admin enables it, by plan `0083`.
