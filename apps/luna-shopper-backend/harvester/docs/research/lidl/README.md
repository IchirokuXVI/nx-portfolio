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
- **20% of products cost different amounts in different regions.** There are 59
  price regions and they are named after Spanish provinces.
- **730 stores**, each one naming the price region it belongs to, so a regional
  price can be attached to the shops it applies to.
- **Per store stock is published but always empty.** `/p/api/storestock` answers
  `UNKNOWN` for every product and every store in Spain.

The catch is coverage, and it is the whole reason the plan is shaped the way it
is: the site publishes what is on offer now and next week, not the permanent
assortment. One run is a snapshot of a rolling window. The catalog is built by
running every week and keeping what earlier runs found.

That the window is all there is was tested, not assumed. `probe-coverage.mjs`
searched 105 grocery terms, covering aisles, staples and every LIDL own brand,
and found **zero** products the empty query had not already returned.

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
