# What a LIDL leaflet page looks like

Read this before the first three page images of a new LIDL leaflet. If the
pages do not match this description, stop and report before reading any
further page: the reading process assumes this layout, and a page that breaks
it will misread quietly rather than loudly.

- **The page is tall and narrow** (467 x 794 pt, A4 portrait at a slightly
  narrow width), one page at a time and never a two page spread. It is cut
  into full bleed colour panels, red, yellow, blue or a photograph, and each
  panel holds one product tile. Two to eight tiles a page, five on a typical
  grocery page and two on a fresh food page that gives half the sheet to a
  photograph.
- **Every page carries a text layer.** All 55 pages of the September 2026
  leaflet did, so the census is a check rather than a filter. The text layer is
  worth reading before the images: it names the department banner, the printed
  validity line and the edition code cheaply.

## The price

- **The price is the largest number on the tile, and it has no badge around
  it.** It is set in the panel itself, euros large and cents smaller and
  raised, and its colour follows the panel: yellow on red or blue, red on
  yellow or white. There is no shield, no box and no footer strip. Nothing else
  on the tile is set anywhere near that size.
- **The headline price uses a period and everything else uses a comma.**
  `3.09`, `0.99`, `12.99` in the big number; `5,70 €/kg`, `La ud sale a
0,66 €` in the small print beside it. Both appear on the same tile. This is
  the trap of this leaflet: a reader that normalises one separator for the
  whole page will get one of the two families wrong.
- **A trailing dash means no cents.** `1.-` is 1.00, `7.-` is 7.00, and in the
  comparison line `29,- €/kg` is 29.00 per kilo.
- **A small struck through number sits to the right of the price.** What it
  means depends on the flag above it, and that is the single most important
  distinction on the page. See the two flags below.
- **A small word runs vertically up the left edge of the price**, in the same
  colour: `ud`, `pack`, `kg`, `1 kg`, `500 g`, `aprox. 300 g`, `2ª ud`. That
  word is the basis: what the number buys.
- **An asterisk after the price** (`0.99*`, `1.99*`) points at the page
  footer, `*Artículos limitados hasta fin de existencias`. It is a stock
  caveat, not a promotion.

## The two flags, and why they are not the same thing

- **`Con Lidl Plus -NN%` beside the blue `Lidl Plus` logo is the loyalty
  mechanic.** The big number is the app price. The struck number beside it is
  the shelf price, which is what a shopper without the app pays, and it is the
  only number on the tile a non member can be charged. Roughly a third of the
  priced tiles carry this flag.
- **A plain `-NN%` flag, or `Bajada permanente`, or `Oferta`, with no Lidl Plus
  logo, is a price cut for everybody.** Here the big number is the price and
  the struck number is the old price.
- The two render identically apart from the logo and the words `Con Lidl
Plus`. **The logo is what tells them apart, and reading the struck number as
  an old price on a Lidl Plus tile inverts the offer.**
- `Superprecio` is a flag with no struck number beside it. It is a slogan.

## The comparison figures

- They are printed in the product's own text block under the size, never in a
  badge: `5,70 €/kg`, `3,63 €/l`, `2,03 €/100 g`, `1 ud 7,48 €/kg / 2 uds
5,62 €/kg`, `1 a 2 uds 3,75 €/100 g / 3 uds 2,75 €/100 g`.
- **When two are printed, separated by a slash, the first is struck through
  and the second is not.** The struck one belongs to the struck number and the
  unstruck one belongs to the big number, on a Lidl Plus tile and on a plain
  discount tile alike. One printed figure always belongs to the big number.
- The leaflet abbreviates the basis (`€/kg`, `€/l`) where Deza spells it out
  (`KILO`, `LITRO`). The shared `PER_WORDS` table in `build-document.mjs`
  reads the spelled out word and has no entry for `kg` or `l`, so this chain's
  prompt asks for the word as a prefix and the printed text after it:
  `KILO 5,70 €/kg`. Drop the prefix as soon as that table learns the
  abbreviations.
- The leaflet misprints one of its own: page 12 of the September 2026 leaflet
  reads `13,99 €/g` for a 350 g pack priced at 4.90. Copy what is printed and
  do not correct it.

## Promotions

- **`-NN% 2ª ud`** is the second unit offer, and it is the one that must not be
  misread. The big number is the price of the second unit, the vertical word
  beside it is `2ª ud`, and `1 ud` with a smaller number to its right is what
  one unit costs. That smaller number is the one a shopper pays for one.
- **`Llévate N por X.-`** is a multibuy total, with `La ud sale a Y €` in a
  flag and `1 ud sale a Z` running vertically beside the price. `Z` is what one
  unit costs on its own.
- **`Pack 3`, `Pack 12`** in a yellow tag on the photograph name the pack size.
  They are not a promotion, and the size the tile states already counts them.
- **`Por tiempo limitado`**, in a yellow diamond, dates the offer rather than
  discounting it.
- Everything else on a tile is provenance or certification and never an offer:
  `Origen España` in a yellow diamond, `Categoría: I.`, `Precio por kg`,
  `3 kg`, the GGN, MSC, ASC, Bienestar Animal and Sabor del Año logos, the
  `Nº1 CALIDAD PRECIO` seal, and the `Karlos Arguiñano` and `Joseba Arguiñano`
  signatures.
- **`¡Dobla tus puntos Lidl! x2` is a full width blue band, not a tile.** It
  runs along the foot of most odd numbered pages and offers points, not a
  price.

**A conditional tile reaches the document with no price today, and that is the
builder rather than the leaflet.** `build-document.mjs` carries only a
promotion's `type` and `rawText` into the offer it assembles, so the
`singleUnitPrice` the reading captured never reaches
`to-harvest-document.mjs`, and its rule 2 records "no single unit price" for a
tile that printed one plainly. Deza prints almost no promotions and never hit
it. LIDL prints a handful a leaflet, so expect one warning and one missing
price per second unit or multibuy tile until the builder forwards the field.
The reading stays truthful either way: it states the conditional type and the
single unit price, and a missing price is the safe direction.

## The heading banner

- **LIDL prints a marketing headline, not a department name.** `Elige la mejor
fruta`, `Yo elijo ahorrar con el mejor pescado fresco`, `Prepara el mejor
bocadillo`, `Cuidarte por dentro vale la pena.` Each names a product family
  and each is worded differently from one leaflet to the next, which is why
  `headings.mjs` will always be behind and why a heading it cannot resolve is
  ordinary here rather than alarming.
- **Some headlines name no department at all**: `Batimos el récord del ahorro`,
  `Récord en ofertas`, `Récord en precios imbatibles`, `Bajadas permanentes`,
  `Súper finde`, `Tus otras marcas de siempre`, `¡Los Nº1 de la semana!`. The
  pages under them mix departments freely, so the prompt asks for an empty
  category path rather than a slogan.
- **The banner spans a spread and only the left page prints it.** Roughly half
  the pages, most of the odd numbered ones, carry no banner of their own and
  continue the one before. A page reader sees one page and cannot know that, so
  those pages give an empty category path too. Naming them belongs to the
  leaflet's own `fixed_sections` if the owner wants them categorised.
- The banner sits at the very top, in 30 to 90 pt type, above every tile.

## Dates, editions and regions

- **A red or yellow strip across the top of every page prints the window**:
  `Desde el lunes 7/9 hasta el 13/9`. The year is nowhere on the page.
- **A leaflet can print two windows.** In the September 2026 leaflet pages 1 to
  35 and page 54 read `Desde el lunes 7/9 hasta el 13/9` and pages 36 to 52 and
  page 55 read `Desde el viernes 11/9 hasta el 13/9`, the weekend half. The
  document's own window is the union of the two, and the later half belongs in
  `leaflet.json`'s `notes`.
- **No offer states a region condition.** LIDL prices are set per offer region
  (backend plan 0089, section 4) and the region is the edition rather than
  anything printed on a tile: the file name ends in the region code (`-00`) and
  the page footer prints `37/2026 – ES`, occasionally with a production suffix
  such as `ESohneNAR`. Nothing on a tile says "except in" anything. The single
  `No aplicable en Canarias` line in this leaflet qualifies the basket price
  study on page 2, not the offers. **The scope of an import is therefore the
  region the file came from, chosen at the upload and never read off the page.**
- The Lidl Plus small print, `Consulta condiciones de la promoción en la App
Lidl Plus`, sits in the footer of most pages. It is a legal note, not a
  per tile condition.

## Pages that carry no products

Four kinds, and all four still look like leaflet pages:

- **The cover** (page 1 in September 2026) carries the LIDL roundel, the
  campaign headline and, unlike Deza's, seven priced tiles. Read them.
- **The back cover** (page 55) is the same: a full page of tiles with no
  banner and no page number.
- **There is no index page.** Nothing in the leaflet lists its own contents.
- **Adverts**, on pages 2, 32, 33 and 53 in September 2026: a basket price
  comparison against another supermarket, two Lidl Plus points pages and a Lidl
  Pay page. They print large numbers (`81.77`, `102.30`, `20€`) that are not
  product prices. They read as an empty array.

## Stop and report if

- A tile's big number carries a comma instead of a period, or the comparison
  line carries a period instead of a comma.
- A `Con Lidl Plus` tile prints no struck shelf price beside the app price. The
  prompt handles that case by stating no price at all, but a leaflet where it
  is common has changed its mechanic and the reading is worth half of nothing.
- A tile prints a region, province or store condition.
- The price moves into a badge with a footer, the way Deza's does.
