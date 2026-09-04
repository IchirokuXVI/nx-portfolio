# 0083 Reading a leaflet PDF, and Deza as its first chain

Plan `0081` consumes a leaflet document and says plainly that it does not produce one: "It does
not read a PDF. `tmp/leaflet` and the model runs in its README are the producer, and the owner has
said the extraction is manual for now." This plan is the producer, and it moves that step out of
`tmp/` and into the harvester.

Backlog `0001` section 5.3 named the leaflet adapter as the third runtime flavour, fetching a PDF
and running OCR over it. Half of that description survives contact with the measurements below and
half does not. The OCR half is wrong, and section 4 says why.

Deza is the chain that forces the question, because **Deza has no other price source at all**.
Mercadona has a JSON storefront. El Jamon has a leaflet with a text layer on two thirds of its
pages. Deza publishes a 62 page PDF in which every page is a flat image, and nothing else. If the
system cannot read that PDF, the system does not know what Deza charges.

Depends on `0081` for the run mode, the alias ladder, the import schema and the document shape.
Depends on `0080` for the dated price row it eventually writes. Neither is implemented today, so
this plan sits behind both in the build order and is written to their designs, not to the code.

## 1. Deza is a chain with no storefront

Checked on 2026-09-04 against `www.dezacalidad.es`.

- **There is no online shop and no product prices on the web site.** The navigation carries a
  "Productos" link, and no page under it lists a price. Nothing there resembles the endpoints plan
  `0038` section 2.1 uses for Mercadona.
- **The leaflet is the product.** `www.dezacalidad.es/ofertas-folletos/` publishes two of them,
  "Folleto Deza" and "Folleto SuperCash", the second marked as applying to the Quemadas and Sector
  Sur stores.
- The company is `Deza Calidad, S.A.`, Pol. Industrial Las Quemadas, parcela 116, 14014 Cordoba,
  printed on the leaflet's back cover. It is a regional chain, not a national one.

So Deza is exactly the case backlog `0001` section 5.4 calls "no implementation is a real state",
and plan `0081` section 1 already accommodates: a chain that publishes only leaflets carries **no
`SupermarketSource` row at all**. Nothing is scheduled for it, a manual spawn of a crawl mode is
refused, and its prices arrive through `LEAFLET_IMPORT`.

Two consequences for the catalog side, and they need no new code:

- **Its scope is regional.** `PriceScope` for Deza covers Cordoba, not the country. Plan `0080`
  section 6 fans a `NATIONAL` scope out to a chain's scopes. Deza never uses that path.
- **Its locations come free.** A `STORE_DISCOVERY` run over the Cordoba postal codes finds Deza
  stores in OpenStreetMap through the existing Overpass query (plan `0038` section 2.7). That
  mode needs a `supermarketId` and no source, which is already how it works.

**SuperCash is a separate `Supermarket`, not a second scope of Deza.** It carries its own leaflet
with its own prices and applies to a named subset of stores. A scope is a set of locations that
share one price list, and these are two price lists. Treating them as one chain would make every
alias ambiguous about which leaflet printed the name.

## 2. What the PDF turned out to be

Measured on `Folleto-Deza-Septiembre-26.pdf`, 21.4 MB, produced by Flipsnack on 2026-08-28.

| | El Jamon | Deza |
| --- | --- | --- |
| Pages | 40 | **62** |
| Pages with a text layer | 28 | **0** |
| Pages that are one flat image | 12 | **62** |
| Page box | 595 x 842 pt (A4) | **813 x 1788 pt** |
| Aspect | 1.41 : 1 | **2.20 : 1** |
| Native artwork | | 1444 x 3177 JPEG per page |
| Offers | 219 | **250 to 320** (section 2.1) |

The pages are tall because the leaflet is drawn for a phone, one column of four to six tiles that
the reader scrolls. Rendering at **128 dpi** reproduces the artwork at its native 1444 x 3177 and
no higher. `tmp/leaflet` renders El Jamon at 200 dpi. Copying that number here upsamples a
JPEG and pays for the pixels twice.

### 2.1 How many offers

Two measurements bracket it, and neither is exact.

- **145** is the floor: tokens shaped like a price that RapidOCR found across all 62 pages, after
  discarding the ones prefixed `LITRO`, `KILO`, `UNIDAD` or `METRO`. It is a floor because OCR
  loses this leaflet's prices badly, which is section 4.
- **456** is the ceiling: connected orange regions matching the price badge, at least 600 pixels,
  found with OpenCV. It over counts, because the badge's notch splits into pieces and orange
  packaging matches.

Counted by eye, page 5 holds 4 tiles, page 24 holds 4 and page 30 holds 5. At four to six tiles
across 57 content pages the true figure is roughly 250 to 320.

## 3. The text layer is not a fallback here

README section 12 of `tmp/leaflet` reached a careful conclusion on El Jamon: send the page image
to a capable model, and use the text layer as a free cross check, because it carries every number
and disagreeing with it is a cheap signal that a page needs a second look.

**On Deza there is no text layer to disagree with.** Zero pages, all 62 flat. So:

- Every page goes to a model. There is no cheap half and no 69 percent cut.
- The cost is the "worst" column of README section 10, every page an image, for every leaflet.
  Section 8 prices it, and it is still small.
- The free cross check is gone. What replaces it is the arithmetic already printed on the tile:
  the badge footer states a unit price, and `price` divided by the format's size must reproduce
  it. Section 7.4.

## 4. OCR does not enter this image

Backlog `0001` section 5.3 assumed a leaflet adapter runs OCR, and expected that to be the thing
that makes the harvester image the largest in the system. The measurements say otherwise.

On El Jamon, README section 7: OCR read **21 percent** of headline prices correctly, against 42
percent for the text layer and 100 percent for a model. The cause is typography. The leaflet sets
a price as a large integer, a small superscript euro sign and smaller cents, and the detector sees
three unrelated shapes.

On Deza the same defect is worse, because Deza's decimal separator is an apostrophe. Over all 62
pages RapidOCR returned `145` for a printed `1'45`, and `100` for `1'00`. On page 5 it found one
of the four prices. A repair pass that crops and re-reads recovers some of them and cannot recover
a whole euro price, which Deza prints often.

**So the harvester gets no OCR engine.** RapidOCR, Tesseract and their models stay out of the
image. The model reads the rendered page directly, which is both more accurate and, once the
renderer is there, less to install. `tmp/leaflet/ocr_extract.py` remains what it is: a measurement
tool that established the baseline, kept for the record, not a thing to port.

The Dockerfile comment at `apps/luna-shopper-backend/harvester/src/Dockerfile` says the image is
built "in its minimal form: HTTP and JSON only, no Chromium and no OCR engine" and that "the
adapter boundary is where that decision belongs, per adapter." This plan is that decision, for
this adapter: a renderer, yes. An OCR engine, no. Chromium, no, and section 10 says why.

## 5. Where the model call lives

`ModelProvider` (208 lines) and `GeminiProvider` (430 lines) sit in
`apps/luna-shopper-backend/assistant/src/app/provider/`. The harvester is a different application
and cannot import them. Three ways out, and the choice matters more than it looks.

| | What it costs |
| --- | --- |
| **a. Extract the client into a library** | One move, two consumers, one place to fix a provider bug. |
| b. Call the assistant over NATS | Makes an interactive service a dependency of a 72 minute batch job. |
| c. A second Gemini client in the harvester | Duplicates 430 lines, including the 429 handling. |

**Take (a).** A new library `@portfolio/luna-shopper/model-client` holds the HTTP client, the
request and reply shapes, and the error types. It is **framework free** in the sense plan `0038`
section 3.3 fixed for `mercadona` and `osm-places`: no Nest, no `ConfigService`, no database, and
every test against recorded fixtures with no network. `GeminiProvider` in the assistant becomes a
thin `@Injectable` wrapper that reads its configuration and delegates, and the harvester writes
its own wrapper beside it. Nothing about the assistant's behaviour changes, which is what makes
this a move rather than a rewrite.

(b) fails on shape rather than on taste. `GeminiProvider`'s documented purpose is a free tier that
"returns 429 in ordinary use", answered with the `retryDelay` seconds from Google's `RetryInfo`,
with the layer above supplying a number when Google does not, "because only that layer knows when
its own window rolls". For an interactive assistant turn that layer is a user waiting. For a 62
page extraction it is a run that should sleep and continue. Those are different policies over one
client, which is an argument for sharing the client and not the service.

(c) is what gets built by accident if nobody decides, and the 429 path is precisely the part that
would be reimplemented worse.

## 6. Rendering a PDF page

The workspace has **no PDF library**. `package.json` carries `ajv`, `ajv-formats` and Playwright
as a dev dependency for e2e, and nothing that reads a PDF.

| Option | Verdict |
| --- | --- |
| **`mupdf` (npm, WASM)** | **Chosen.** No native build, no apt layer. |
| `pdfjs-dist` plus a canvas | The canvas is a native module, built per platform. |
| `pdftoppm` from poppler | An apt layer and a shelled out binary. |

`mupdf` is chosen for a reason beyond packaging: it is the same engine PyMuPDF wraps, and PyMuPDF
is what rendered every page this plan's measurements were taken from. A page rendered at 128 dpi
by the service is the page the fixtures in section 11 were scored against. With any other renderer
that correspondence is an assumption instead of a fact.

The image grows by the WASM module and nothing else. **That growth must be measured and recorded
in the plan's PR**, not estimated here, and the Dockerfile comment quoted in section 4 is updated
to say what the image now carries.

## 7. The extraction run

### 7.1 A separate mode, not a phase of the import

`HarvestRunMode` gains **`LEAFLET_EXTRACT`**, beside the `LEAFLET_IMPORT` that plan `0081` adds.
A run in that mode has `supermarketId` set, `sourceId: null`, a PDF as its input and a leaflet
document as its output. It writes **no prices**. The document it produces is then uploaded through
`0081`'s existing route, by a person who has looked at it.

Fusing the two is the obvious design and it is wrong, for three reasons.

- **Extraction costs money and takes 72 minutes. Import costs nothing and takes seconds.** A
  failed import must not re-run a paid extraction.
- **`0081`'s dedupe would stop working.** Its unique index is on (`supermarketId`,
  `documentSha256`), and a re-extraction of the same PDF produces a *different* document, because
  a model is not byte reproducible even at temperature 0. A fused run would therefore accept the
  same leaflet twice under two digests, which is the exact thing that index exists to refuse.
  Keeping them separate puts the digest on an artifact a person approved.
- **A model reading needs a person to look at it before it moves a price.** Plan `0081` section 3
  already refuses to let a fuzzy name match write a price without an admin. A model reading a
  price off a picture earns the same treatment, and separating the runs is what creates the
  moment to give it.

### 7.2 The input

The PDF arrives on `POST /v1/admin/harvest/leaflets/extract`, `multipart/form-data`, with
`supermarketId` and an optional `profileKey`. Multipart here and JSON in `0081` section 7 is not
an inconsistency: that route carries a JSON document the schema validates, and this one carries 21
MB of binary that no schema describes.

The body limit is its own setting, `LEAFLET_PDF_MAX_BYTES`, default **32 MB**, validated by Joi
like every other number, and refused with the number in the problem document. The Deza file is
21.4 MB. Nest's default JSON parser is not involved.

**The PDF is not stored in Postgres.** `harvest_runs.input` holds the run's parameters and the
document digest, not 21 MB of binary. The file lives for the run's duration only. Re-running an
extraction means uploading the PDF again, which is one action by the same person who has it.

### 7.3 What a run does, in order

1. Open the PDF, count pages, and record per page whether it carries a text layer. This is the
   census of section 2 and it costs nothing.
2. Refuse the run if the page count exceeds `LEAFLET_MAX_PAGES`, default 120. A 500 page file is
   a mistake, and it must be refused before it is paid for.
3. For each page in order: render at the profile's dpi, send the image and the profile's prompt to
   the model, parse the reply as an array of offers.
4. Apply the per page checks of section 7.4. Attach a warning to any offer that fails one.
5. Assemble the document: `retailer`, `validity`, `source` with its `sha256`, `pages` with their
   headings, and every offer with its page number and its `id`.
6. Validate the assembled document against the import schema version the profile names, the same
   `leaflet-import-1.0` that `0081` section 4 puts in `contracts`. A document the importer would
   reject is a failed extraction, found here rather than at upload.
7. Finish `COMPLETED`, with the document as the run's output.

**Progress is per page**, so a 72 minute run reports 17 of 62 rather than nothing. The executor
already carries progress for the discovery runs.

**SIGTERM stops after the current page** and completes the run with the pages already read, marked
partial in its warnings. The Dockerfile's exec form exists for this, and it matters more here than
for a crawl: the pages already read were paid for.

### 7.4 The checks that replace the text layer

Free, arithmetic, and each one produces a warning rather than a correction.

- **Unit price agreement.** When an offer carries `unit_price`, its `per`, and a `format` with a
  parsable size, `price` divided by that size must reproduce `unit_price` within a cent. On the
  three calibrated Deza pages this held on 11 of 11. It is the check that would have caught
  Gemini's `total_price / 2` defect on El Jamon (README section 11).
- **A price with no name, or a name with no price**, is a tile the model half read.
- **Two offers on one page with the same price and the same name.** Section 2.1 of `0081` routes
  a duplicate alias key to the queue. Catching it here names the page.
- **A page that returned zero offers but whose render is not blank.** Page 36 and page 57 of the
  Deza file returned no OCR boxes at all, and a model returning nothing for a page with tiles on
  it is a dropped page, not an empty one.

`second_unit_discount` gets the check README section 11 established, `total_price -
single_unit_price`, which recovered the printed price 5 times out of 5 on El Jamon. It is written
now even though no Deza tile needs it, because the profile mechanism means the next chain's
profile inherits it.

## 8. Cost, and the fourth switch

Measured this session, Gemini 3.5 Flash-Lite over Deza pages 5, 24 and 28, with the profile of
section 9: **2979 input tokens and 393 output tokens per page**, at 42, 79 and 30 seconds.

A tall Deza page costs about **1400 to 1550 image tokens**, against 1573 for El Jamon's A4 page.
The 2.2 : 1 aspect is free, because the model normalizes the image. **Splitting a page in half was
considered and rejected on that measurement**: it would double the call count and buy nothing.

| Model | 62 pages | Per page |
| --- | --- | --- |
| **Gemini 3.5 Flash-Lite** | **$0.12** | $0.002 |
| Claude Haiku 4.5 | $0.31 | $0.005 |
| Claude Sonnet 5 | $1.03 | $0.017 |

Roughly 72 minutes serialized at the measured 69 seconds per page. The free tier answers 429 under
concurrency (the note at the head of `run-gemini-leaflet.mjs` records it), so pages run one at a
time and the run is long by construction.

**`LEAFLET_EXTRACT_ENABLED`, default false**, joins `HARVEST_ENABLED` and `MERCADONA_ENABLED`.
Plan `0038` section 8.1 gave the first two separate switches because bringing a service up and
letting it fetch from a third party are different decisions. This is a third one: **letting it
spend money.** It is the first thing in this system that does, and a switch that means "this pod starts
runs" must not silently also mean "this pod bills an account".

Beside it, two numbers that bound one run: `LEAFLET_MAX_PAGES` (section 7.3) and
`LEAFLET_MODEL_ID`, so the model is configuration and not a literal.

## 9. The reading profile

A profile is what one chain's leaflet needs in order to be read: **a prompt, a model id, a render
dpi, and the import schema version it targets.** It lives in the repository under
`libs/luna-shopper/leaflet-profiles/`, versioned, one directory per chain, exported by key.

**It is code, not configuration in a database.** The prompt decides which printed number becomes a
price. A change to it changes what the system believes Deza charges, and that belongs in a diff a
person reviewed, beside the fixtures in section 11 that prove the change did not make the reading
worse.

### 9.1 What Deza needs that El Jamon did not

`tmp/leaflet/tools/prompt.txt` was written for El Jamon. Four of its assumptions are wrong for
Deza, and each was measured.

| | El Jamon | Deza |
| --- | --- | --- |
| Decimal separator | comma, `2,59` | **apostrophe, `0'79`, `12'95`** |
| `ANTES` struck price | common | **0 pages of 62** |
| `2a unidad`, `Llevando 1 unidad` | 20 and more tiles | **0** |
| `el litro le sale a` | common | **0** |
| Loyalty badge | 6 offers of 48 | **0** |
| Unit price | a comparison line on the tile | **the badge footer** |

1. **The apostrophe is the decimal separator.** A comma in this leaflet is almost always a pack
   size, `1,5 L`.
2. **The orange badge footer is one of two things**, and telling them apart is most of the
   reading. Either the basis of the headline price, written with no number (`EUR/Ud`, `EUR/KILO`),
   or a derived unit price, written as a word and a number (`LITRO 1'18`, `KILO 3'61`,
   `UNIDAD 0'48`, `METRO 0'03`, `LAVADO 0'23`). A footer with a number is never the product price.
3. **A pack size is not a promotion.** Page 24 prints `2x1,5 L` beside `FORMATO DIVISIBLE`, and it
   is a pack of two 1.5 litre bottles. It is the only string in the whole document that matches a
   `2 X 1` pattern, and it is a false match. This is the trap that a rule written for El Jamon
   walks straight into.
4. **Text printed on the packaging is not a Deza promotion.** Page 28 shows `+50% GRATIS` and
   `28+16` on the Ariel bottle. Those belong to the manufacturer's pack, and the leaflet has
   already counted them in the size it states, "44 lavados". Recording them as `pack_bonus` would
   count the same bonus twice. A promotion is what the leaflet prints in its own text, outside the
   photograph.

Rule 4 is the one judgment call in this plan that a reasonable person could decide the other way.
It affects six pages: 17, 28, 29, 41, 48 and 54. It is recorded here so that reversing it is a
decision and not a discovery.

Deza also needs section slugs the schema did not have. `APERITIVOS`, `ELABORADOS CARNICOS`,
`PLATOS PREPARADOS`, `REFRIGERADOS`, `DESAYUNOS Y MERIENDAS`, `LIMPIEZA`, `AMBIENTACION`,
`VUELTA AL COLE`, and an `index` for the two contents pages. All nine are added to
`pages[].section`, and `section_raw` keeps the heading as printed. Those headings are artwork, as
they were on El Jamon: the model reads them and no text layer ever will.

### 9.2 What it scored

Pages 5, 24 and 28, chosen as a plain page, the pack format trap and the packaging flash. 11
offers, read by eye first and then by the model.

| Measure | El Jamon prompt | **Deza profile** |
| --- | --- | --- |
| Offers found | 8/8 | **11/11** |
| Price | 8/8 | **11/11** |
| Unit price | 8/8 | **11/11** |
| Unit price basis | 8/8 | **11/11** |
| Promotion present or absent | 8/8 | **11/11** |
| `basis` | 5/8 | **11/11** |

The first pass scored 5 of 8 on `basis`, and every one of those three was an under specified rule
rather than a misreading: the prompt did not say what a tray of four portions is. The profile now
orders that decision, `EUR/KILO` gives `kg`, a tray or a multipack gives `pack`, anything else
gives `unit`.

**Validity is not on the page.** The only date printed anywhere in 62 pages is "hasta el 15 de
septiembre del 2026" on page 3, and it belongs to the back to school section alone. So
`validity.starts_on` and `ends_on` come back null, and plan `0081` section 5 already requires the
admin's override in exactly that case. The file name carries the month and a file name is not a
date.

## 10. The PDF arrives by hand, and section 12 says why

This plan does not fetch anything. The admin downloads the leaflet and uploads it.

That is not laziness about a small piece of work. `www.dezacalidad.es/folleto-deza/` embeds the
leaflet in a Flipsnack viewer through a CloudFront iframe, the flipbook slugs are not derivable
from a date, the index that lists them renders in JavaScript and returns nothing to a plain fetch,
and the Flipsnack API path a downloader would want is disallowed by that host's `robots.txt`.
Backlog `0012` records all of it with the evidence. Until it is picked up, the manual step costs
one file per month, which is less than a browser in this image costs every deploy.

## 11. Testing

- **The renderer.** A three page PDF extracted from the Deza file and committed under
  `__fixtures__`, rendering at 128 dpi to 1444 x 3177, asserted on dimensions and on a hash of the
  pixels. The full 21 MB file is not committed.
- **The profile, scored.** The reference reading of pages 5, 24 and 28 is committed beside the
  recorded model replies. The scorer asserts 11 of 11 on every measure. **A prompt edit that makes
  the reading worse fails the suite**, which is the whole reason the profile is code.
- **No network in unit tests.** A fake model client returns the recorded reply, exactly as
  `mercadona` and `osm-places` run against fixtures.
- **The checks of 7.4**, each with a constructed reply: a unit price that does not divide, a
  priceless tile, a page that returns nothing, a `second_unit_discount` whose headline is
  `total / 2`.
- **The document validates** against `leaflet-import-1.0` from `contracts`, and a reply that
  cannot be parsed as JSON fails the page with a warning and does not fail the run.
- **The 503 path.** Page 28 answered `HTTP 503` twice in a row during this session's calibration,
  on the free tier, with the message "This model is currently experiencing high demand." A page
  that exhausts its retries is a warning naming the page, not a failed run, and the document is
  emitted without that page's offers. A 62 page serialized run meets this, so it is tested with a
  client that returns 503 then succeeds, and with one that never succeeds.
- **Integration**, in the `test-integration` target against a slot: extract the three page fixture,
  then import the document it produced through plan `0081`'s route, and read the prices back.
- `openapi.json` and `wire-types.ts` regenerated and committed, and `npx nx affected -t lint test`
  green.

## 12. What this does not do

- **It does not fetch the PDF.** Backlog `0012`.
- **It does not write a price.** It produces a document. Plan `0081` writes.
- **It does not decide what a printed number means as a price.** That is `0081` section 6, and it
  runs at import over the document this plan produced.
- **It does not run OCR.** Section 4.
- **It does not put Chromium in the image.** Section 10.
- **It does not run in either cluster.** `harvester.enabled` is false in both values files, and
  `LEAFLET_EXTRACT_ENABLED` is a second false beside it. Plan `0081`'s exit criteria turn the
  first one on. This plan does not turn on the second.
- It does not read the SuperCash leaflet. That is a second profile once the first one has read a
  full leaflet end to end.

## 13. Exit criteria

- A `LEAFLET_EXTRACT` run takes a PDF and a `supermarketId`, needs no `SupermarketSource`, and
  produces a document that validates against `leaflet-import-1.0` without being edited by hand.
- The 62 page Deza leaflet is read end to end, and the resulting document imports through plan
  `0081` for a Deza chain with a regional scope.
- The Deza profile scores 11 of 11 on every measure over the committed three page fixture, and a
  prompt change that lowers any of those scores fails the suite.
- The model client is a library used by both the assistant and the harvester, framework free, with
  no network in its tests, and the assistant's behaviour is unchanged.
- A page renders at 128 dpi to 1444 x 3177, from `mupdf`, matching the fixture hash.
- No OCR engine and no browser is added to the harvester image, and the image size change is
  measured and recorded in the PR.
- `LEAFLET_EXTRACT_ENABLED` defaults to false, a run is refused while it is false, and
  `LEAFLET_MAX_PAGES` and `LEAFLET_PDF_MAX_BYTES` refuse an oversized input with the number in the
  problem document.
- A page that answers 503 until its retries are exhausted produces a warning naming the page, and
  the run completes.
- SIGTERM during a run completes it partially, keeping the pages already paid for.
