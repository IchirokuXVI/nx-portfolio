# 0126 A product database read by barcode

> First of four plans that bring Open Food Facts and Open Beauty Facts into Luna Shopper. This
> one is the library that reads them and nothing else. `0127` is where catalog keeps what was
> read, `0128` is the harvester run that reads for every product we hold, and `0129` keeps a
> copy of the photo. `0126` and `0127` are independent and can be built in either order. `0128`
> needs both.
>
> Open Food Facts and Open Beauty Facts are two open product databases keyed on the barcode:
> names, sizes, ingredients, allergens, nutrition values, scores and photographs, under the Open
> Database License for the data and Creative Commons Attribution ShareAlike for the photos.
> Plan `0038` section 5.7 already names Open Food Facts as where a product photo comes from,
> beside the owner, and as the intended source of nutrition data. `source-entry.service.ts`
> writes `imageUrl: null` with a comment that says so. Nothing in the repository reads either
> database yet.
>
> **They are not a supermarket.** No chain, no price, no shop, no assortment. What they answer
> is one question, "what is the product behind this barcode", so the library is a reader keyed
> on barcodes we already hold and never a walk of their catalog.
>
> Prerequisite reading: `0038` sections 3.4, 5.7 and 8.1, `0085` section 10 (why a barcode is
> never found by product name), `backlog/0013` section "Also considered: Open Food Facts" (the
> coverage that was measured), and the barrel and `types.ts` of `libs/luna-shopper/lidl`, which
> is the library shape to copy.

## Brief for the agent

### Objective

Create the framework free library `@portfolio/luna-shopper/open-facts` with the three readers
of section 3, the normalizer of section 4, the image address builder of section 5 and the
`capture-fixtures` tool of section 7. Add `barcodeKey` to `libs/luna-shopper/contracts` as its
own entry point (section 2). Every test runs against checked in fixtures with no network.

### Context

- `mercadona`, `lidl` and `osm-places` share one shape (`deza` and `carrefour` differ only in
  how they name their parser files): `src/index.ts` barrel, `src/lib/<name>.client.ts`,
  `src/lib/types.ts`, `src/lib/normalize.ts`, `src/lib/__fixtures__/`,
  `tools/capture-fixtures.ts`, and a
  `project.json` with `test`, `lint` and `capture-fixtures`. `lidl/project.json` passes
  `--tsconfig tsconfig.base.json` to `tsx` because it imports the contracts library, and this
  library does too.
- The client options every library takes are in `libs/luna-shopper/lidl/src/lib/types.ts`
  (`LidlClientOptions`): `userAgent`, `acquire`, `minIntervalMs`, `retries`, `backoffBaseMs`,
  `fetchImpl`, `signal`, `sleepImpl`, `now`. `acquire` is awaited before every request and is
  where the harvester passes its token bucket.
- Node's global `fetch` is the only HTTP client (plan `0038`, section 3.4). The harvester's
  `package.json` is a hand written runtime manifest, so a new dependency there is a second
  change in a second file. This plan adds none: `node:zlib`, `node:readline` and `node:stream`
  are built in.
- `libs/luna-shopper/contracts` already exposes one function as its own entry point:
  `@portfolio/luna-shopper/contracts/brand-key` in `tsconfig.base.json`, beside the export from
  the barrel. `brand-key.cases.json` is the shared case table its spec reads.
- `items.ean` is a varchar, unique when present. Catalog's `search-term.ts` accepts 8, 12, 13
  and 14 digits as a barcode. LIDL's 8 digit `eans` value is deliberately not written to `ean`
  (`libs/luna-shopper/lidl/src/lib/types.ts`), so it never reaches this library.
- Measured on 2026-09-19 (record these in the library's `types.ts` doc comments, with the date):
  - Every line of the JSONL export and of a delta file is one JSON document that **starts**
    `{"_id":"<code>",`. The `code` field itself sits anywhere from character 900 to 5,500.
  - Food export `openfoodfacts-products.jsonl.gz` is 13.0 GB compressed. Their own data page
    still says 0.9 GB. Beauty export is 98 MB. One food delta file is 25 MB, one beauty delta
    file is 148 KB and 124 lines. Delta files are kept for 14 days and carry no deletions.
  - `GET /api/v2/search?code=a,b,c` answered three barcodes in one request.
  - Limits per IP address: 15 product reads a minute, 10 searches a minute, HTTP 503 above a
    global limit. The required User-Agent form is `AppName/Version (ContactEmail)`.
  - Codes are stored the way they normalize them: `0000527000057` (a 12 digit code padded to
    13) and `00032831` (8 digits) both appear as `_id`.

### Target state

`npx nx run-many -t lint test -p luna-shopper/open-facts luna-shopper/contracts` is green, the
library is importable as `@portfolio/luna-shopper/open-facts`, and every acceptance criterion
in section 10 holds.

### Scope

- Work only in: a new `libs/luna-shopper/open-facts/`, `tsconfig.base.json` (two path aliases),
  `libs/luna-shopper/contracts/src/lib/barcodes/` (new), and the contracts barrel.
- Do NOT touch: the harvester, catalog, the gateway, any other source library, `package.json`,
  any `plans/` file other than this one.

### Constraints

- Framework free, the same hard constraint as its five siblings: no TypeORM, no Nest, no
  database, no network in a test. State it in the barrel's doc comment.
- **Node only.** The export reader imports `node:zlib`, so this library must never be imported
  by an Angular app. State that in the barrel too. `barcodeKey` is in contracts precisely so a
  browser can have it without this library.
- No new dependency. No Parquet, no DuckDB, no CSV parser.
- Never look a product up by name. There is no search by text in this library's public
  surface, and section 6 says why.
- The request floors of section 3.3 are clamped up and never down, the rule
  `CARREFOUR_MIN_DELAY_MS` already follows.
- Fixtures are written verbatim by the capture tool and never edited by hand.

### Action boundaries

- Proceed with everything in scope, including running `capture-fixtures` once against the live
  services. It makes about ten requests and downloads one beauty delta file.
- Do NOT download the food export while building. It is 13 GB. The reader is proven on the
  beauty fixture and on a synthetic stream.
- Stop and ask if a fixture shows that a line no longer starts with `{"_id":"`, because
  section 3.1 depends on it, or if the multiple barcode search stops answering.

### Progress evidence

Report after `barcodeKey` with its case table, after the export reader with its spec, after the
client, and after the normalizer with the fixtures captured. Each report cites the test output.

## 1. What is being built

| Piece                                          | Where                                         |
| ---------------------------------------------- | --------------------------------------------- |
| `barcodeKey`, `isRestrictedBarcode`            | `contracts/src/lib/barcodes/barcode-key.ts`   |
| `OPEN_FACTS_DATASETS`, the dataset table       | `open-facts/src/lib/datasets.ts`              |
| `readProductLines`, `readExport`, `readDeltas` | `open-facts/src/lib/export-reader.ts`         |
| `listDeltas`, `deltasSince`                    | `open-facts/src/lib/delta-index.ts`           |
| `OpenFactsClient`                              | `open-facts/src/lib/open-facts.client.ts`     |
| `normalizeProduct`, `OpenFactsProduct`         | `open-facts/src/lib/normalize.ts`, `types.ts` |
| `imageAddress`, `productPageUrl`               | `open-facts/src/lib/images.ts`                |
| `capture-fixtures`                             | `open-facts/tools/capture-fixtures.ts`        |

## 2. One key for a barcode

Their databases and ours write the same barcode differently. They pad a 12 digit code to 13
digits and keep an 8 digit code at 8. A chain prints whichever form its till uses. Under the
GS1 rules a code and the same code with leading zeros are one number, so:

`barcodeKey(text)` strips everything that is not a digit, strips leading zeros, and answers the
rest. It answers `null` when fewer than 8 digits remain, when more than 14 were given, or when
`isRestrictedBarcode` is true.

`isRestrictedBarcode(text)` is true for a number a shop assigns to itself, which is unique
inside one chain and means something else in the next. **It is decided on the number and never
on how the number was written**, so both rules read `p`, the stripped digits padded back to 13:

| `p`                                                   | Meaning                              |
| ----------------------------------------------------- | ------------------------------------ |
| starts `2`, `02` or `04`                              | in store and variable weight numbers |
| starts `00000` and its last 8 digits start `0` or `2` | in company numbers of the short form |

Those are the GS1 prefixes 200 to 299, 020 to 029 and 040 to 049, and the short form's prefixes
0 and 2. `02345673` and `0000002345673` are one number, and both answer `null`.

A counter product weighed in one Mercadona and a record somebody typed into Open Food Facts
under the same digits are two different products. A wrong join here writes the wrong photo and
the wrong allergens onto a product, so the key refuses the whole range instead of trusting it.

The function lives in contracts, beside `brandKey` and exposed the same two ways, because
catalog (plan `0127`) has to make the same key the harvester made and neither imports the
other. `barcode-key.cases.json` is the case table, and it includes the two codes measured above
and one code from each restricted range.

## 3. Three readers, one document shape

All three hand back the same thing, the raw product document as their server wrote it, as
`Record<string, unknown>`. The normalizer of section 4 is the only place that reads fields.

`OPEN_FACTS_DATASETS` is a table keyed `FOOD` and `BEAUTY`, and `OpenFactsDataset` is the type of
its keys. Each row holds the API host, the
static host, the image host, the export file name and the delta file prefix. A third database
of theirs is a third row. No other file names a host.

### 3.1 The export

`readExport(dataset, wanted, onProduct, options)` requests the JSONL export, pipes the body
through `zlib.createGunzip()` and `readline`, and calls `onProduct(document)` for every line
whose code is wanted. `wanted` is a `ReadonlySet<string>` of `barcodeKey` values.

**A line is parsed only when it is wanted.** The reader takes the code out of the fixed prefix
`{"_id":"` with a slice, makes its key, and tests the set. The food export is about four and a
half million lines and we hold a few thousand barcodes, so parsing every line spends most of an
hour on documents that are thrown away. A line that does not start with the prefix is counted
in `malformed` and skipped, and the answer reports
`{ lines, matched, malformed, bytes, lastModified }`, where `lastModified` is the file's
`Last-Modified` header. Plan `0128` takes its watermark from it.

`options.onProgress(lines)` is called every 50,000 lines, and the reader awaits what it returns
before it reads on. The food export takes longer than the harvester's stale run limit, and the
caller uses this to say that it is still reading, which in the harvester is an asynchronous
write.

Nothing touches the disk. The stream is abandoned through `options.signal`, and a body that ends
before the gzip trailer rejects with `OpenFactsTruncatedError`, because a short read that looks
like a finished read marks thousands of products as absent.

`readProductLines(stream, wanted, onProduct)` is the same loop over any readable stream, which
is what the specs and the delta reader use.

### 3.2 The deltas

`listDeltas(dataset)` reads `delta/index.txt` and answers `{ fileName, from, to }` for every
line of the form `<prefix>_products_<from>_<to>.json.gz`, where both numbers are UNIX seconds.

`deltasSince(deltas, since)` answers the files needed to cover everything after `since`, oldest
first, or `null` when the oldest file starts after `since`. `null` means the window was missed
and only the export can answer. The caller decides what to do with that: this library never
falls back by itself.

`readDeltas(dataset, files, wanted, onProduct, options)` reads the files in order with the same
line rule. A product changed twice is delivered twice, oldest first, so the last call wins.

A delta says nothing about a deleted product. Plan `0128` section 7 records what follows.

### 3.3 The API

`OpenFactsClient` has two methods and no more:

- `product(dataset, code)` reads `GET /api/v2/product/<code>.json` and answers the document, or
  `null` for their `status: 0`.
- `products(dataset, codes)` reads `GET /api/v2/search?code=<comma separated>&page_size=100`
  for at most 100 codes and answers the documents found. It sends no `fields` parameter, so the
  documents are whole.

The options are `LidlClientOptions` without the LIDL specific fields. Two floors are constants
and are clamped up, never down: `OPEN_FACTS_PRODUCT_MIN_DELAY_MS = 4000` and
`OPEN_FACTS_SEARCH_MIN_DELAY_MS = 6000`, which are their published 15 and 10 a minute. They are
enforced inside the client **in addition to** `acquire`, because the limit is per IP address
and the harvester's bucket is per run.

429 and 503 retry with the backoff every sibling client uses. `OpenFactsHttpError` carries the
status. The User-Agent is whatever the caller passes, and the capture tool defaults it from
`HARVEST_USER_AGENT` as its siblings do.

Their documentation asks that anything above a few hundred products comes from the export. The
client is for a product added today and for one refresh from the back office. The doc comment on
the class says so, and plan `0128` is where that rule is enforced.

## 4. What a document becomes

`normalizeProduct(document, dataset)` answers an `OpenFactsProduct`, or `null` for a document
with no usable code.

| Field                                          | From                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| `dataset`, `code`, `key`                       | the argument, `code`, `barcodeKey(code)`                  |
| `revision`                                     | `rev`                                                     |
| `sourceModifiedAt`                             | `last_modified_t`                                         |
| `mainLocale`                                   | `lc`                                                      |
| `names`                                        | every `product_name_<xx>`, plus `product_name` under `lc` |
| `genericNames`                                 | every `generic_name_<xx>`                                 |
| `brands`                                       | `brands` split on commas, trimmed, as printed             |
| `quantity`                                     | `quantity`, verbatim                                      |
| `productQuantity`, `productQuantityUnit`       | the two fields of those names                             |
| `servingSize`                                  | `serving_size`                                            |
| `categories`, `labels`, `countries`, `stores`  | the `_tags` arrays                                        |
| `origins`, `packaging`                         | the `_tags` arrays                                        |
| `categoriesText`, `labelsText`                 | `categories`, `labels`, the text a person typed           |
| `ingredients`                                  | every `ingredients_text_<xx>`                             |
| `allergens`, `traces`, `additives`, `analysis` | the `_tags` arrays                                        |
| `nutriments`                                   | every `<name>_100g`, `<name>_serving` and `<name>_unit`   |
| `nutritionPer`                                 | `nutrition_data_per`                                      |
| `nutriScore`                                   | `nutriscore_grade` when it is `a` to `e`, else null       |
| `novaGroup`                                    | `nova_group` when it is 1 to 4, else null                 |
| `environmentalScore`                           | `environmental_score_grade`, else `ecoscore_grade`, when it is `a` to `f`, else null |
| `periodAfterOpening`                           | `periods_after_opening`, beauty only                      |
| `images`                                       | section 5                                                 |
| `completeness`                                 | `completeness`                                            |
| `raw`                                          | section 4.1                                               |

Tags stay tags (`en:tomato-sauces`). Turning a tag into a Spanish word needs their taxonomy
files, which is a plan of its own (section 6).

Every reader of a field goes through one `text()`, `number()` or `tags()` helper that answers
null or an empty array for anything of the wrong type. Their documents are typed by volunteers
and by several generations of their own server: `nova_group` arrives as a number, a string and
an empty string.

### 4.1 The raw document

`raw` is the document with the noise removed, so that "fetch everything" means everything a
person wants to read and not their server's bookkeeping. `RAW_DROPPED` names what goes: keys
that end `_debug_tags`, `_prev_tags`, `_next_tags` or `_hierarchy`, keys that start
`ingredients_text_with_allergens`, and `category_properties`, `categories_properties`,
`popularity_tags`, `unique_scans_n`, `scans_n`, `sortkey`, `editors`, `editors_tags`,
`informers_tags`, `correctors_tags`, `checkers_tags`, `photographers_tags`, `entry_dates_tags`,
`last_edit_dates_tags`, `last_image_dates_tags`, `misc_tags` and `states`.

The spec asserts the size of `raw` for the largest fixture and the capture tool prints it, so
the number that plan `0127` sizes its table by is measured and not guessed.

## 5. Where a photo is

A document's `images` object holds two kinds of key. Numbered keys are uploads. Named keys such
as `front_es` are the crops their contributors selected, with `imgid`, `rev` and `sizes`.

`images` in the product is one entry per selected crop:
`{ role, locale, imageId, revision, width, height, sizes }`, where `role` is `FRONT`,
`INGREDIENTS`, `NUTRITION` or `PACKAGING` and `sizes` is the subset of `100`, `200`, `400` and
`full` the document lists. Uploads are not listed: they are in `raw` for whoever wants them.

`imageAddress(dataset, code, image, size)` builds the address their documentation describes:
the code padded to 13 digits and split `3/3/3/rest`, a code of 8 digits or fewer used whole,
then `<role>_<locale>.<revision>.<size>.jpg` on the dataset's image host. The revision is part
of the address, so an address never changes what it shows and a changed photo is a changed
address. Plan `0129` relies on that.

This library does not choose which crop an item shows. It lists every crop, and catalog chooses
(plan `0127`, section 3), so that the rule lives in one place.

`productPageUrl(dataset, code)` is the page a credit links to. The text of the credit itself,
the database names and the two licenses, is `ITEM_FACTS_ATTRIBUTION` in contracts (plan `0127`,
section 5.5), because a client needs it and a client cannot import this library. The barrel's
doc comment states that showing any of this data or a photo is an obligation to show that
credit, the way `osm-places` states it for `OSM_ATTRIBUTION`.

## 6. What the library does not do

- **No search by name.** Plan `0085` tried it: the search answered a United States can of Pepsi
  for `pepsi 1.75`, and a wrong barcode merges two products in the one field that joins chains.
- **No walk of their catalog.** 371,634 food products are tagged for Spain. They belong to no
  chain, they vary in quality, and copying them makes our whole catalog a derived database under
  share alike. We read what we already hold a barcode for.
- **No CSV and no Parquet.** The CSV is a tenth of the size but has one name, one ingredient
  text and no photo list. Parquet needs a native dependency, and Hugging Face answered 429 to
  ranged reads when `backlog/0013` measured it.
- **No writes.** They accept contributions. We send none.
- **No taxonomy.** A tag stays a tag. A plan of its own maps tags to words in a language.
- **No third database.** Open Products Facts and Open Pet Food Facts are one row each in
  `OPEN_FACTS_DATASETS` when somebody wants them.

## 7. Fixtures

`tools/capture-fixtures.ts`, run by hand through the `capture-fixtures` target, sequential,
paced by the floors of section 3.3, each fixture annotated with why a test needs that shape:

- `product-food-hacendado.json`: `8480000160072`, a Spanish record with three selected crops.
- `product-food-missing.json`: a well formed barcode they do not hold, for `status: 0`.
- `product-beauty.json`: one beauty record with `periods_after_opening`.
- `product-food-sparse.json`: a record with no name in any language and no photo.
- `search-three-codes.json`: the multiple barcode search.
- `delta-index-beauty.txt` and one beauty delta file, stored compressed as it arrived.
- `export-head-beauty.jsonl.gz`: the first 200 lines of the beauty export, cut at a line end and
  compressed again by the tool. This is the one fixture the tool makes and does not copy, and
  its annotation says so.

## 8. Tests

- `barcode-key.spec.ts` over the case table: padding forms agree, including for a restricted
  number written at 8 and at 13 digits, short input, long input, every restricted prefix,
  punctuation and spaces.
- `export-reader.spec.ts`: matches by key across padding forms, never parses an unwanted line
  (a wanted set of one and a line of invalid JSON that is not wanted), counts a line with no
  prefix as malformed, rejects a truncated gzip body, stops on abort.
- `delta-index.spec.ts`: parses the index, orders oldest first, answers null when the window was
  missed, and ignores a line of another form.
- `open-facts.client.spec.ts` with a fake `fetch`: both methods, `status: 0`, the two floors
  clamped up, more than 100 codes refused, retry on 503, the User-Agent header.
- `normalize.spec.ts` over every fixture: every row of the table in section 4, the wrong typed
  fields, `raw` without the dropped keys, and the size assertion of section 4.1.
- `images.spec.ts`: the address of the measured Hacendado front crop is exactly
  `https://images.openfoodfacts.org/images/products/848/000/016/0072/front_es.100.400.jpg`, an 8
  digit code is not split.
- `live-source.spec.ts`, skipped unless an environment flag is set, as in `lidl`.

## 9. Verification

```sh
npx nx run-many -t lint test -p luna-shopper/open-facts luna-shopper/contracts
npx nx run luna-shopper/open-facts:capture-fixtures
```

## 10. Acceptance criteria

- [ ] `@portfolio/luna-shopper/open-facts` and `@portfolio/luna-shopper/contracts/barcode-key`
      resolve, and the barrel states the framework free rule and the Node only rule.
- [ ] `barcodeKey` answers one key for the padded and unpadded form of a code, and `null` for a
      restricted number however it is written.
- [ ] `readExport` parses only wanted lines, writes nothing to disk, and rejects a truncated
      body.
- [ ] `deltasSince` answers `null` when the oldest delta starts after the asked moment.
- [ ] `OpenFactsClient` cannot be configured below 4,000 ms between product reads or 6,000 ms
      between searches.
- [ ] `normalizeProduct` fills every row of the table in section 4 from the fixtures and never
      throws on a wrong typed field.
- [ ] `imageAddress` reproduces the measured address.
- [ ] No test opens a socket, and `package.json` is unchanged.
