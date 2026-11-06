# 0183: a line with several products chooses its unit

> Decided on 2026-11-05. A line can hold several products: the ones a catalog group gave it,
> or the ones a shopper added on the line page. When those products are of different kinds,
> loose bananas beside a bunch sold as a piece beside a bag, the line can be served by weight
> or by the piece, and only the shopper knows which they mean. Backend `0246` W1 lets such a
> line, and only such a line, choose its unit. This plan is that choice drawn, and the rule of
> W3 for which product of the line is the cheaper one.
>
> Needs velista `0182` first (the unit on the model, the writes and the reel), and backend
> `0246` on the gateway. No mock before the build: the chip is a segmented control of two or
> three words on sheets that exist, and the member cards gain one line of words each. If the
> owner wants to see it first, `apps/velista/plans/mocks/` has the canvas recipe.
>
> Prerequisite reading: backend `0246` sections 0 (W1, W3, M4, M5), 1, 2 and 4.3; velista
> `0182`; velista `0137` section 2 (the word CHEAPEST on a card of the line page); velista
> `0115` (why groups left the typeahead); the basket change sheet
> (`feature-shopping-lists/src/lib/change-sheet/`). Code: `libs/velista/models/src/lib/line-products.ts`
> (`lineProductPrices`, `orderLineCards`, `lineShownProduct`, `lineCardOrder`),
> `basket-page.ts` (`groupCheaper`), `line-detail-sheet.ts` ("Which one"), `line-page.ts`.
> Load the `nx-portfolio-angular-developer` skill before any code, and `design-taste-frontend`
> for the chip and the member cards.

## Brief for the agent

### Objective

On a line whose products offer more than one unit, let the shopper pick the unit, start the
amount at the default of that unit, show which products can serve it, and order those
products by the cost of the line's amount (W3), with the price of one and that cost drawn
on each.

### Context

- The line page draws the line's products as cards, ordered by `orderLineCards` with one
  marked CHEAPEST by `lineProductPrices`: the lowest price per kilo or litre first, then the
  price. The basket marks a cheaper member with `groupCheaper` and opens the change sheet,
  which replaces the product for every list. The line detail sheet asks "Which one" when
  buying. The settle sheet has no member picker: a basket row is one product (backend `0201`).
- The gateway's own pick (`cheapestOf`, backend `0246` section 4.3) becomes: members that can
  serve the line's unit, ordered by the cost of the line's amount, or by the price of one when
  the line is at 0. Velista's copy of the order must agree with it, as velista `0181` agrees
  with `0245` for the catalog.
- Velista never sends `productGroupId` on add and the typeahead drops group rows (`0115`),
  so a line with several products comes from the line page's product set, from
  `adoptItemIds`, or from a server flow. Production holds 4 such lines.
- Backend `0246` refuses a unit the line's products do not offer (`line_unit_not_offered`)
  and requires a quantity with every unit change.

### Target state

1. A `lineUnits(products)` in `models` mirrors backend `0246`'s `lineUnitsOf`: the union of
   each product's own unit and the units it can also serve (a sized pack serves grams or
   millilitres through its size, a piece with a weight serves grams). It answers `['UNIT']`
   for an empty or free text line.
2. **The chip** appears on the line detail sheet and the line page, beside the reel, only
   when `lineUnits` has two or more entries: a segmented control reading "pieces", "weight",
   "volume" (`line.unit.UNIT`, `line.unit.GRAM`, `line.unit.MILLILITER`; Spanish "unidades",
   "peso", "volumen"). On a line with one unit nothing is drawn, as W1 says.
3. Choosing a unit sends one `updateLine` with `unit` and `quantity = defaultQuantity(unit)`
   (1, 1000 or 1000). The reel moves to that value and steps by the new unit. The chip is
   disabled while the write is pending, and a `line_unit_not_offered` puts it back and shows
   the sheet's error line.
4. **Members that cannot serve the unit are kept and marked.** On the line page's cards and
   in the change sheet, a product with no amount for the line's unit (`lineAmount` null) is
   drawn after the ones that have one, with the caption "not sold by weight" or "not sold by
   the piece" (`line.unit.cannot.GRAM` and so on), and it is not a candidate for CHEAPEST or
   for the basket's cheaper mark.
5. **The order and the mark follow W3.** `lineProductPrices` and `groupCheaper` compare
   `lineAmount(line.quantity, line.unit, product, offer).cents`, the cost of the line's
   amount, among the members that can serve the unit, and `amountOfOne(offer, kind)` when
   the line is at 0. On a count line that is the order of the price of one. `unitPrice` and
   the comparable price of `0245` leave this comparison. The doc comment says why: it is
   what the line costs with each product, not the cheapest kilo, which the catalog tab
   answers.
6. **The cost of the line's amount is drawn beside each member**, through `lineAmount`:
   "1 kg · 1,99 €" on the loose product, "2 × ~700 g · ≈ 2,78 €" on the piece, "2 × 500 g ·
   3,98 €" on the bag, for a line at 1000 g. The member marked CHEAPEST is thus always the
   one with the lowest number in that caption. The price of one stays the member's price
   line, as velista `0179` draws it.
7. The product the line counts as (`lineShownProduct`) is the first member in that order
   that can serve the unit, the favourite first when it can.

### Scope

- Work in `libs/velista/models` (`line-products.ts`, `lineUnits`), `feature-shopping-lists`
  (the line detail sheet, the line page, the basket page's mark, the change sheet) and `ui`
  for the chip if it is new, and the two i18n files.
- Do NOT touch the catalog tab, the product page, the typeahead, how a line's product set
  is edited, or any write other than the unit change of target state 3.

### Constraints

- Rule D4: own models. `lineUnits` and the W3 comparison are velista's own code with a spec
  that names backend `0246`'s.
- Copy through RokuTranslator keys; no number inside a key; no dashes as punctuation.
- The chip is one control reused on both sheets, in `libs/velista/ui`, with no raw `<svg>`.
- W3 was first stated as the price of one alone, which would have ordered a 700 g piece at
  1,39 € before one kilo of the same bananas at 1,99 €. Shown the scenarios, the owner
  amended it on 2026-11-05 to the cost of the line's amount (backend `0246` section 0). It
  is settled, and a builder does not reopen it.

### Action boundaries

- Proceed with everything in sections 1 to 3.
- Stop and ask if velista `0182` is not merged or backend `0246` is not on the slot's gateway.
- Stop and ask if `lineUnits` and the gateway disagree on a line of the slot's seed: the two
  must be one rule.

### Progress evidence

Each criterion of section 4 with its spec output, `npx nx build velista`, and one walk on a
slot: a line that holds a loose product and a kilo piece (seed one with the `0244` walk
recipe) shows the chip, "weight" starts it at 1 kg with both members priced and the piece
first, "pieces" starts it at 1 with the loose product marked "not sold by the piece", and
the basket's cheaper mark agrees.

## 1. The rule

```ts
export function lineUnits(products: readonly LineUnitProduct[]): LineUnit[];
```

`LineUnitProduct` is `{ unit, size, approxWeight }`, the fields `soldAs` reads plus the
size. The spec mirrors backend `0246` section 1's "can also serve" column row for row.

The W3 comparator in `line-products.ts`:

```ts
/**
 * W3 (backend 0246): the cost of the line's amount, among the members that can serve
 * the unit; the price of one when the line is at 0. Ascending, null last, input order
 * on a tie.
 */
function cheaperForLine(line: Pick<Line, 'quantity' | 'unit'>): (a: Member, b: Member) => number;
```

`lineProductPrices`, `orderLineCards` and `groupCheaper` go through it, filtered by
`lineAmount(Math.max(line.quantity, 1), line.unit, product, offer) !== null`. Its spec and
the spec of backend `0246`'s `cheapestOf` name each other and share the scenario numbers.

## 2. The chip

`lib-line-unit-chip` in `libs/velista/ui/src/lib/list/`: inputs `units` (the offered list),
`value`, `disabled`; output `chosen`. A segmented control with the sheet's own tokens, the
active segment filled, keyboard arrows move it, each segment is a `radio` of one group. It is
drawn above the reel on the line detail sheet and on the line page, only when `units.length
> 1`. The sheet handles `chosen` with target state 3 and keeps the reel's `unit` in step.

## 3. The members

- **Line page cards**: a card gains one caption line, the cost of the line's amount
  ("2 × ~700 g · ≈ 2,78 €") or the cannot serve text; CHEAPEST follows section 1.
- **The change sheet**: the same caption on each option, the same order, the same marking of
  members that cannot serve the unit. Choosing one that cannot serve the unit is allowed
  (the shopper may have reasons) and the row then shows no amount, as a line with no price
  does today.
- **The basket row's cheaper mark** (`groupCheaper`) reads section 1, so a loose product
  never earns the mark on a count line and a counted pack never on a weight line.

## 4. Acceptance criteria

1. `lineUnits` specs: each row of backend `0246` section 1, an empty set, a set of all kinds,
   and a legacy `LITER` size.
2. `line-products.spec.ts`: on a weight line at 1000 g a loose product at 1,99 € per kilo
   is ordered before a 700 g piece at 1,39 € (two pieces, 2,78 €), at 500 g the loose
   product (1,00 €) still comes first, at 1800 g a 1,8 kg piece priced as one at 2,50 €
   comes before loose at 1,49 € per kilo (2,68 €), at 0 the order is the price of one, a
   counted pack is excluded, and the favourite stays first; on a count line the loose
   product is excluded and two packs order by price; `unitPrice` is no longer read.
3. `groupCheaper` specs: the same three cases through the basket page.
4. The chip's spec: hidden for one unit, three segments for three, `chosen` emits once, the
   sheet sends one `updateLine` with `unit` and the default quantity, and a
   `line_unit_not_offered` restores the previous segment.
5. The caption specs: the cost of the amount for the three kinds at 1000 g, and the cannot
   serve text for a loose product on a count line, in `en` and `es`.
6. `npx nx affected -t lint test` is green and `npx nx build velista` builds.

## Not in this plan

- **Lines bound to a catalog group from the typeahead.** Velista `0115` removed them; this
  plan works on any line with several products however it got them.
- **A unit on a free text line** (backend `0246` W1).
- **The catalog tab's order and the product page's "cheaper option"**, which stay on the
  comparable price of backend `0245` and velista `0181`.
