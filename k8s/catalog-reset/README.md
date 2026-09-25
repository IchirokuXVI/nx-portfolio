# Resetting the catalog and harvester databases

This procedure empties the catalog and harvester databases of one cluster. The
auth and core databases, which hold the users' data, stay as they are. Run it
on the VPS as `deploy`, in a checkout of the chart.

## What changes

- **Catalog and harvester start empty.** The next deploy runs the migrations,
  which recreate the schema, the postal code points and the six price policies.
  The reference seed is off in both clusters, so nothing else comes back.
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

4. Deploy again, with a chart that has `referenceSeed.enabled: false`. A
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
