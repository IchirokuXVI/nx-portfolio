> **PR:** [#239](https://github.com/IchirokuXVI/nx-portfolio/pull/239)

# 0089 A catalog that arrives a week at a time

LIDL Spain publishes its in-store assortment through a JSON search endpoint, one product page per
article, and a store service that names every shop in the country. All three answer without a key,
an account or a cookie. This is the third chain the harvester fetches from, after Mercadona
(plan `0038`) and DEZA (plan `0085`), and the first that gives a price, an EAN and a validity window
in the same read.

It is also the first whose assortment is **not a catalog**. The site publishes what is on offer this
week and next, not what a shop stocks. A single run reaches 153 supermarket products. The chain sells
several times that. **The catalog is built by running every week**, and section 2 is why every other
decision in this plan follows from that one fact.

Depends on `0086` for the one source product table, because a LIDL run writes prices and needs the
walk to write them. Depends on `0083`, so that a third chain arrives without a third environment
variable. Depends on `0080`, because a LIDL price is one source among several and must not overwrite
what another source said. Depends on `0079`, because LIDL prints Spanish only.

The research that produced every number below is committed at `tools/research/lidl/`, with the
probes that measured each one.

## 1. What the site gives, and what it does not

Measured on 2026-09-06 against the live site, by `tools/research/lidl/dry-run.mjs`. The complete run
took 161 seconds and 216 requests and raised no warning.

| Fact                           | Value                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- |
| Products flagged in store      | 493                                                                         |
| Of those, supermarket products | 153 (`Food` and `F+V`), of which 132 carry a price                          |
| The other 340                  | 285 online shop articles a shop also stocks, 43 middle aisle, 12 plants     |
| EAN                            | Yes. 83% carry a real EAN-13, 15% an eight digit internal code, 5% nothing  |
| Price                          | Yes, with the previous price beside it when the article is discounted       |
| Validity window                | Yes, `startDate` and `endDate`, on every priced observation                 |
| Size                           | A printed string such as `500 g`, `6x200ml`, `Aprox. 950g`. 144 of 208 rows |
| Price regions                  | 59, named after Spanish provinces                                           |
| Products priced by region      | 38 of 187, so about one in five                                             |
| Stores                         | 730, with coordinates, address, postcode and opening hours                  |
| Per store stock                | Published and always empty. See section 1.2.                                |
| Category                       | A four level tree LIDL calls its need worlds, plus a coarse `Food` flag     |
| `robots.txt`                   | Disallows search result URLs and any URL carrying `offset` or `sort`        |

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
A LIDL price applies to a region, and the region is what the run states.

## 2. The assortment is a rolling window, and that is the whole shape

This is the finding the design rests on, so it carries its own evidence.

Of 228 price observations, 166 expired on the Sunday of the week they were read and 56 expired the
Sunday after. Three ran to the end of the year and one to March. Nothing else was published. The
window is one to two weeks wide and it moves.

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
- **The run is scheduled weekly, not daily.** Reading the same window twice in a week costs 216
  requests and confirms prices that have not moved. Once a week, early in the week, catches the new
  window. Section 9 states the trigger.

**Next week is already published.** 30 of the 493 in-store rows carry an `IN_STORE_FROM_DATE_FUTURE`
badge and 39 more carry `ALSO_IN_STORE_FROM_DATE_FUTURE`. A run therefore reads prices that have not
started yet. They arrive with a `startDate` in the future and are written with it, so the price model
from plan `0080` decides on read whether the price applies, and nothing here has to hold them back.

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

## 4. A price belongs to a region, and a store names its region

This is the part the existing model already fits, exactly.

Each product carries `regionsV2`, a map of region id to `{ regionName, regionPriceId }`, and
`regionsPrices`, a map of price id to the price. Each store carries
`marketingData.offerRegion` and `offerRegionName`. **The two id spaces are the same one.**
`tools/research/lidl/probe-regions.mjs` proved it: 54 of the 59 region ids on a product matched a
region named by a store, covering 690 of the 730 shops.

`PriceScope` was built for this. Its own docstring calls it "the set of stores a chain charges the
same in", and every `SupermarketLocation` already carries a required `priceScopeId`. So:

- **One price scope per LIDL region.** `externalKey` is the region id as a string, `label` is the
  region name, which is a province. 59 scopes for one chain, created on first sight by the run.
- **A store's `priceScopeId` is its region's scope.** That is written by store discovery, section 9,
  and it is the whole reason store discovery has to run before a price is useful.
- **A product is ingested once per distinct price.** A product with one price across 54 regions is
  one ingest against the scopes that share that price. A product with two prices is two.
  `SourceIngest` takes one `priceScopeId` per call, so the runner groups its observations by price id
  and calls it once per group.

**`PriceScopeKind` gains `REGION`.** `NATIONAL`, `WAREHOUSE`, `POSTAL_CODE` and `STORE` are the four
that exist, and a Spanish province is none of them. Calling it `WAREHOUSE` borrows Mercadona's word
for a different thing and makes the admin list lie. The ripple is named in section 11.

**A region with no price is not a price of zero.** The five Canary region ids carry no current price
for most products. Those observations are dropped, not written as null and not written as the
mainland figure. A shopper in Las Palmas is shown nothing rather than a price that does not exist
there.

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
| `eans`      | `4335619207615` | the EAN-13, when it is one. 83% of products                     |
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
   whose category is `Food` or `F+V`.
2. `DETAIL`. One product page per kept row, for `eans` and `regionsV2`. 153 requests. A page that
   fails is a warning naming the `externalId`, not a failed run.
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
  withEan13:         126,
  regionsSeen:       59,
  scopesWritten:     59,
  observations:      228,
  regionallyPriced:  38                 products whose price is not the same everywhere
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
shops, official names, street, postcode, province, coordinates, opening hours, and the price region.
So `STORE_DISCOVERY` gains a dispatcher of the same shape `CatalogDiscoveryRunner` already has, and
`OsmStoreDiscoveryRunner` becomes the `osm-places` case rather than the only case.

The LIDL case takes no postal code and no radius. It reads every store in three requests and:

- creates one `PriceScope` per distinct `offerRegion`, keyed on the region id,
- writes one `DiscoveredPlace` per shop, with the region on it.

**It still creates nothing in catalog.** The rule from plan `0038` section 6.1 holds: import is a
second, explicit step by an admin. A source naming its own shops does not change who decides that a
shop of theirs becomes a shop of ours, which is what plan `0084` settled.

**Store discovery runs before the first catalog run.** A price scope has to exist before a price can
point at it. A catalog run that meets a region with no scope creates the scope and warns, so the
order is a recommendation rather than a hard gate, but a run in the wrong order produces scopes with
no stores attached.

## 10. Politeness, and the key

**One request per second, four workers, and both are the row's defaults.** `supermarket_sources`
already carries `workers` and `maxRequestsPerSecond`, and plan `0083` made the per chain switch a
row. Nothing new is configured.

`https://www.lidl.es/robots.txt` disallows search result URLs and any URL carrying `offset`, `sort`,
`idsOnly` or `productsOnly`. The walk in section 8 is that kind of URL. The rate limit is therefore
treated as a real constraint and not a formality: a full run is 216 requests spread over about three
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
- **`PriceScopeKind.REGION` ripples.** The value is added in
  `libs/luna-shopper/contracts/src/lib/enums/catalog.enums.ts`, which needs the catalog migration that
  alters the Postgres enum, the regenerated `openapi.json`, the regenerated
  `wire-types.ts`, and the admin price scope form. That is the largest single piece of work outside
  the adapter itself and it is named here so that it is not discovered halfway.

## 12. Testing

- **`normalize.spec.ts`**, against fixtures. One search page, one product page with a single price,
  one with two regional prices, one with none, one with a short code instead of an EAN, one store
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
- **A runner integration spec** against a slot, in the `test-integration` target, asserting that one
  product with two regional prices produces two ingest calls against two scopes.

## 13. Exit criteria

- `libs/luna-shopper/lidl` exists, is framework free, and its tests pass with no network.
- `ADAPTER_KEYS` holds `lidl-api`, and `openapi.json` and `wire-types.ts` are regenerated and
  committed.
- `PriceScopeKind.REGION` exists, with its catalog migration, and the admin form offers it.
- `CatalogDiscoveryRunner` dispatches to `LidlCatalogRunner`, and `StoreDiscoveryRunner` dispatches
  to an OSM case and a LIDL case.
- A store discovery run against the compose stack creates 59 price scopes and 730 discovered places.
- A catalog run against the compose stack ingests the week's supermarket products, writes a price per
  region group, writes no availability, and produces the report in section 8.1.
- The run refuses a request that names a `priceScopeId`.
- `supermarket_sources` holds a disabled `lidl-api` row for LIDL, and the run refuses to start until
  an admin enables it, by plan `0083`.
