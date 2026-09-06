# 0089 A catalog behind a browser

Carrefour publishes its grocery assortment at `https://www.carrefour.es/supermercado`, with a
price on every product card. This plan says how to read it.

**The verdict is that it is viable, and that it costs a browser.** Carrefour does have an API.
The storefront ships its own service map, twenty five routes of it, and the product routes in
that map are not reachable from the internet. What is reachable is the rendered page, and the
page carries the whole listing as data. So this is a third `CATALOG_DISCOVERY` adapter in the
sense plan `0085` established, and it writes prices, which the DEZA adapter does not.

The part that is new, and the reason this plan is long, is the client. Carrefour sits behind
Cloudflare, and Cloudflare here refuses `fetch`. Not on a header, not on a rate: on the TLS
handshake. Every framework free client the harvester owns today is refused on the first request.
The adapter needs a real browser, which is the first time this backend needs one.

Depends on `0086` for the row a run writes, because a Carrefour product has an id, a name, a
brand and a price, and `source_catalog_entries` plus `source_entry_prices` is where those go.
Depends on `0083`, so that the chain arrives as a row rather than as a variable. Depends on
`0080`, because the price this writes is one source among several and must not be written onto
`supermarket_items`.

Plan `0038` section 4.3 already reserved this ground. It measured Node against the workload,
concluded the runtime is not the constraint, and named the exception: "where a different runtime
would genuinely earn its place is the CPU bound work backlog 0001 defers: leaflet OCR, and
browser driven adapters". This is that adapter. Section 11 says why it stays in Node anyway.

## 1. What was measured

Everything in this plan was measured against the live site on 2026-09-06, with the scripts in
[`libs/luna-shopper/carrefour/tools`](../../../libs/luna-shopper/carrefour/tools/README.md).
Those scripts are checked in so the numbers can be re-taken, not because they are library code.

| Fact | Value |
| --- | --- |
| Product cards per listing page | 24 |
| Page weight, images refused | About 250 KB |
| Fields on every card | 14, and 19 distinct names across a page |
| Price on a card | Yes, and a price per unit |
| EAN on a card | No. On the product page, yes |
| Product id on a card | Yes, two of them |
| Paging ceiling per category | 1008 |
| First level categories | 10, of which 5 fit under the ceiling |
| Categories in the crawl frontier | 84 |
| Product listings across the frontier | 17,135 |
| Page loads for a full run | 851, about 62 minutes |
| Categories the ceiling truncated | 0 |
| Sustained pace with no block | 30 loads in 131 s, 0 refused |
| Clients that can read the site | Chromium, and Windows `curl` |
| Clients that cannot | node `fetch`, node `http2`, Linux `curl` |

## 2. There is an API, and none of it is ours

Every page renders its own service map into `window.__INITIAL_STATE__.config.endpoints`. Each
entry names a `client` path the browser calls and usually a `server` path, which is a hostname
inside their cluster. That map is the fastest way to see the shape of the storefront, and
`probe-endpoints.ts` reads it and then calls every route in it.

Three answers come back, and they mean different things:

- **`503` with the body `Service Unavailable`.** The edge routes nothing there. The service is
  real and it is server side only. This is the answer for `plp-food-papi`, which is the product
  listing API the page itself is rendered from, for `categories-api`, which holds the category
  tree, and for `/api/unified_menu`.
- **`403` with an HTML body.** The Cloudflare block page. This is the answer for
  `search-api/query/v1/search`, which is the Empathy search platform and the one route that
  answers every question at once. It is closed.
- **A JSON body, including a JSON `404`.** The backend answered. `salepoints/v1` and
  `header/v1` are here.

So the three routes that carry a catalog are the three that are closed, and the routes
that are open carry stores and a shopping cart. **There is no product JSON API to use.** A
future maintainer who reads "Carrefour has an API" in this file must read this section before
trying to call one.

`salepoints/v1/stores-location/es` is open and answers, and it is not a store list: it returns
one store, the nearest to the caller, whatever query parameters it is given. It is not a route
to store discovery. Store discovery for this chain is `osm-places` and plan `0084`, as for
every other chain.

## 3. The client is the whole problem

This is the finding that shapes the adapter, and it is easy to mistake for a rate limit, so it
was measured against that. Six clients, one distinct category URL each, interleaved rather than
grouped, ten seconds apart, identical `User-Agent`. `compare-clients.ts` runs it.

| Client | TLS stack | Result |
| --- | --- | --- |
| `curl` on Windows | Schannel | **200**, three times out of three |
| `curl` on Linux, in Docker | OpenSSL | 403 |
| node `https` | OpenSSL | 403, three times out of three |
| node `https`, Chrome cipher list and curves | OpenSSL | 403 |
| node `http2` | OpenSSL | 403 |
| headless Chromium | BoringSSL | **200** |

**A rate limit cannot produce that table.** The rows are interleaved, so a limit that had built
up refuses the `curl` rows as well. It refused none of them.

What separates the passing rows from the failing ones is the TLS handshake. Cloudflare
fingerprints the client hello, and OpenSSL does not emit what a browser emits. Setting node's
cipher list and curve list to Chrome's changes nothing, because the fingerprint also covers
extension order and the GREASE values, and node has no API for either.

**Windows `curl` passing is a local accident and not a route to production.** Schannel is the
operating system TLS stack, the one a browser on that machine uses, so it produces a browser
shaped handshake for free. The cluster runs Linux, where `curl` is built on OpenSSL, and the
Docker row above is exactly that case. It is refused.

That leaves a browser. `@portfolio/luna-shopper/mercadona` and `@portfolio/luna-shopper/deza`
are framework free by hard constraint, and this library cannot be: it depends on Playwright.
Section 10 says what that changes and what it does not.

## 4. The Cloudflare cookies have to be thrown away

A browser is necessary and not sufficient. A browser that behaves like a browser is blocked
after one page.

Exactly the first navigation of a fresh context succeeds. Every navigation after it answers 403
with the title "Attention Required! | Cloudflare", which is the hard block page and not an
interstitial: waiting forty five seconds for it to resolve itself times out. The behaviour does
not change with `headless: false`, with `--disable-blink-features=AutomationControlled`, or with
the real Chrome channel instead of bundled Chromium, so it is not headless detection.

The one thing that changes between the first navigation and the second is the cookie jar. Five
listing pages, seven seconds apart, one variant per row:

| Cookie handling | Five loads |
| --- | --- |
| Keep everything, an ordinary session | `200 403 403 403 403` |
| Clear every cookie before each load | `200 200 200 200 200` |
| Clear only `__cf*` and `cf_*` | `200 200 200 200 200` |
| A fresh context for each load | `200 200 200 200 200` |

The first response sets `__cf_bm` and `cf_clearance`. **Presenting them again is what draws the
block.** Dropping them before every navigation is the whole fix.

**Drop the two Cloudflare cookies and keep the rest.** Clearing the jar works equally well
today and throws away `salepoint`, which is the cookie that decides which shop's assortment and
prices the listing shows. Section 9 needs that cookie.

This is worth stating plainly because it inverts the usual advice, and a later reader who
"fixes" the client by keeping its session will break it in a way that looks like a rate limit.

## 5. The pace the site tolerates

With the cookies dropped, 30 consecutive listing pages at a 2000 ms delay produced **30
successes and no refusals**, in 131 seconds. A load costs about 2.3 seconds of that, so the
achieved rate is 0.23 pages per second, or about 5.5 product cards per second.

Two operational notes for whoever tunes this:

- **The block escalates and it is not instant to clear.** During the investigation, a burst of
  a few dozen unpaced requests put the address into a state where only the first load of each
  fresh browser session succeeded. That state is what section 4 diagnoses, and once the cookie
  handling was right it did not recur. Do not tune the delay downward by trial against the live
  site.
- **Refusing images matters for bytes and not for the block.** A listing page is about 250 KB
  with images refused and several megabytes with them. Both were measured and neither changes
  whether the page is served.

## 6. What one product card carries

Measured over a full page of "La Despensa". Fourteen names appear on every card and
nineteen appear across the page.

| Field | On | Notes |
| --- | --- | --- |
| `product_id` | 24/24 | The chain's id, for example `VC4AECOMM-539367`. This is `externalId`. |
| `sku_id` | 24/24 | A second id, numeric. Not an EAN. |
| `name` | 24/24 | Spanish, and it already carries the size: "pack de 9 unidades de 1 l." |
| `brand` | 24/24 | Present on every card, `CARREFOUR` for the private label. |
| `price` | 24/24 | Display text, `"7,65 €"`. Comma decimal, dot thousands. |
| `price_per_unit` | 24/24 | Display text. The comparison price. |
| `measure_unit` | 24/24 | `l`, `kg`, `ud` and so on. The unit `price_per_unit` is per. |
| `sell_pack_unit` | 24/24 | How many the shopper buys at once. |
| `app_price`, `app_price_per_unit` | 24/24 | The app's own price. Equal to `price` in the sample. |
| `images` | 24/24 | `desktop` and `mobile` URLs. |
| `url` | 24/24 | The product page path. |
| `catalog`, `document_type` | 24/24 | Both `food` throughout the grocery storefront. |
| `units_in_stock` | 21/24 | Availability, per the sale point the page was rendered for. |
| `badge`, `badge_map` | 7/24 | Promotion markers. |
| `info_tags` | 6/24 | Diet and origin labels. |
| `restrictions` | 3/24 | Purchase limits, with a display name and a quantity. |
| **`ean`** | **0/24** | **Absent.** Section 14. |

Three of these are worth a decision rather than a shrug:

- **`product_id` has no single shape.** One sample of 192 products held three:
  `VC4AECOMM-651364`, `600805795` and `prod301649`. It is still the right `externalId`,
  because it is what the product URL is built from and it was unique across the sample with
  no duplicates. Do not parse it, do not assume it is numeric, and do not derive anything from
  its prefix.

- **`name` contains the size and the pack count**, which the catalog's own merge rules
  say must not be in a product name. So the size has to be parsed out of the name, the
  way plan `0085` section 7 does for DEZA, and `measure_unit` plus `sell_pack_unit` are
  the two fields that make that parse checkable rather than a guess.
- **`app_price` was equal to `price` on every card in the sample.** Do not assume that
  holds. `sample-products.ts` reports both, and if they ever diverge the till price is
  `price`, because that is the one the storefront shows a web shopper.

A second sample, 192 products over eight pages of `Congelados`, says how clean the data is:

| | |
| --- | --- |
| Unique products | 192 |
| Duplicate ids within the category | 0 |
| Products with no readable price | 0 |
| Products with no price per unit | 8 |
| Products with no brand | 4 |
| Distinct brands | 41 |
| Distinct measure units | `kg`, `l`, `ud` |

So a price is close to universal on this source, and the no price case of section 12 is real
but rare. The eight without a price per unit are the ones to watch, because that field is the
comparison the shopper actually wants.

## 7. Paging stops at 1008, so a run pages the frontier

A listing page reports two different totals and the difference is the whole enumeration
problem. `productCardList.results.total_results` is what the result set holds.
`pagination.total_pages` times `pagination.page_size` is what paging will actually serve, and
it stops at 42 pages of 24, which is **1008**.

"La Despensa" holds 6341 products and hands over 1008 of them. No page size parameter moves it.

So a category over the ceiling has to be read through its children. The category tree is not
published in a form a client can read, because `categories-api` is one of the closed routes, so
it is discovered by walking: every listing page names its own children under
`horizontalNavigation.secondLevelCategories`. `walk-categories.ts` does that walk.

### 7.1 The obvious rule is wrong, and it loses most of the catalog

The obvious reading of a paging ceiling is "crawl the leaves". Measured over the whole tree,
633 nodes, on 2026-09-06:

| Strategy | Categories paged | Products found |
| --- | --- | --- |
| Every childless leaf | 106 | 2,780 |
| Shallowest node under the ceiling | 84 | **17,135** |

**The deep levels of this tree are curated views, not an exhaustive breakdown.** "Vinos Tintos"
holds 257 products and its six children hold 90 between them. "Pienso para gatos" holds 250 and
its three children hold 79. Seven branching nodes lose more than 40 percent of themselves this
way. A run that descends to the bottom throws away six products in seven.

At the top of the tree the children do cover the parent, and that is what makes the ceiling
workable at all: the ten first level categories are covered by their children to within a few
percent, and 413 of the 526 branching nodes reach 95 percent of their parent. Coverage is a
property of the first three levels, not of the tree.

### 7.2 The rule

**Descend only while a node reports more than the ceiling. Page the node you land on whole.**
The set that results is the frontier, and it is what a run enumerates.

Measured with `walk-categories.ts --prune`, which walks exactly that way:

| | |
| --- | --- |
| Page loads to find the frontier | 95 |
| Frontier categories | 84 |
| Products in the frontier | 17,135 |
| Listing pages to read them | 756 |
| Total page loads for a full run | 851 |
| Wall clock at the measured pace | About 62 minutes |
| Frontier nodes over the ceiling with no children | 0 |

Five of the ten first level categories already fit under the ceiling and are paged without
descending at all: Congelados, Bebé, Mascotas, Parafarmacia and the Ofertas view. Only five
need opening. The frontier sits at depth 1 for five of them, depth 2 for 49 and depth 3 for 30,
so the walk never goes deeper than three levels.

**Nothing was capped in the measured run**, so no product was knowingly missed. That is a
measurement and not a guarantee. A node over the ceiling with no children is the case the run
cannot enumerate, and if one ever appears the run records it in `harvest_runs.report`, the way
plan `0085` section 3 does for DEZA. Do not add a number that claims completeness the source
does not support.

Two node kinds are skipped:

- `catmasterlist`, "Mis productos", which is a signed in shopper's own history and is empty for
  an anonymous client.
- Promotion views, whose URL carries an `F-` token instead of a `cat` id. They re-list products
  a real category already holds, so walking them counts products twice.

**17,135 is a count of category memberships, not of distinct products.** A product listed in two
frontier categories is counted twice here, and the run deduplicates on `product_id` as it goes.
The distinct total is not known until a run has finished, and this plan does not guess at it.

## 8. Scope is `/supermercado`, and that is the whole filter

The requirement is groceries and not electronics. **No exclusion list is needed to get that.**
`carrefour.es/supermercado` is the grocery storefront and it has its own category tree, ten
first level nodes: Frescos, La Despensa, Bebidas, Congelados, Cuidado personal e Higiene,
Droguería y Limpieza, Bebé, Mascotas, Parafarmacia, and an Ofertas view. Electronics, clothing,
toys and the marketplace live under other sections of the site, and the walk in section 7 never
reaches them, because it only follows children of nodes it already holds.

Parafarmacia is inside the grocery storefront and stays. It is what a Spanish supermarket sells
next to the tills, and excluding it needs a rule the source does not offer.

## 9. Carrefour Express is not a second source, and here is why

Carrefour Spain runs three physical grocery formats. The store finder names them as its own
three filters: `cb1` Hipermercado, `cb2` Carrefour Market, `cb3` Carrefour Express.

**Only the online storefront has prices, and there is one of it.** Carrefour Express is a
franchise convenience format. Its own page on the site sells the franchise, not a basket. There
is no Express catalog, no Express price list, and no Express sale point that the online
supermarket will serve. A run against `/supermercado` reads one assortment, the one attached to
the sale point in the `salepoint` cookie, and that sale point is a fulfilment centre.

So Carrefour Express is not a `supermarket_sources` row with an adapter behind it. What it can
be is two other things this repository already has shapes for:

- **Locations.** Express shops are shops, and plan `0084` is how a chain's shops become ours.
  They come from `osm-places`, as every other chain's do.
- **Leaflets.** Plan `0081` reads a leaflet as a source without fetching anything. If Carrefour
  publishes an Express specific leaflet, that is the path to an Express price, and it needs no
  adapter at all.

**Whether prices differ by sale point was not measured and this plan does not assume either
way.** The `salepoint` cookie is real and section 4 keeps it deliberately. Measuring price
variation across sale points is a prerequisite for treating Carrefour as more than one price
scope, and section 14 leaves it out of this plan rather than guessing at it.

## 10. `@portfolio/luna-shopper/carrefour`

A new library beside `mercadona` and `deza`, holding the client and the parser, and no database
and no Nest.

```
libs/luna-shopper/carrefour/
  src/lib/
    carrefour.client.ts      the browser session, the pacing, the cookie rule
    state.ts                 pulling the listing state out of a loaded page
    listing.ts               a listing page to SourceCatalogEntry rows
    price.ts                 "7,65 €" to cents, and the null case
    categories.ts            the tree walk and the ceiling rule
    types.ts
  tools/
    capture-fixtures.ts      refreshes __fixtures__ from the live site
```

**It is framework free in every way except one.** No TypeORM, no Nest, no database, no
`SupermarketItem`. Every test runs against checked in fixtures with no network, exactly as
`mercadona` and `deza` do. The exception is Playwright, and the exception is forced: section 3
is the measurement that says no other client works.

The fixture for this library is **the page state object, not the HTML**. The parser reads
`window.__INITIAL_STATE__`, so a captured `.json` of that object is the whole input, and it
keeps the tests off both the network and a browser. `capture-fixtures.ts` is the only thing in
the library that launches one, and CI never runs it.

`CarrefourClient` shadows the adapter method names the way `MercadonaClient` does:
`walkCategories` is the enumeration, `readListing` is the page read. There is no `search`,
because the search API is the closed one.

## 11. Where the browser runs, and why this stays in Node

A browser in the harvester image is the real cost of this plan, and it is worth stating in
megabytes. Chromium plus its shared libraries adds roughly 400 MB to an image that is currently
tens of megabytes. That is a build time cost, a pull time cost and a patching surface.

**It stays in the harvester service and in Node.** Plan `0038` section 4.3 measured the
alternative and the reasoning holds here. A second runtime costs a second toolchain in Nx and
CI, a second base image, and the loss of `@portfolio/luna-shopper/contracts`, which is the
TypeScript the whole backend agrees on. None of that is repaid by a browser driven adapter,
because the browser is the cost and the browser is the same in any language. Playwright's Node
API is also the one this repository already uses for e2e, so the dependency is not new to the
workspace, only new to a backend image.

Two decisions follow, and both are section 13's to enforce:

- **One browser per run, not per page.** Launching Chromium costs about a second. A run holds
  one browser and one context for its whole life, and drops the Cloudflare cookies between
  navigations, per section 4.
- **The browser is torn down when the run ends, including when it aborts.** A leaked Chromium
  is 300 MB of resident memory in a pod sized for a Nest service.

## 12. The run

`CATALOG_DISCOVERY`, dispatched on `supermarket_sources.adapterKey` exactly as plan `0085`
built it. The key is `carrefour-web`. `CatalogDiscoveryRunner` gains a third branch and no new
mode.

What the run writes, per plan `0086`:

- One `source_catalog_entries` row per product, keyed on (`supermarketId`, `externalId`), with
  `externalId` the card's `product_id` and `sourceKind` `OFFICIAL_WEB`.
- `name` and `brand` verbatim, Spanish, never rewritten, per `0086` D8 and plan `0079`.
- `ean` from the product page, on the terms in 12.1. The listing card carries none.
- One `source_entry_prices` row per entry for the run's price scope, carrying `price` and the
  card's `price_per_unit` verbatim in `unitPrice` and `unitPriceLabel`.

**The price per unit is stored as printed and never recomputed.** This is the same rule the
harvester already carries for Mercadona's `bulk_price`, and for the same reason: the field
exists so a shopper can compare, and a derivation that disagrees with the chain in the last
cent is worse than useless.

**A card with no readable price writes an entry and no price row.** Some cards are priced by
weight and print no figure. `sample-products.ts` reports how many, per category. Writing a zero
there is a lie about a real product, and `0086` section 3.2 already allows an entry with
no price for exactly this case.

Nothing here writes to `supermarket_items`. Plan `0080` decides which source a shopper sees, on
read, and this is one more source.

### 12.1 The EAN is on the product page, and it is worth one visit per product

The listing card has no EAN. The **product page does**, at `__INITIAL_STATE__.pdp.product.ean`,
and it is a real EAN-13: `8431876300383` for Carrefour's own bagged ice. The same page also
carries ingredients, net content as its own field ("2000 g"), and vegan and vegetarian flags.

**This matters more than any other field on the page.** An EAN is the top rung of plan `0086`'s
ladder. With it a Carrefour product resolves to an existing item with confidence 1 and no
person in the loop. Without it every row lands in the fuzzy rung and waits in the queue, which
is where DEZA already sits. Reading it turns Carrefour from a source that makes work into a
source that resolves itself.

**The cost is one page load per product, and it is paid once.** A listing page carries 24
cards, so reading every product page is roughly twenty times the crawl: an 851 load run becomes
of the order of 18,000 loads, which is most of a day at the measured pace.

So the detail pass is **keyed on the product and not on the run**. An EAN does not change, so a
product whose `source_catalog_entries` row already holds one is never fetched again. That gives
two very different costs:

| Pass | Loads | When |
| --- | --- | --- |
| Prices, the frontier crawl | 851 | Every run |
| EAN backfill, products with no EAN yet | Up to about 18,000 once, then only new products | First run, then rarely |

**Build the price crawl first and the detail pass behind its own switch.** The price crawl is
the thing the product is for, it finishes in an hour, and it is complete on its own terms. The
detail pass is a backfill that can run overnight, resume where it stopped, and be interrupted
without costing anything, because a row with no EAN is exactly the state it started in.

Two things to hold to when building it:

- **Never block a run on the detail pass.** A price crawl that waits for 18,000 loads is a
  price crawl that never finishes.
- **A missing EAN is a value, not an error.** Some pages will not carry one. Write the entry
  without it and let the fuzzy rung do its job.

## 13. Politeness

The knobs plan `0085` section 4 established already cover this and no new environment variable
is added, per plan `0083`.

- The chain is enabled by its `supermarket_sources` row and by nothing else.
- One request at a time. The pace in section 5 is a single sequential reader, and it is what
  was measured. Do not add concurrency to a source that blocks on burst.
- A delay of 2000 ms between navigations, configurable on the source row, never below what
  section 5 measured.
- A refusal aborts the run rather than retrying into a deeper block. Section 5 records that the
  penalty escalates.
- A `User-Agent` that names the app and a contact address, as every other client here does.

## 14. What this does not do

- **It does not read the product page in the price crawl.** The EAN is there and it is worth
  having, and section 12.1 is how: a separate backfill, keyed on the product rather than on the
  run, behind its own switch. Until that backfill runs, every Carrefour row resolves through
  the fuzzy rung of `0086` and waits for a person, which is where DEZA sits today.
- **It does not measure price variation by sale point**, so Carrefour is one price scope. See
  section 9.
- **It does not harvest Carrefour Express or Carrefour Market as sources.** Section 9.
- **It does not touch leaflets.** Plan `0081` already reads a leaflet, and a Carrefour leaflet
  is an upload, not a crawl.
- **It does not use the search API**, because the search API is blocked. A future maintainer
  looking for a cheaper enumeration will find `search-api/query/v1/search` in the page config
  and must read section 2 first.

## 15. Testing

- `state.ts`, `listing.ts`, `price.ts` and `categories.ts` against checked in fixtures, with no
  network and no browser. This is the bulk of it, and it is the same arrangement `deza` has.
- `price.ts` gets the cases that actually occur: `"7,65 €"`, a thousands separator, and a card
  with no figure at all, which must give null and not zero.
- The ceiling rule in `categories.ts` gets a fixture where a node reports more than 1008 with
  children, and one where it reports more than 1008 with none. The second must reach the run
  report.
- The client's cookie rule gets a test that asserts a Cloudflare cookie is removed before a
  navigation and that `salepoint` survives. Section 4 is the reason this is a test and not a
  comment.
- The runner branch gets the `0085` treatment: a fake client, and an assertion that the run
  writes an entry with no price row when the card had no price.
- Nothing in CI launches a browser or reaches the network.

## 16. Exit criteria

1. `supermarket_sources` holds a Carrefour row with `adapterKey` `carrefour-web`, disabled.
2. Enabling it and starting a `CATALOG_DISCOVERY` run finds the frontier, pages every category
   in it, and finishes without a refusal.
3. The run writes `source_catalog_entries` with verbatim names and brands, and
   `source_entry_prices` with prices and printed unit prices, for the order of ten thousand
   distinct products section 7 measured.
4. Any frontier category the ceiling truncated is named in `harvest_runs.report`.
5. The EAN backfill of 12.1 runs behind its own switch, never blocks a price crawl, and can be
   stopped and restarted without losing what it already wrote.
6. No row reaches `supermarket_items` except through the `0080` read path.
7. The harvester image builds with Chromium, and a run that aborts leaves no browser behind.
8. `npx nx run luna-shopper-backend-gateway:openapi` produces no diff, or its diff is committed.
