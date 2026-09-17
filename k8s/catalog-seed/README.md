# Seeding a cluster's catalog from a local harvest

The catalog is populated by running the harvester **locally** and moving the
result, rather than by harvesting from a cluster. Plan 0038 kept the harvester out
of staging and production, and that part is no longer true: `values.staging.yaml`
and `values.production.yaml` both set `enabled: true` and `harvestEnabled: true`.
What a cluster runs is still narrow. Every chain's `supermarket_sources` row is off
(plan 0083), so no storefront is fetched there. The clusters run store discovery,
which is two requests, and leaflet imports, which are none. A catalog discovery run
is 4,383 HTTP requests over about eighteen minutes, and it still happens here
against the compose stack, where the development machine has room for it.

So the flow is: harvest here, export the catalog data, restore it there.

## What travels, and what does not

Only the **catalog** database travels. The harvester's own tables
(`source_catalog_entries`, `harvest_runs` and the rest) stay on the development
machine. The harvester now exists in both clusters, with its own Postgres and PVC,
but a local run's rows are not copied into that database. Nothing in catalog
references those rows.

The export is data only, table by table, in dependency order. This is the list in
`export-catalog.sh` today:

| Table                        | Why it is in the list                                         |
| ---------------------------- | ------------------------------------------------------------- |
| `supermarkets`               | the chain                                                     |
| `price_scopes`               | a location cannot exist without one to price against          |
| `supermarket_locations`      | physical stores, when a store discovery run has been imported |
| `product_groups`             | an item may point at one                                      |
| `items`                      | the products                                                  |
| `supermarket_items`          | the price a shopper sees, per item per scope                  |
| `supermarket_location_items` | per store overrides, when there are any                       |

`migrations` is deliberately **not** exported. The target's schema belongs to the
migrations the chart has already run, and carrying that table over would make the
target disagree with its own history.

**Ids are preserved.** Luna joins its databases by opaque id with no cross
database foreign keys, so a core shopping line points at an item id in catalog. A
restore that renumbered rows would break every one of those lines. This is also
why re-importing a catalog that is already in use is not cheap: fixing a field in
place is, recreating the rows is not.

### The script predates newer catalog tables

The list above was written for plan 0038. Catalog has gained tables since then,
and the script does not export any of them:

| Table                               | What it holds                                                  |
| ----------------------------------- | -------------------------------------------------------------- |
| `item_prices`                       | every price a source gave, one row per source (plan 0080)      |
| `item_price_details`                | what a leaflet printed beside one price (plan 0081)            |
| `price_policies`                    | how each source kind competes (a migration inserts these rows) |
| `brands`                            | registered brands, referred to by `items.brandId` (plan 0115)  |
| `supermarket_location_price_scopes` | which scopes each shop sells at (plan 0105)                    |
| `catalog_audit`                     | who changed a catalog row, and how (plan 0075)                 |
| `postal_code_points`                | postal code centroids, loaded by a migration (plan 0060)       |

The script has not been updated for these tables, and a restore with it has not
been checked against the current schema. Read the consequences below before you
use it:

- **Prices do not travel as sources.** Since plan 0080, `supermarket_items` is
  derived from `item_prices`, and nothing writes a price to it directly. The dump
  carries the derived rows but not the rows they were derived from. When catalog
  recomputes one of those rows (a write for that item and scope, or the sixty
  second sweep once `nextBoundaryAt` passes), it finds no source row and clears
  the price.
- **Brands do not travel.** `items.brandId` has a foreign key to `brands`. An item
  row that names a brand the target does not hold is refused by that key.
- **Shops lose their scopes.** A shop's scopes are rows in
  `supermarket_location_price_scopes`, not a column on `supermarket_locations`, so
  restored shops arrive with no scope to price against.

## Export

From the worktree that ran the harvest, naming that slot's catalog container:

```sh
bash k8s/catalog-seed/export-catalog.sh luna-slot2-catalog-db-1 catalog-seed.sql
```

It prints a row count per table. Check them before moving on: an export that
silently wrote nothing looks exactly like a successful one until it is restored.

## Restore BEFORE the reference catalog seed, never after

Plan 0067 adds a second writer of catalog products: a seed that creates the 239
products the till receipts name, Mercadona included, so a database with no
harvest still has something real in it. The two agree on identity by barcode, and
`uq_items_ean` is UNIQUE where not null, so whichever writes second is refused
for every product they share.

The seed handles that in one direction and only one. It looks each barcode up
first, so on a database that already holds this dump it adopts the harvested rows
and creates only the eight products the harvest does not carry. The other
direction has no such check: restoring this dump onto a database the seed has
already populated tries to insert a second row for 109 barcodes and fails.

So on any environment where both are wanted, restore this first and let the seed
run afterwards. On a cluster that means restoring before the deploy that sets
`lunaShopperBackend.referenceSeed.enabled: true`.

## Restore into staging, then production

The dump is plain SQL with `ON CONFLICT DO NOTHING`, so it is safe to run twice
and safe to repeat after a partial failure. The local and cluster databases run
the same `postgres:16-alpine`, so there is no version skew to work around.

```sh
# staging first, always
kubectl exec -i -n nx-portfolio luna-shopper-backend-catalog-db-0 \
  -- psql -U luna_catalog -d luna_catalog < catalog-seed.sql

# check it landed
kubectl exec -n nx-portfolio luna-shopper-backend-catalog-db-0 \
  -- psql -U luna_catalog -d luna_catalog \
  -c 'select count(*) from items' -c 'select count(*) from supermarket_items'
```

Then the same two commands against the production cluster's context. Nothing
about the commands differs between environments: the resource names are identical
in both clusters, and which one you are talking to is decided by the kubeconfig
context, exactly as it is for `helm upgrade`.

## After a restore

The derived rows keep the `priceSourceKind` (for a Mercadona crawl,
`OFFICIAL_API`) and the `priceObservedAt` of the harvest, not of the restore. That
is correct, because they were observed then.

The rule that decides which price a shopper sees is plan 0080's, not plan 0038's.
Every source's price is a row of its own in `item_prices`, and nothing overwrites
another row. `price_policies` plus the seven day protection window on an `ADMIN`
row decide on every read which one wins, and the answer is materialized on
`supermarket_items`. An `OFFICIAL_API` price has a maximum age of seven days in the
shipped policy. Because the dump carries no `item_prices` rows, a restored price
has nothing behind it once catalog recomputes it (see the section on newer tables
above). A price that has to last in a cluster needs its `item_prices` row there,
and this script does not write one.
