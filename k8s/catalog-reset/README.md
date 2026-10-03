# Resetting the catalog and harvester databases

This procedure empties the catalog and harvester databases of one cluster. The
auth and core databases, which hold the users' data, stay as they are.

**It runs by itself** as release task
`k8s/release-tasks/tasks/0001-reset-catalog-and-harvester`, once in staging and
once in production, at the first deploy that carries it. The steps below are
what that task does, and they are the way to run it by hand, on the VPS as
`deploy`.

## What changes

- **Catalog and harvester start empty.** The next deploy runs the migrations,
  which recreate the schema, the postal code points and the six price policies.
  The reference seed no longer exists (backend plan 0180), so nothing else
  comes back.
- **Lost for good in catalog:** every chain, shop, price scope, product,
  product group, brand, price, alias and audit row.
- **Lost for good in the harvester:** every harvest run, preset, uploaded
  leaflet and `supermarket_sources` row.
- **Kept:** the Secrets. The database passwords, the URLs and
  `HARVESTER_ACTOR_ID` live in Secrets, not in the databases. Do not run
  `provision-release.sh --rotate`.
- **Core keeps catalog ids** with no foreign key, so they point at nothing after
  the reset. `cleanup-core-catalog-refs.sh` clears them. The table of what it
  changes is at the top of the script. Lines keep their text and quantity.
  Purchases keep their outcome, quantity and price paid, and lose the product,
  chain, shop and scope.
- **Redis and NATS need no action.** Redis holds a cache with a 60 second
  lifetime and no persistence. The NATS stream holds zone, list and basket
  events only.

## Procedure

1. Take a backup of all four databases.

   ```sh
   kubectl -n nx-portfolio create job --from=cronjob/luna-shopper-backend-auth-db-backup reset-backup-auth
   kubectl -n nx-portfolio create job --from=cronjob/luna-shopper-backend-core-db-backup reset-backup-core
   kubectl -n nx-portfolio create job --from=cronjob/luna-shopper-backend-catalog-db-backup reset-backup-catalog
   kubectl -n nx-portfolio create job --from=cronjob/luna-shopper-backend-harvester-db-backup reset-backup-harvester
   kubectl -n nx-portfolio wait --for=condition=complete --timeout=10m \
     job/reset-backup-auth job/reset-backup-core job/reset-backup-catalog job/reset-backup-harvester
   ```

   Make sure that the four new dumps are in the bucket before you continue.
   Staging has no backup CronJobs, so skip this step there.

2. Stop the catalog and the harvester, so that nothing writes during the reset.

   ```sh
   kubectl -n nx-portfolio scale deploy/luna-shopper-backend-catalog deploy/luna-shopper-backend-harvester --replicas=0
   ```

3. Drop and recreate the two databases. The pods and their volumes stay.

   ```sh
   kubectl -n nx-portfolio exec luna-shopper-backend-catalog-db-0 -- \
     psql -U luna_catalog -d postgres -c 'DROP DATABASE luna_catalog WITH (FORCE)' -c 'CREATE DATABASE luna_catalog OWNER luna_catalog'
   kubectl -n nx-portfolio exec luna-shopper-backend-harvester-db-0 -- \
     psql -U luna_harvester -d postgres -c 'DROP DATABASE luna_harvester WITH (FORCE)' -c 'CREATE DATABASE luna_harvester OWNER luna_harvester'
   ```

4. Deploy again. The chart has had no reference seed since backend plan 0180,
   so there is no switch to check first. A
   service does not migrate its database at startup. The migration Jobs are Helm
   hooks, so an upgrade is what rebuilds the schema, and it also scales the two
   services back up.

   ```sh
   k8s/helm/deploy-release.sh <current-version>   # production
   ```

   In staging, the next deploy from `main` does the same.

5. Clean up core. Run it without arguments first. That is a dry run: it prints
   what it will change and rolls back.

   ```sh
   k8s/catalog-reset/cleanup-core-catalog-refs.sh
   k8s/catalog-reset/cleanup-core-catalog-refs.sh --apply
   ```

   Run it before anybody adds catalog data again. It keeps every id that catalog
   still holds, so it is safe to run twice, and the second run changes nothing.
   If the catalog database has no schema, it stops before it touches core.

6. In the back office, create the `supermarket_sources` rows again. Every chain
   starts off. Core announces a postal code only on a profile change, so the
   postal code discovery queue does not refill for existing users.

## How it was tested

On 2026-09-25, the task ran against Luna slot 4, which held a copy of the
volumes of slot 3. Slot 3 was only read. The steps were the same as on a
deploy: dumps in the format of the backup CronJob, then `pre.sh`, then the
migrations with the seed off, then the cleanup.

| Step         | Result                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Before       | catalog 2,290 products, 13 shops, 2,409 prices. Core 21 lists, 71 lines, 16 line products, 11 purchases. |
| After        | catalog empty but migrated. Core 21 lists, 71 lines, 0 line products, 11 purchases with no catalog ids.  |
| Gateway      | `/health/ready` answered 200 before and after.                                                           |
| Second run   | `pre.sh` left both databases alone, and the cleanup changed 0 rows.                                      |
| Dump restore | The restored catalog, harvester and core counts were equal to the counts before.                          |

## Removing only the products

Release task `0002-remove-catalog-products` keeps both databases and removes
only the products. `remove-catalog-products.sh` deletes every row of catalog's
`items`, and the foreign keys remove the prices and availability of those
products. It then sends each harvester row that was bound to a product back to
the queue. The task runs `cleanup-core-catalog-refs.sh` last, for core.

Chains, shops, price scopes, price policies, brands, product groups, harvest
runs, sources, discovered places, postal code requests and the source rows with
their prices all stay.

Run the script without arguments for a dry run. It prints the counts and rolls
back.

```sh
k8s/catalog-reset/remove-catalog-products.sh
k8s/catalog-reset/remove-catalog-products.sh --apply
k8s/catalog-reset/cleanup-core-catalog-refs.sh --apply
```

### How it was tested

On 2026-10-02, the scripts ran against Postgres containers on a copy of the
volumes of slot 3. Slot 3 was only read.

| Step       | Result                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Before     | catalog 2,290 products, 6,661 offers, 2,409 prices. Harvester 2,169 bound rows and 11 proposals.              |
| After      | catalog 0 products, offers and prices. 6 chains, 13 shops, 17 price scopes, 65 brands and 161 groups stayed.  |
| Harvester  | 2,180 rows went back to the queue. 16 runs, 4,323 source prices and 92 discovered places stayed.              |
| Core       | 16 line products deleted, 16 lines rehashed, 11 purchases lost their product id and kept the price paid.      |
| Second run | The catalog step left the table alone, and the other two steps changed 0 rows.                                |
