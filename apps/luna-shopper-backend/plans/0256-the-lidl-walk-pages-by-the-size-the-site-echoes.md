> **PR:** [#944](https://github.com/IchirokuXVI/nx-portfolio/pull/944)

# 0256: the LIDL walk pages by the size the site echoes

> Found on 2026-11-08 by the review of plan `0252` (PR #937), and confirmed live the same day with
> the library's own client. The LIDL search endpoint answers at most 60 rows a page, whatever
> `fetchsize` asks. A request with `fetchsize=100` at offset 0 returned 60 items, all gridbox
> product tiles, and echoed `"fetchsize": 60, "maxfetchsize": 1000, "numFound": 679, "offset": 0`.
> A request at `offset=60` returned 60 further items, and none of them was on the first page. The
> walk advances its offset by the page size it asked for, 100, so it reads rows 0 to 59, skips 60
> to 99, reads 100 to 159, and so on. Every weekly walk has read about 60 percent of the window:
> the walk of 2026-11-06 listed 419 of 662 rows, which is seven pages of 60. The probe of plan
> `0252` has the same gap: its second listing page starts at offset 100.
>
> Prerequisite reading: plan `0089` (LIDL, the week's window, the regions, section "the walk"),
> plan `0219` (the probe), plan `0252` (the probe reads a grocery product),
> `libs/luna-shopper/lidl/src/lib/lidl.client.ts` (`walkInStore`, `searchUrl`,
> `DEFAULT_PAGE_SIZE`), `normalize.ts` (`normalizeListPage`, which already reads `numFound`,
> `offset` and `fetchsize` off the payload), `probe.ts` (the listing steps and the second page),
> `types.ts` (`LidlListPage`) and `apps/luna-shopper-backend/harvester/src/app/harvest/lidl-catalog.runner.ts`.

## Brief for the agent

### Objective

Make the LIDL walk and the LIDL probe advance through the listing by the number of items the
site returned, never by the number asked for, so a walk reads every row of the window and the
probe's second page starts where its first ended. Nothing else about a LIDL row changes.

### Context

- `walkInStore` (`lidl.client.ts`, near line 146) loops `for (offset = 0; total === null ||
  offset < total; offset += this.pageSize)`, with `pageSize` 100. It stops on a page with no
  rows. It deduplicates by `externalId` through a `seen` set, so an overlap costs nothing and a
  gap costs the rows.
- `normalizeListPage` keeps `total` (`numFound`), `offset` and `fetchsize` from the payload. The
  committed fixture `search-page.json` carries `"fetchsize": 5, "offset": 325, "numFound": 494`,
  so the echo is in the shape the parser already reads. What it does not keep is how many raw
  items the page carried before the parser dropped the tiles that are not products.
- The probe (`probe.ts`, after PR #937) reads page 2 at `offset=100` when page 1 holds no grocery
  row and the total is above 100.
- The walk's budget in plan `0089` was five listing requests for a window of about 500 rows. A
  window of 679 rows at 60 a page is twelve listing requests. Each grocery row then costs its
  product page as today. On 2026-11-06 the walk kept 166 grocery rows of 419; a whole window
  holds about 260, so the product stage grows by about the same ratio.
- **Nothing delists on a LIDL walk.** Plan `0220` keeps LIDL out of every absence rule: "nothing
  here deletes a product for being absent from one week" (`lidl-catalog.runner.ts`, line 28), and
  a LIDL price ends by its own `validUntil`. A walk that suddenly reads 679 rows instead of 419
  thus adds rows and prices and removes nothing.
- `robots.txt` of `www.lidl.es` disallows any URL that carries `offset` (plan `0089`, section
  "robots"). That was weighed when the walk was built and is not reopened here: the number of
  requests rises from about seven to about twelve a week.

### Target state

A walk on an ephemeral slot lists every row the index states in `numFound`, within one page of
rounding, and the probe's `steps` show a second page that starts at the first page's item count.

### Scope

`libs/luna-shopper/lidl/src/lib/lidl.client.ts`, `normalize.ts`, `types.ts`, `probe.ts` and
their specs. A fixture captured through the library's `capture-fixtures` target only if the
existing pages cannot express a case. No harvester code: the runner consumes `walkInStore` as an
iterable and does not page.

### Constraints

- The walk and the probe never ask for more than the site serves: no retry loop, no second
  request for the same offset.
- The shop walk (`walkStores`, `STORE_PAGE_SIZE`) is not touched unless its endpoint shows the
  same cap; say in the PR which it is, from one live page.
- The verdict rules of plan `0219` do not change. A page that returns fewer items than asked
  while more remain is the site's normal answer, not a shape change.

### Action boundaries

Stop and ask before changing the request rate, the `q=` query, the store parameter, or anything
about regions and prices.

### Progress evidence

`npx nx test luna-shopper/lidl`, the echoed `fetchsize` and `numFound` of one live page quoted in
the PR, and the row count of one walk on an ephemeral slot against the `numFound` it stated.

## 1. The step

1. `LidlListPage` gains `itemCount`: the number of raw items the page carried, before the
   parser dropped the tiles that are not products. `normalizeListPage` fills it.
2. The walk's next offset is `offset + page.itemCount` when `itemCount` is above zero, else
   `offset + page.fetchsize` when the echo states one above zero, else `offset + pageSize`. The
   first case is the one that runs; the other two are for a payload that lost its shape, and
   each keeps the walk moving instead of stopping it.
3. The walk ends on a page with no items, or when the next offset reaches `total`, as today.
4. The asked `fetchsize` stays 100 (decision D1).

## 2. The probe

The second listing page starts at the first page's `itemCount`. "More remain" is `total >
itemCount`, in place of `total > 100`. The listing sample states the echoed `fetchsize` and the
item count beside `rows` and `total` (decision D2), so a person reading a probe can see the cap.

## Tests

- Client spec: a server that answers 60 of 100 asked is read at offsets 0, 60, 120 and so on,
  and every row of a 150 row index is yielded once. A server that honours 100 is read at 0 and
  100. A page with no items ends the walk. A total of 61 makes two requests.
- Normalize spec: `itemCount` counts the raw items, also when some are not product tiles.
- Probe spec: page 2 is asked at the first page's item count; a total equal to the item count
  asks for no page 2; the existing cases keep their verdicts.

## Acceptance criteria

- [ ] A walk against a server that caps the page at 60 yields every row of the index.
- [ ] The probe's second page starts at the first page's item count.
- [ ] No request is repeated for one offset, and the walk makes at most `ceil(total / 60) + 1`
  listing requests against the live site.
- [ ] The existing probe cases keep their verdicts.

## Verification

On an ephemeral slot, walk LIDL once and compare the rows listed with the `numFound` of the
first page, quoted from the run's report or the harvester log. The two agree within one page.
Then read the newest `source_probes` row and quote its listing steps.

## Decisions

- **D1 (owner): what the walk asks for.** (a) keep `fetchsize=100` and step by what came back;
  (b) ask `fetchsize=60`. Recommended: (a). The cap is the site's and may change; a hard 60
  bakes today's cap into the client, and asking 100 costs nothing.
- **D2 (owner): the probe states the echo.** (a) the listing sample carries `fetchsize` and
  `itemCount`; (b) `rows` and `total` only, as today. Recommended: (a), one line that makes the
  next cap change visible on the probe page.
