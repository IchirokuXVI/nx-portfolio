# 0164: a shopping list row shows its product

> Asked for by the owner on 2026-10-20: the rows of the shopping list draw the picture of
> their product, as the rows of a list already do. He accepted the proposal as drawn.
>
> **The audit** is https://claude.ai/artifact/AZuvmtf9UcY1Hn1mnkwDbA (section "Shopping
> list rows"). **The mock is the design.** It is
> `apps/velista/plans/mocks/product-card/BasketRows.dc.html` and the top row of
> `Search.dc.html`, published at https://claude.ai/artifact/KT628cnKaK4PbKHHv8oNes.
>
> **This plan stands alone.** It does not need plan `0162`: it uses
> `lib-product-picture`, which exists today.

## Brief for the agent

### Objective

Draw the product's picture on each row of the shopping list, between the status circle
and the name, at the 44 px of the list rows.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills.

### Context

Every statement below was read on `dev` at `e0b2911f`.

- **A row of the shopping list is `lib-basket-row`**
  (`libs/velista/feature-shopping-lists/src/lib/basket-row/`). It resolves its product
  through `_product` (`basket-row.ts:948`, `basketRowProduct`), a `BasketProduct`
  (`libs/velista/models/src/lib/basket-view.ts:319`) that holds `imageUrl`. Nothing draws
  it.
- **The row is a flex row** (`basket-row.scss`): the status control at the leading edge,
  the body (name, then price and list), then the quantity and its caption.
- **The same component draws the "On your lists" rows** at the top of a search of the
  shopping list (`basket-page.html:262` to `277`), so they gain the picture with no
  change of their own.
- **A list row already draws its product** with `lib-product-picture` at
  `--app-line-picture-size` (44 px) (`libs/velista/ui/src/lib/list/line-row.html:84`).
- **Crossed rows** (removed from the list, or bought through another shopping list,
  velista `0093` and `0142`) are drawn by their own branch, with no status control.

### Target state

1. A row with a product draws `lib-product-picture` with the product's photo after the
   status control, at 44 px.
2. A row with no product keeps the slot empty (a dashed outline, as the mock draws), so
   the names of all rows start at one edge.
3. A crossed row keeps the slot empty too.
4. The search's "On your lists" rows show the picture.

### Scope

- `libs/velista/feature-shopping-lists/src/lib/basket-row/` and its spec.

### Constraints

- **The mock decides the look.**
- **The row's controls do not change.** The status control, the body that opens the
  sheet and the quantity keep their size, their names and their place. The picture is
  not a control and is hidden from a screen reader; the row's accessible name already
  names the product.
- **The row grows only as much as the 44 px picture needs.**
- **One copy of the photo code**: `lib-product-picture`.

### Action boundaries

- Do not change the backend, the basket reads or `BasketProduct`.
- Do not change the list rows or the cards of plan `0162`.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/feature-shopping-lists` pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- A browser walk at 390 pixels, Day and Night, on a slot whose catalog has photos: a
  shopping list with products with and without photos and a line with no product, a
  bought row, a crossed row, and a search with a row on your lists.

## 1. The picture

In `basket-row.html`, after the status control, draw
`<lib-product-picture [imageUrl]="product.imageUrl" />` when `_product()` is set, and an
empty slot of the same size when it is not. The slot takes `--app-line-picture-size` and
`--app-line-picture-radius`, as `line-row.scss` sets them.

## 2. Tests

`basket-row.spec.ts`: a row with a product draws the picture with its photo, a product
without a photo draws the glyph, a row with no product draws the empty slot, a crossed
row draws the empty slot, and the status control and body keep their accessible names.

## 3. Not in this plan

- The card of plan `0162` and the sheets of plan `0163`.
