# LIDL Spain: what the site publishes and how to read it

Throwaway research scripts, written on 2026-09-06 to answer one question: can the
harvester run a catalog discovery against LIDL the way it runs one against
Mercadona and DEZA? The answer is yes, and this directory is the evidence.

**None of this code ships.** It is committed so that the plan it produced,
`apps/luna-shopper-backend/plans/0089-a-catalog-that-arrives-a-week-at-a-time.md`,
can be read beside the probes that found each fact. The real adapter belongs in
`libs/luna-shopper/lidl`, framework free, with checked in fixtures, like the
other two.

Leaflets are out of scope here on purpose. The leaflet path already exists and is
a `FILE_IMPORT` run (plan 0081). This is about the website and its API.

## What was found

LIDL Spain runs three services that answer without a key, an account or a cookie.

| Service                                | What it answers                                                   |
| -------------------------------------- | ----------------------------------------------------------------- |
| `www.lidl.es/q/api/search`             | the product index, as JSON, including the in-store assortment     |
| `www.lidl.es/p/<slug>/p<id>`           | one product, with its EAN and its price per region                |
| `live.api.schwarz/odj/stores-api/v2/…` | every Spanish store, with coordinates, hours and its price region |

The numbers below come from `dry-run.mjs`, which performed a complete run on
2026-09-06 in 161 seconds and 216 requests, with no warnings.

- **493 products** carry the in-store flag. 285 of them are online shop articles
  that a shop also stocks. The supermarket half is **153** products, of which
  **132 have a price**.
- **83% of grocery products carry a real EAN-13.** 15% carry an eight digit
  internal code and 5% carry nothing.
- **Every price has a validity window.** 166 of 228 price observations expired
  the Sunday of the week they were read, and 56 expired the Sunday after.
- **A price is published per region, and there are 59 of them.** They are named
  mostly after Spanish provinces, with a few operational names such as `Cat 2`.
  Each product carries a price pointer for every region, so the format allows 59
  different prices for one product. 20% of the sampled products used more than
  one. See the section below for what grocery did this week.
- **730 stores**, every single one naming the price region it belongs to, with no
  gaps, so a regional price attaches to its shops with nothing inferred.
- **Per store stock is published but always empty.** `/p/api/storestock` answers
  `UNKNOWN` for every product and every store in Spain.

The catch is coverage, and it is the whole reason the plan is shaped the way it
is: the site publishes what is on offer now and next week, not the permanent
assortment. One run is a snapshot of a rolling window. The catalog is built by
running every week and keeping what earlier runs found.

That the window is all there is was tested, not assumed. `probe-coverage.mjs`
searched 105 grocery terms, covering aisles, staples and every LIDL own brand,
and found **zero** products the empty query had not already returned.

## The region is a real region, and a postal code does not give it

Two probes answer the question that decides the whole price model: what is the
smallest group of shops LIDL charges the same in?

**A region is not a shop.** 730 shops sit in 59 regions, a mean of 12.4 shops
each, a median of 7, and 84 in Madrid. Six regions hold exactly one shop, which is
because those provinces have one Lidl and not because a region means a shop. The
site's own page state carries `selectedRegion` separately from `selectedZone`,
with `defaultRegion: "26"`, so choosing a shop on the storefront selects that
shop's region and the storefront prices per region.

**A postal code does not give the region.** 12 of the 52 provinces hold shops in
more than one region, covering 273 of the 730 shops. Going finer helps but does
not fix it: of the 652 full postcodes that hold a Lidl, three hold shops in two
regions, which are `43700`, `04700` and `28922`.

**It does not need to, because every shop states its own region.**
`marketingData.offerRegion` is present on all 730 records with no gaps. So the
harvester copies the region and derives nothing.

**What grocery did this week is not a rule.** Across all 132 priced grocery
products, no two regions disagreed on a price. Every split had one shape, which
`out/province-price-conflict.json` states in a line:

```json
priceSplitShapes: [{ "shape": "none:2 + price:50", "count": 132 }]
```

That is 50 provinces with a price and the two Canary ones with none. It is
tempting to read that as three zones, `PEN`, `BAL` and `CAN`, and store three
scopes instead of 59. **Do not.** The pointer per region is real, a `Livarno` lamp
in the middle aisle already uses three distinct prices, and a model built on this
week's agreement cannot store the week LIDL prices one region on its own. The
zone is worth recording as an attribute, because it explains the missing Canary
prices, and it decides nothing.

## The scripts

Run them from the workspace root. They need no environment and write into `out/`,
which is git ignored except for the small reports the plan quotes.

| File                    | What it does                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `capture-network.mjs`   | Opens a page in Playwright and records every XHR, to find endpoints instead of guessing them.    |
| `nuxt-payload.mjs`      | Decodes the `__NUXT_DATA__` blob a lidl.es page carries. Shared by the probes below.             |
| `probe-endpoints.mjs`   | Calls candidate endpoints and reports what each one answers. This is what found `/q/api/search`. |
| `probe-enumeration.mjs` | Tries every way of asking the search endpoint for the whole assortment.                          |
| `walk-assortment.mjs`   | Walks the in-store assortment and tallies the fields on what it finds.                           |
| `probe-coverage.mjs`    | The 105 term keyword sweep that showed the empty query is complete.                              |
| `probe-regions.mjs`     | Proves the store region ids and the price region ids are one id space.                           |
| `probe-postal-to-region.mjs` | Tests whether a postal code decides the region. It does not. Names the 12 provinces that split. |
| `probe-province-price-conflict.mjs` | Reads every grocery product page and asks whether the regions inside one province ever charge differently. |
| `probe-pdp-sample.mjs`  | Reads a spread of product pages and measures how usable `eans` and `regionsV2` are.              |
| `dry-run.mjs`           | A complete catalog discovery in the shape a runner performs it, writing nothing.                 |

```sh
node tools/research/lidl/probe-endpoints.mjs
node tools/research/lidl/walk-assortment.mjs
node tools/research/lidl/probe-coverage.mjs
node tools/research/lidl/dry-run.mjs
```

## Four things that cost an hour to learn

- **The search endpoint refuses `Accept: application/json`.** It answers 406. It
  must be `*/*`, which is what the browser sends. Every probe here sets it.
- **`assortment` is the country and `locale` is underscored.** The endpoint needs
  `assortment=ES&locale=es_ES&version=2.0.0`. Any other spelling of the locale is
  rejected by name, and a missing `version` gives a bare 400 that names nothing.
- **An empty `q` returns the whole index.** That is not documented anywhere. It is
  how the assortment is walked without a keyword.
- **The list is not the product.** `eans` and `regionsV2` exist only on the
  product page, so a run that wants an EAN pays one request per product.

## What the site says about crawling

`https://www.lidl.es/robots.txt` disallows search result URLs and any URL
carrying `offset`, `sort`, `idsOnly` or `productsOnly`. A catalog walk is exactly
that kind of URL, so the plan treats the rate limit as a real constraint rather
than a formality, and a run stays near one request per second. The store API host
`live.api.schwarz` serves no `robots.txt` and restricts nothing.

The `x-apikey` the store API needs is a fixed string shipped inside the public
store search bundle. Reading it out of the bundle at run time is brittle,
and a copy written here goes stale. The plan pins it in configuration and
treats a 401 as the signal that it rotated.
