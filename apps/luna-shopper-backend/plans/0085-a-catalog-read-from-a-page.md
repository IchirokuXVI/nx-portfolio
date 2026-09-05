> **PR:** [#222](https://github.com/IchirokuXVI/nx-portfolio/pull/222)

# 0085 A catalog read from a page

DEZA publishes its assortment at `https://www.dezacalidad.es/productos/`. There is no API. Each row
is a product description and a popup naming the shops that carry it.

This is the second storefront the harvester fetches from and the first whose only claim is per shop
availability. Plan `0038` built the machinery for the first one. This plan adds an adapter beside it,
an enumeration strategy the source forces, and the parser that turns a rendered page into
`SourceCatalogEntry` rows.

**It writes no price.** The site prints none. What a run produces is candidate products for review
and availability for the shops it resolved.

Depends on `0084` for the per shop availability write and the shop mapping. Depends on `0083`, so
that a second chain arrives without a second environment variable. Depends on `0079`, because DEZA
prints Spanish only and a product created from it has no English name.

## 1. What the page gives, and what it does not

Measured on 2026-09-04, against the live site.

| Fact | Value |
| --- | --- |
| Rows per page | 15 |
| Page weight | About 126 KB |
| Shops named | 10, coded `T1` to `T7`, `C1`, `C2`, `Z1` |
| Sections | 9 top level, 62 leaves, 71 nodes |
| Availability | By omission. The popup lists only the shops that carry the product. |
| Price | None |
| EAN | None |
| Product id | None |
| Product URL | None |
| `robots.txt` | Allows `/productos/`. Only `/wp-admin/` is disallowed. |

**Availability by omission is the whole value of this source.** A product stocked everywhere lists
ten shops and a niche one lists a single shop. That is a per shop claim an automated source can make,
which is the thing plan `0084` exists to receive.

**The markup contains empty price elements. Do not build on them.** Every shop in every popup carries
a `wpdz-precio-ok` and a `wpdz-precio-oculto` element, and both are blank on the public site. They
are the storefront's own hidden pricing, not a field waiting to be read. A parser that treats a blank
string as a price writes zeros.

**The chain also publishes eighteen centres**, of which these ten appear in the listing. The rest are
warehouses, cafeterias, a bakery and a beauty salon. Plan `0084` section 6 has the `IGNORED` status
for them.

## 2. Every query returns at most 300 rows

The pagination widget stops at page 20 and page 21 is empty. That holds for a leaf section with a few
hundred products and equally for `ALIMENTACION`, a top level section with thousands. Pages 25, 60 and
200 of that section are all empty. So 300 is a ceiling on the result set, not the size of the
assortment, and no page size parameter moves it.

Two filters exist and they combine:

- **The section.** A POST of `wpdzSeccProd` with a code such as `W011000009`. The selection is held
  in a **PHP session cookie**, and `?wpdz-pagination=1&paged=N` follows that cookie.
- **A substring search.** `wpdz-input-name`, matching anywhere in the description. `ino` matches
  `Vino`. An empty section searches the whole catalog.

**28 of the 62 leaves hit the ceiling.** The other 34 hold about 4,950 products between them. The
assortment is therefore at least 13,350 and its true size is unknown from the outside.

**The session cookie is a constraint on concurrency.** A worker cannot share a cookie jar with another
worker running a different query, because the second POST moves the first worker's section. So a run
holds one jar per in flight query, and the shared thing between workers stays the token bucket.

## 3. The split, and the budget that stops it

A section under the ceiling is crawled directly. A section at the ceiling is split by substring
search within that section.

The loop, per capped section:

1. Crawl what the section returns, up to 300 rows.
2. Collect the vocabulary of the descriptions seen so far.
3. Issue the most frequent unused term as a search within the section.
4. A query whose last page is under 20 is complete. A query still at 20 is itself a candidate for
   further narrowing by a second term.
5. Stop when a full pass adds no new product, or when the budget runs out.

**The budget is 25 queries per section**, the owner's number. It bounds a run at roughly
`34 + 28 * 25` queries of a few pages each, which is about 5,000 page fetches and 630 MB.

**What happens at the budget is the important half.** The section is recorded as incomplete, with the
queries that were still at the ceiling when the budget ran out. The run reports it. Nothing pretends
the catalog is whole.

**Completeness cannot be proven against this source and the plan does not claim it.** There is no
total to check against. A term based cover reaches every product whose description shares vocabulary
with a product already seen, and Spanish product descriptions share vocabulary heavily, so coverage
in practice is high. The honest artifact is the incompleteness report, not a number.

## 4. Politeness, and the knob that is already there

Measured on 2026-09-04: 30 requests issued at 10 per second answered 200 every time, with latency
flat at 0.38 seconds and no throttling.

**The rate is `supermarket_sources.maxRequestsPerSecond`**, which plan `0038` section 4.2 already made
per source and the back office already edits. No new setting. The DEZA row ships at 4 and the owner
raises it, which is the arrangement that lets a rate be tuned without a deploy.

**The number to watch is weight, not count.** At 126 KB a page, 10 per second is about 1.3 MB per
second sustained off one Apache server. That is the reason to leave the shipped default low even
though the source tolerates more.

`workers` and `maxRequestsPerSecond` keep the two separate jobs plan `0038` section 6.3 gave them.
The token bucket is shared by the whole run, because four workers each pausing is four times the rate
the owner set.

## 5. `@portfolio/luna-shopper/deza`

A new library beside `mercadona` and `osm-places`, under the same hard constraint: **no TypeORM, no
Nest, no database, and every test against checked in fixtures with no network.** A `capture-fixtures`
target refreshes them, and nobody edits a fixture by hand.

It holds the client, the parser and the normalizer:

- The section tree, read from the search form rather than hard coded, so a new section appears on its
  own.
- One page fetch, returning the rows and the last page number.
- The row parser: description, attribute icons, and the list of shop codes with their printed names.
- `normalizeName` is imported behaviour, not a second copy. The harvester's `matching.ts` owns it.

The page declares UTF-8 and is UTF-8. There is no encoding workaround to write.

## 6. There is no product id, so the identity is the description

`SourceCatalogEntry` is unique on (`supermarketId`, `externalId`) and DEZA supplies no id. So
`externalId` is a hash of the normalized name and the normalized size, which is the same key shape
plan `0081` section 2.1 uses for a leaflet alias.

**The consequence, stated because it is real: a reworded description is a new candidate and orphans
the old one.** DEZA renaming "Refresco PEPSI 1.75 L" produces a new entry, and the previous one stops
being seen and ages out on `lastSeenAt`. There is no id to notice that they are the same product. An
operator who has already accepted the old one sees a new candidate for a product the catalog holds,
and the fuzzy rung proposes the match.

**The listing repeats rows.** "Perlas de perfume LENOR classic frescos de abril 195 g" was returned
twice in one result set, as was a mussels product, most likely because one product is filed under two
sections. The run deduplicates on the key. That also silently merges two genuinely distinct products
that share a description, which is a cost this source makes unavoidable.

## 7. The size comes out of the description, and this is why

The description is one string with the size at the end. A leaflet offer, by contrast, arrives with
`product.name` and `product.format.raw` already separate, and plan `0081` section 2.1 keys an alias on
`normalizeName(name) + '|' + normalizeName(format)`.

**So a crawl that leaves the whole description in `name` can never meet a leaflet.** The keys have
different shapes. `refresco pepsi 1 75 l|` and `pepsi regular o zero|1 75 l` do not collide, and no
amount of fuzzy matching fixes a key that was built wrong.

The parser therefore splits the trailing size into `sizeFormat` and puts the rest in `name`, so both
sources produce keys of one shape.

**Three notation differences were measured between the leaflet extractor's output and this site.**
Seven leaflet products were compared against their web rows on 2026-09-04:

| Difference | Leaflet | Web | Survives `normalizeName`? |
| --- | --- | --- | --- |
| Decimal separator | `1,75 L` | `1.75 L` | No. Both become `1 75 l`. |
| Sub brand punctuation | `SANDEVID 0'0` | `SANDEVID 0+0` | No. Both become `sandevid 0 0`. |
| Pack composition | `44 lavados` | `28+16 lavados` | **Yes.** `44 lavados` against `28 16 lavados`. |

`normalizeName` replaces every run of non alphanumeric characters with a space, so two of the three
vanish for free. **Only the pack sum survives**, in 3 of the 7 pairs: `28+16` is the leaflet's 44,
`23+12` is its 35, `330+165` is its 495.

Expanding `a+b` before comparing sizes is worth doing and it belongs to the matcher, not to this
parser. This plan states the finding and stores the size verbatim. Rewriting `28+16 lavados` into
`44 lavados` at parse time would destroy what the chain printed, which is the thing plan `0081`
section 2 is built to preserve.

## 8. Brand, and the icons

The brand sits inside the description in capitals: `ARIEL`, `LENOR`, `PEPSI`, `SANDEVID`, `CASTELLAR`,
`ALTEZA`. A capitals run is a usable brand extractor and it is stored on `SourceCatalogEntry.brand`
with no pretence of certainty. Plan `0081` section 2.1 keeps brand out of the alias key for exactly
this reason, and the same holds here: the brand is for a person to read in the queue.

The icons in `wpdz-row-col-icons` carry chain attributes, such as `Andaluz` for an Andalusian product.
They are captured onto the entry's `categoryPath` alongside the section path, because they are the
only classification beyond the section that the page offers.

## 9. The run

`ADAPTER_KEYS` gains `deza-web`. `HarvestRunMode` gains nothing: this is a `CATALOG_DISCOVERY` run,
which is what a walk of a chain's whole assortment is called.

**The dispatch has to change.** `run-executor.service.ts` branches on mode at lines 114 to 131 and
`CatalogDiscoveryRunner` imports `MercadonaClient` directly. A second adapter under one mode means
the runner selects its client from `source.adapterKey`, which is the field that has been on
`SupermarketSource` since plan `0038` and has had one possible value until now.

What a run does, in order:

1. Read the section tree.
2. Enumerate, section by section, under section 3's rules and budget.
3. Upsert `source_catalog_entries` with name, size, brand, section path and `lastSeenAt`.
4. Match against catalog items through `ItemMatchIndex` and refresh `item_source_refs`. The EAN rung
   never fires here, so every automatic match is a `CANDIDATE` and none writes anything a shopper
   reads.
5. Resolve the shop codes through `source_locations` (plan `0084` section 6), skipping the unmapped.
6. Call `supermarketLocationItem.setAvailability` once per resolved shop, with a value for every
   product the run resolved, positive and negative.

Step 3 is what makes an aborted run cheap to resume, exactly as plan `0038` section 6.3 describes:
the snapshot is already the answer and a re-run skips what it has.

## 10. What this does not do

- **No prices.** `item_prices` gains nothing from this source. DEZA's prices arrive through the
  leaflet import of plan `0081`.
- **No EAN, so no cross chain join.** Every match here is name based and lands in the review queue.
  Reading an EAN from Open Food Facts by product name was investigated and is not in this plan: the
  current search endpoint answers a United States can of Pepsi for `pepsi 1.75`, and a wrong EAN
  merges two different products in the one field that joins chains. It belongs in a later plan as a
  human confirmed suggestion, never as an automatic write.
- **Nothing for the fresh counters.** The site has no fish counter section. Leaflet offers for counter
  goods have no web row to meet, which is a fact plan `0081`'s queue absorbs rather than something
  this crawl can fix.
- **No schedule.** Every run is started by a person, as plan `0038` section 8.1 requires.

## 11. Testing

In `@portfolio/luna-shopper/deza`, against fixtures:

- The row parser on a captured page: 15 rows, the shop codes, the printed names, the icons.
- A product listing fewer than ten shops parses as fewer, and the omission is the negative claim.
- The blank `wpdz-precio-ok` elements produce no price field at all.
- The last page number is read from the pagination widget, and a page past the end parses as zero
  rows rather than an error.
- The size split, over a table of real descriptions.
- The section tree parses to 9 top level and 62 leaf codes.

In the harvester:

- A capped section triggers the split. An uncapped one does not.
- The budget stops the split at 25 and the run records the section incomplete with its open queries.
- A duplicate description within one run writes one entry.
- An unmapped shop code is skipped and counted, and the run still finishes.
- The rate limiter holds the configured rate across several workers, which is the existing token
  bucket test extended to this runner.
- A `CATALOG_DISCOVERY` run for a `mercadona-api` source still takes the Mercadona path. This is the
  test that the dispatch change broke nothing.

## 12. Exit criteria

- A run enumerates the sections and writes candidate entries with name, size and brand separated.
- Per shop availability reaches `supermarket_location_items` for every mapped shop, positive and
  negative.
- The incompleteness report names every section the budget could not finish.
- The rate is changed from the back office with no deploy.
- No price row is written by this source.
- `nx test luna-shopper-deza` passes with no network.
