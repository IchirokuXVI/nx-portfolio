# Leaflet finder

Which leaflets each supermarket chain publishes right now, and which of them are new
since the last run. One command, one module per chain, one state file.

```sh
node tools/leaflets/find-leaflets.mjs                              # every chain, grocery only
node tools/leaflets/find-leaflets.mjs --chain lidl                 # one chain
node tools/leaflets/find-leaflets.mjs --download tmp/leaflets/pdf  # save every new PDF, record its sha256
node tools/leaflets/find-leaflets.mjs --json > report.json         # machine readable
node --test tools/leaflets/find-leaflets.test.mjs                  # the tests, no network
```

Plain `node`, no dependencies and no Nx project, like `tools/release/`. Nothing here
ships in a service. The leaflet itself is read elsewhere, by the model reading pipeline
that produces a `LEAFLET_IMPORT` document (plan 0081). This tool answers the question
that comes before it: is there a leaflet to read that we have not read yet.

## What it does

1. Asks each chain module for every leaflet the chain publishes, one entry per
   edition the publisher gave its own id.
2. Drops the kinds nobody reads. Only `grocery` survives unless `--all` is passed.
   `bazar` and `other` (outlet leaflets) are counted in the report and skipped.
3. Folds editions with identical content into one entry that lists every region
   that carries it, so a leaflet shared by many regions is reported once.
4. Compares every remaining edition with the state file. An edition whose content
   hash is not in the file is **new**.
5. With `--download <dir>`, saves each new PDF under `<dir>/<chain>/` and records its
   sha256, which is what `source.sha256` in the leaflet import document wants.
6. Writes the state file, unless `--dry-run` was passed or a chain failed.

The state file defaults to `tmp/leaflets/state.json` (git ignored) and `--state`
moves it. It holds, per chain, every content hash seen so far with the edition it
belongs to, and `latest`: the hash of the most recent leaflet the chain published,
by offer start date. Deleting an entry makes that edition new again on the next run.

## Adding a chain

Add `chains/<chain>.mjs` exporting a `chain` object with a `key`, a `name` and a
`findLeaflets(http, options)`, and list it in `chains/index.mjs`. `http` is the
throttled client `find-leaflets.mjs` builds (`json`, `head`, `download`). `options`
carries `regions` (when `--regions` was passed) and `log`. Answer every leaflet the
chain publishes, in this shape:

```js
{
  chain: 'lidl',
  sourceId: '<the publisher id of this edition>',
  name, title, kind: 'grocery' | 'bazar' | 'other', category,
  pdfUrl, fileSize, startDate, endDate, offerStartDate, offerEndDate, viewerUrl,
  regions: [{ code, name, zone }],
  contentHash: { algorithm: 'etag' | 'sha256' | 'source-id', value },
}
```

`contentHash` is what the finder deduplicates and remembers by. Give it something the
publisher derives from the file's bytes when one exists (an ETag, a checksum in the
listing), and fall back to the edition id when nothing does. Do the classification in
the module: the finder only reads `kind`.

## LIDL

Found on 2026-09-06. The numbers below come from `find-leaflets.mjs --chain lidl`
and from the probes described in
`apps/luna-shopper-backend/harvester/docs/research/lidl/README.md`.

**lidl.es does not host its leaflets.** The page at
`/c/descubre-nuevas-ofertas-cada-semana-folletos-lidl/s10087402` embeds an overview
widget from `esi.leaflets.schwarz`, rendered from one JSON call that needs no key,
no account and no cookie:

```
https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl/es-ES&region_id=<n>&store_id=0
```

`client_locale` must be exactly `lidl/es-ES`. Every other spelling is refused as
"wrongly formatted". `region_id` is the same id space as `marketingData.offerRegion`
on the store records, the 59 price regions plan 0089 describes, and the module reads
that list from the store API (`live.api.schwarz`, with the public `x-apikey` every
lidl.es page ships) rather than keeping a copy. Region `0` is what the site shows
before a shop is chosen. The viewer app at `/l/es/folletos/` is a shell over the same
service. It fetches one flyer at a time (`/v4/flyer?flyer_identifier=<slug>`) and has
no listing of its own.

**The answer is regionalized, and the regions share editions.** Each week LIDL Spain
publishes one grocery leaflet ("FOLLETO ALIMENTACIÓN d/m") and one bazar leaflet, plus
next week's pair from Thursday or so. Every one of them exists as **nine flyer ids**,
one per group of regions, each with its own PDF:

| Regions                                                                                    | Notes                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 0 (no shop chosen), 28 Madrid, 33 Guadalajara                                              | three flyer ids, **one PDF**: identical bytes     |
| 1 to 6: Galicia, Asturias, León                                                            |                                                   |
| 7 to 22, 56, 57: Castilla y León, Cantabria, Basque Country, La Rioja, Navarra, Aragón     | 56 `Vit 2` and 57 `Cat 2` are operational names   |
| 23, 35 to 39: Teruel, Albacete, Comunidad Valenciana, Murcia                               |                                                   |
| 24 to 27: Catalonia                                                                        | the smallest PDF, so not the same pages           |
| 29 to 32, 34, 40 to 47, 51, 52: Extremadura, Castilla-La Mancha, Andalusia, Ceuta, Melilla |                                                   |
| 48, 58, 59: Balearic Islands                                                               |                                                   |
| 49, 50, 53 to 55: Canary Islands                                                           | its own name: "FOLLETO CANARIAS ALIMENTACIÓN d/m" |

Madrid alone also lists "FOLLETO FACTORI d/m" under "Nuestros folletos semanales",
the Lidl Factori outlet, which the module classifies as `other`.

So a week is **8 distinct grocery PDFs**, not 1 and not 59. They share a file name
and a page count and differ in content, which is what a regional price is. The tool
reports each once, with the regions that carry it, and reports the Madrid edition
once for its three flyer ids.

**The ETag is the file's MD5.** `assets.leaflets.schwarz` answers a `HEAD` with an
ETag that equals the MD5 of the PDF (checked against two downloads), so the finder
knows two editions are the same bytes without downloading either. That is the
`contentHash` for LIDL. The flyer id is not enough: region 0 and Madrid carry
different ids over one file.

**What a run costs.** 3 store API pages, 60 overview calls and one `HEAD` per distinct
PDF (about 40), at four requests a second: under a minute, no download. `--download`
adds about 23 MB per new grocery edition, so the first run of a week is about 190 MB.

**What the flyer JSON adds, for the reader.** `/v4/flyer?flyer_identifier=<slug>`
(the slug is in the overview's `flyerJson`) answers every page as a 2400 px image
URL on `imgproxy.leaflets.schwarz`, with a `keyWords` string per page, so the model
reading pipeline can take page images straight from the service instead of rendering
the PDF. It has no structured prices: `products`, `topics` and `texts` are empty.
