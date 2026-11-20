# 0184: a settled line shows what the till charged

> Decided on 2026-11-09. Velista `0182` prices a weighed settlement as the price of a kilo
> times the grams (backend `0246` M7), and draws that price as "X / kg" under the row. A
> shopper who asks for 1 kg and takes two 750 g packs paid 2,78 € for 1,5 kg; the history
> reads "≈ 1,85 €" and "1,85 € / kg", and a tick on the basket row then taken back leaves the
> line at 1,5 kg. Backend `0259` makes the settlement record what the till charged: the price
> of one pack, what one pack covers (`paidFor`), the whole packs taken as `quantity`, and what
> the line asked for as `wanted`. This plan makes velista read those fields and draw them:
> the money the till took, drawn with no "/ kg"; under it the price per kilo as a reminder;
> the amount bought with how much of it was extra; and a revert that takes the whole buy back.
>
> Needs backend `0259` on the gateway first, and velista `0182` and `0183` merged. No mock:
> no new control is drawn. A number changes its words and a caption gains a clause.
>
> Prerequisite reading: backend `0259` sections 0, 1 and 3.3; velista `0182` section 3 (the
> settle sheet and the history); velista `0139` section 3 (`gotToday`); velista `0151`
> (`ownBoughtUnits`); backend `0136` section 5.2 (what a revert names). Code:
> `libs/velista/models/src/lib/domain.ts` (`LineSettlement`), `line-detail-view.ts`
> (`toSettlementRow`, `:493`), `purchases.ts` (`PurchaseEntryRow`), `basket-total.ts`,
> `libs/velista/data-access/src/lib/mapping/mappers.ts` (`:623-645`),
> `purchases/purchase-mappers.ts` (`:97`), `baskets/basket-store.ts` (`setLeft`, `:1170`),
> `libs/velista/feature-shopping-lists/src/lib/settle-sheet/settle-sheet.ts` (`amountToGet`,
> `:531`; `gotToday`, `:576`; `_toRow`, `:1550`), `basket-page/basket-page.ts` (`revertRow`,
> `:1362`), `basket-row/basket-row.ts` (`ownBoughtUnits`, `:86`), `basket-labels.ts`
> (`quantityCaption`), `libs/velista/feature-lists/src/lib/line-history-page/line-history-page.html`
> (`:160-190`), `select-line-history.ts` (`factsOf`, `:136`),
> `libs/velista/ui/src/lib/catalog/line-amount-words.ts`. Load the
> `nx-portfolio-angular-developer` skill before any code, and `design-taste-frontend` for the
> captions.

## Brief for the agent

### Objective

Draw a settled weighed line from the settlement's own figures: what was bought, what the till
charged for it with no per kilo words, the per kilo price as a reminder, and how much was
bought beyond what the line asked. Preview the whole packs on the settle sheet before the buy,
and take the whole buy back on a revert.

### Context

- `toSettlementRow` (`line-detail-view.ts:529-538`) computes the spend as
  `unitPriceCents × quantity / 1000` for a weighed row, draws it as `price`, and draws the
  same `unitPriceCents` as `unitPrice` with `unitPricePer` of `KILOGRAM` or `LITER`
  (`:563-567`). The line history page draws them as "≈ price" and "amount at unitPrice / kg"
  (`line-history-page.html:160-190`). `factsOf` draws the last paid price as `unitPriceCents`
  raw (`select-line-history.ts:171-180`).
- The settle sheet's `amountToGet` already draws the cost of whole packs through
  `lineAmount(row.left, row.unit, product, offer)` (`settle-sheet.ts:531-566`), with "≈" when
  `amount.estimated`. `lineAmount` answers `pieces` too (`models/src/lib/line-amount.ts`), and
  velista `0183` draws "2 × 750 g · 2,78 €" on member cards through `line-amount-words.ts`.
- `basketTotal` prices `row.bought` and `row.bought + row.left` through `lineAmount`
  (`basket-total.ts:152-153`), so it already counts whole packs; the `estimated` of a sized
  pack there is false.
- A revert sends `units` as the person's own bought units, else `row.bought`, with `from:
  row.bought` (`basket-page.ts:1362-1382`). The row's `bought` sums the settlements, so it
  reads 1500 after a buy of two 750 g packs. The server gives back `wanted` (backend `0259`
  section 3.4), so velista sends nothing new; it must not cap `units` at `row.asked`.
- The mappers read a settlement's `unit`, `estimated`, `pricePaidCents` and `pricePaidCurrency`
  from `unknown` (`mappers.ts:623-645`), and the purchase mappers the same (`purchase-mappers.ts:97`).
- Backend `0259` adds `paidFor` and `wanted` to `LineSettlementView`, `paidFor` to
  `PurchaseRowView`, and `over` to the basket row and entry views. Absent on the wire, `paidFor`
  reads as the unit's default (1 for `UNIT`, 1000 otherwise), `wanted` as `quantity`, `over` as 0.
- The "Bought" tab is velista `0095` and unbuilt; the purchases API is mapped and drawn nowhere.
  The settlement history velista draws is `toSettlementRow` on the line page, the line detail
  sheet and the settle sheet's history pane.

### Target state

1. `LineSettlement.paidFor` and `wanted`, `PurchaseEntryRow.paidFor`, `BasketRow.over` and
   the entry's `over`, mapped from `unknown` with the fallbacks above. The in memory fakes
   carry them.
2. One pure `settlementSpend(cents, quantity, paidFor)` and `settlementPerKilo(cents, paidFor)`
   in `models`, integer cents rounded half up once, with a spec that names backend `0259`
   section 1 and asserts its five examples.
3. `toSettlementRow` draws `price` as the spend with no per kilo words, `estimated` as the
   server says, and `unitPrice` as the per kilo figure for a weighed row, "1,85 € / kg", under
   it. A count row is unchanged. The row gains `over`, drawn as "500 g more than asked" when it
   is not zero.
4. The settle sheet's amount line says the whole packs it will record, "2 × 750 g · 2,78 €",
   with no "≈" for a sized pack and with it for a loose product or a kilo piece, through the
   words of `line-amount-words.ts`. After the buy the row and `gotToday` read the recorded
   amount ("Got 1,5 kg today"), and the caption says the extra.
5. The basket row's caption on an over bought row reads "1,5 kg of 1 kg · 500 g more" through
   `row.over`; `asked` stays what the server serves (backend `0259` M5), so the reel still
   reaches the whole buy.
6. A revert from the row's tick sends the whole buy and the line returns to what it asked.
   Nothing in velista caps the units at `asked`, and a spec says so.
7. `factsOf`'s last paid price is the per kilo figure for a weighed row and the price of one
   for a count.

### Scope

- Work in `libs/velista/models`, `data-access`, `feature-shopping-lists`, `feature-lists`,
  the two i18n files, and `apps/velista-luna-e2e`.
- Do NOT touch the catalog tab, the product page, the unit chip of `0183`, `basketTotal`'s
  rule, or the back office.

### Constraints

- Rule D4: own models, mapped from `unknown`. No import from `@portfolio/luna-shopper/contracts`.
- Copy through RokuTranslator keys in `en` and `es`; numbers through `Intl`, never inside a
  key. No dashes as punctuation in any prose or copy.
- No mock. The settle sheet's amount line and the captions are the words of `0183` reused.
- The per kilo reminder is drawn under the money, smaller, as velista `0179` draws a price per
  kilo beside a pack's price. It is never the main figure of a settled row.

### Action boundaries

- Proceed with everything in sections 1 to 4.
- Stop and ask if backend `0259` is not on the slot's gateway, or if its views carry different
  field names than its section 3.3.
- Stop and ask before changing how a revert chooses `units` (`ownBoughtUnits`), beyond
  asserting that it is not capped.

### Progress evidence

Each criterion of section 5 with its spec output, `npx nx build velista`, and one walk on a
slot with backend `0259`: a `GRAM` line at 1 kg on a 750 g pack at 1,39 €; the settle sheet
reads "2 × 750 g · 2,78 €" with no mark; the tick records it; the row reads "1,5 kg of 1 kg ·
500 g more"; the history reads "bought 1,5 kg", "2,78 €" and "1,85 € / kg" under it; the
tick again takes the buy back and the row reads "1 kg to get".

## 1. The model and the mappers

```ts
/** backend 0259 section 1. Integer cents, rounded half up once. */
export function settlementSpend(cents: number, quantity: number, paidFor: number): number;
export function settlementPerKilo(cents: number, paidFor: number): number;
```

`LineSettlement` gains `paidFor: number` and `wanted: number`; `PurchaseEntryRow` gains
`paidFor`; `BasketRow` and `BasketRowEntry` gain `over: number`. The mappers read each with a
fallback that mirrors the server's defaults, so a settlement from before the plan reads as
today. `toSettlementRow` takes `paidFor` and `wanted` as optional inputs, as it takes `unit`
and `estimated`, and the two callers that build a settlement by hand do not have to state them.

## 2. The history row

`toSettlementRow`:

- `price` is `settlementSpend(cents, quantity, paidFor)`, formatted, for any unit. The `/ 1000`
  branch goes.
- `estimated` is the server's flag, and `measured` is no longer its fallback. A row with no
  flag on the wire is an estimate exactly when the server says so.
- `unitPrice` on a weighed row is `settlementPerKilo(cents, paidFor)` with `unitPricePer`
  unchanged; on a count row it stays the price of one, drawn above one unit as today.
- `over` is `quantity − wanted`, and the row gains `overText`, "500 g more than asked"
  (`list.history.over`, Spanish "500 g más de lo pedido"), null at zero.

The line history page draws `overText` after the amount, in the same muted style as the list
name. The accessible sentence reads the spend, then "at 1,85 € / kg" as today, then the extra.
`factsOf` draws `lastPaid` as the per kilo figure for a weighed line (target state 7).

## 3. The settle sheet and the basket row

- `amountToGet` draws `lineAmountWords(amount, product)` of `0183`, so a 750 g pack at 1 kg
  reads "2 × 750 g · 2,78 €" and a loose product "1 kg · ≈ 1,99 €". The mark follows
  `amount.estimated`, which is already false for a sized pack.
- The sheet's settle sends what it sends today (the reel's number or `left`); the server
  rounds and answers the row. The optimistic row is replaced by the answer, as a `stale_quantity`
  replaces it. No rounding is done in velista: O2 of backend `0259`.
- `gotToday` reads `row.bought` as today, so it says "Got 1,5 kg today"; when `row.over > 0`
  the sentence gains ", 500 g more than asked" (`basket.sheet.gotOver`).
- `quantityCaption` in `basket-labels.ts`: an over bought row reads its amount of the asked
  amount and the extra, "1,5 kg of 1 kg · 500 g more" (`basket.row.over`), where the asked
  amount is `row.asked − row.over`. A row with `over` at zero is unchanged.
- The settle sheet's history pane (`_toRow`) passes `paidFor` and `wanted` through.

## 4. The revert and the e2e suite

- `revertRow` and `setLeft` send what they send. A spec on `basket-page` asserts that a row
  with `bought 1500`, `asked 1500` and `over 500` sends `units 1500`, and that nothing reads
  `asked − over` as the ceiling. `ownBoughtUnits` sums `entry.bought`, which is the whole buy.
- `apps/velista-luna-e2e/shop.spec.ts` gains the walk of the progress evidence against the
  slot's seed, which needs one product sold as a 750 g pack with a price beside the loose
  product `0182` seeded: added at 1 kg, ticked, "2 × 750 g · 2,78 €" shown before, "1,5 kg of
  1 kg · 500 g more" after, the tick again, "1 kg" to get.

## 5. Acceptance criteria

1. Mapper specs: `paidFor`, `wanted` and `over` from `unknown` with their fallbacks on every
   model that carries them.
2. `settlement-spend.spec.ts`: the five examples of backend `0259` section 1 in cents and per
   kilo, and the rounding once.
3. `line-detail-view.spec.ts`: a 750 g pack row reads "2,78 €" with no mark and "1,85 € / kg";
   a loose row reads "≈ 1,49 €" and "1,99 € / kg"; a count row is unchanged; `overText` at 500
   and null at 0; a row from before the plan reads as today.
4. `settle-sheet.spec.ts`: the amount line for a pack and for a loose product in `en` and `es`;
   `gotToday` with and without the extra; the history pane passes the fields.
5. `basket-labels.spec.ts`: the over bought caption, and the unchanged caption at zero.
6. `basket-page.spec.ts`: the revert sends the whole buy.
7. `select-line-history.spec.ts`: `lastPaid` per kilo on a weighed line.
8. `npx nx affected -t lint test` is green, `npx nx build velista` builds, and the e2e
   scenario of section 4 passes on a slot.

## Not in this plan

- **The "Bought" tab** (velista `0095`).
- **Rounding in the client.** The gateway rounds (backend `0259` O2); velista previews with
  `lineAmount` and draws the answer.
- **What a suggestion does with an over buy** (backend backlog `0022`) and **putting a
  suggestion off** (backend backlog `0023`).
