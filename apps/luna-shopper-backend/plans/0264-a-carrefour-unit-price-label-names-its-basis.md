> **PR:** [#974](https://github.com/IchirokuXVI/nx-portfolio/pull/974)

# 0264: a Carrefour unit price label names its basis, and a wash names none

> Found during the all chain scheduled harvest of 2026-11-06 on Luna slot 4, and checked
> against `origin/dev` on 2026-11-11. Carrefour states the unit of its comparison price in the
> field `measure_unit` and never prints a label. The adapter builds the label as
> `€/${measure_unit}`. `unitBasisOf` knows no label that starts with `€/`, so it answers null
> for every Carrefour price. The committed Carrefour fixtures print `measure_unit` `l` 92
> times, `kg` 24 times and `ud` 2 times. The share of Carrefour offers with a null basis was
> not re-measured on 2026-11-11, Docker was down. The code says it is all of them.
>
> The owner answered the decisions of this plan on 2026-11-11. The answer to D2 widens the
> plan: **a wash is not a unit of measure for this app.** A wash count is the brand's own
> claim. Nobody can measure it, and it is a bad basis to compare prices on. The plan thus also
> removes the two wash keys from the label table.
>
> Prerequisite reading: plan `0157` (the label table), plan `0189` (a label that is true of its
> figure), plan `0245` (a comparable price says what it compares in), plan `0249` (the size
> check and its own label table), `libs/luna-shopper/contracts/src/lib/units/unit-basis.ts`
> (`unitBasisOf`, `UNIT_BASIS_BY_LABEL`), `libs/luna-shopper/contracts/src/lib/messages/catalog.messages.ts`
> (`UNIT_BASES`), `libs/luna-shopper/carrefour/src/lib/price.ts` (`unitPriceLabel`),
> `libs/luna-shopper/carrefour/src/lib/listing.ts` (`MEASURE_BASE`, `readCard`),
> `libs/luna-shopper/mercadona/src/lib/normalize.ts` (`readUnitPriceLabel`, `washedLabel`) and
> `apps/luna-shopper-backend/harvester/src/app/harvest/size-check.ts` (`labelKey`).

## Brief for the agent

### Objective

Make `unitBasisOf` name a basis for the three labels Carrefour builds, `€/kg`, `€/l` and
`€/ud`, so that a Carrefour offer carries a `unitBasis`. Remove the keys `lv` and `lavado`
from `UNIT_BASIS_BY_LABEL`, so that no label names the basis `WASH`, and remove the value
`WASH` itself from the contract and from every reader of it (D4). Change no stored value.

### Context

- `unitBasisOf` (`unit-basis.ts`, near lines 47 to 60) trims and lowercases a label and looks
  it up exactly in `UNIT_BASIS_BY_LABEL` (near lines 29 to 45). The table has no key with `€/`.
- **The wash keys.** The table maps `lv` and `lavado` to `'WASH'` (near lines 43 and 44). It
  does not map the plural `lavados`, which thus answers null today. The comment of the table
  (near lines 17 to 20) says that `lv` on liquid detergent sits on a price per litre.
- `'WASH'` is the last value of `UNIT_BASES` (`catalog.messages.ts`, near lines 1149 to 1157),
  and the type `UnitBasis` is read from that array. This plan removes the value (D4).
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
- **Who prints a wash label.** Production on 2026-11-05 held 1,645 priced rows with the label
  `lavados` or `lv` (plan `0245`, Context). Plan `0249` counted 227 Carrefour rows with
  `€/lavado`. The DIA leaflet prompt names `€/lavado` too
  (`libs/luna-shopper/tools/leaflet/chains/src/dia/prompt.txt`, near line 89).
- **Mercadona is mostly not affected.** Plan `0189` rule 3 (`washedLabel`, `normalize.ts` near
  lines 386 to 395 and 433) writes `L` or `kg` in place of `lv` when the figures prove that the
  stored figure is per litre or per kilo. A Mercadona row keeps `lv` only when both of its
  figures are the price of one wash, for example a pack of tablets (rule 1 of the same
  comment). Those rows lose their basis.

### Target state

1. `unitBasisOf('€/kg')` is `KILOGRAM`, `unitBasisOf('€/l')` is `LITER`,
   `unitBasisOf('€/ud')` is `UNIT`, and `unitBasisOf('€/m')` is null.
2. `unitBasisOf('lv')`, `unitBasisOf('lavado')` and `unitBasisOf('€/lavado')` are null. No
   label answers `WASH`.
3. Every other label answers what it answers today.
4. The PR lists every reader of the wash basis (section 2).
5. No contract, document or client names the value `WASH` (D4). A client that receives it
   from an older backend reads it as no basis and does not fail.

### Scope

`libs/luna-shopper/contracts/src/lib/units/unit-basis.ts` and
`apps/luna-shopper-backend/catalog/src/app/catalog/unit-basis.spec.ts`, and the fixture proof
spec in `libs/luna-shopper/carrefour`. For D4: the value `'WASH'` of `UNIT_BASES` and the type
`UnitBasis` (`catalog.messages.ts`, and the schemas that read the array), `openapi.json` and
`wire-types.ts` (regenerated, never edited), velista (`PriceUnitBasis`, `PRICE_UNIT_BASES`, the
mappers and the `WASH` keys of `en.json` and `es.json`), the back office (`WASH: 'wash'` in
`money.ts`), and each other reader that section 2 finds, with their specs. Nothing in the
Carrefour adapter (D1) and nothing in the Mercadona normalizer.

### Constraints

- The table names a basis only for a label whose figure is per that unit. Before you change
  the table, prove it with the Carrefour fixtures. **The proof tests the basis, not the
  cent** (owner, 2026-11-11). For each priced card whose `measure_unit` is `kg`, `l` or `ud`,
  price divided by `price_per_unit` must be within 10% of the size the name prints, read
  with the adapter's own `splitCardName`. A wrong basis is off by a factor of 10, 100 or the
  pack count, so it still fails. A card whose name gives no size in the family of its
  `measure_unit` is left out by that rule, and never by product id or name: no card is named
  as an exception. The spec asserts how many cards it measured, so the rule cannot silently
  skip all of them. The PR states how many cards agree to the cent. If a card fails the 10%
  rule, stop and report it.
- `bulk_price`, `unitPrice` and `unitPriceLabel` stay verbatim. The fix is on read only.
- The reader removes a leading `€/` (with optional spaces around the slash) and nothing more.
  A label it does not know after that still answers null, never a guess.
- A wash is not a unit of measure (D2). No label maps to `WASH`, and no new wash key is added
  in any spelling.
- `unitBasisOf` stays browser reachable. It names no `process`.
- `UNIT_BASES` and the type `UnitBasis` lose the value `'WASH'` and nothing else (D4). The
  OpenAPI document and `wire-types.ts` change only by that value, and only through
  `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types`. If the regenerated document differs in
  anything else, stop and report it.
- The basis is derived on read from the stored label. No stored column, migration, seed,
  database enum type or fixture row may hold the value `WASH`. If one does, stop and report it
  before you touch it: no migration rewrites rows.
- A velista client that is already installed must not break. Its mapper reads an unknown
  basis from `unknown` as no basis, never as a throw.

### Action boundaries

- Before you remove the value, write the list of section 2 for the PR.
- Stop and ask before you change a stored label or the Carrefour adapter.

### Progress evidence

The fixture proof of Constraints as a table in the PR, the list of section 2, the spec output,
and one Carrefour product read through the catalog search on a Luna slot whose catalog holds
Carrefour rows, with its `unitBasis` quoted.

## 1. The change

1. In `unitBasisOf`, after trim and lowercase, remove a leading `€/`, then look the key up.
   The three Carrefour keys then reach `kg`, `l` and `ud`, which the table already maps. `€/m`
   reaches `m`, which stays null. No new key is added to `UNIT_BASIS_BY_LABEL`.
2. Remove the keys `lv` and `lavado` from `UNIT_BASIS_BY_LABEL`. Rewrite the comment of the
   table: it says that `lv` sits on a price per litre, and after this plan it says that a wash
   is no basis, with the reason of D2.

The effect of step 2:

- An offer whose label is `lv`, `lavado` or `€/lavado` gets no basis.
- velista draws no unit price line for such an offer, by the rule of Context.
- The back office prints the raw label beside the figure, by the fallback of Context.
- Ranking is not affected, because plan `0245` compares by size and not by label.
- Mercadona is mostly not affected, because `washedLabel` already turns `lv` into `L` or `kg`
  when the figures prove it. Only rows whose figures are both per wash lose their basis.

## 2. The readers of the wash basis

Before you touch anything beyond the two keys, list each reader of `WASH` in the PR, with its
file and line on the branch, and what it does with the value. The list that this plan knows of:

- The value `'WASH'` in `UNIT_BASES` (`catalog.messages.ts`) and the type `UnitBasis`, and the
  schemas that read the array (`catalog.schemas.ts`, `harvest.schemas.ts`).
- The gateway and `apps/luna-shopper-backend/gateway/docs/openapi.json`, which lists `WASH` in
  six enums, and `wire-types.ts`, generated from it.
- velista: `PriceUnitBasis` and `PRICE_UNIT_BASES` (`libs/velista/models/src/lib/catalog-browse.ts`),
  the mapper that reads them (`catalog-browse-mappers.ts`) and the key `WASH` in
  `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- The back office: `WASH: 'wash'` in `libs/luna-shopper-admin/models/src/lib/resource/money.ts`.
- `size-check.ts` of plan `0249`. It does not read the basis: its own table `LABEL_AMOUNTS` has
  no wash key, and `lv` and `€/lavado` answer no check there. Say so in the list.
- `washedLabel` of plan `0189`. It does not read the basis either: it writes the label `L` or
  `kg` in place of `lv` on the way in. Say so in the list.

The builder adds each reader that a search of the branch finds and this list does not name.

## Tests

- `unit-basis.spec.ts`: a second table for the Carrefour labels, `€/kg`, `€/l`, `€/ud`,
  `€/m`, `€ / kg` and `€/KG`, each with its basis.
- `unit-basis.spec.ts`: the row `['lv', 72, 'WASH']` of the first table becomes
  `['lv', 72, null]`, and the row `['lavado', 'WASH']` of the second table moves to a test of
  labels that answer null. `lv` leaves the list of `only ever answers a basis the contract
  names`. A new test: `lv`, `lavado`, `lavados`, `€/lavado` and `LV` all answer null.
- A label `€/` alone answers null.
- The Carrefour fixture proof as a spec in `libs/luna-shopper/carrefour`, so that a later
  capture that breaks it fails a test.

## Acceptance criteria

- [ ] The three Carrefour labels name a basis, and `€/m` names none.
- [ ] No label answers `WASH`.
- [ ] Every other label of the existing table answers what it answered before.
- [ ] The PR lists every reader of the wash basis.
- [ ] No stored row changes and no migration is added.
- [ ] `WASH` is gone from `UNIT_BASES`, `openapi.json`, `wire-types.ts`, velista and the back
      office, and the two generated files differ only by that value.
- [ ] velista and the back office read a `WASH` from an older backend as no basis.
- [ ] Every priced `kg`, `l` and `ud` card whose name gives a size in its family is within
      10% of that size, and the spec asserts how many cards it measured.

## Verification

```sh
npx nx test luna-shopper/contracts
npx nx test luna-shopper-backend-catalog -t "unitBasisOf"
npx nx test luna-shopper/carrefour
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
git diff apps/luna-shopper-backend/gateway/docs/openapi.json libs/luna-shopper-admin/models/src/lib/wire/wire-types.ts
npx nx test luna-shopper-backend-gateway
npx nx test luna-shopper-admin/models
npx nx build velista
npx nx build luna-shopper-admin
npx nx affected -t lint test
```

The diff of the two generated files removes `WASH` and nothing else.

Then one Carrefour product on a Luna slot, as Progress evidence says.

## Decisions

**D1 (owner, answered 2026-11-11):** the reader removes a leading `€/` (option a). Nothing
stored changes, and the adapter keeps writing `€/kg`, `€/l` and `€/ud`.

**D2 (owner, answered 2026-11-11):** `lavados` does not join the table. Further, a wash is not a
unit of measure for this app. A wash count is the brand's own claim, nobody can measure it, and
it is a bad basis to compare prices on. This plan thus also removes the existing keys `lv` and
`lavado` from `UNIT_BASIS_BY_LABEL`.

**D3 (owner, answered 2026-11-11):** later. One label table for `unit-basis.ts` and
`size-check.ts` is a plan of its own. The two tables answer different questions (a basis, and
an amount the figure is per), so only the key rule is shared.

**D4 (owner, answered 2026-11-11): removed in this plan.** The value `WASH` leaves
`UNIT_BASES`, the OpenAPI document, `wire-types.ts`, velista and the back office, together
with every other reader that section 2 finds. The PR writes the list of section 2 first. The
change removes a value from the wire, and a client that still receives it from an older
backend reads it as no basis.
