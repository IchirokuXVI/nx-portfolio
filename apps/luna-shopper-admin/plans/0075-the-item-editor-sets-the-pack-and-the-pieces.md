# 0075 The item editor sets the pack and the pieces

> Asked for by the owner on 2026-11-26 (decision 153a): a product that is a pack has a pack
> count, a bag of candies has a piece count, and both are set by a person. Backend plan `0278`
> adds `pieceCount` beside `packCount`. This plan puts both in the product's form, so the
> curator sets them without a request by hand, and makes the size the products list prints say
> the same thing velista plan `0209` prints.
>
> **Needs backend plan `0278` merged first**: the wire types carry no `pieceCount` before it.
>
> Every anchor below was read on `origin/dev` at `e56cf9b51` on 2026-11-26. Line numbers are of
> that commit.
>
> Prerequisite reading: backend plan `0278` sections 1 and 2 (what the counts mean and the
> rules), backend plan `0162` (the pack count), admin plan `0068` (the weight field and its
> note) and admin plan `0070` (the step field, hidden unless it applies), and the "Angular
> conventions" section of `CLAUDE.md`. Load the `design-taste-frontend` skill before you touch
> the look of the form; the admin design canvas (admin plan `0041` onward) outranks it.

## Brief for the agent

### Objective

Add "Units in the pack" (`packCount`) and "Pieces inside" (`pieceCount`) to the product form of
the back office, in the section that holds the size, with the server's bounds and its rule for
when a piece count applies. Map the new refusal to the field. Print the size in the products
list with its counts, as O1 decides.

### Context

- **The form is a descriptor.** `ITEMS` in
  `libs/luna-shopper-admin/feature-catalog/src/lib/items.ts` (lines 221 to 557) lists the
  fields (lines 233 to 424), the record sections (lines 494 to 536) and `errorFields` (lines
  540 to 547). The section "sold" holds `defaultUnit`, `unitSize`, `approxWeight`,
  `quantityStep`, `imageUrl` and `shownPhoto` (lines 505 to 514).
- **No field edits `packCount` today.** The gateway takes it on create and edit since backend
  plan `0162`, and the form never offered it: a pack count is set today only by a run or by a
  request by hand. This plan adds the field for the first time.
- **The step is the pattern for a field that applies only sometimes.** `quantityStep` (lines
  328 to 371) is `shown` only when `measuredUnitOf` says so (lines 171 to 179). Hidden, it
  holds its empty value, so the edit that takes the product out of the rule sends `null`
  beside it, which is what the server asks.
- **A refusal names its field** through `errorFields` and its words through
  `libs/luna-shopper-admin/feature-resource/src/lib/gateway-error-key.ts` (the step's case is
  at lines 114 to 118). Copy is in `libs/luna-shopper-admin/ui/assets/i18n/en.json` (the
  product fields near line 467). The back office has one language.
- **The size the list prints** is `formatSize` in
  `libs/luna-shopper-admin/feature-catalog/src/lib/products/product-format.ts` (lines 115 to
  160): "6 x 1 L" for a pack, the size of one unit after the count, never the whole. The
  products page calls it (`products-page.ts` line 1147) and so does the harvest queue for a
  source entry (`libs/luna-shopper-admin/feature-harvest/src/lib/entries-queue-page.ts`).
- **The wire type** is `Wire.CatalogItemView` in
  `libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts`, generated (admin plan `0004`,
  section 2). The memory gateway's rows are in `feature-catalog/src/lib/catalog-seed.ts`.

### Target state

1. The section "sold" shows "Units in the pack" after the size and "Pieces inside" after it,
   both integer fields, empty for none.
2. "Units in the pack" takes 2 to 1000, "Pieces inside" takes 2 to 10000, as the server does.
3. "Pieces inside" is shown only when the form holds a size and the unit is grams or
   millilitres. Hidden, it holds its empty value.
4. A refusal `item_piece_count_not_allowed` is said under "Pieces inside" in its own words.
5. The products list prints the size with its counts, as O1 decides, and the harvest queue
   prints a source entry's size as it does today.
6. Specs of section 4 pass, and `npx nx build luna-shopper-admin` succeeds.

### Scope

- `libs/luna-shopper-admin/feature-catalog`: `items.ts`, `products/product-format.ts`,
  `catalog-seed.ts`, and their specs (`catalog-descriptors.spec.ts`, `product-format.spec.ts`).
- `libs/luna-shopper-admin/feature-resource/src/lib/gateway-error-key.ts` and its spec.
- `libs/luna-shopper-admin/ui/assets/i18n/en.json`.
- Nothing in the backend, velista or the generated wire types.

### Constraints

- The bounds and the rule are the server's (backend plan `0278` section 2), restated here the
  way `measuredUnitOf` restates the step's. The server stays the authority.
- A hidden field holds its empty value, so an edit that clears the size or changes the unit of
  a product with pieces sends `pieceCount: null`.
- An emptied field sends `null`, which clears the count.
- No new visual component: both are number fields of the existing descriptor.
- Never edit `wire-types.ts`.
- Only make changes directly requested.

### Action boundaries

- Stop and report if backend plan `0278` is not merged, or if `Wire.CatalogItemView` has no
  `pieceCount` after it.
- Stop and ask before you change the harvest queue's size text, or add a field the plan does
  not name.

### Progress evidence

`npx nx test` and `npx nx lint` of `luna-shopper-admin/feature-catalog` and
`luna-shopper-admin/feature-resource`, `npx nx build luna-shopper-admin`, and one walk on an
Angular slot with the memory gateway (the dev autologin): a 360 g product saved with 4 units,
and a 70 g product saved with 2 units and 100 pieces, with a screenshot of each form and of the
list.

## 1. The two fields

```ts
{
  // How many units the pack holds, the size being the whole pack (backend
  // plan 0162). Empty: not a pack.
  kind: 'number',
  name: 'packCount',
  label: 'catalog.items.packCount',
  help: 'catalog.items.packCountHelp',
  nullable: true,
  integer: true,
  min: 2,
  max: 1000,
},
{
  // How many pieces the whole product holds, across its pack (backend plan
  // 0278). Only beside a size in grams or millilitres.
  kind: 'number',
  name: 'pieceCount',
  label: 'catalog.items.pieceCount',
  help: 'catalog.items.pieceCountHelp',
  nullable: true,
  integer: true,
  min: 2,
  max: 10000,
  shown: (held) => carriesPieceCount(held),
},
```

`carriesPieceCount(held)` is true when `unitSize` is not blank and `defaultUnit` is `GRAM` or
`MILLILITER`, and it is exported for its spec, as `measuredUnitOf` is. `min` and `max` are the number
field's own options (`libs/luna-shopper-admin/models/src/lib/resource/resource-field.ts` lines
272 and 273).

The order in the section becomes `defaultUnit`, `unitSize`, `packCount`, `pieceCount`,
`approxWeight`, `quantityStep`, `imageUrl`, `shownPhoto`.

Copy, in `en.json` under `catalog.items`:

| Key | Text |
| --- | --- |
| `packCount` | Units in the pack |
| `packCountHelp` | How many units the pack holds. The size is the whole pack: 4 burgers of 90 g are 360 g and 4 units. |
| `pieceCount` | Pieces inside |
| `pieceCountHelp` | How many pieces the whole product holds, for things counted more than weighed: 2 bags of 50 candies are 100 pieces. Not washes or servings. |

A note under "Pieces inside", read from the form as it is held, when it holds a count and
"Units in the pack" holds one that is equal or greater: "More pieces than units, or leave one
empty." The server refuses that edit anyway (backend `0278` section 2, rule 3); the note says
it before the save.

## 2. The refusal

- `errorFields`: `item_piece_count_not_allowed: 'pieceCount'`.
- `gateway-error-key.ts`: a case that answers `resource.error.itemPieceCountNotAllowed`, with
  the text "Pieces need a size in grams or millilitres, and more pieces than units in the
  pack." and a comment in the style of the step's case.

## 3. The size in the list

`formatSize` takes `pieceCount` beside `packCount` and prints the form O1 picks. Whatever the
choice:

- A count of 1, null or absent prints nothing for that count, as today.
- The weight of one unit is the size divided by the pack count. When the result is not whole at
  the precision printed, it starts with `~`, the mark this file already uses for an approximate
  weight (`APPROX_MARK`).
- The harvest queue calls `formatSize` with a source entry, which has no `pieceCount`, so its
  text does not change.

## 4. Specs

- `catalog-descriptors.spec.ts`: both fields in the section in the order of section 1, the
  bounds, `carriesPieceCount` for each unit with and without a size, and the hidden field
  saving `null` when the size is cleared.
- `product-format.spec.ts`: a 360 g pack of 4, a 70 g pack of 2 with 100 pieces, a 35 g bag of
  50 pieces, 185 g in 7 (not whole), a pack with no size, and a source entry with a pack count
  printed as before.
- `gateway-error-key.spec.ts`: the new code answers its key.
- The memory seed holds one product of each kind above, so the walk can be done on it.

## 5. Acceptance criteria

- [ ] Both fields are in the section "sold", with the server's bounds.
- [ ] "Pieces inside" shows only beside a size in grams or millilitres, and a hidden one saves
      `null`.
- [ ] `item_piece_count_not_allowed` is said under "Pieces inside".
- [ ] The products list prints the size as O1 decides; the harvest queue is unchanged.
- [ ] Specs, lint and `npx nx build luna-shopper-admin` pass.

## Not in this plan

- Any backend change (backend plan `0278`).
- A count on a source entry in the harvest queue (backend `0278`, O1).
- Bulk setting of counts over many products. The 22 waiting rows go through backend `0278`
  section 7.

## Open decisions for the owner

**O1. How does the products list print a size with counts?**

- **A. Total first, as velista does (recommended).** The number a curator reads first is the
  number they would type back as the size, as admin plan `0072` asks of a doubted row.
  Examples: "360 g (4 x 90 g)", "70 g (2 x 35 g) · 100 pieces", "185 g (7 x ~26 g)".
- **B. As today, the count and one unit, with the pieces after it.** Examples: "4 x 90 g",
  "2 x 35 g · 100 pieces".
- **C. The size alone, and two columns for the counts.** Examples: "360 g" with "4" and an empty
  cell; wider rows on a phone.

## Decisions

- **O1: A** (the owner, 2026-11-26). The products list prints the whole size first, as velista
  does: "360 g (4 x 90 g)", "70 g (2 x 35 g) · 100 pieces". The sign is "x", the one the admin
  already prints for a pack.
