> **PR:** [#352](https://github.com/IchirokuXVI/nx-portfolio/pull/352)

# 0108 One walk, several warehouses

A Mercadona catalog discovery walks one warehouse. The warehouse it walks and the scope it writes for
are two separate inputs, and nothing joins them:

| Input           | Comes from                                                               |
| --------------- | ------------------------------------------------------------------------ |
| the warehouse   | `source.config.warehouse` (`mercadona-catalog.runner.ts:202`)            |
| the price scope | `input.priceScopeId`, chosen at the spawn (`harvest-run.service.ts:462`) |

The runner calls `requireScope` only to fail early, and its own comment says so: "Checked and not
kept". The scope's `externalKey` is never read, and neither the spawn nor the runner compares it to
`config.warehouse`. So a run started with `warehouse: "4661"` in config and the scope keyed `4804`
walks Córdoba and writes those prices onto A Coruña's scope, with no error and nothing in the report
to show it.

This plan removes both halves of that. **The warehouse is read from the scope, and a run takes
several scopes.**

Depends on `0105` for the priority a scope carries, and on `0106` for the scopes existing at all:
this run selects scopes and creates none.

## 1. The warehouse comes from the scope

`config.warehouse` is deleted. For each scope the run is given, the warehouse is that scope's
`externalKey`, which is what `0106` wrote there and what `PriceScope.externalKey` has been documented
as holding since `0038`.

The error an operator meets today goes with it:

> This source has no `warehouse` in its config. Resolve one from a postal code first (plan 0038,
> section 2.2) and set it with supermarketSource.upsert.

There is nothing to set any more. A run either names scopes or is refused, and a scope carries its
own warehouse.

**A selected scope whose `externalKey` is null is refused at the spawn**, naming the scope. That is a
`STORE` scope somebody priced by hand, and there is no warehouse to walk for it.

## 2. The run takes a list

```ts
export interface CatalogDiscoveryInput {
  /**
   * The scopes to walk, one warehouse each, read from `externalKey`.
   *
   * A list and not one id, because the cost of a walk is dominated by the
   * product detail phase and that phase is shared across warehouses (section 3).
   * Which scopes a run is allowed to take is section 4.
   */
  priceScopeIds: string[];
  detailBackfill?: boolean;
}
```

`mercadona-api` gains `scopesItsOwn: true` in `ADAPTER_CAPABILITIES`, so the spawn stops demanding
one default scope and starts demanding a non-empty list.

Each price claim is stamped with its scope key, which the report has carried since `0103`:

```ts
report.price({ externalId, scopeKey: warehouse, price, bulkPrice, observedAt });
report.assortmentComplete(warehouse);
```

`assortmentComplete` per warehouse is what lets the orchestrator work out, per scope, what that
warehouse does not carry. A run of four warehouses completes four assortments, not one.

## 3. Why several warehouses cost far less than several runs

A single warehouse walk is 4,383 requests: 151 for the category tree, then 4,232 product details. The
detail phase exists for `ean` and `brand`, and **neither depends on the warehouse**. The category
listing already carries the price: every product in a level 2 category response has
`price_instructions` with `unit_price` and `bulk_price` on it.

So the shape is:

1. Walk the tree once per warehouse: **151 requests each**. This is where the prices come from, and
   where the assortment of that warehouse comes from.
2. Fetch detail once per product **ever seen across the selected warehouses**, not once per
   warehouse.

| Warehouses | One run each | This plan    |
| ---------- | ------------ | ------------ |
| 1          | 4,383        | 4,383        |
| 6          | 26,298       | about 5,300  |
| 255        | 1,117,665    | about 42,700 |

At the owner set four requests per second that is roughly three hours for all 255 rather than about
seventy six. The second column is what the code does today, once per run.

**A product first seen in the fourth warehouse still needs its detail**, so the detail count is the
size of the union of the assortments and not of the first one. The report states both numbers, which
is what makes the saving auditable rather than assumed.

## 4. Which scopes a run may take

The implementation decides, and it decides on priority, which is what `0105` added:

```ts
/**
 * The scope priorities this adapter's walk may write.
 *
 * Mercadona prices by warehouse, so a walk writes REGION scopes and nothing
 * coarser or finer. A NATIONAL row for this chain is an operator's summary and
 * not something a crawl of one warehouse may claim, and a STORE row is a hand
 * entered price a crawl must never overwrite.
 */
walkablePriorities: {
  min: number;
  max: number;
}
```

For `mercadona-api` that is the `REGION` band alone. A spawn naming a scope outside it is refused,
naming the scope and its priority. This is the switch the operator asked for, and it lives in the
adapter table rather than in the runner, so a chain that genuinely prices nationally states so once.

## 5. Two things that look like bugs and are not

Both were measured against the live API on 2026-09-10, across six warehouses and 1,807 products.

### 5.1 A differing `unit_price` with an identical `bulk_price` is pack weight

| wh     | `unit_price` | `bulk_price` | `unit_size` | `approx_size` |
| ------ | ------------ | ------------ | ----------- | ------------- |
| `4661` | 4.38         | 7.30         | 0.60 kg     | true          |
| `alc1` | 4.75         | 7.30         | 0.65 kg     | true          |
| `4149` | 4.75         | 7.30         | 0.65 kg     | true          |
| `4055` | 4.31         | 7.30         | 0.59 kg     | true          |

The euros per kilo is national. What differs is the typical weight of the tray. Of the differences
between warehouses, 59 to 126 per pair were of this kind and only 0 to 32 were a real `bulk_price`
difference.

**So `bulk_price` is still stored verbatim and still never recomputed**, which is the rule from
`0038`. A run that "corrected" `unit_price` to `bulk_price` times a national weight would be
inventing a number no shop charges.

### 5.2 Real differences are rare, regional, and must not be collapsed

Across five warehouse pairs, 36 products differed in `bulk_price`. Thirty two of them were in one
warehouse, `4149`, and every one was an energy drink: the Catalan tax on packaged sugary drinks.
Sampling one warehouse per province, 52 warehouses fell into 10 price signatures, and one group was
exactly the four Catalan provinces while another was exactly the two Canary Islands provinces.

That is a good reason to select a subset of warehouses for a routine crawl. **It is not a reason to
store a subset.** The format allows a price per warehouse, a collapsed model cannot record the week
one warehouse differs, and `0089` already states this rule for LIDL's 59 regions. Prices are written
per scope, one row per scope, exactly as `0080` requires.

## 6. What changes

| File                                                   | Change                                            |
| ------------------------------------------------------ | ------------------------------------------------- |
| `harvester/.../harvest/mercadona-catalog.runner.ts`    | walk per scope, share the detail phase            |
| `harvester/.../harvest/catalog-runner.ts`              | `priceScopeIds` on the input                      |
| `harvester/.../harvest/harvest-run.service.ts`         | the list, the priority band, the null key refusal |
| `harvester/.../harvest/supermarket-source.service.ts`  | `config.warehouse` is no longer read              |
| `libs/luna-shopper/contracts/.../harvest.messages.ts`  | `scopesItsOwn: true`, `walkablePriorities`        |
| `gateway/.../harvest/harvest.dto.ts`                   | a scope list on the spawn                         |
| `libs/luna-shopper-admin/feature-harvest/runs-page.ts` | a multi select, filtered to the allowed band      |

The back office picker becomes a multi select showing each scope's key and label, disabled for scopes
outside the adapter's band rather than hidden, so an operator can see why one is not offered.

## 7. Order of work

1. The contract: `scopesItsOwn`, `walkablePriorities`, the input.
2. The spawn: the list, the band, the refusals, with their messages.
3. The runner: walk per scope, detail over the union.
4. Delete `readWarehouse` and `config.warehouse`.
5. The back office multi select.
6. `npx nx run luna-shopper-backend-gateway:openapi` and
   `npx nx run luna-shopper-admin/models:wire-types`.

## 8. Tests

- A run of one scope writes what it writes today, keyed to that scope.
- A run of three scopes writes three prices for a product all three carry, and one for a product only
  one carries.
- The detail phase is entered once per external id across three scopes, not three times. This is the
  test that protects the saving in section 3.
- A product absent from the first scope and present in the third is detailed.
- `assortmentComplete` is reported once per scope.
- A scope whose `externalKey` is null is refused, naming it.
- A scope outside the adapter's priority band is refused, naming it and its priority.
- An empty scope list is refused.
- A spawn no longer reads `config.warehouse`, and a source that still has one is unaffected.
- `mercadona-catalog.runner.spec.ts` keeps its fixture based walk with no network.

## 9. Decisions

- **D1. The warehouse is the scope's `externalKey`.** One fact in one place, and the mismatch that
  silently mislabels a whole crawl becomes unrepresentable.
- **D2. `config.warehouse` is deleted, not deprecated.** Leaving it would leave two answers, and the
  wrong one has no error attached.
- **D3. The run selects scopes and creates none.** Creation is `0106`'s, through `0103`'s resolver.
- **D4. The detail phase is shared, the tree walk is not.** Detail carries `ean` and `brand`, which
  do not vary by warehouse. The tree carries price and assortment, which do.
- **D5. What a walk may write is a priority band on the adapter.** Not a runner conditional, and not
  an environment variable.
- **D6. Prices stay one row per scope.** No collapsing, whatever the measurements say this month.

## 10. What this plan does not do

- It does not decide which warehouses to crawl on a schedule. A run is still started by an operator
  or by the existing trigger.
- It does not touch `LEAFLET_IMPORT`, the `ADMIN` price row, the seven day protection window, or
  `price_policies`.
- It does not change `deza-web`, `carrefour-web` or `lidl-api`. LIDL already scopes its own prices
  and is untouched by the list.
- It writes nothing to `supermarket_items` directly. The materialized answer is recomputed inside the
  write that changed it, per `0080`.
