# 0162: one product card

> Asked for by the owner on 2026-10-20: "check which places could be re-designed to show a
> more detailed product card so that we try to use a single component with the same
> design (or very close) in multiple places". After the audit and the mock he chose, in
> his words "Keep A", and accepted the rest as proposed:
>
> - **A**: rows on hairlines, not boxed cards.
> - The **Details** link goes. Pressing the card opens the product, as the catalog does.
> - Radios sit at the right edge, in the control slot (plan `0163` applies it to sheets).
> - Shopping list rows get a picture (plan `0164`).
> - The missing photo in search is fixed first, on its own (plan `0161`).
>
> **The audit** is https://claude.ai/artifact/AZuvmtf9UcY1Hn1mnkwDbA: a screenshot of each
> place today, with a verdict. **The mock is the design.** It is
> `apps/velista/plans/mocks/product-card/` (`Card.dc.html`, `Search.dc.html`,
> `Catalog.dc.html`), published at https://claude.ai/artifact/KT628cnKaK4PbKHHv8oNes.

## Brief for the agent

### Objective

Make `lib-product-row` the one card that draws a catalog product, in the look of option
A, and draw the search cards of the list page and the shopping list page with it.
Route every product photo through `lib-product-picture`.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `e0b2911f`, with plan `0161` assumed built.

- **Two cards draw a product for the same job today.**
  - `lib-product-row` (`libs/velista/ui/src/lib/catalog/product-row.ts`) draws the catalog
    tab, Choose a product (velista `0140`, `0146`) and the similar products of a product
    page. It is a boxed card (`.row` has a border, `--app-card-radius` and the raised
    surface), a 52 px thumbnail with its own `<img>` and failure handler, name and
    `brand · size`, the price with a caption, and one control: a plus (`button.add`), a
    radio or a tick (`ProductRowChoice`), or a verb pill. Under it, the lines of the chosen
    list that hold the product, each with a stepper (`.held`).
  - The search cards (`suggestion-list.html`, placement `'page'`) are inline markup:
    a 48 px thumbnail, name, pack, price, `meta` and `aside`, a chain marks row that opens
    each shop's price, a group's reveal and members, a "Details" link, the lines that hold
    the product under a violet label (`.already-h`), and a tall tinted plus column
    (`.pick-cell`).
- **Placement `'below'` has no host.** Both hosts of `lib-suggestion-list`
  (`list-page.html:224`, `basket-page.html:312`) pass `placement="page"`. The one line
  listbox (`suggestion-list.html:324` to `416`), its helpers (`nameOf`, `noteOf`,
  `bestPriceOf`, `groupSummaryArgs`, `sizeOf`, `_sizeFormat`), its styles
  (`suggestion-list.scss:1` to `130`) and the four describes of `suggestion-list.spec.ts`
  exist only for it.
- **The photo code is written four times**: `product-row.ts:313` to `318`,
  `line-product-rail.ts:163` to `190`, `product-page.ts:191` and `:220`, and
  `product-picture.ts`, which is the shared one. Its doc comment already names the others
  as a later cleanup (velista `0145`, section 10).
- **The browse read carries one price**: `CatalogProduct.offer`, with its scope, so the
  catalog knows one chain for a product. The suggest read carries every chain's price
  (`CatalogItem.chainPrices`).
- **The unit price rule exists**: `unitPriceText` in `suggestion-card-view.ts:300` draws
  the price per litre or kilo only when it differs from the price.
- **The staging gate reads the card.** `apps/velista-luna-e2e/src/catalog.spec.ts` finds
  cards by `lib-product-row` and uses `button.add`, `button.open` and `.held-line`.

### Target state

1. `lib-product-row` draws option A: a row on a hairline, no box. Sections 1 and 2.
2. Its picture is `lib-product-picture`, 52 px. The line page tiles and the product page
   header use `lib-product-picture` too, at their own sizes. Section 3.
3. It has a chain line, a price block with the unit price rule, and one control slot at
   the right edge. Section 2.
4. It can draw a group and the expanded shop prices and members that search needs.
   Section 4.
5. The search cards are `lib-product-row`. The "Details" link, the violet label and the
   tinted plus column are gone. Section 5.
6. Placement `'below'` and everything that exists only for it are removed. Section 6.
7. It has a compact size (44 px picture) for sheets. Plan `0163` uses it. Section 2.

### Scope

- `libs/velista/ui/src/lib/catalog/product-row.ts`, `product-row.scss`,
  `product-row-view.ts` and their specs.
- `libs/velista/ui/src/lib/list/suggestion-list.*`, `suggestion-card-view.ts` and their
  specs, `product-picture.*`, `line-product-rail.*`.
- `libs/velista/feature-catalog/src/lib/product-page/` (the header's picture only),
  `catalog-page/` (inputs only, if the row's inputs change).
- `libs/velista/feature-lists/src/lib/list-page/` and
  `libs/velista/feature-shopping-lists/src/lib/basket-page/` (inputs only).
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- `apps/velista-luna-e2e/src/catalog.spec.ts` if a selector it reads changes.

### Constraints

- **The mock decides the look.** Day and Night both use the existing tokens; no new
  colour. Add a size token only where the mock draws a size the tokens lack.
- **One component.** The search cards and the catalog rows render the same component.
  Differences are inputs, never a second template.
- **One control slot.** Add, radio, tick or stepper, 44 px, at the right edge, never two.
  The verb pill keeps working for its spec, in the same slot.
- **A press on the rest of the card opens the product**, except in a mode that chooses,
  where the whole card is the label of its radio or tick (today's `label.open`).
- **The search panel keeps its rules from velista `0101`.** Nothing in it takes the focus
  from the field (the `mousedown` hold), and it stays a `role="grid"` owned by the
  field's combobox, with each card a row. A card's open control, plus and chain button
  are reachable by keyboard.
- **The accessible name of the card** stays the product, the size and the price, in that
  order (`ProductRowView.label`).
- **No dashes as punctuation** in strings, comments or the plan's follow ups.

### Action boundaries

- Do not change the backend, the mappers or the reads.
- Do not change what the catalog tab, Choose a product or search do. Only their look and
  the "Details" link change.
- Do not change the line page tiles beyond their picture.
- Do not build plan `0163` or `0164`.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/ui velista/feature-catalog velista/feature-lists velista/feature-shopping-lists`
  pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, Day and Night, English and Spanish, on a slot whose
  catalog has photos: the catalog tab with and without a chain chosen, Choose a product
  for one product and for a set, a product page's similar products, a search on a list
  and on the shopping list with a product already held, a stale price, a product with no
  price, a group opened and a chain row opened. Screenshots of each beside the mock.

## 1. The look: option A

A card is a row, not a box. It sits on the page's ground, with a hairline under it
(`--app-border-subtle`) and none under the last of a list. The radius, border and raised
surface of `.row` go. `.is-chosen` (a ticked or chosen card in a mode that chooses) loses
its border colour, because the radio or tick carries the state.

Spacing follows the mock: 12 px between columns, 12 px above and below, 16 px at the
sides on a page. The list pages already draw their rows this way.

## 2. The parts

From left to right, as `Card.dc.html` draws them.

- **Picture.** `lib-product-picture`, 52 px, radius `--app-line-picture-radius`. A photo
  sits on the raised surface with a hairline; without one, the glyph on the sunken fill.
- **Text.** The name on up to two lines. The detail on one line: brand, size and pack
  (`Danone · 480 g · Pack 4`); the pack moves from the pill of today's search card onto
  this line. Then the chain line: a mark for each chain (its initial, as search draws it
  today, at most `CHAIN_MARKS_SHOWN`), the cheapest one named, `+N` for the rest. When the
  card knows each shop's price, the chain line is a button that opens them (section 4);
  when it knows one chain, as in the catalog, it is text.
- **Price.** At the right of the text: the price, then under it the price per litre or
  kilo when it differs from the price (the rule of `unitPriceText`, shared by both
  builders), or the age of a stale price with the clock. With no price, the words
  `no price`. The catalog's caption that named the chain moves to the chain line.
- **Control slot.** 44 px, at the right edge: the plus (a round outlined button, as the
  catalog has today), a radio, a tick or the verb pill.
- **Held lines.** Under the text and price, from the text column to the right edge: the
  heading "On <list>" in the muted colour, then each line with its name and its stepper.
  The catalog's `.held` already draws this. The violet label of search goes.

**Compact size.** An input that draws the picture at 44 px and drops the side padding,
for a list inside a sheet (`Card.dc.html`, right). The control slot can also hold a
stepper there. Plan `0163` uses it; build and test it here.

## 3. One picture

Move the remaining copies onto `lib-product-picture`:

- `ProductRow` (`broken`, `image`, and its `<img>`).
- `LineProductRail` (`_broken`, `imageOf`, `markBroken`): the tile's picture at
  `--app-line-product-card-image`.
- `ProductPage` (`brokenImage`, `image`): the header's picture at
  `--app-product-page-image-size`.

`lib-product-picture` takes its size from its host's CSS today. Keep that: each host sets
the size and radius custom properties it reads, so no size input is needed. If a host
needs `loading="eager"` (the product page header is above the fold), add that one input.

Update the doc comment of `product-picture.ts`: it is now the only place that draws a
product photo.

## 4. What search needs from the card

The row gains optional inputs, unused by the catalog:

- **A group.** The crate glyph in place of the picture, the word "Group" after the name,
  "Adds its N products" as the detail, `from` above the best price, and the reveal that
  lists the members (today's `.reveal` and `ul.inside`, five cheapest and the count of
  the rest).
- **Each shop's price.** The chain line opens `ul.shops` under the card (today's
  `openChains`), the cheapest marked.
- **The synonym line** (`alsoCalled`, velista `0108` target 4), under the detail.

Build each as an input of plain values, as `ProductRowAdd` is today. Where a part grows
the component past what one file reads well, split it into a child component in
`ui/catalog`, still drawn only by `lib-product-row`.

## 5. Search draws the card

`SuggestionList` (placement `'page'`) renders one `lib-product-row` for each suggestion:

- `suggestionCardView` and `productRowView` become one view, or one builds the other.
  The shared fields are the fields of `ProductRowView`; search adds the group, the shops
  and the synonym of section 4. The unit price rule and the size text have one home.
- **The plus** chooses the suggestion, as `.pick` does today, with its `pickLabel`.
- **The held lines** come from `holdingsOf`, as the "already" block does today, with
  their steppers and their `editable` state.
- **A press on the card opens the product** through `productLink`, as the "Details"
  link did. A group card has no product page; a press on it opens its members, as the
  reveal does.
- **Removed**: the "Details" link and `linkFor`, the violet `.already-h` label, the
  `.pick-cell` column, `.sug` and its styles, and the strings only they used
  (`list.add.card.details`, `list.add.card.detailsOf`, `list.add.card.already`, if no
  other place reads them).

The no results row (`lib-suggestion-no-match`) and the skeleton stay. The skeleton takes
the card's new shape (`lib-product-row-skeleton`).

## 6. The one line rows go

Remove placement `'below'`: the `placement` input (or its `'below'` value), the template
branch, the helpers that only it uses, its styles, the four describes of
`suggestion-list.spec.ts` that test it, and the `placement` option of the render helper in
`suggestion-cards.spec.ts`. Fix the two comments that cite `SuggestionList.sizeOf`
(`product-row-view.ts:104`, `models/src/lib/enums.ts:459`) to cite the one size text
that remains. `line-composer.spec.ts:645` asserts the list is absent there; keep it.

## 7. Strings and tests

- **Strings**: the group card says "Group" (`list.add.card.groupBadge` today) and "Adds
  its N products", which is `list.add.groupAdds`, a key of the one line rows that section
  6 removes: keep that key for the card. Add a key for "from" only if none exists. Remove
  the keys that sections 5 and 6 free, in English and Spanish, after a search shows
  nothing else reads them.
- **`product-row.spec.ts`**: every part of section 2 in each mode (open, add, radio,
  tick, verb), the compact size, a photo and a failed photo, the chain line as text and
  as a button, the unit price rule, a stale price, no price.
- **`suggestion-cards.spec.ts`**: the cards render `lib-product-row`, a press opens the
  product, the plus chooses, the held lines step, a group reveals its members, a chain
  row opens the shop prices, nothing takes the focus from the field.
- **`catalog.spec.ts`** (velista-luna-e2e): keep `button.add`, `button.open` and
  `.held-line` as names on the new markup, or update the spec in the same change.

## 8. Not in this plan

- The change sheet, "Which one did you get?" and the visit added sheet on the compact
  card: plan `0163`.
- Pictures on the shopping list rows: plan `0164`.
- The line page tiles keep their layout. They share the picture only.
