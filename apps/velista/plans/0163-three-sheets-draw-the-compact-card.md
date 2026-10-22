> **PR:** [#807](https://github.com/IchirokuXVI/nx-portfolio/pull/807)

# 0163: three sheets draw the compact card

> Asked for by the owner on 2026-10-20, with plan `0162`: the places that choose or list
> a product inside a sheet draw the same card at its compact size. He accepted that the
> radio moves to the right edge, into the card's control slot.
>
> **The audit** is https://claude.ai/artifact/AZuvmtf9UcY1Hn1mnkwDbA (sections "Change the
> product", "Which one did you get?" and "Added to the list"). **The mock is the design.**
> It is `apps/velista/plans/mocks/product-card/Sheets.dc.html`, published at
> https://claude.ai/artifact/KT628cnKaK4PbKHHv8oNes.
>
> **Plan `0162` comes first.** This plan uses the compact size and the control slot that
> `0162` builds. Do not start it before `0162` is merged.

## Brief for the agent

### Objective

Draw the choices of the "Change the product" sheet, the choices of "Which one did you
get?" and the rows of the sheet of what a catalog visit added with `lib-product-row` at
its compact size: picture, name, detail, price, and the radio or the stepper in the
control slot.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `e0b2911f`, with plan `0162` assumed built.

- **Change the product** (`libs/velista/feature-shopping-lists/src/lib/change-sheet/`).
  The rows are `ChoiceRow` (`change-sheet.ts:64`): `itemId`, `name`, `caption`
  (`chosenNow`, `cheaper`, `notSold` or null) and `price`. `_nameOf` (`:463`) bakes the
  brand and size into `name` from a `CatalogItem` that also holds `imageUrl`, `brand`,
  `size`, `unit` and `offer`. `change-sheet.html:45` draws each row as
  `lib-radio-row`, a label with the radio first. `lib-radio-row`
  (`libs/velista/ui/src/lib/choice/radio-row.ts`) has no other user.
- **Which one did you get?** (`libs/velista/feature-lists/src/lib/line-detail-sheet/line-detail-sheet.html:406`).
  Buttons with `role="radio"`, a tinted fill on the chosen one, name and brand only. The
  type is `LineItemChipVm` (`libs/velista/models/src/lib/line-detail-view.ts:113`):
  `itemId`, `name`, `brand`, `removable`. It is built in `select-line-detail.ts` (about
  line 90) from `LineDetailInput.itemNameOf`, which returns a `CatalogItem` with
  `imageUrl`, `size`, `unit` and `offer`. `LineDetailInput.pricesOf` also exists.
- **Added to the list** (`libs/velista/ui/src/lib/catalog/visit-added.ts`).
  `VisitAddedRow`: `lineId`, `itemId`, `name`, `detail`, `quantity`, `floor`, `pending`,
  drawn with a stepper. The rows come from `visitSections` over `VisitAddition`
  (`libs/velista/models/src/lib/catalog-visit.ts:12`), which the catalog writes through
  `CatalogAddProduct` (`libs/velista/data-access/src/lib/catalog/catalog-add-store.ts:31`:
  `itemId`, `name`, `detail`). **None of them carries a photo.** The catalog row that the
  plus was pressed on holds it (`ProductRowView.imageUrl`).

### Target state

1. The change sheet draws each choice as the compact card: picture, name, `brand · size`,
   the caption it has today (`basket.change.chosenNow`, `.cheaper`, `.notSold`), the
   price with its unit price,
   and the radio at the right edge. `lib-radio-row` is removed.
2. "Which one did you get?" draws each choice the same way, with the radio at the right
   edge and no tinted fill. The price is the product's best known price and the chain
   that has it.
3. The visit added sheet draws each row as the compact card with its stepper in the
   control slot, and the photo of the product that was added.

### Scope

- `libs/velista/feature-shopping-lists/src/lib/change-sheet/`.
- `libs/velista/feature-lists/src/lib/line-detail-sheet/` and
  `libs/velista/models/src/lib/line-detail-view.ts`.
- `libs/velista/ui/src/lib/catalog/visit-added.ts`,
  `libs/velista/feature-catalog/src/lib/added-sheet/`, `catalog-page/` (where the plus
  writes), `libs/velista/models/src/lib/catalog-visit.ts`,
  `libs/velista/data-access/src/lib/catalog/catalog-add-store.ts`.
- `libs/velista/ui/src/lib/choice/radio-row.*` (removed).
- Specs of all of the above, and `en.json` and `es.json` if a string changes.

### Constraints

- **The mock decides the look.** Compact size from plan `0162`, nothing new.
- **A radio group stays a radio group.** The choices of each sheet keep one name, arrow
  keys move between them, and the whole card is the label of its radio. The chosen state
  is the radio, never colour alone.
- **The detail line is built once.** Brand and size come from the same text function
  that the card of plan `0162` uses; `_nameOf` stops baking them into the name.
- **A visit already recorded keeps working.** If the visit record outlives a page load
  (check where `CatalogVisit` is kept), an entry written before this change has no photo
  and draws the glyph.
- **No dashes as punctuation** in strings or comments.

### Action boundaries

- Do not change the backend or any read.
- Do not change what the sheets do: which product a radio chooses, what Record it and
  Use it for the list write, what the minus at the floor takes back.
- Do not change the rest of the line detail sheet, only the "Which one" choices.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/ui velista/data-access velista/feature-catalog velista/feature-lists velista/feature-shopping-lists`
  pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, Day and Night, on a slot whose catalog has photos: change
  the product of a shopping list row with two choices, record a buy on a line with two
  products and pick the second, add two products from the catalog and open the sheet of
  what was added. Each beside `Sheets.dc.html`.

## 1. Change the product

`ChoiceRow` gains `imageUrl`, `detail` and the unit price, from the same `CatalogItem`
that `_nameOf` reads. `name` becomes the product's name alone. The template draws
`lib-product-row` at its compact size with a `choice` (the radio, name
`basket-change-product`) and the caption as its caption line under the detail.

`lib-radio-row` then has no user. Remove it and its export (it has no spec of its own).

## 2. Which one did you get?

`LineItemChipVm` gains `imageUrl`, `detail` (`brand · size`) and `price` (formatted, or
null) with the chain that has it, built in `select-line-detail.ts` from the
`CatalogItem` that `itemNameOf` already returns. Read the price from `item.offer`; use
`pricesOf` only if `offer` is absent for a product of the line. A product with no name
stays "unnamed" (section 1.2 of the plan that wrote it).

The choices draw `lib-product-row` at its compact size with a radio. The tinted fill of
the chosen button goes.

Other users of `LineItemChipVm` read only the fields they read today; the new fields are
additions.

## 3. Added to the list

`CatalogAddProduct` and `VisitAddition` gain `imageUrl: string | null`. The catalog page
passes the row's `imageUrl` when its plus is pressed, `visitSections` keeps it, and
`VisitAddedRow` carries it. The sheet draws each row as the compact card with its
stepper in the control slot; `pending` stays a line under the detail.

## 4. Tests

- `change-sheet.spec.ts`: a choice draws its picture, its detail and its radio at the
  right; choosing one still selects it.
- `select-line-detail.spec.ts` and `line-detail-sheet.spec.ts`: the new fields, the
  radio at the right, no tint.
- `catalog-visit.spec.ts`, `visit-added.spec.ts`, `added-sheet.spec.ts`: the photo is
  kept from the plus to the sheet, and an entry without one draws the glyph.

## 5. Not in this plan

- Pictures on the shopping list rows: plan `0164`.
- The cards of plan `0162`.
