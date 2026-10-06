# 0006: the offer tiles a chain shows on its website

> Found by a check of `https://www.dezacalidad.es/ofertas-folletos/` on 2026-10-06. The
> evidence is in the git ignored folder `.curation-runs/2026-10-deza-web-offers/` of the
> main checkout on the developer's machine: `page-2026-10-06.html`, `tiles/` (214 images),
> `readings.txt` (every tile read by eye), `tiles-read.json` and `report.txt`.
>
> Prerequisite reading: plans `0001` to `0005` here and `src/README.md`. Backend plans
> `0085` section 6, `0086` (D2, the file import), `0181`, `0189` and `0190`.
> `libs/luna-shopper/deza/src/lib/size.ts` (`splitSize`, `sizeOf`), `brand.ts`
> (`extractBrand`) and `tools/capture-fixtures.ts`.
> `apps/luna-shopper-backend/harvester/src/app/harvest/matching.ts` (`entryKey`,
> `normalizeName`) and `libs/shared/model-engines/src/claude-cli.mjs` (`images`).

Below its two leaflets, the offers page of Deza lists "OFERTAS DESTACADAS": 214 small
images, one product each. The page states the name of each product as text. The price is
only in the picture. Deza's website catalog prints no price at all, so these tiles are the
first source that can put a price on a product the website walk already bound.

## Brief for the agent

### Objective

Add one command to the leaflet tool that turns the offer tiles of a chain's web page into a
checked `HarvestDocument`: the page gives the product text, a vision model reads the two
numbers of each tile, and the existing file import takes the document. Deza is the first
and only chain.

### Context

Every number below was measured on the page of 2026-10-06.

- **The markup.** Each tile is `<li id="banner-N"><a class="fancybox" href="IMG"><img
  src="IMG" title="TEXT" alt="TEXT"/></a></li>`. `IMG` is
  `https://dezacalidad.es/wp-content/uploads/carteles/06-10-2026/C_PQC75211.png`, 245 by 235
  pixels. The folder is a date and the file name holds the article code of the chain. 214
  tiles, 214 distinct codes.
- **The text is the website's own description.** `alt` is the product name plus its format,
  in the wording of the website catalog: `Queso para untar PHILADELPHIA salmón 150 g`. The
  harvester keys a Deza row on `entryKey(name, sizeFormat)`, and the walk gets both halves
  from `splitSize`. So a tile with the same text lands on the row the walk made. 187 of 214
  tiles matched a website row of local slot 1 by text, and 184 of those rows were bound to
  a product. **Not confirmed:** that count through `splitSize` and `entryKey` themselves.
  Target state 9 measures it.
- **The page loses every accented letter.** The server writes a literal `?` for each one:
  `GARC?A BAQUERO`, `Anguri?as`. `normalizeName` would read `GARC?A` as `garc a`, which is
  not `garcia`, so the `alt` alone cannot build the key for 88 of the 214 tiles.
- **The picture prints the same text with its accents.** Three lines at the bottom right:
  the name, the brand in bold, then the rest and the format. Read in that order they equal
  the `alt` on 212 of 214 tiles, with each `?` standing for one letter. The other two say
  `Queso mezcla curado` where the `alt` says `Queso curado`, and the website row agrees with
  the picture.
- **The price.** An orange badge at the top right holds the price with an apostrophe as the
  decimal mark: `3'65`. Under it, on 176 tiles, a smaller line states a comparison price:
  `kilo 16'22 €`. The labels seen are `kilo` (123), `litro` (37), `100 ml` (7), `lavado`
  (4), `unidad` (3), `metro` (1) and `100 g` (1). 38 tiles print none.
- **A tile sold by weight.** 24 tiles print `-kg-` or a bare `kg` in the text and no
  comparison line. The badge is then the price of a kilo. The website row of such a product
  ends in `kg` and has no format.
- **The numbers can be checked.** On 166 of 168 tiles with a weight or a volume, the price
  over the size equals the printed comparison price. The other two are inconsistent on the
  page itself (`2 patas 160-200 g`, and a `500 g` cake priced as 550 g).
- **The leaflet agrees.** 109 tiles are an offer of the October leaflet, and all 109 show
  the price the leaflet read gave. The leaflet joins variants in one offer (`Salchichas
  maxi original o queso`). The tiles state each variant alone.
- **No date is printed.** The only date is the folder name.
- **The article code joins nothing today.** The website catalog prints no code, and no
  stored row holds one. It is the identity of an offer from one week to the next, and
  nothing else.
- **An engine call takes several images.** The `claude` and `api` engines of
  `libs/shared/model-engines` accept an `images` list, so twelve tiles go in one call with
  no contact sheet.

### Target state

1. **The Deza library parses the page.** `libs/luna-shopper/deza` gains `offers.ts` with
   `DEZA_OFFERS_PATH` and `parseOfferTiles(html)`. It answers one object per tile: the
   position, the article code, the image URL, the `alt` exactly as sent, and the day the
   folder names. `capture-fixtures.ts` captures the page as `offers-page.html`, and the spec
   reads that fixture. A page with no tile answers an empty list.
2. **One function restores the text.** `restoreTileText(alt, readText)` in the same file
   answers `readText` when it equals `alt` with every `?` standing for exactly one
   character, compared after whitespace is folded and `-kg-` is read as `kg`. It answers
   null otherwise. It never guesses a letter.
3. **A command reads the tiles.** `nx run luna-shopper/leaflet-cli:offers -- --chain deza
   --out <dir>` does these steps in order, and each one can refuse:
   1. Fetch the page, or read `--html <file>`.
   2. Download each image to `<out>/tiles/`, one request at a time, or read `--tiles <dir>`.
      An image already there is not fetched again.
   3. Read. Twelve tiles per model call, in page order, writing
      `<out>/import/batch_NN.json` as it goes. The answer is one row per image: the price,
      the comparison price and its label or null for both, and the three text lines joined
      in reading order.
   4. Check (target 6).
   5. Build the document (targets 4 and 5), then run `validate.mjs` on it.
   6. Report what was read, every tile to look at, and the document's path.
   `--resume`, `--engine`, `--model`, `--valid-from` and `--valid-until` behave as they do
   for the `read` command. The default engine is `claude` with model `sonnet`.
   `--engine manual` writes `<out>/PROMPT.md` and stops, and `--finish` picks the batch
   files up.
4. **A tile becomes one product of the document.**
   - The description is the restored text. When target 2 answers null, the description is
     the text the model read, and the report names the tile with both texts.
   - `name` and `size.label` come from `splitSize` of the description. The size quantity
     and unit come from `sizeOf`. `brand` comes from `extractBrand` of the name. These are
     the three functions the website walk uses. Do not copy any of them.
   - `price` is the badge. `unit_price` is the comparison line, with the label as printed.
   - A tile sold by weight (a `kg` word with no number before it, and no comparison line)
     states `unit_price` alone with the label `kg`, no `price` and no size quantity. That
     is rule 3 of the README and the rule of plan `0005`.
   - `extra` holds the article code, the image URL, the `alt` as sent, the position, the
     folder day, the engine and each check the tile failed.
5. **The document says what it is.** `hints.source_kind` is `OFFICIAL_LEAFLET` (decision A).
   `sha256` is the hash of the ordered list of the image hashes, so the same set of tiles
   is the same document and the import refuses it twice. `producer.name` names the page,
   the folder day, the tile count and the engine. `validity` follows decision B.
6. **Four checks, and none edits a row.**
   - Every tile has exactly one answer. A missing one stops the build.
   - The text check of target 2.
   - For the labels `kilo`, `litro`, `100 ml` and `100 g`: the price over the size is the
     comparison price, within 2 percent plus 0.02. A tile that fails is named in the
     report with both figures and stays in the document.
   - A label that `unitBasisOf` in `libs/luna-shopper/contracts` does not read is named
     once. Today that is `metro`.
7. **A chain folder for the tiles.** `chains/src/deza/offers/prompt.txt` and `layout.md`
   describe one tile: the badge, the apostrophe, the comparison line, the three text
   lines. No `baseline.json` and no drift check: the tile count is whatever the chain
   publishes that week, and target 6 is the check.
8. **The command never uploads.** It prints the back office call, as `read` does.
9. **Measured once, on the saved page.** Run the parse and the build on
   `.curation-runs/2026-10-deza-web-offers/` with `readings.txt` standing in for the model,
   and count the keys that equal a Deza row key of
   `.curation-runs/2026-10-audit-repair/stage-b/rows-snapshot.after-deza.json`. State the
   count in the pull request. The text match was 187.

### Scope

- In: `libs/luna-shopper/deza` (`offers.ts`, its spec, the fixture, `capture-fixtures.ts`,
  `index.ts`), `libs/luna-shopper/tools/leaflet/cli` (the command, its specs, `project.json`,
  the README) and `libs/luna-shopper/tools/leaflet/chains/src/deza/offers/`.
- Out: the harvester, the gateway, catalog, the `HarvestDocument` schema,
  `libs/shared/model-engines`, the `read` command and its chain files, the back office,
  other chains.

### Constraints

- No new npm dependency. The tool shells out or uses Node, as it does today.
- The Deza library stays framework free and its specs read fixtures with no network.
  Refresh a fixture with `capture-fixtures`, never by hand.
- **How the `.mjs` command reaches the TypeScript library is not confirmed.** `validate.mjs`
  runs under `node --experimental-strip-types`, and `capture-fixtures` runs under `tsx`.
  Use whichever loads `libs/luna-shopper/deza/src/index.ts` whole. A second copy of
  `splitSize` or of the key is not an answer.
- Commit no tile image. The pictures are the chain's. A spec that needs an image builds a
  small synthetic PNG.
- One request at a time to the chain, through the Deza client. **Not confirmed:** that the
  page and the images answer the client's user agent. The check of 2026-10-06 sent a
  browser one.
- No automated match binds a printed name to a product (CLAUDE.md). This tool writes a
  file. The import decides what a row is.
- Only make changes directly requested.

### Action boundaries

- Proceed with code, specs, the fixture capture (one page request) and the measurement of
  target 9.
- **At most three model calls**, on 36 saved tiles from `tiles/`, to compare the default
  engine with `readings.txt`. Stop and ask before more.
- Do not upload a document to any stack. Do not start or touch slot 0, Luna slot 1 or Luna
  slot 3.
- Stop and ask before a change to the document schema, to the engines library, or to
  anything in the harvester.

### Progress evidence

- `parseOfferTiles` on the captured fixture: the tile count, distinct codes, one folder day.
- `restoreTileText`: an accented word, a tile with two `?`, `-kg-` against `kg`, and a
  text with one word more, which answers null.
- A build spec over six hand written readings: a priced pack, a tile sold by weight, a
  `100 ml` label, a tile whose text differs, a tile whose arithmetic fails, and `metro`.
- The command refuses a batch with a missing tile, and a resume keeps the batches read.
- `npx nx test` passes for `luna-shopper/deza` and `luna-shopper/leaflet-cli`.
- The count of target 9, and the agreement of the 36 tiles with `readings.txt`, price by
  price, both pasted in the pull request.

## 1. Why this is a tool and not a harvest run

The harvester fetches and parses. It holds no model and no key for one, and plan `0086`
gave a file every source that needs a reader. A tile needs a reader for two numbers. So
the producer is the operator's tool, and the harvester sees a `HarvestDocument` like any
other. Nothing in the backend changes for this plan.

The two halves of a tile fail in different ways, and the design keeps them apart:

- **The text decides the row.** It comes from the page and is proven against the picture.
  A wrong text makes a new row in the queue. It cannot bind a price to the wrong product.
- **The model decides the price.** A wrong digit is a wrong price on the right product.
  The arithmetic check catches it on the 168 tiles that print a comparison price, and
  nothing catches it on the others. Section 3 says what that leaves.

## 2. What waits on backend plan 0190

**Do not import a tile document into a stack that lacks backend `0190`.** On 2026-10-06
that plan is written and not built. It waits for backend `0191` (pull request #652).

A tile lands on the website's row on purpose. Without `0190` the last writer owns the row:
the import turns up to 187 website rows into leaflet rows and rewrites their name, brand
and size from the tile. With `0190`, a leaflet observation of a row that a walk owns moves
the seen fields, writes its price under its own kind, and leaves the text alone.

Nothing in this plan's Scope needs `0190`. The tool is built and tested without it. What
is left out until then is the one check that needs a stack: a real import of a tile
document on an ephemeral slot that already holds a Deza website run.

Two things to read on that first import. Neither is confirmed.

- A tile sold by weight lands on a website row whose `soldByWeight` is false, because the
  walk prints no price. `0190` keeps the leaflet from writing that flag on a row a walk
  owns. Check that the per kilo price is still published per kilo (plan `0181`).
- `0190` keeps one price row per row, scope and kind. A tile and the leaflet are the same
  kind (decision A), so the later import replaces the earlier price on the 109 shared
  offers. The prices are equal today. The validity window is not.

## 3. Decisions for the owner

Each has a recommendation that the builder follows unless the owner says otherwise.

**A. The kind of a tile price.**

- Recommended: `OFFICIAL_LEAFLET`. A tile is an offer the chain published for a short time,
  read from a picture by a model. That is what `0190` means by a leaflet: it adds a price
  and never owns the text of a row.
- The other choice is a new kind for web offers. It needs an enum value, a migration and a
  place in the price policies of plan `0080`, and it lets a tile and a leaflet keep one
  price each for one product. That is a backend plan, not this one.

**B. The validity window.** The tiles print none, and the import refuses a null bound.

- Recommended: `validity.from` is the folder day. `validity.until` comes from
  `--valid-until`. Without the flag the document states no window, with a warning, and the
  person who uploads supplies it. A made up end date would sit on 214 prices.
- Not known: how often the folder day changes, and so how long a tile is true. Two captures
  a week apart answer it.

**C. A tile and a leaflet offer for one product.** Recommended: import the leaflet first
and the tiles after it. Where both state a product, the tile is the later and the cleaner
statement.

**D. The 38 tiles with no comparison price.** 24 are sold by weight and 14 are packs of
one litre or one kilo, where the price is its own comparison price. Recommended: accept them as read.
A second read by another model is the alternative, at twice the calls.

## 4. Not in this plan

- The SuperCash leaflet and any tile it has.
- The article code as a row key. It becomes one only when the website catalog prints it.
- A run on a schedule. A person starts the command and uploads the document.
- The offers pages of other chains.
- The `metro` label in the unit basis table.
