# 0024 The badge, the tiles and the chain picker

Three small corrections with no dependency between them, gathered because each alone is smaller
than a plan. The environment badge stops explaining where it got its answer, the dashboard's
tiles inside one section become the same size, and the discovered places queue trades a raw uuid
input for the picker every comparable screen already has.

Depends on `0001` for the badge, `0016` for the dashboard, and `0006` and `0014` for the places
queue this amends. Section 3.2 reverses a documented decision, on the owner's instruction, and
says so where the old reasoning stood.

## 1. The badge keeps the answer and drops the sourcing

`EnvironmentBadge` renders a third line under the environment's name: "Reported by the gateway
this app is talking to, not by the build." It was written for the operator who needed to trust
the badge before trusting the screen, and it has done that job; now it is a sentence read a
hundred times a day that says nothing new after the first.

The `.source` paragraph goes, everywhere the badge renders, which is the sign in page and the
shell header. The `environment.sourcedFromApi` key leaves `en.json` with it, and
`environment-badge.spec.ts` stops asserting on the paragraph. Everything else stays: the
checking state, the name, and the `unknownExplanation` paragraph for a deployment that could not
be established, which is a different sentence doing a job that is not done yet.

## 2. Tiles in one section are one size

### 2.1 Why they differ today

Every `.tiles` grid gives its cells equal widths already (`auto-fit` with a `minmax`). Heights
differ, for two stacked reasons. The tile is not the grid item: it sits inside a wrapper
(`.captioned` for a tile with a caption under it, `.wrap` for the one link that needs query
parameters), and neither wrapper stretches the tile to the cell, so `.tile { block-size: 100% }`
has nothing to fill. And the content genuinely differs: the users tile carries a delta and a
sparkline, several tiles carry a caption, and the caption is drawn **outside** the tile's
border, so even a stretched tile would end above its neighbor.

### 2.2 The tile becomes the grid item

`StatTile` gains two inputs, and both wrappers disappear:

- **`caption`**: the line under the number moves inside the tile, drawn under the value in the
  muted ink the wrappers use today. A tile's box then contains everything the tile says, so
  equal boxes mean equal looking cards.
- **`queryParams`**: passed through to the anchor beside `routerLink`, which is the whole reason
  `.wrap` existed. The one tile that opens a queue on a chain keeps doing so.

With the wrappers gone, `lib-stat-tile` is the grid child, the grid stretches it to the row, and
`block-size: 100%` finally means something: every tile in a row shares the row's height, and the
tallest content in the row decides it. A plain tile beside the sparkline tile gets quiet space
under its number, which is the cost the owner accepted.

The claim is per section, deliberately. The waiting row, the people row, the catalog row and the
sign ins row are four grids, and nothing makes a card in one match a card in another: that would
take a fixed height, and a fixed height either clips a sparkline or pads every section to the
tallest tile on the page.

`dashboard-page.ts` loses `.captioned` and `.wrap` and their styles; the caption lands on the
tile input instead of a sibling paragraph. The dashboard view models already carry `caption` per
tile, so no selector changes.

## 3. The places queue picks a chain instead of typing one

### 3.1 The picker

The "Chain identifier to file it under" field is a bare text input bound to a uuid. It becomes a
`lib-reference-picker` over the `supermarkets` resource, with `ResourceReferences` as the
lookup, which is the exact wiring the shops queue page already has. The supermarkets descriptor
declares the search filter the picker needs, so typing narrows by name. The field stays
optional: the picker's clear state is the old empty input, and an import with no chain keeps
today's meaning, catalog resolves the chain from the place's own brand.

The picker still resets after each single decision, as the text input does today. A visible
leftover choice quietly filing the next place under the previous chain is the mistake the reset
prevents, and a picker makes re-choosing cheap enough that the reset costs little.

### 3.2 The picked chain now applies to bulk import too

Today the bulk path sends an empty body on purpose, and the comment on `askImport` records why:
one operator's typed answer applied to rows they did not look at. The owner has weighed that and
wants the chain to apply, so the reversal is deliberate and this section replaces that comment's
reasoning rather than silently contradicting it.

What makes it acceptable now is the control's nature. A typed uuid is opaque: an operator cannot
see what they are about to stamp on thirty rows. A picker shows the chosen chain **by name**,
and the confirm dialog seals it: when a chain is picked, the dialog's body names it beside the
count, so the operator confirms "import 12 places under Mercadona" and not just "import 12
places". With no chain picked the dialog and the behavior are exactly today's: catalog resolves
each place from its brand and refuses the ones it cannot, named in the report.

After a bulk run the picker resets, for section 3.1's reason.

`importPlace` and `askImport` both read the picker's value; `ImportDiscoveredPlaceDto` already
carries the optional `supermarketId`, so no backend change of any kind.

## 4. Tests

- `environment-badge.spec.ts`: the source paragraph is gone in both drawn states; the unknown
  explanation stays.
- The dashboard specs: the caption arrives as a tile input rather than a sibling element, and
  the query carrying tile still opens its queue filtered.
- `place-view.spec.ts` is untouched; the places queue page spec gains the picker: a picked chain
  reaches the single import, reaches every row of a bulk import, appears in the confirm dialog's
  body arguments, and an empty picker sends an empty body on both paths.
- Assertions on inputs and call arguments, not on rendered interpolated text.
