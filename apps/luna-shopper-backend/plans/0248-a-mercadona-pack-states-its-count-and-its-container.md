# 0248: a Mercadona pack states its count and its container

> Found on 2026-11-06 by a scheduled walk of every chain on Luna slot 4 (run
> `261ae8b8-57ff-470b-b9c1-be8864f9bd28`, warehouse 4661, 4,331 products, 0 failed). The slot is
> locked with `--keep-data`, so every row named here can be read again. A four pack of half litre
> Coca-Cola reads as one two litre bottle, and the queue proposes it as the same product as the
> real two litre bottle. Two causes, both in the Mercadona adapter: `readPackCount` reads
> `pack_size` as a count when, on packs of drinks and desserts, the chain uses it for the size of
> one unit; and the container the chain prints (`packaging`: `Brik`, `Botella`, `Pack-4`) is read
> and then dropped, so a brik and a bottle of the same milk share a name and a size.
>
> Prerequisite reading: plan `0162` (how many are in the pack), plan `0177` (a source size
> states its own unit), plan `0183` (a size counts what is inside), plan `0155` (the sibling key
> of rung 4), `libs/luna-shopper/mercadona/src/lib/normalize.ts` (`toListProduct`,
> `normalizeProduct`, `readUnitSize`, `comparedOver`, `readPackCount`),
> `libs/luna-shopper/mercadona/src/lib/types.ts`, the fixtures README beside them,
> `apps/luna-shopper-backend/harvester/src/app/harvest/mercadona-catalog.runner.ts` and
> `harvest/matching.ts` (`siblingKey`, `entryNameKey`).

## Brief for the agent

### Objective

Make the Mercadona adapter state the pack count of every pack whose payload proves it, including
the packs where `pack_size` is the size of one unit, and carry the chain's `packaging` text onto
the source row so two containers of one product stop reading as one product. Nothing else about
a Mercadona row changes.

### Context

- `readPackCount` (`normalize.ts`, near line 496) answers, for `is_pack: true`, `pack_size` or
  `total_units`, and null when both are set and differ. Its comment says `pack_size` is a count,
  proved by `product-capsules-per-unit.json` (`pack_size: 20`, `total_units: 20`).
- What the walk of 2026-11-06 read live (`GET /api/products/<id>/?lang=es&wh=4661`):

  | id | Name | `packaging` | `is_pack` | `pack_size` | `total_units` | `unit_size` | `size_format` | `unit_price` |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 28113 | Refresco Coca-Cola | Pack-4 | true | 0.5 | 4 | 2 | l | 6.00 |
  | 28115 | Refresco Coca-Cola zero azúcar | null | true | 0.5 | 4 | 2 | l | 6.00 |
  | 21698 | Bebida energética Energy Drink Hacendado | null | true | 0.25 | 6 | 1.5 | l | 2.40 |
  | 18382 | Postre Caramel Cake Hacendado | null | true | 0.08 | 2 | 1.6 | kg | 1.70 |
  | 27342 | Refresco Coca-Cola | Botella | false | null | null | 2 | l | 2.19 |

  18382 also answered `bulk_price: "10.63"` and `reference_price: "10.625"`; 28113 answered
  `bulk_price: "3.00"`, the price of a litre of the pack.

  On the first three, `pack_size × total_units = unit_size`: `pack_size` is the content of one
  unit and `total_units` is the count. Each row was stored with `packCount` null and the size of
  the whole pack, which is the convention of plan `0162`. The queue then proposed 28113 as a
  `CANDIDATE` of 27342 (`matchedBy: NAME_SIZE`, confidence 0.6), and the same for the zero sugar
  pair and the energy drink pair.
- On 18382 the chain contradicts itself: `0.08 × 2 = 0.16`, `reference_price` 10.625 is 1.70 over
  0.16, and `unit_size` says 1.6. The stored size is 1.6 kg. Plan `0249` handles a size that its
  own comparison price disproves. This plan states the count (2) and leaves the size to `0249`.
- `toListProduct` reads `packaging` into `MercadonaListProduct.packaging` (`types.ts`, line 110).
  Nothing downstream reads it. On slot 4, 18 groups of Mercadona rows (36 rows) share a name and
  a size: nine are pieces with no size, three are the pack and single pairs above, and six differ
  only by container: `Brik` and `Botella` (milk, apple juice), `Tarrina` and `Pastilla` (butter),
  `Vaso` and `Paquete` (noodles). Their prices differ (0.83 and 1.09).
- `siblingKey` (`matching.ts`, near line 214) is the name, `sizeFormat` and `unitSize`.
  `packCount` is not part of it, so a pack and a single unit of one size still share a key after
  the count is fixed. Separating them needs D2 or D3.
- Plan `0162`'s table says Mercadona's `packaging` is a container, not a count, and backlog
  `0001` section 3.3 meant a jsonb `attributes` for it. No column holds it today.

### Target state

Every acceptance criterion holds, and a re-run of the same walk on a slot shows packCount 4 on
28113, 6 on 21698 and 2 on 18382. With D3 (a), no `CANDIDATE` joins a pack and a single unit of
the same drink; with D2 (b), none joins two containers of one product.

### Scope

- `libs/luna-shopper/mercadona/src/lib/normalize.ts`, `types.ts`, their specs, and new fixtures
  captured with the library's `capture-fixtures` target.
- The Mercadona runner and the observation it builds, only to carry `packaging` through.
- The place the row keeps it (section 2) and the key of rung 4, only if the owner picks D2 (b).

### Constraints

- `bulk_price` stays verbatim (plan `0038`, section 2.4). Nothing here derives a price.
- A count is read, never chosen: a payload whose fields disagree in a way this plan does not
  name still answers null.
- `unitSize` keeps the convention of plan `0162`: the size of the whole pack.
- Fixtures come from the `capture-fixtures` target, never by hand.

### Action boundaries

Stop and ask before adding a database column (D1 decides where `packaging` lives), before
changing a matching key, and before touching any other adapter.

### Progress evidence

The new specs, `npx nx test luna-shopper/mercadona`, `npx nx test luna-shopper-backend-harvester`,
and a walk of one warehouse on an ephemeral slot whose report and rows are quoted in the PR.

## 1. The count

`readPackCount` for `is_pack: true` becomes five cases, in this order:

0. Only one of `pack_size` and `total_units` is set: the count is that one, as today
   (`packCountOf(packSize ?? totalUnits)`).
1. `pack_size` and `total_units` are equal: the count is that number (today's capsules).
2. `total_units` is a whole number above 1 and `pack_size × total_units` equals `unit_size`
   within the rounding of the payload (four decimals): the count is `total_units`, and
   `pack_size` is the content of one unit.
3. `total_units` is a whole number above 1 and `reference_price` equals `unit_price` over
   `pack_size × total_units` within one step of its last decimal (`comparedOver` already reads
   that tolerance): the count is `total_units`. This is 18382.
4. Anything else is null, as today when both are set and differ.

The branch for `is_pack: false` (the box priced as one piece, plan `0177`) does not change.

Case 3 states only the count. It does not change `unit_size`.

## 2. The container

`packaging` is the chain's own text. Store it verbatim on the source row so the queue shows it
and a person can tell a brik from a bottle. Where it lives is decision D1. Whether it also joins
the sibling key of rung 4, so a brik is never proposed as the bottle, is decision D2.

## 3. Fixtures

Capture 28113, 21698, 18382 and 27342 with `capture-fixtures` and name them after what they
prove (`product-pack-of-bottles.json`, `product-pack-size-is-content.json`,
`product-pack-contradicts-size.json`, `product-single-bottle.json`). Update the fixtures README.

## Tests

- `normalize.spec.ts`: each case of section 1 from a captured fixture, and the existing capsule
  and box fixtures unchanged.
- A spec that `packaging` reaches the observation.
- If D2 (b): a `matching.spec.ts` case that two rows differing only by `packaging` do not share a
  sibling key, and two rows with the same `packaging` still do.
- If D3 (a): a `matching.spec.ts` case that two rows differing only by `packCount` do not share a
  sibling key.
- A case for each of the two "only one field set" shapes of case 0.

## Acceptance criteria

- [ ] 28113 reads `packCount` 4, 21698 reads 6, 18382 reads 2, and each keeps the `unitSize` it
  had.
- [ ] The capsules fixture still reads 20, and every other fixture keeps its count.
- [ ] `packaging` is stored on the row as the chain printed it.
- [ ] No price field changes.

## Verification

On an ephemeral slot, walk warehouse 4661 with `details: ALL` and read
`select name, "packCount", "unitSize" from source_catalog_entries where "externalId" in ('28113','21698','18382')`.

## Decisions

- **D1 (owner): where `packaging` lives.** (a) a nullable `packaging varchar(40)` column on
  `source_catalog_entries`, a harvester migration; (b) a key in `extra`. Recommended: (a), because
  the queue and the key of D2 read it, and a typed column is what a filter needs.
- **D2 (owner): does the container separate products.** (a) shown only; (b) also part of rung
  4's sibling key for Mercadona rows, so a brik never proposes a bottle. Recommended: (b), because
  the catalog merge rules already say a different format is a different product, and the prices
  differ.
- **D3 (owner): does the pack count separate products.** (a) `packCount` joins rung 4's sibling
  key for every chain, so a pack of four never proposes the single bottle of the same total size;
  (b) no. Recommended: (a). Without it the count fixed here is shown and the queue still proposes
  28113 as 27342, because both read 2 l. It is a change to a matching key, so the builder stops
  for it as the action boundaries say.
