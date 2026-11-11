# 0259: a settlement records what the till charged

> Decided on 2026-11-09. Plan `0246` gave a list line a unit, and its decision M7 made the
> price of a weighed settlement the price of one kilo or one litre, so that what was spent
> is that price times the grams over a thousand. That is right for a loose product. It is
> wrong for a weight served by packs or pieces: a shopper who asks for 1 kg and takes two
> 750 g packs at 1,39 € paid 2,78 € for 1,5 kg, and the history reads 1,85 € for 1 kg. The
> gateway's own code names the limit (`settle-price.service.ts`, the comment above `paidOf`),
> and PR #959 marked every weighed settlement estimated to be honest about a number it knew
> was off. Nothing stored says how many packs were taken or what one pack cost.
>
> This plan makes a settlement record what the till charged: the price of one pack and the
> amount of the line's unit that one pack covers, and the quantity as the whole packs that
> were taken. It also records how much of that the line asked for, so an over buy is a fact
> and not a diff, and a revert gives back what the line asked and not what was bought.
>
> It amends `0246` M7 and section 3.5, and it reverses finding 4 of PR #959's first review.
> The client half is velista `0184`. Both land after PRs #959, #960 and #961 are in `dev`,
> and nothing here is built on their branches.
>
> Prerequisite reading: `0246` sections 0 (M7), 2, 3.5 and 7; `0244` section 4 (what a kilo
> piece records); `0143` sections 2 and 4.3 (why `pricePaidCents` is a price per unit and
> never a total); `0104` section 3.2 (a revert smaller than a row splits it); `0202` section 3
> (a change of product rewrites buys); `0047` section 4.2 (a settlement keeps what was
> bought, not what was owed). Code, on `dev` once the three PRs are in (the line numbers are
> those of `feat/velista-0183-line-unit-chip` on 2026-11-09):
> `gateway/src/app/baskets/settle-price.service.ts` (`paidOf`, `:578`; `lookupAtShop`,
> `:332`; `lookupCheapest`, `:395`; `lookupForRewrite`, `:427`),
> `gateway/src/app/lists/list.controller.ts` (the list settle, `:688`),
> `gateway/src/app/baskets/basket.controller.ts` (the basket settle's price, `:466`),
> `core/src/app/entities/line-settlement.entity.ts` (`:113`, `:219`),
> `core/src/app/lists/settlement-paid.ts` (`paidColumns`), `core/src/app/lists/settlement.service.ts`
> (`:204`), `core/src/app/baskets/basket-settle.service.ts` (`:174`, `:201`),
> `core/src/app/baskets/basket-revert.service.ts` (`:161`), `core/src/app/baskets/basket-product-change.service.ts`
> (`priceOf`, `:392`), `core/src/app/baskets/basket-rows.ts` (`allocateOldestFirst`, `:652`;
> `toRuleEntry`, `:317`; `rowNumbersOf`), `core/src/app/purchases/purchases.sql.ts` (`:263`),
> `libs/luna-shopper/contracts/src/lib/messages/list.messages.ts` (`SettlementPaid`, `:1047`;
> `LineSettlementView`, `:1199`), `basket.messages.ts` (`BasketScopePrice`, `:857`),
> `purchase.messages.ts` (`PurchaseRowView`, `:162`).

## Brief for the agent

### Objective

Make every settlement hold enough to draw what was really bought and really paid, with no
guessing: the price of one pack or piece or kilo, how much of the line's unit that one
covers, the whole packs taken, and how much of it the line asked for. Make every sum, every
split and every view read those columns through one formula.

### Context

- `line_settlements.pricePaidCents` is the price of one of `unit`: a piece or pack for
  `UNIT`, a kilo or litre for `GRAM` and `MILLILITER` (`line-settlement.entity.ts:219-225`).
  Every reader multiplies it by `quantity` and divides by 1000 for a weighed row:
  `purchases.sql.ts:263-272` as `numeric`, rounded once per entry.
- The gateway derives that per kilo figure for a pack as `price × 1000 / bridge.amount`
  (`settle-price.service.ts:604-610`), and for a kilo piece records the price of a kilo
  (`:598-603`). Since finding 4 of PR #959's first review every weighed settlement is
  `estimated: true` whatever served it (`:571-572`).
- `quantity` is what was bought, and may exceed what the line asked (`line-settlement.entity.ts:107-112`).
  The list settle floors the line at zero (`settlement.service.ts:204`), the basket settle
  does the same per entry (`basket-settle.service.ts:177-178`), and `allocateOldestFirst`
  puts the surplus on the last entry (`basket-rows.ts:663-669`). Nothing records how much
  of a buy the line had asked for: the line's quantity moves, and a basket trip row's
  `asked` exists only for a basket.
- A revert walks the standing buys newest first and takes `min(need, candidate.quantity)`
  from each, splitting a row it empties in part (`basket-revert.service.ts:161-209`), and
  adds every unit it took back onto the line (`:230-235`). A buy of 1500 g on a line that
  asked 1000 g thus comes back as a line of 1500 g.
- A partial revert copies the four price columns onto the remainder row, and the comment
  there says why the column is a price per unit: a total would have to be split
  (`basket-revert.service.ts:189-194`). A change of product copies the place and takes the
  new product's price per scope (`basket-product-change.service.ts:392-410`).
- `lineAmountOf` in contracts already answers the cost of whole packs for an amount, with
  `pieces` (`libs/luna-shopper/contracts/src/lib/units/line-amount.ts:80-92`), and velista's
  settle sheet draws it live under its reel. The basket total prices whole packs the same
  way. Only the settlement does not.
- PRs #959 to #961 are open and unmerged on 2026-11-09, and production holds no weighed
  line, so no row carries the defect yet. The 3 legacy rows of `0246` M2 count pieces and
  are untouched by this plan.
- Plan `0240` (one baseline migration per service) is written and not built: the migrations
  directory on `dev` still ends in `1756004000000-AssistantAllowance` and the `0246` branch
  adds `1756004100000-LineUnit`.

### Target state

1. `line_settlements.paidFor`: the base units of `unit` that one `pricePaidCents` buys. 1 for
   a count, 1000 for a loose product, the pack's size for a pack, the approximate weight for
   a kilo piece on a weighed line. What was spent is `pricePaidCents × quantity / paidFor`
   everywhere, rounded once, and the "per kilo" reminder is `pricePaidCents × 1000 / paidFor`.
2. `line_settlements.wanted`: how much of `quantity` the line asked for at the moment of the
   settle, in `unit`. `quantity − wanted` is the over buy. A revert gives `wanted` back to
   the line, never `quantity`.
3. On a weighed line served by a pack or a piece, the gateway rounds the quantity up to whole
   packs before core writes, and the settlement's `quantity` is those whole packs: 1 kg of
   750 g packs is recorded as 1500 g, two packs, 2,78 €.
4. `estimated` is false for a count at a pack price and for whole packs of a sized pack. It is
   true for a loose product, for a kilo piece, and for any weighed row whose `quantity` is
   not a multiple of its `paidFor`.
5. Every view that carries `pricePaidCents` carries `paidFor` beside it, and the settlement
   views carry `wanted`. The basket row and entry views carry `over`, the units bought
   beyond what the entries asked.
6. The purchases SQL, the revert, the change of product and the partial split all read or
   copy the new columns and never divide a total.
7. The OpenAPI document and the wire types are regenerated and committed.

### Scope

- Work in `libs/luna-shopper/contracts`, `apps/luna-shopper-backend/core`, `gateway` and
  `assistant` (one sentence of a tool result), and the generated documents.
- Do NOT touch velista (velista `0184`), the back office (owner's decision O5), catalog, the
  harvester, `lineAmountOf` or `priceOfOne`.

### Constraints

- O1 to O6 of section 0 are the owner's and are settled. M1 to M8 are the writer's; the owner
  may overrule them before the build.
- Build only once PRs #959, #960 and #961 are in `dev`. The migration is a new file after
  `1756004100000-LineUnit`.
- `pricePaidCents` stays a price per one and never becomes a total. Plan `0143` section 4.3
  stands, and this plan depends on it: a row split on a partial revert copies `paidFor` and
  the formula stays right on both halves.
- Every quantity on the wire and in a column stays an integer in base units.
- No dashes as punctuation in any prose or comment.

### Action boundaries

- Proceed with everything in sections 1 to 6.
- Stop and ask if plan `0240` has landed in `dev`: the columns then go into the baseline by
  that plan's rules.
- Stop and ask if `paidOf` on `dev` differs from `settle-price.service.ts:578-613` of the
  `0246` branch in any branch other than its comments.
- Stop and ask before changing `MIN_CLIENT_VERSION` anywhere. Section 7 says why it should
  not move.

### Progress evidence

Each criterion of section 6 with its spec output, the migration run up, down and up on a
slot, and one HTTP walk on an ephemeral slot: a `GRAM` line of 1000 on a product sold as a
750 g pack at 1,39 €, settled for 1000, records `quantity 1500`, `wanted 1000`,
`pricePaidCents 139`, `paidFor 750`, `estimated false`; the purchases read shows `spent 278`
and `estimated false`; a revert of 1500 puts the line back at 1000 and marks the row.

## 0. Decisions

The owner's, 2026-11-09, not to reopen:

- **O1. A settlement records what was taken, and keeps what was asked.** Two 750 g packs for
  a 1 kg line are 1500 g bought. The 1000 g the line asked for is stored on the same row, so
  the history can say the shopper got 500 g more than needed. It is a stored fact and not a
  diff against a line that an edit may move later.
- **O2. The gateway rounds to whole packs.** The client previews the same rule and sends what
  the shopper chose; the server decides what is written. One rule, one place.
- **O3. A buy of whole packs loses the estimate mark.** The till charged exactly two packs.
  "≈" means the scale decides, as it does for a loose product and for a kilo piece. It does
  not mean the model is rough.
- **O4. A new plan and a new PR**, after the three open PRs are merged. Nothing on their
  branches changes.
- **O5. The back office is not touched.**
- **O6. A revert of a buy gives the whole buy back.** Taking back the tick on the basket row
  reverts 1500 g, not the 1000 g the line asked for, and the line returns to the 1000 g it
  asked. Nothing stays bought.

The writer's, open to the owner:

- **M1. One column, `paidFor`, and one formula.** `pricePaidCents` keeps its meaning of a
  price of one; `paidFor` says how much of the unit that one is. M7's `CASE unit WHEN 'UNIT'
  THEN 1 ELSE 1000 END` becomes a column, because the pack is a third case the `CASE` cannot
  state and the kilo piece a fourth. The formula is linear in `quantity`, which is what lets
  a split row and an allocation across lines keep the price without dividing anything.
- **M2. `wanted` is a second amount, not a flag.** `min(quantity, the line's quantity before
  the write)` per settlement row. On a partial revert the over buy goes back first, then what
  was wanted (section 3.4), so the line never climbs above what it asked.
- **M3. `estimated` is decided in core, beside the price.** The gateway says whether the
  price of one is itself an estimate (a loose product, a kilo piece). Core adds the second
  half: a weighed row whose `quantity` is not a multiple of `paidFor` is an estimate, because
  no till charges a fraction of a pack. This covers the remainder of a partial revert and a
  change of product onto a pack of another size without a rule in either place.
- **M4. The rounding is the gateway's.** `paidOf` answers whether its `paidFor` is indivisible
  (a pack or a piece) and the controller rounds `quantity` up to the next multiple before
  core is asked. Core stores what it is told. A settle with no price, because catalog did not
  answer, is not rounded: nothing says what a pack is.
- **M5. `asked` on a basket row stays `bought + left`.** Plan `0136` computes it and stores
  it nowhere, and velista uses it as the ceiling of the row's reel, which must reach the whole
  buy for O6. The over buy is served beside it as `over`, on the entry patch and on the row.
- **M6. The migration backfills.** `paidFor` is 1 for `UNIT` rows and 1000 for the others,
  which keeps every spend that exists today at its value. `wanted` is `quantity` on every
  existing `BOUGHT` row: an over buy from before this plan reads as wanted, and no row in
  production is weighed, so nothing of value is lost.
- **M7. The wire grows, nothing shrinks.** `paidFor`, `wanted` and `over` are new fields on
  the views. A client that does not read `paidFor` computes M7's spend, which is only wrong
  for a pack served weight, and no released client can hold one: velista `0182` is unreleased
  and lands in the same release train as velista `0184`. `MIN_CLIENT_VERSION` does not move
  for this plan.
- **M8. A change of product keeps the grams.** A buy of 1500 g rewritten onto a 500 g pack is
  three packs and exact; onto a 700 g pack it is 1500 g at the pack's price over 700, and M3
  marks it estimated. No rounding happens on a rewrite: the shopper took what they took.

## 1. The shape

Two columns on `line_settlements`, both `NOT NULL`:

| Column | Type | Meaning |
| --- | --- | --- |
| `paidFor` | `int`, default 1 | Base units of `unit` that one `pricePaidCents` buys. 1 for `UNIT`. 1000 for a loose product in `GRAM` or `MILLILITER`. The pack's size in its base unit for a pack. `approxWeight` for a kilo piece on a `GRAM` line. |
| `wanted` | `int`, default 0 | How much of `quantity` the line asked for when this was settled, in `unit`. 0 for `NOT_AVAILABLE`. |

The two formulas, used by every reader and stated once in a comment on the column:

```text
spent      = round_half_up(pricePaidCents × quantity / paidFor)
per kilo   = pricePaidCents × 1000 / paidFor          (GRAM and MILLILITER only)
over buy   = quantity − wanted
```

What a settle writes, by what served the line:

| Line unit | Served by | `quantity` written | `pricePaidCents` | `paidFor` | `estimated` |
| --- | --- | --- | --- | --- | --- |
| `UNIT` | a pack | as sent | the pack's `price` | 1 | false |
| `UNIT` | a kilo piece | as sent | `piecePrice` | 1 | true |
| `UNIT` | a loose product (legacy, `0246` M2) | as sent | `price` | 1 | true |
| `GRAM` | a loose product | as sent | `price` of a kilo | 1000 | true |
| `GRAM` | a sized pack of `s` grams | `⌈q / s⌉ × s` | the pack's `price` | `s` | false |
| `GRAM` | a piece priced as one, weight `w` | `⌈q / w⌉ × w` | `price` | `w` | true |
| `GRAM` | a kilo piece, weight `w` | `⌈q / w⌉ × w` | `piecePrice` | `w` | true |
| `MILLILITER` | a product by the litre | as sent | `price` of a litre | 1000 | true |
| `MILLILITER` | a sized pack of `s` millilitres | `⌈q / s⌉ × s` | the pack's `price` | `s` | false |
| any | a product that cannot serve the unit, or no price | as sent | null | the unit's default (1 or 1000) | false |

The examples the specs assert, all on a 1000 g `GRAM` line, settled for 1000:

| Product | Written | Spent | Per kilo | Mark |
| --- | --- | --- | --- | --- |
| loose bananas, 1,99 €/kg | 1000 g, 199, 1000 | 1,99 € | 1,99 € | ≈ |
| 750 g pack at 1,39 € | 1500 g, 139, 750 | 2,78 € | 1,85 € | none |
| 500 g pack at 1,39 € | 1000 g, 139, 500 | 2,78 € | 2,78 € | none |
| kilo piece, about 700 g, piece 1,39 € | 1400 g, 139, 700 | 2,78 € | 1,99 € | ≈ |
| piece priced as one, about 1,8 kg, 2,50 € | 1800 g, 250, 1800 | 2,50 € | 1,39 € | ≈ |

`wanted` is 1000 on every row above, and the over buy is 500 g, 0 g, 400 g and 800 g.

## 2. Gateway

### 2.1 `paidOf`

`paidOf(product, offer, unit)` in `settle-price.service.ts` answers
`{ price, paidFor, whole, estimated } | null`:

- `UNIT`: `paidFor 1`, `whole false`; a kilo piece records `piecePrice` and is estimated; a
  pack records `price` and is exact; a legacy loose product records `price` and is estimated.
  Unchanged from today except for the two new fields.
- `GRAM` with a loose product, `MILLILITER` with a product by the litre: `price`, `paidFor
  1000`, `whole false`, estimated.
- `GRAM` with a kilo piece or a piece priced as one with a weight: `piecePrice` or `price`,
  `paidFor approxWeight`, `whole true`, estimated. A kilo piece with no `piecePrice` records
  nothing, as today.
- `GRAM` or `MILLILITER` with a sized pack whose `packBridgeOf` names the unit: `price`,
  `paidFor bridge.amount`, `whole true`, exact.
- Anything else: null.

The comment that names the limit of M7 is replaced by one that names this plan. `paidPriceOf`
keeps answering `paidOf(..., 'UNIT').price`.

### 2.2 The settle rounds

Both settle routes hand `paid` to core beside the request. Both now also hand the quantity
core writes:

```ts
/** The whole packs a quantity needs when what served it comes whole (plan 0259 O2). */
export function wholeQuantityOf(quantity: number, paid: { paidFor: number; whole: boolean } | null): number;
// whole false, or no paid: quantity. whole true: Math.ceil(quantity / paidFor - 1e-9) * paidFor.
```

- The list settle (`list.controller.ts:688-713`) sends `quantity: wholeQuantityOf(dto.quantity ?? 1, paid)`.
- The basket settle (`basket.controller.ts`, the route that calls `:466`) does the same with
  the row's `quantity`. The `from` bargain is untouched: `from` is the sum of the lines'
  quantities, not what is bought, and `allocateOldestFirst` already carries a surplus on the
  last entry (`basket-rows.ts:663-669`).
- The allocation sheet (`allocations` on the basket settle) is a list of amounts the shopper
  typed per line. It is not rounded: the shopper said how the packs fell on the lists, and
  `wanted` per line is still `min(allocated, that line's quantity)`.
- `NOT_AVAILABLE` sends no quantity and is never rounded.

The DTO descriptions of `quantity` on `SettleLineDto` and `SettleBasketRowDto` gain one
sentence: on a weighed line served by packs or pieces the amount is rounded up to whole packs
and the settlement says what was recorded.

### 2.3 The wire

- `SettlementPaid` (`list.messages.ts:1047`) gains `paidFor: number`, with the doc comment of
  section 1. `BasketScopePrice` (`basket.messages.ts:857`) gains `paidFor: number`. The JSON
  schemas in `list.schemas.ts` and `basket.schemas.ts` require both.
- `lookupAtShop`, `lookupCheapest` and `lookupForRewrite` fill it from `paidOf`.

### 2.4 The assistant

`settle_lines` already reports the settlement core answered. Its result sentence names the
recorded amount when it differs from what was asked: "recorded 1,5 kg, two packs of 750 g".
One sentence in the tool's result mapping and one spec. Nothing else in the assistant changes.

### 2.5 The documents

```sh
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

## 3. Core

### 3.1 The entity and the columns helper

`LineSettlement` gains `paidFor` and `wanted` with the comments of section 1. The comment on
`pricePaidCents` (`line-settlement.entity.ts:219-245`) is rewritten: it is the price of one,
`paidFor` says what one is, and the two reasons it is never a total stand.

`SettlementPaidColumns` and `paidColumns` (`settlement-paid.ts`) gain `paidFor`:

- Required beside a price: a `SettlementPaid` with a price and no `paidFor`, or a `paidFor`
  that is not a positive integer, is refused like a price with no currency.
- With no price, `paidFor` is the unit's default: 1 for `UNIT`, 1000 otherwise. The helper
  takes the unit for that.
- `estimated` becomes M3: `bought && price !== null && (paid.estimated === true || quantity % paidFor !== 0)`,
  so the helper takes the quantity written too. A `UNIT` row has `paidFor 1` and the second
  half is always false.

### 3.2 The two settles write `wanted`

- `settlement.service.ts:204`: `remaining = max(0, line.quantity − quantity)`; the row's
  `wanted` is `line.quantity − remaining`.
- `basket-settle.service.ts:174-232`: per entry, `wanted = min(allocated, before)` and the
  row gets it. `NOT_AVAILABLE` rows write 0.

### 3.3 The views

- `LineSettlementView` (`list.messages.ts:1199`) gains `paidFor` and `wanted`; `toLineSettlementView`
  maps them. The doc comment of `pricePaidCents` there (`:1260-1272`) is rewritten.
- `PurchaseRowView` (`purchase.messages.ts:162`) gains `paidFor`. The row key of the fold
  (`purchases.sql.ts:346`, `:421`) gains `paidFor`, so two buys at one price of one but of
  two pack sizes are two rows.
- `BasketEntryPatch` and `BasketRowView` gain `over: number`: the sum of `quantity − wanted`
  over the entries' standing `BOUGHT` settlements, computed where `bought` is
  (`basket-rows.ts:325`, `rowNumbersOf`). `asked` stays `bought + left` (M5).
- The realtime line events carry the settlement view, so they carry the fields.

### 3.4 The revert

`basket-revert.service.ts:161-214`. For each candidate, newest first, with
`take = min(need, candidate.quantity)`:

```text
over       = candidate.quantity − candidate.wanted
fromOver   = min(take, over)
fromWanted = take − fromOver
restored[line] += fromWanted
remainder row (if take < candidate.quantity):
  quantity = candidate.quantity − take
  wanted   = candidate.wanted − fromWanted
  paidFor, pricePaidCents, currency, scope, shop, chain, snapshot copied
  estimated recomputed by M3 for the new quantity
```

The line thus climbs by what it asked and never by what was bought (O6). A full revert of a
1500 g buy that wanted 1000 g restores 1000 g. A revert of 250 g from it marks the row, writes
a remainder of 1250 g with `wanted 1000`, estimated, and restores nothing: the 250 g came off
the over buy. The comment at `:189-194` is extended with the one new column and the reason it
can be copied.

`LineChangeRecorder.buyReverted` is called with the quantities as today; the amounts it sees
are the line's before and after.

### 3.5 The change of product

`basket-product-change.service.ts`: `pricesByScope` validates `paidFor` beside the price;
`priceOf` copies it onto the replacement row beside the four columns; the replacement row
copies `wanted` from the row it replaces, and `estimated` is M3 for the row's own quantity
(M8). The unscoped price path reads `paidFor` off the `SettlementPaid` as a settle does.

### 3.6 What was spent

`purchases.sql.ts:263-272`:

```sql
SUM(p."pricePaidCents"::numeric * p."quantity" / p."paidFor")
  FILTER (WHERE p."outcome" = 'BOUGHT' AND p."pricePaidCents" IS NOT NULL) AS "spent"
```

The `CASE` on `unit` goes. `estimated` stays `BOOL_OR(p."estimated")`. The comment above it is
rewritten to name this plan. Every other `SUM(quantity)` that `0246` grouped by unit is
unchanged: `paidFor` changes money, not amounts.

### 3.7 The migration

`1756004200000-SettlementPaidFor` in core, next after `1756004100000-LineUnit`:

```sql
ALTER TABLE "line_settlements" ADD COLUMN "paidFor" integer NOT NULL DEFAULT 1;
ALTER TABLE "line_settlements" ADD COLUMN "wanted" integer NOT NULL DEFAULT 0;
UPDATE "line_settlements" SET "paidFor" = 1000 WHERE "unit" <> 'UNIT';
UPDATE "line_settlements" SET "wanted" = "quantity" WHERE "outcome" = 'BOUGHT';
ALTER TABLE "line_settlements"
  ADD CONSTRAINT "ck_line_settlements_paid_for" CHECK ("paidFor" > 0);
ALTER TABLE "line_settlements"
  ADD CONSTRAINT "ck_line_settlements_wanted" CHECK ("wanted" >= 0 AND "wanted" <= "quantity");
COMMENT ON COLUMN "line_settlements"."paidFor" IS 'Base units of "unit" that one "pricePaidCents" buys (plan 0259): 1 for a piece or pack, 1000 for a kilo or litre of a loose product, a pack''s size for a pack. Spent is pricePaidCents × quantity / paidFor.';
COMMENT ON COLUMN "line_settlements"."wanted" IS 'How much of "quantity" the line asked for when it was settled (plan 0259 O1). quantity − wanted is the over buy, and a revert gives wanted back.';
COMMENT ON COLUMN "line_settlements"."pricePaidCents" IS 'The price of one, where "paidFor" says what one is (plan 0259). Never the row total.';
```

`down` drops the two constraints and the two columns and puts back the comment of plan
`0246`. No release task: no row's money changes, and the backfill is M6.

## 4. Contracts and schemas

Section 2.3 and 3.3 name every field. `line-amount.ts` and `line-unit.ts` are not touched:
`lineAmountOf` already answers the cost of whole packs and its `pieces`, and the gateway's
`wholeQuantityOf` is the only new pure function, placed beside `paidOf` with a spec.

## 5. Merge order

This plan lands after PRs #959, #960 and #961. Velista `0184` lands after this plan is on a
gateway and before the next rollup from `dev` to `main`, in the same velista release as
`0182`, so that no released client ever reads a pack served settlement with M7's formula.
`MIN_CLIENT_VERSION` does not move for this plan (M7).

## 6. Acceptance criteria

1. `settle-price.service.spec.ts`: `paidOf` for every row of the first table of section 1,
   including the null rows; `wholeQuantityOf` for a loose product (unchanged), a 750 g pack at
   1000 (1500), at 1500 (1500), at 1 (750), and with no paid (unchanged).
2. The gateway HTTP spec: a `GRAM` settle of 1000 on a 750 g pack sends core `quantity 1500`
   and `paid.paidFor 750`; a loose product sends 1000 and 1000; the allocation sheet is not
   rounded; `NOT_AVAILABLE` is not rounded.
3. `settlement-paid.spec.ts`: `paidFor` required beside a price and refused when not a positive
   integer; the unit's default with no price; `estimated` true for a weighed quantity that is
   not a multiple of `paidFor` and false for one that is; a `UNIT` row never estimated by the
   second half.
4. `line-settlement.spec.ts` and the basket settle specs: `wanted` is `min(quantity, before)`
   on the list settle and per entry on the basket settle; the surplus entry records the over
   buy; `NOT_AVAILABLE` writes 0.
5. `basket-revert.service` specs: a full revert of 1500 wanted 1000 restores 1000; a revert of
   250 off it restores 0 and leaves a remainder of 1250 wanted 1000, estimated, with `paidFor`
   copied; a revert of 700 restores 200 and leaves 800 wanted 800; two buys newest first.
6. `basket-product-change.spec.ts`: the replacement row copies `wanted`, takes the new
   `paidFor`, and is estimated exactly when its quantity is not a multiple of it.
7. The purchases specs: the five examples of section 1 read the spends of that table; a row
   key separates two pack sizes at one price; `estimated` follows the rows.
8. The basket read specs: `over` on the entry patch and the row, `asked` unchanged.
9. The migration runs up, down and up on a slot; `openapi.json` and `wire-types.ts` are
   regenerated; `npx nx affected -t lint test` is green.

## 7. Known and not changed

- **The legacy rows of `0246` M2** (a count line holding a loose product) keep recording
  `price` as an estimate with `paidFor 1`. They are three rows in production and the next
  edit of each line moves it to grams.
- **A revert off the over buy restores nothing to the line**, by M2. The shopper took back the
  extra pack, and the list still asked for what it asked for.
- **The basket's `asked` reads the whole buy** on a row that was over bought (M5), and `over`
  says how much of it was extra. Drawing that is velista `0184`.
- **A trip row's `asked`** (`basket_trip_rows.asked`) is the line's amount when the row was
  written and is not touched: it is about the trip, not the buy.
- **Receipts** (backlog `0008`) would turn the two remaining estimates into facts. Not here.
- **The back office** keeps drawing `pricePaidCents` as it does (O5). Its spend, if it draws
  one, is wrong for a pack served weight until a later admin plan reads `paidFor`.
- **What a suggestion does with an over buy** is backlog `0022`.
