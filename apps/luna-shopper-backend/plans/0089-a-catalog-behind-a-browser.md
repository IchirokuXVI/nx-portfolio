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
browser driven adapters". This is that adapter. Section 10 says why it stays in Node anyway.

## 1. What was measured

Everything in this plan was measured against the live site on 2026-09-06, with the scripts in
[`libs/luna-shopper/carrefour/tools`](../../../libs/luna-shopper/carrefour/tools/README.md).
Those scripts are checked in so the numbers can be re-taken, not because they are library code.

| Fact | Value |
| --- | --- |
| Product cards per listing page | 24 |
| Page weight, images refused | About 250 KB |
| Fields on a card | 16 |
| Price on a card | Yes, and a price per unit |
| EAN on a card | No |
| Product id on a card | Yes, two of them |
| Paging ceiling per category | 1008 |
| First level categories | 10 |
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
Section 9 says what that changes and what it does not.

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
prices the listing shows. Section 8 needs that cookie.

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

## 6. Paging stops at 1008, so a run walks leaves

A listing page reports two different totals and the difference is the whole enumeration
problem. `productCardList.results.total_results` is what the result set holds.
`pagination.total_pages` times `pagination.page_size` is what paging will actually serve, and
it stops at 42 pages of 24, which is **1008**.

"La Despensa" holds 6341 products and hands over 1008 of them. No page size parameter moves it.

So the run enumerates **leaf categories**, and the honest test of the enumeration is whether
any leaf still reports more than 1008. The category tree is not published in a form a client
can read, because `categories-api` is one of the closed routes, so it is discovered by walking:
every listing page names its own children under
`horizontalNavigation.secondLevelCategories`. `walk-categories.ts` does that walk.

Measured to depth 2:

| | |
| --- | --- |
| Nodes | 99 |
| Products summed over leaves | 17,593 |
| Leaves still over the ceiling | 3 |
| Listing pages to crawl every leaf | 760 |
| Total page loads for a full run | 859 |
| Wall clock at the measured pace | About 50 minutes |

The three that overflow at depth 2 are `Alimentación` (1044), `Desayuno` (1151) and
`Conservas, Sopas y Precocinados` (1202). All three have children, so the full walk resolves
them, and the run's rule is this: **descend while a node reports more than the ceiling and
has children.**

A node that reports more than the ceiling and has **no** children is the case the run cannot
enumerate completely. If any exist, the run records them in `harvest_runs.report`, the way plan
`0085` section 3 does for DEZA. Do not add a number that claims completeness the source does
not support.

Two node kinds are skipped:

- `catmasterlist`, "Mis productos", which is a signed in shopper's own history and is empty for
  an anonymous client.
- Promotion views, whose URL carries an `F-` token instead of a `cat` id. They re-list products
  a real category already holds, so walking them counts products twice.

## 7. Scope is `/supermercado`, and that is the whole filter

The requirement is groceries and not electronics. **No exclusion list is needed to get that.**
`carrefour.es/supermercado` is the grocery storefront and it has its own category tree, ten
first level nodes: Frescos, La Despensa, Bebidas, Congelados, Cuidado personal e Higiene,
Droguería y Limpieza, Bebé, Mascotas, Parafarmacia, and an Ofertas view. Electronics, clothing,
toys and the marketplace live under other sections of the site, and the walk in section 6 never
reaches them, because it only follows children of nodes it already holds.

Parafarmacia is inside the grocery storefront and stays. It is what a Spanish supermarket sells
next to the tills, and excluding it needs a rule the source does not offer.

## 8. Carrefour Express is not a second source, and here is why

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
scope, and section 13 leaves it out of this plan rather than guessing at it.

## 9. `@portfolio/luna-shopper/carrefour`

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

## 10. Where the browser runs, and why this stays in Node

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

Two decisions follow, and both are section 12's to enforce:

- **One browser per run, not per page.** Launching Chromium costs about a second. A run holds
  one browser and one context for its whole life, and drops the Cloudflare cookies between
  navigations, per section 4.
- **The browser is torn down when the run ends, including when it aborts.** A leaked Chromium
  is 300 MB of resident memory in a pod sized for a Nest service.

## 11. The run

`CATALOG_DISCOVERY`, dispatched on `supermarket_sources.adapterKey` exactly as plan `0085`
built it. The key is `carrefour-web`. `CatalogDiscoveryRunner` gains a third branch and no new
mode.

What the run writes, per plan `0086`:

- One `source_catalog_entries` row per product, keyed on (`supermarketId`, `externalId`), with
  `externalId` the card's `product_id` and `sourceKind` `OFFICIAL_WEB`.
- `name` and `brand` verbatim, Spanish, never rewritten, per `0086` D8 and plan `0079`.
- `ean` **null**. The listing card carries none. Section 13 covers the product page.
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

## 12. Politeness

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

## 13. What this does not do

- **It does not read the product page, so it writes no EAN.** A listing page carries 24
  products, so opening every product page multiplies a 859 load run by 24, into roughly 20,000
  loads and most of a day at the measured pace. Whether the product page even carries an EAN is
  what `probe-product-page.ts` answers, and until an EAN is proven to be there the cost cannot
  be justified. Without it every Carrefour row resolves through the fuzzy rung of `0086` and
  waits for a person, which is the same position DEZA is in.
- **It does not measure price variation by sale point**, so Carrefour is one price scope. See
  section 8.
- **It does not harvest Carrefour Express or Carrefour Market as sources.** Section 8.
- **It does not touch leaflets.** Plan `0081` already reads a leaflet, and a Carrefour leaflet
  is an upload, not a crawl.
- **It does not use the search API**, because the search API is blocked. A future maintainer
  looking for a cheaper enumeration will find `search-api/query/v1/search` in the page config
  and must read section 2 first.

## 14. Testing

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

## 15. Exit criteria

1. `supermarket_sources` holds a Carrefour row with `adapterKey` `carrefour-web`, disabled.
2. Enabling it and starting a `CATALOG_DISCOVERY` run walks the tree, pages every leaf, and
   finishes without a refusal.
3. The run writes `source_catalog_entries` with verbatim names and brands, and
   `source_entry_prices` with prices and printed unit prices, for the order of ten thousand
   products section 6 measured.
4. Any leaf the ceiling truncated is named in `harvest_runs.report`.
5. No row reaches `supermarket_items` except through the `0080` read path.
6. The harvester image builds with Chromium, and a run that aborts leaves no browser behind.
7. `npx nx run luna-shopper-backend-gateway:openapi` produces no diff, or its diff is committed.
