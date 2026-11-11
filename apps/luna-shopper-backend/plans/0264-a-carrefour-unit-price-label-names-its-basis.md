# 0264: a Carrefour unit price label names its basis

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. Carrefour states the unit of its comparison price in the
> field `measure_unit` and never prints a label. The adapter builds the label as
> `€/${measure_unit}`. `unitBasisOf` knows no label that starts with `€/`, so it answers null
> for every Carrefour price. The committed Carrefour fixtures print `measure_unit` `l` 92
> times, `kg` 24 times and `ud` 2 times. The share of Carrefour offers with a null basis was
> not re-measured on 2026-11-11, Docker was down. The code says it is all of them.
>
> Prerequisite reading: plan `0157` (the label table), plan `0189` (a label that is true of its
> figure), plan `0245` (a comparable price says what it compares in), plan `0249` (the size
> check and its own label table), `libs/luna-shopper/contracts/src/lib/units/unit-basis.ts`
> (`unitBasisOf`), `libs/luna-shopper/carrefour/src/lib/price.ts` (`unitPriceLabel`),
> `libs/luna-shopper/carrefour/src/lib/listing.ts` (`MEASURE_BASE`, `readCard`) and
> `apps/luna-shopper-backend/harvester/src/app/harvest/size-check.ts` (`labelKey`).

## Brief for the agent

### Objective

Make `unitBasisOf` name a basis for the three labels Carrefour builds, `€/kg`, `€/l` and
`€/ud`, so that a Carrefour offer carries a `unitBasis`. Change no stored value.

### Context

- `unitBasisOf` (`unit-basis.ts`, near lines 29 to 60) trims and lowercases a label and looks
  it up exactly in `UNIT_BASIS_BY_LABEL`. The table has no key with `€/`.
- `unitPriceLabel` (`carrefour/src/lib/price.ts`, near line 54) answers `€/${unit}` for a
  card that states a `measure_unit`. `readCard` (`listing.ts`, near line 455) calls it.
  `MEASURE_BASE` (`listing.ts`, near lines 156 to 161) knows `l`, `kg`, `ud` and `m`.
- `labelKey` in `size-check.ts` (near lines 83 to 91) already removes a leading `€/` for its
  own table. Its comment near lines 42 to 44 says that a shared table would live in the
  contracts units module.
- Four readers call `unitBasisOf`: `catalog.mappers.ts` (near lines 409, 453 and 478),
  `item.service.ts` (near line 4434), `price-history.service.ts` (near line 131) in catalog,
  and `harvest.mappers.ts` (near line 346) in the harvester.
- What a null basis costs today:
  - velista draws no unit price line on a `PACK` offer with no basis
    (`libs/velista/ui/src/lib/catalog/product-row-view.ts`, near line 312).
  - The back office prints the raw label, for example "1.23 / €/kg", because `unitPriceUnit`
    (`libs/luna-shopper-admin/models/src/lib/resource/money.ts`, near line 142) falls back
    to the label.
  - Ranking is not affected. Plan `0245` ranks on `comparablePrice`, which
    `catalog/src/app/catalog/comparable-price.sql.ts` computes from price and size and not
    from the label.
- `100gr` (El Jamón) stays null on purpose, by plan `0189`. `m` stays null by plan `0157`.
- The fixtures prove the figure is per `measure_unit` on the cards checked for this plan:
  - `Leche fermentada ... pack 6 unidades 100 g.`, 3,99 €, 6,65 € per `kg` (3.99 / 0.6).
  - `Aperitivo de patata ... Pringles 185 g.`, 2,95 €, 15,95 € per `kg`.
  - `Atún claro ... pack de 8 latas de 52 g.`, 6,59 €, 15,84 € per `kg` (6.59 / 0.416).
  - `Café cápsulas ... 10 ud.`, 4,15 €, 0,42 € per `ud`.

### Target state

`unitBasisOf('€/kg')` is `KILOGRAM`, `unitBasisOf('€/l')` is `LITER`, `unitBasisOf('€/ud')`
is `UNIT`, and `unitBasisOf('€/m')` is null. Every other label answers what it answers today.

### Scope

`libs/luna-shopper/contracts/src/lib/units/unit-basis.ts` and
`apps/luna-shopper-backend/catalog/src/app/catalog/unit-basis.spec.ts`. Nothing in the
Carrefour adapter, unless the owner picks D1 (b).

### Constraints

- The table names a basis only for a label whose figure is per that unit. Before you change
  the table, prove it with every `kg`, `l` and `ud` card of the Carrefour fixtures: price
  divided by the size the name prints must equal `price_per_unit` within one cent. If one
  fixture disagrees, stop and report it.
- `bulk_price`, `unitPrice` and `unitPriceLabel` stay verbatim. The fix is on read only.
- The reader removes a leading `€/` (with optional spaces around the slash) and nothing more.
  A label it does not know after that still answers null, never a guess.
- `unitBasisOf` stays browser reachable. It names no `process`.

### Action boundaries

- Stop and ask before you change a stored label or the Carrefour adapter (D1).
- Stop and ask before you add `lavados` or any new key beyond the three of the Target state
  (D2).
- Stop and ask before you move the `size-check.ts` table into the contracts (D3).

### Progress evidence

The fixture proof of Constraints as a table in the PR, the spec output, and one Carrefour
product read through the catalog search on a Luna slot whose catalog holds Carrefour rows,
with its `unitBasis` quoted.

## 1. The change

In `unitBasisOf`, after trim and lowercase, remove a leading `€/`, then look the key up. The
three Carrefour keys then reach `kg`, `l` and `ud`, which the table already maps. `€/m` reaches
`m`, which stays null. No new key is added to `UNIT_BASIS_BY_LABEL`.

## Tests

- `unit-basis.spec.ts`: a second table for the Carrefour labels, `€/kg`, `€/l`, `€/ud`,
  `€/m`, `€ / kg` and `€/KG`, each with its basis. The first table stays as it is.
- A label `€/` alone answers null. A label `€/lavados` answers null (D2).
- The Carrefour fixture proof as a spec in `libs/luna-shopper/carrefour`, so that a later
  capture that breaks it fails a test.

## Acceptance criteria

- [ ] The three Carrefour labels name a basis, and `€/m` names none.
- [ ] Every label of the existing table answers what it answered before.
- [ ] No stored row changes, and no migration is added.
- [ ] The fixture proof passes for every `kg`, `l` and `ud` card.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-catalog -t "unitBasisOf"
npx nx test luna-shopper/carrefour
npx nx affected -t lint test
```

Then one Carrefour product on a Luna slot, as Progress evidence says.

## Decisions

**D1. Where the label is fixed.**

- (a) The reader normalizes a leading `€/`. Nothing stored changes.
- (b) The adapter writes `kg`, `l` and `ud`. This changes the stored label. The price writer
  inserts a new row when a value changes, so the first walk after it writes a new
  `item_prices` row for every Carrefour price.

Recommended: (a).

**D2. `lavados`.** Production on 2026-11-05 held 1,645 priced rows with the label `lavados`
or `lv` (plan `0245`, Context). The table maps `lv` and `lavado` to `WASH`, and not the plural.

- (a) Add `lavados` to the table as `WASH` in this plan.
- (b) A plan of its own, after a measurement that names the chain that prints it and proves
  that its figure is per one wash.

Recommended: (b).

**D3. One label table for `unit-basis.ts` and `size-check.ts`.**

- (a) Now: move the `€/` and full stop rules of `labelKey` into the contracts and let both
  read them.
- (b) Later, in a plan of its own. The two tables answer different questions (a basis, and an
  amount the figure is per), so only the key rule is shared.

Recommended: (b), unless the shared key function is a few lines with no change to either
table.
