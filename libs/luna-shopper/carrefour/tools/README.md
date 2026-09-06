# Carrefour probe scripts

Research scripts written to answer one question: can the harvester read the Carrefour
catalog the way it reads Mercadona and DEZA?

They are **not a library yet**. There is no `project.json`, no `src`, no test target and
nothing imports them. They sit here because this is the place for a
`@portfolio/luna-shopper/carrefour` library. They are checked in because the numbers in
[`apps/luna-shopper-backend/plans/0089-a-catalog-behind-a-browser.md`](../../../../apps/luna-shopper-backend/plans/0089-a-catalog-behind-a-browser.md)
must be reproducible by somebody who did not write them.

Read the plan first. It states the conclusion. These scripts are the evidence.

## Running them

They need `playwright` and its Chromium download, both of which the workspace already has.

```sh
# Which HTTP clients does Cloudflare let through? This is the central finding.
npx tsx libs/luna-shopper/carrefour/tools/compare-clients.ts

# Which API routes are reachable from the internet, and which are server side only?
npx tsx libs/luna-shopper/carrefour/tools/probe-endpoints.ts

# How fast can pages be read before the edge starts refusing them?
npx tsx libs/luna-shopper/carrefour/tools/measure-rate-limit.ts 8000 25
npx tsx libs/luna-shopper/carrefour/tools/measure-rate-limit.ts 8000 25 --assets

# How big is the category tree, and how many page loads is a full crawl?
npx tsx libs/luna-shopper/carrefour/tools/walk-categories.ts --depth 2
npx tsx libs/luna-shopper/carrefour/tools/walk-categories.ts --out tree.json

# What does one product card carry, and is it enough to write a price?
npx tsx libs/luna-shopper/carrefour/tools/sample-products.ts cat20001 5

# Does the product page add anything the listing card lacks, an EAN above all?
npx tsx libs/luna-shopper/carrefour/tools/probe-product-page.ts \
  /supermercado/gazpacho-carrefour-sin-gluten-1-l/805505583/p
```

## Please do not run these in a loop

Every one of them makes real requests to a live storefront. The edge rate limits
aggressively and the limit escalates: once it trips, a single load per minute can keep
failing for several minutes afterwards. Each script is written to produce one result per
invocation, and re-running one immediately after a blocked run measures the block rather
than the site.

If a script reports everything as blocked, that is the cooldown, not a change in the
site. Wait, then run it again.

## What the scripts assume

- **The data is in `window.__INITIAL_STATE__`.** Every listing page renders its products,
  its pagination and its child categories into that object. After hydration the
  serialized HTML no longer contains the literal blob, so the scripts read the live
  object through `page.evaluate` rather than parsing markup.
- **Scope is `/supermercado`.** That path is the grocery storefront. Electronics,
  clothing and the marketplace live elsewhere on carrefour.es and the category walk never
  reaches them, so nothing has to be filtered out.
- **A browser is not an optimization.** `compare-clients.ts` exists because the choice
  looks heavy until you see that no other client works.

## Files

| File | What it is |
| --- | --- |
| `carrefour-browser.ts` | The paced Chromium client and the parsing helpers. Everything else builds on it. |
| `compare-clients.ts` | curl, node and Chromium against the same host, interleaved. The TLS finding. |
| `probe-endpoints.ts` | Reads the storefront's own service map, then calls every route in it. |
| `measure-rate-limit.ts` | How many pages per minute the edge tolerates. |
| `walk-categories.ts` | Discovers the category tree and sizes a full crawl. |
| `sample-products.ts` | Pages one category and censuses the fields on a product card. |
| `probe-product-page.ts` | What a product page adds over a listing card. |
