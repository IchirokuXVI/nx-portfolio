# 0161: a search card shows the product photo

> Asked for by the owner on 2026-10-20, after an audit of every place velista draws a
> product: "seems like product images aren't shown in the zone list product search". He
> chose to fix it first and on its own, before the card of plan `0162` replaces the
> search cards.
>
> **The audit** is https://claude.ai/artifact/AZuvmtf9UcY1Hn1mnkwDbA. Its first section
> shows the defect on a slot with Mercadona photos switched on: searching "yogur" on a
> list, the row of the line already on the list shows its Danone photo, and the card of
> Strawberry yogurt, one of that line's products, shows the carton glyph. The line page
> shows the photo of the same product.
>
> **No mock.** The card keeps its look. Only the glyph in its thumbnail becomes the
> photo when the product has one.

## Brief for the agent

### Objective

Draw the product photo in the thumbnail of the search cards, on the list page and on the
shopping list page, wherever the suggestion carries one.

Use the `nx-portfolio-angular-developer`, `antislop` and `antislop-ui` skills.

### Context

Every statement below was read on `dev` at `e0b2911f`.

- **The backend sends the photo.** Every catalog item read, the suggest read included,
  goes through `toItemView` (`apps/luna-shopper-backend/catalog/src/app/catalog/catalog.mappers.ts:278`),
  which fills `imageUrl` with the first linked image of plan `0198`.
- **Velista reads it.** `libs/velista/data-access/src/lib/mapping/mappers.ts:731` maps
  `imageUrl` onto `CatalogItem` (`libs/velista/models/src/lib/domain.ts:552`).
- **The card drops it.** `SuggestionCardView` (`libs/velista/ui/src/lib/list/suggestion-card-view.ts`)
  has no image field, and `suggestion-list.html:43` draws `lib-product-icon` (or
  `lib-basket-icon` for a group) in `.sug-thumb` every time. The comment above it still
  waits for backend plans `0126` to `0129`.
- **`lib-product-picture`** (`libs/velista/ui/src/lib/list/product-picture.ts`) is the one
  component that draws a product photo with its fallback: an `<img>` that becomes the
  glyph when it fails to load. Its only input is `imageUrl`. It takes its size from the
  host's CSS (`--app-line-picture-size`, `--app-line-picture-radius`).
- **Both hosts use the cards**: `list-page.html:224` and `basket-page.html:312`, each with
  `placement="page"`.

### Target state

1. `SuggestionCardView` carries `imageUrl: string | null`: the item's photo, and null for
   a group.
2. The thumbnail of an item card draws `lib-product-picture` with that photo, at the
   thumbnail's present size. A photo that fails to load shows the glyph, as it does today.
3. A group card keeps the crate glyph.
4. The stale comment in `suggestion-list.html` says what the thumbnail does now.

### Scope

- `libs/velista/ui/src/lib/list/suggestion-card-view.ts`, `suggestion-list.html`,
  `suggestion-list.scss`, `suggestion-list.ts` (imports), and their specs.

### Constraints

- **One copy of the photo code.** Use `lib-product-picture`. Do not add an `<img>` with a
  second failure handler to the card.
- **The card does not move.** The thumbnail keeps `--app-suggestion-thumb`, its radius
  and its place. A photo sits on the raised surface with the hairline that the list rows
  use; the glyph keeps the sunken fill.
- **The thumbnail stays hidden from a screen reader** (`aria-hidden`), as today. The card's
  name already says what the product is.

### Action boundaries

- Do not change the backend or the mapper.
- Do not restyle the card or touch its other parts. Plan `0162` replaces it.
- Do not change the one line rows of placement `'below'`. Plan `0162` removes them.

### Progress evidence

- `npx nx build velista` and `npx nx run-many -t lint test -p velista/ui` pass.
- A spec in `suggestion-cards.spec.ts`: an item with an `imageUrl` renders an `<img>`
  with that `src` in the thumbnail, an item without one renders the glyph, and a group
  renders the crate.
- A browser check on a slot whose catalog has photos (plan `0198`): search "yogur" on a
  list and "aceite" on the shopping list, and a Mercadona product shows its photo.

## 1. Where the photo comes from

`itemView` in `suggestion-card-view.ts` builds an item's card from its `CatalogItem`.
Copy `item.imageUrl` onto the view. `groupView` sets null. Nothing else in the builder
changes.

## 2. The thumbnail

Inside `.sug-thumb`, an item draws `<lib-product-picture [imageUrl]="card.imageUrl" />`
and a group keeps `lib-basket-icon`. Size the picture to the thumbnail with the two
custom properties that `lib-product-picture` reads, set on `.sug-thumb` in
`suggestion-list.scss`, so the component itself does not change.

The thumbnail draws its own sunken fill and border today. With a picture inside, the
picture draws them, so the thumbnail of an item becomes a plain box and a group's
thumbnail keeps its present look.

The skeleton (`.sk-thumb`) does not change.

## 3. Tests

Extend `suggestion-cards.spec.ts` as the evidence above says. The specs that assert
the glyph on every item card change to assert the glyph only when there is no photo.

## 4. Not in this plan

- The new card, the chain line and the control slot: plan `0162`.
- Pictures on the shopping list rows: plan `0164`.
