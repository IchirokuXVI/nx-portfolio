> **PR:** [#940](https://github.com/IchirokuXVI/nx-portfolio/pull/940)

# 0245: a comparable price says what it compares in

> Found on 2026-11-05 while the measurement series was reviewed against plan `0244`. Every
> place that ranks offers against each other orders by `unitPrice`, the chain's own comparison
> figure, with no look at what that figure is a price per. A dozen eggs thus compares with one
> egg, a piece priced per piece with a piece priced per kilo, and LIDL, which prints no unit
> price, sinks to the bottom of every such order. Status report `0172` keeps this as step 2 of
> its proposal, and it is independent of the unit on a line.
>
> Prerequisite reading: plan `0080` (every price a source gave, and the answer materialized on
> `supermarket_items`), plan `0157` (the best offer has a till price, and a basis read from the
> label), plan `0189` (a label that is true of its figure), plan `0196` section 1 (the three
> orders of the listing), plan `0244` section 1 (the four kinds of product),
> `catalog/src/app/catalog/effective-price.service.ts` (`recomputeEffectivePrices`,
> `applyEffective`), `effective-price.sweep.ts`, `item.service.ts` (`lowestAtScopesSql` near
> line 234, the group lateral near line 1490, the member ranking near line 1740,
> `orderOffers` and `orderOffersByUnitPrice` near line 3890, `lowestUnitPriceOffer`),
> `catalog.mappers.ts` (`toItemOfferView`, `toSupermarketItemView`),
> `libs/luna-shopper/contracts/src/lib/units/unit-basis.ts` and `source-size.ts`
> (`toBaseUnit`), and velista `libs/velista/models/src/lib/product-group.ts`.
>
> velista half: velista plan `0181`. It needs this plan merged first.

## Brief for the agent

### Objective

Give every materialized offer a comparison figure that the catalog derives itself, with the
basis it is a price per as an enum beside it, and make every ordering and every "cheaper"
decision read that pair and compare only figures of one basis. Keep `price` and `unitPrice`
exactly what they are.

### Context

**What the two price columns mean today, and why neither can be the comparison figure.**

- `supermarket_items.price` is what the till charges for one of what the product is: a pack,
  or a kilo for a `KILOGRAM` product (plan `0181`). The settle, the basket totals and velista's
  D4 rule read it. It cannot mean anything else.
- `supermarket_items.unitPrice` with `unitPriceLabel` is the chain's own comparison figure,
  stored verbatim by the rule of plan `0080` and never recomputed. It is evidence, not a
  computed value: plan `0189` found 1,497 false pairs by comparing it against the size, and
  plan `0244` found the seven per piece products through its label. `unitBasis` on the views
  is read from that label by a fixed table (plan `0157`) and describes that figure.

**What orders by `unitPrice` today, with no look at the basis** (all in `item.service.ts`):

| Where | What it ranks | Across what |
| --- | --- | --- |
| `lowestAtScopesSql('unitPrice')`, the `unitPrice` order of the listing (plan `0196`) | products | every product of the page, any basis |
| the group lateral near line 1490, the `cheapestItem` of a ranked group | members of a group | the members, which can state different bases |
| the member ranking near line 1740 (`cheapestMembersOf`) | members of a group | the same |
| `orderOffers`, the second key after `price` | offers of one product | the scopes, one basis |
| `orderOffersByUnitPrice` and `lowestUnitPriceOffer` | offers of one product under the `unitPrice` order | the same |
| velista `compareGroupOffers` and `isCheaper` (`product-group.ts`) | members of a group, the "cheaper option" mark | the members |

**Production on 2026-11-05** (read only; staging holds the same data):

- 330,854 rows of `supermarket_items`. Among the priced and available ones, the label is
  `kilo` or `kg` on 89,149, `litro` or `l` on 40,731, `unidad` or `ud` on 27,564, `100gr`,
  `100ml`, `100 ml` and `100 g` on 20,749, empty on 4,266, `lavados` or `lv` on 1,645,
  `docena` on 140 and `metro` on 40.
- **4,266 priced rows state no unit price at all:** 3,818 of LIDL, 288 of Deza and 160 of El
  Jamón. Each of them sinks under every `unitPrice` key today, although the catalog knows
  their size.
- **The chain's basis often disagrees with the product's unit.** 2,651 rows of products sized
  in grams carry a per piece label (`unidad`, `ud`), 1,489 rows of products sized in
  millilitres do too, 1,560 counted products are compared per wash and 140 per dozen, and 265
  counted products carry `kilo` or `kg`. The label is what the chain compares in. It is not a
  defect, and this plan does not change it.
- Items: 8,663 sized in `GRAM`, 5,595 in `MILLILITER`, 2,031 counted with a size, 5,072
  counted with no size, 842 `KILOGRAM` with no size. Of the counted ones, 139 carry both a
  `unitSize` and a `packCount`, 17 of those differ, 49 carry a `packCount` only.
- **No product in production belongs to a group yet** (`productGroupId` is null on every
  item). The two group rankings and velista's mark are thus wrong on slot data and on the
  next curation import, not on a shopper's screen today. The listing order and the per
  product orders are live.

### Target state

1. `supermarket_items` carries `comparablePrice numeric(12,4)` and `comparableBasis`, an
   enum of `KILOGRAM`, `LITER`, `UNIT`, both null exactly when the row has no `price` or the
   figure cannot be derived.
2. A pure function in the contracts library derives the pair from the row's `price` and the
   item's `unitSize`, `defaultUnit`, `packCount` and `approxWeight` (section 1). The catalog
   writes it wherever it writes `price` (section 2), and rewrites every row of an item when
   the item's size, unit, pack count or weight changes (section 3).
3. Every ordering of the table above reads `comparablePrice` in place of `unitPrice`, and the
   two orderings that cross products rank a basis block before a figure (section 4).
4. `ItemOfferView` and `SupermarketItemView` carry both fields. The OpenAPI document and the
   admin wire types are regenerated.
5. A migration adds the columns and backfills them in SQL, so nothing waits for a sweep.

### Scope

- Work in `apps/luna-shopper-backend/catalog`, `libs/luna-shopper/contracts`, the gateway's
  generated document and the admin's generated wire types.
- Do NOT touch `price`, `unitPrice`, `unitPriceLabel`, `unitBasis` or the label table. Do NOT
  touch velista (velista plan `0181`), the back office, the harvester, or the settle.
- Do NOT change which row `recomputeEffectivePrices` picks as the effective one. This plan
  adds two columns to the row it already writes.

### Constraints

- The derivation is one pure function, used by the write path and by the backfill's
  reference spec. The SQL of the backfill is a translation of it, and a spec proves both
  equal on the five kinds of row in section 1.
- Decisions C1 to C6 below are the reviewer's, and **the owner accepted all six on 2026-11-05**.
  They are settled, and a builder does not reopen them. Nothing in this plan reopens D1 to D4
  or R1 to R6 of plan `0244`.
- No dashes as punctuation in any prose.

### Action boundaries

- Proceed with everything in sections 1 to 6.
- Stop and ask if plan `0240` (one baseline migration per service) has landed in `dev`: the
  columns then go into the baseline by that plan's rules, not into a new migration.
- Stop and ask if `recomputeEffectivePrices` no longer has the item ids of the keys it writes
  at hand, or if the four size fields of section 1 are not all on `items`.

### Progress evidence

Each criterion of section 7 with its spec output, the migration proved on a copy of the
production dump or on a slot seeded with the five kinds of row, and one read on a slot: the
listing under `order=unitPrice` with a LIDL product in the page, placed by its derived figure,
and the `cheapestItem` of a group whose members state two bases.

## 0. Decisions

- **C1. A stored pair, not an expression evaluated on read.** The `unitPrice` order of the
  listing and its keyset cursor read a column (`lowestAtScopesSql`, plan `0196`), and plan
  `0080` materializes every price answer on `supermarket_items` for the same reason. The cost
  is section 3: the pair depends on the item, so an item edit rewrites its rows. A SQL
  expression over a join would avoid that cost and was set aside because the cursor cannot
  carry it and because six queries would repeat it.
- **C2. The basis comes from the item's base unit alone.** Grams and kilograms give
  `KILOGRAM`, millilitres and litres give `LITER`, a count and a `PACK` give `UNIT`. Three
  values. `DOZEN` and `WASH` stay what the label says about the chain's figure and never
  become a comparable basis: a dozen is twelve units, and a wash is a count the catalog does
  not hold.
- **C3. Per kilo and per litre, not per gram.** That is what every chain prints, what `price`
  already is for a `KILOGRAM` product, and what velista draws. A figure per gram is 0.0134 and
  nothing in the system uses it.
- **C4. A piece priced as one is compared per unit, not by its weight.** The weight is
  approximate (plan `0244`), and the chain itself compares such a piece per piece.
- **C5. Kilo and litre figures share one block, counted figures come after, and a row with
  no figure comes last**, in the two orderings that cross products. The listing under
  `unitPrice` interleaves per kilo and per litre figures today, and keeps doing so. It stops
  interleaving a price per piece among them.
- **C6. `unitBasis` stays on the views, unchanged.** It describes `unitPrice`. The new
  `comparableBasis` describes `comparablePrice`. A client that draws the chain's figure keeps
  reading the first pair; a client that compares reads the second.

## 1. The derivation

`comparablePriceOf(input)` in `libs/luna-shopper/contracts/src/lib/units/comparable-price.ts`,
beside `unit-basis.ts`:

```ts
export const COMPARABLE_BASES = ['KILOGRAM', 'LITER', 'UNIT'] as const;
export type ComparableBasis = (typeof COMPARABLE_BASES)[number];

export interface ComparablePriceInput {
  price: number | null;
  unitSize: number | null;
  defaultUnit: UnitOfMeasure;
  packCount: number | null;
  approxWeight: number | null;
}

export function comparablePriceOf(
  input: ComparablePriceInput
): { price: number; basis: ComparableBasis } | null;
```

The size is first put in its base unit with `toBaseUnit` (`source-size.ts`), so a legacy
`LITER` or `KILOGRAM` size is read as millilitres or grams. Then:

| Kind of row (plan `0244` section 1) | `comparablePrice` | `comparableBasis` |
| --- | --- | --- |
| no `price` | null | null |
| pack in grams, base size `s` > 0 | `price × 1000 / s` | `KILOGRAM` |
| pack in millilitres, base size `s` > 0 | `price × 1000 / s` | `LITER` |
| pack in grams or millilitres with no size | null | null |
| counted (`UNIT`, `PACK`) | `price / n`, where `n` is `unitSize` when set, else `packCount` when set, else 1 | `UNIT` |
| sold by the kilo, kilo piece (`KILOGRAM`, no size) | `price` | `KILOGRAM` |
| piece priced as one (`UNIT`, no size, a weight) | `price` (the row above with `n` = 1) | `UNIT` |

Rounded half up to four decimals, the scale of the column. `n` prefers `unitSize` because
plan `0183` made the size count what is inside; the 17 production items where the two
differ follow it. `approxWeight` is in the input for C4's sake and for a later plan that may
want a per kilo figure for such a piece. It is not read by this plan.

## 2. The write

`applyEffective` in `effective-price.service.ts` writes the pair beside `price`. It needs the
item's four fields, which the price row does not carry. `recomputeEffectivePrices` already
holds the item ids of its keys and loads the held rows by item; it loads the items' size
fields in the same query (one `SELECT` by id over `items`) and hands each to `applyEffective`.
The equality test that decides whether the row moved compares the pair too, so the sweep stays
idempotent (the second run writes nothing).

The pair is thus written in every place `price` is written, with no new call site: the price
writer's transaction (`item-price.service.ts`), the merge (`item.service.ts` near line 2666),
the copies between scopes, and the sixty second sweep.

## 3. An item edit rewrites its rows

The pair depends on the item, and `price` does not. So four writes that leave `price` alone
have to rewrite the pair of every row of the item:

| Write | Where |
| --- | --- |
| a person edits `unitSize`, `defaultUnit` or `packCount` | `ItemService.update` (near line 3206) |
| a run or a person writes `approxWeight` | `item.setApproxWeights` and the admin update (plan `0244` section 3.4) |
| a run fills `packCount` | `fillPackCounts` through its catalog write |
| a merge moves rows under the surviving item | the merge already recomputes effective prices for its keys; nothing more |

One function, `recomputeComparablePrices(manager, itemIds)`, does it: one `UPDATE` of
`supermarket_items` joined to `items`, with the SQL translation of section 1, inside the
transaction of the edit. It is the same statement the migration's backfill runs over the
whole table. `createdSize` corrections (plan `0244` section 7) go through the item update and
need nothing of their own.

## 4. The orderings

Every key `si."unitPrice" ASC NULLS LAST` and `o."unitPrice" ASC NULLS LAST` of the table in
the context becomes `comparablePrice`. In addition:

- **The listing under `unitPrice`** (`lowestAtScopesSql`, the cursor of plan `0196`): the sort
  value of a product is the lowest `comparablePrice` among its priced, available rows at the
  scopes **whose basis is `KILOGRAM` or `LITER`**, else the lowest among `UNIT` rows, in a
  second block, else null. The cursor carries the block and the figure. `bestOffer` under that
  order is the row that placed the product (`lowestUnitPriceOffer` reads the pair).
- **The two group rankings** order by `price IS NULL`, then the basis block (`KILOGRAM` and
  `LITER` first, `UNIT` second, null last), then `comparablePrice`, then `price`, then the
  id. A group whose members state two bases thus answers the cheapest of its first block,
  deterministically. The product group rule of 2026-09-25 makes such a group a data defect
  and not a case to design for.
- **The per product orders** (`orderOffers`, `orderOffersByUnitPrice`) switch the column and
  need no block: the rows of one product share its basis.

The `order` value stays `unitPrice` on the wire. Renaming it is a client change with no
reader that gains anything.

## 5. The wire

`ItemOfferView` and `SupermarketItemView` gain:

```ts
/**
 * The price of a kilo, a litre or one unit of this product, derived by the
 * catalog from `price` and the product's size (plan 0245). Null when the row
 * has no price or the size is unknown. This is the figure that orders offers;
 * `unitPrice` stays the chain's own figure.
 */
comparablePrice: number | null;
comparableBasis: ComparableBasis | null;
```

`ItemPriceView` and the price history do not change: a history point is the chain's row, and
the comparison is made over materialized rows only. Regenerate the OpenAPI document and the
admin wire types (`luna-shopper-backend-gateway:openapi`, `luna-shopper-admin/models:wire-types`).

## 6. The migration

`1759400000000-SupermarketItemComparablePrice` in `catalog/src/app/db/migrations/`, after
plan `0244`'s `1759300000000-ItemApproxWeight`:

```sql
CREATE TYPE "comparable_basis" AS ENUM ('KILOGRAM', 'LITER', 'UNIT');
ALTER TABLE "supermarket_items" ADD COLUMN "comparablePrice" numeric(12,4) NULL;
ALTER TABLE "supermarket_items" ADD COLUMN "comparableBasis" "comparable_basis" NULL;
ALTER TABLE "supermarket_items" ADD CONSTRAINT supermarket_item_comparable_pair CHECK (
  ("comparablePrice" IS NULL) = ("comparableBasis" IS NULL)
);
-- then the backfill of section 3 over every row
```

The backfill is one `UPDATE ... FROM items` statement over 330,854 rows, inside the migration,
so a deploy answers correct orders at once. `down` drops the constraint, the columns and the
type. No index: `lowestAtScopesSql` reads `uq_supermarket_item_scope` as today, and plan
`0196` added none for the sort.

## 7. Acceptance criteria

1. `comparablePriceOf` specs: one row per line of the table in section 1, a `LITER` size of
   1.5 read as 1500 ml, a counted product with `unitSize` 10 and `packCount` 6 divides by 10,
   a counted product with `packCount` 6 only divides by 6, rounding to four decimals.
2. A spec proves the SQL backfill equal to the function on a table seeded with every kind of
   row, and the migration integration spec runs `up` on such a table and `down` after it.
3. `recomputeEffectivePrices` writes the pair beside `price`, and a second run writes nothing
   (the idempotence spec of plan `0080` extended).
4. An item update that changes `unitSize` rewrites the pair on every row of the item in the
   same transaction; the same for `defaultUnit`, `packCount` and `setApproxWeights`.
5. Integration specs on the orderings: a LIDL row with a size and no `unitPrice` places by
   its derived figure under `order=unitPrice`; a counted product comes after every kilo and
   litre figure; a group with a per kilo member and a per unit member answers the kilo member
   as `cheapestItem` whatever their figures; `orderOffersByUnitPrice` picks the row with the
   lowest `comparablePrice`.
6. The cursor of the `unitPrice` order pages through the two blocks and the null tail without
   a repeat or a gap (`catalog-order.integration.spec.ts`).
7. `openapi-document.spec.ts` and `wire-types.spec.ts` pass against the regenerated files.
8. `npx nx affected -t lint test` is green.

## 8. Known and not changed

- **The chain's figure stays what velista draws as the unit price line** (velista `0101` rule
  5). This plan changes what compares, not what is printed. velista `0181` says where the
  derived figure is drawn.
- **A product sized in grams that the chain compares per piece** (2,651 rows) is now compared
  per kilo with its siblings. That is the group rule: the members of a group are one product
  in several sizes, and the kilo is what tells them apart.
- **The 4,266 rows with an empty label** keep a null `unitBasis` and gain a comparable pair
  where the size is known.
- **`DOZEN` and `WASH`** never become a comparable basis (C2). Eggs compare per unit.
- **The admin price proposal** (`price-proposal.ts`) keeps proposing the chain's figure with
  the labels `1 kg`, `1 L` and `1 ud`. It is the figure of a `unitPrice` row, not of this pair.
- **Whether a basket should prefer a cheaper sibling of another basis** is not a question
  this plan answers. Nothing compares across bases after it.
