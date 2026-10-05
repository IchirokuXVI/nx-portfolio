> **PR:** [#646](https://github.com/IchirokuXVI/nx-portfolio/pull/646)

# 0005: a leaflet read counts pages once and invents no kilo

> Found by the Deza October 2026 leaflet read (44 page PDF, 196 offers, read by
> `claude-sonnet-5`). The evidence is in the git ignored handoff
> `.curation-runs/2026-10-deza-staging/leaflet/` on the developer's machine: `audit.md`,
> `read/run.json` and `read/import/leaflet.json`.
>
> Prerequisite reading: plans `0001` to `0004` here, `src/census.mjs`,
> `src/build-document.mjs`, and `libs/luna-shopper/tools/leaflet/chains/src/deza/`
> (`prompt.txt`, `layout.md`, `baseline.json`).

Three defects of the reader showed up on one real leaflet. None of them changed a price, and
the audit found 47 of 47 checked headline prices correct. Two of them changed what a
curator saw, and one forced a manual page range.

## Brief for the agent

### Objective

Count a PDF's pages once, stop turning a per kilo price into a 1 kg size, and stop reading
a product line's maker as its brand.

### Context

- **Page count.** `census.mjs` counts every `/Type /Page` object in the raw PDF text. A PDF
  saved with incremental updates holds several copies of one page object, so the census
  counted 85 pages for a 44 page PDF. The run then needed `--pages 1-44` by hand.
- **The invented kilo.** On pages 5 to 9, 20 per kilo tiles print only "€/KILO" and no
  pack size. The model answered `unitSize` 1 and `sizeFormat` "kg", and
  `build-document.mjs` wrote that as `format.quantity` 1 with unit kg. A curator then sees
  a fixed 1 kg pack where the shop sells by weight.
- **The maker as brand.** The model wrote "L'Oréal" for tiles that print "ELVIVE". The
  catalog's rule is that the brand is the line: Elvive, not L'Oréal.

### Target state

- The census answers the page count from the document's page tree (the root `/Pages`
  `/Count`), or from distinct page object numbers when there is no readable tree. It
  never counts duplicates of one object. PyMuPDF, when installed, still wins.
- When an offer's basis is per kilo and its only size is exactly 1 kg with no printed
  pack size in `format.raw`, `build-document.mjs` writes no quantity, and adds a warning
  that names the offer.
- `prompt.txt` for Deza says: a tile that prints only a per kilo price has no size, so
  answer `unitSize` null. It also says: the brand is the line printed on the pack (Elvive,
  Fructis), not its maker (L'Oréal, Garnier).
- `baseline.json` is updated only if the drift check needs it after the change, with the
  reason in the commit message.

### Scope

Work only in `libs/luna-shopper/tools/leaflet/cli/src/census.mjs`,
`libs/luna-shopper/tools/leaflet/cli/src/build-document.mjs`, their specs, and
`libs/luna-shopper/tools/leaflet/chains/src/deza/`.

Do NOT touch: the HarvestDocument schema, the harvester, other chains' prompts.

### Constraints

- No live model calls. The user runs every live read.
- Build the page count fixture from a small synthetic PDF with an incremental update.
  Do not commit the Deza leaflet.
- Only make changes directly requested.

### Acceptance criteria

- [ ] A census spec counts 2 pages in a 2 page PDF that holds an incremental update of
      one page.
- [ ] A build spec writes no quantity for a per kilo offer read as 1 kg, and keeps 1 kg
      for an offer whose raw format prints "1 kg".
- [ ] A prompt spec asserts both new rules are in Deza's `prompt.txt`.

### Action boundaries

Proceed with in-scope edits and tests. Stop and ask before changing the document schema.

### Progress evidence

Report each fix only with its spec output.
