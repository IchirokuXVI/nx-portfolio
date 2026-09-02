# Seeding a cluster's catalog from a local harvest

The catalog is populated by running the harvester **locally** and moving the
result, rather than by harvesting from a cluster. That is not a workaround: plan
0038 turns the harvester off in staging and production on purpose, and
`values.staging.yaml` and `values.production.yaml` both say so. A run costs a
fourth Postgres and eighteen minutes of fetching that the two VPSs do not have
room for, and enabling it there is a separate decision.

So the flow is: harvest here, export the catalog data, restore it there.

## What travels, and what does not

Only the **catalog** database travels. The harvester's own tables
(`source_catalog_entries`, `item_source_refs`, `harvest_runs`) stay on the
development machine, because the harvester does not exist in either cluster --
the chart renders no Deployment, no Postgres and no PVC for it. Nothing in
catalog references those rows.

The export is data only, table by table, in dependency order:

| Table                        | Why it is in the list                                         |
| ---------------------------- | ------------------------------------------------------------- |
| `supermarkets`               | the chain                                                     |
| `price_scopes`               | a location cannot exist without one to price against          |
| `supermarket_locations`      | physical stores, when a store discovery run has been imported |
| `product_groups`             | an item may point at one                                      |
| `items`                      | the products                                                  |
| `supermarket_items`          | one price per item per scope                                  |
| `supermarket_location_items` | per store overrides, when there are any                       |

`migrations` is deliberately **not** exported. The target's schema belongs to the
migrations the chart has already run, and carrying that table over would make the
target disagree with its own history.

**Ids are preserved.** Luna joins its databases by opaque id with no cross
database foreign keys, so a core shopping line points at an item id in catalog. A
restore that renumbered rows would break every one of those lines. This is also
why re-importing a catalog that is already in use is not cheap: fixing a field in
place is, recreating the rows is not.

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

The prices carry `priceSourceKind = OFFICIAL_API` and the `priceObservedAt` of
the harvest, not of the restore. That is correct -- they were observed then --
and it is what lets a future harvester run update them. Had they been written as
`ADMIN`, plan 0038 section 6.5 would forbid any automated fetch from ever
correcting them, because that rule exists to stop a fetch overwriting a price a
person typed in.
