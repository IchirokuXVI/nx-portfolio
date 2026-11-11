> **PR:** [#964](https://github.com/IchirokuXVI/nx-portfolio/pull/964)

# 0254: DIA maps the leaves its menu added

> Found on 2026-11-06 by a scheduled walk of DIA on Luna slot 4 (run
> `41ecb2b2-90af-4017-9a75-88da126d1e1c`, fulfilment store 7745, 4,939 products, locked with
> `--keep-data`). The report names 13 menu leaves that `dia-map.json` does not know, holding 363
> products, plus five leaves the chain renamed and one it moved. A product under an unknown leaf
> resolves to no category of ours, so it waits in the queue with nothing to file it under. Five
> of the 13 are not seasonal: facial care, perfumes and colognes, and a sixth, tableware, sits under the Christmas root.
>
> Prerequisite reading: plan `0173` (DIA's tree becomes the reference taxonomy), plan `0174`
> section 7 (the category table, `unmappedLeaves`, `renamedLeaves`), plan `0166` (category slugs),
> `apps/luna-shopper-backend/harvester/docs/research/dia/data/dia-map.json` and
> `category-tree.json`, `libs/luna-shopper/dia/tools/generate-categories.ts`,
> `libs/luna-shopper/dia/src/lib/categories.ts` (generated, `DIA_CATEGORY_NAMES`,
> `DIA_CATEGORY_SLUGS`) and `harvest/dia-catalog.runner.ts` (`noteLeaves`).

## Brief for the agent

### Objective

Map every leaf of the Context table to a category slug of the reference taxonomy, record the five
renames, regenerate `categories.ts`, and make the walk's report state zero unmapped
leaves for the menu of the build day. Where no existing slug fits, propose one and stop for the
owner (D1).

### Context

The 13 leaves (id, DIA's name, products in store 7745, the root DIA files it under):

| Id | Name | Products | Root in the product's stored path |
| --- | --- | --- | --- |
| L2355 | Caldos y cremas | 8 | Navidad |
| L2222 | Ibéricos y quesos | 40 | Navidad |
| L2230 | Carnes, pescados y mariscos | 30 | Navidad |
| L2255 | Platos especiales | 22 | Navidad |
| L2356 | Bombones, chocolates y trufas | 36 | Navidad |
| L2353 | Turrones y dulces de Navidad | 57 | Navidad |
| L2354 | Especial otoño | 65 | Novedades y recomendados |
| L2258 | Mesa y hogar | 34 | Navidad |
| L2358 | Limpieza facial | 20 | Cabello y belleza |
| L2359 | Cremas y cuidado facial | 25 | Cabello y belleza |
| L2360 | Perfumes y colonias mujer | 13 | Cabello y belleza |
| L2361 | Perfumes y colonias hombre | 4 | Cabello y belleza |
| L2362 | Colonias infantiles y familiares | 9 | Cabello y belleza |

Renamed (the table knows the old name): L2030 `Ensaladas y verduras preparadas` to `Ensaladas`,
L2025 `Verduras congeladas y al vapor` to `Verduras congeladas`, L2015 `Pavo` to `Pavo y conejo`,
L2136 `Tartas y churros` to `Roscones, tartas y churros`, L2140 `Bolsitas y snacks` to
`Pouches y snacks`. Moved: L2144 from `/cabello-y-belleza/champu/` to
`/cabello-y-perfumeria/champu/`: the root `Cabello y belleza` is now `Cabello y perfumería`.
`category-tree.json` already names the new root. `movedLeaves` is not read from the data
files: the runner writes it when the server answers a leaf on another path than the menu gave
(`read.movedTo`, `dia-catalog.runner.ts` near line 330), so no change to the data clears it. It
is out of scope here and stays on the report until the menu and the answer agree.

The Navidad and Especial otoño leaves hold products DIA also sells under a permanent leaf;
`Especial otoño` held 65 products that day. L2353 (Christmas) was already newer than
`dia-map.json` when plan `0174` was rehearsed on 2026-10-02.

### Target state

`dia-map.json` maps each leaf of the table, `categories.ts` is regenerated and
`categories.spec.ts` passes, and one DIA walk on an ephemeral slot reports
`unmappedLeaves: []` and `renamedLeaves: []`.

### Scope

`dia-map.json`, `category-tree.json` (the new names and nodes), the regenerated `categories.ts`,
and nothing in the runner unless D2 picks (b).

### Constraints

- A leaf maps to a leaf slug of the reference taxonomy, as the generator requires.
- No new catalog category without the owner (D1): that is a catalog change, not a harvester one.
- The generator writes `categories.ts`; never by hand.

### Action boundaries

Stop and ask before adding a category to the catalog, or before mapping a leaf to a slug whose
products would differ (a perfume under a cream).

### Progress evidence

The generator's diff, `npx nx test luna-shopper/dia`, and the report keys of one walk.

## 1. The mapping

Propose, in the PR, one slug per leaf: a seasonal leaf maps to the permanent leaf its products
belong to (turrones to the sweets leaf, ibéricos and cheeses to their leaves, `Mesa y hogar` to
the household leaf); a beauty leaf maps to its permanent equivalent if the taxonomy has one.
List each leaf with no fitting slug for D1.

## Tests

`categories.spec.ts` as it is (the generated file agrees with the data) and a runner spec case
that a menu holding the 13 ids reports none unmapped.

## Acceptance criteria

- [ ] Each of the 13 leaves maps to a slug, or is listed for D1 in the PR.
- [ ] The five renames are recorded, so the walk reports `renamedLeaves: []`.
- [ ] One walk reports `unmappedLeaves: []`.

## Verification

Walk one DIA fulfilment store on an ephemeral slot and quote `unmappedLeaves`, `renamedLeaves`
and, for the record only, `movedLeaves`.

## Decisions

- **D1 (owner): beauty leaves with no slug.** If the taxonomy has no facial care or perfume leaf:
  (a) add the leaves to the catalog in a plan of its own; (b) map them to the nearest existing
  leaf. Recommended: (a) for perfumes, which are a product type of their own.
- **D2 (owner): seasonal leaves come back every year with new ids.** (a) map by hand each season,
  as here; (b) let the runner read a product of an unknown seasonal leaf from its other leaf when
  DIA files it twice. Recommended: (a) now, and measure how many Navidad products DIA files under
  a permanent leaf too before (b).
