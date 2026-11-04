# 0068 A piece sold by the kilo is edited with its weight

> Backend half: plan `0244` of `apps/luna-shopper-backend/plans/` (a piece sold by the kilo
> states its approximate weight). That plan must be merged first: it adds the fields this plan
> edits and the error code this plan explains. velista half: velista plan `0179`.
>
> **Reviewed on 2026-11-04** with backend plan `0244`. The weight is allowed on any product
> with no size, not only on a `KILOGRAM` one, and the error code is
> `item_approx_weight_beside_size`. The form rule below is "a size or a weight, never both",
> and a `KILOGRAM` product has no size at all (plan `0237` section 3.3).
>
> Evidence: `apps/luna-shopper-backend/docs/kilo-pieces-2026-11/`, sections 4 and 6.
>
> Mock: none. The changes sit inside forms and a tab that exist. Section 2 says what is drawn.
> **Ask the owner before you build whether a mock comes first.**

## Brief for the agent

### Objective

Let a person see and edit the approximate weight of a piece, stop a person from saving a size
beside a weight (or a size on a product sold by the kilo) before the server refuses it, and
show the piece price of a kilo piece beside its price per kilo. Use the
`nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`, `antislop-ui` and
`antislop-copywriting` skills.

### Context

Backend `0244` gives a product with no size an optional `approxWeight` in grams, and
`approxWeightSetBy` (`SOURCE` or `ADMIN`). A run rewrites a `SOURCE` weight with the latest
read and never an `ADMIN` one. What the price of such a product means is still decided by its
unit: a kilo for `KILOGRAM` (a kilo piece, with a derived `piecePrice` on every offer), the
piece for `UNIT` (a piece priced as one, `piecePrice` null). Two refusals guard the rule:
`item_kilogram_has_size` (plan `0237` section 3.3) and the new `item_approx_weight_beside_size`.

What the back office does today (evidence section 4):

- The product form (`libs/luna-shopper-admin/feature-catalog/src/lib/items.ts:194` to `211`)
  offers `KILOGRAM` (`catalog-enums.ts:34`) and a nullable `unitSize` side by side, with no
  local check. Neither refusal has a message in the admin translations.
- The create form of the queue (`libs/luna-shopper-admin/feature-harvest/src/lib/entries-queue-page.ts:539`
  to `561`) fills the size from the row (line 1684) and offers `KILOGRAM` too.
- `formatSize` (`products/product-format.ts:96`) prints nothing for `KILOGRAM` with no size.
- The prices tab (`products/product-prices-tab.ts:1093` to `1106`) prints the price and the
  unit price, both the price of a kilo for a product sold by the kilo.
- `proposeUnitPrice` (`price-proposal.ts:44` to `65`) divides the price by the size. For a
  product sold by the kilo the unit price is the price itself.

### Target state

1. **The product form.** The size field and an "Approximate weight (g)" field are both in the
   "sold" section, and one excludes the other: a typed size clears and disables the weight, a
   typed weight clears and disables the size. With `KILOGRAM` chosen, the size field is not
   offered at all (a product sold by the kilo has no size) and the weight field is, empty by
   default. Below the weight field, a line says who set it: "From the chain, updated by each
   run" or "Typed by a person. Runs do not change it", with a "Use the chain's weight" action
   that sends `approxWeight: null`. Beside the unit, one hint says what the price means for the
   chosen unit: "The prices of this product are per kilo" for `KILOGRAM`, nothing otherwise.
2. **The create form of the queue.** A row with a weight proposes no size and the row's weight,
   with `KILOGRAM` when the row is sold by weight and `UNIT` when it is not. A person can still
   choose a fixed pack, and then the weight is dropped.
3. **The two refusals** have messages in the admin translations, and the form maps each to the
   field it names (the size for `item_kilogram_has_size`, the weight for
   `item_approx_weight_beside_size`).
4. **The product list and the record** print "approx. 1.56 kg" for any product with a weight
   (`formatSize`), and "by the kilo" for a product sold by the kilo with no weight.
5. **The prices tab** prints, for a kilo piece, the piece price of the offer ("20,94 €") beside
   the price per kilo ("13,42 € / kg"). For a product sold by the kilo with no weight, it prints
   the price once, with "/ kg". For a piece priced as one, as for a pack.
6. **The price form** proposes, for a `KILOGRAM` product, a unit price equal to the price and
   the label `kg`. For a `UNIT` product with a weight it proposes the price over the weight,
   per kilo, which the operator may change.
7. The admin models read `approxWeight`, `approxWeightSetBy` and `piecePrice` from the
   regenerated `wire-types.ts` (admin plan `0004` section 2).

### Scope

- Work in `libs/luna-shopper-admin/feature-catalog`, `libs/luna-shopper-admin/feature-harvest`,
  `libs/luna-shopper-admin/models` (not the generated file) and the admin translations.
- Do NOT touch the backend, velista, or `wire-types.ts` by hand.

### Constraints

- The server stays the authority. The local checks only stop a request that the server would
  refuse, with the same rule as `requireBaseUnit` and backend `0244` section 3.2.
- The piece price shown is the server's `piecePrice`. The back office does not compute it.

### Action boundaries

- Ask the owner whether a mock comes first. Proceed only after the answer.
- Stop and ask if backend `0244` is not merged, or its wire shape differs from its section 3.3.

### Progress evidence

Each criterion of section 3 with its spec output, `npx nx build luna-shopper-admin`, and one
walk on a slot with backend `0244`: the cheese of the evidence folder (or a seeded piece) shows
"approx. 1.56 kg", a person edits the weight to 1500, a Mercadona run over fixtures leaves it
at 1500, and "Use the chain's weight" hands it back to the next run. A seeded `UNIT` piece of
580 g shows "approx. 580 g" and its price as a pack's.

## 1. Copy

| Key | English | Spanish |
| --- | --- | --- |
| weight field | Approximate weight (g) | Peso aproximado (g) |
| weight from the chain | From the chain, updated by each run | De la cadena, se actualiza en cada lectura |
| weight from a person | Typed by a person. Runs do not change it | Escrito por una persona. Las lecturas no lo cambian |
| hand back | Use the chain's weight | Usar el peso de la cadena |
| price per kilo hint | The prices of this product are per kilo | Los precios de este producto son por kilo |
| `item_kilogram_has_size` | A product sold by the kilo has no size. Give it an approximate weight instead, or choose grams. | Un producto que se vende por kilo no tiene tamaño. Dale un peso aproximado, o elige gramos. |
| `item_approx_weight_beside_size` | A product has a size or an approximate weight, not both. Clear one of them. | Un producto tiene tamaño o peso aproximado, no los dos. Borra uno de ellos. |
| by the kilo | by the kilo | por kilo |

## 2. What is drawn

No new screen, no new section. The weight field sits beside the size field in the "sold"
section of the product form (`items.ts:346`), and for `KILOGRAM` it takes the size field's
place, so the form keeps its height. The "who set it" line and the price per kilo hint are the
hint text style the form already uses. The prices tab adds one value to the offer row and no
column.

## 3. Acceptance criteria

1. Form specs: typing a size clears and disables the weight, and typing a weight does the
   opposite; choosing `KILOGRAM` hides the size and shows the weight; choosing GRAM shows the
   size again and keeps a typed weight only while the size is empty. The save request of a
   kilo piece sends `approxWeight` and `unitSize: null`; the save of a `UNIT` piece with a
   weight sends the same with `defaultUnit: 'UNIT'`.
2. A spec per refusal maps the error to its field with the message of section 1.
3. Queue specs: a row sold by weight with a weight proposes `KILOGRAM`, no size, the weight. A
   row not sold by weight with a weight proposes `UNIT`, no size, the weight.
4. `formatSize` specs: 1560 answers "approx. 1.56 kg", 395 answers "approx. 395 g" for a
   `UNIT` product too, a loose product answers "by the kilo", a 250 g pack is unchanged.
5. A prices tab spec: a kilo piece prints its `piecePrice` and its price per kilo; a `UNIT`
   piece prints its price once.
6. `proposeUnitPrice` specs: a `KILOGRAM` product proposes the price itself, label `kg`; a
   `UNIT` product of 580 g at 6.50 proposes 11.2069 per kg.
7. `npx nx affected -t lint test` is green, and `npx nx build luna-shopper-admin` builds.
