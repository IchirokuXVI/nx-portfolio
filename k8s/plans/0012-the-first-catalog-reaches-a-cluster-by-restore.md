# 0012 The first catalog reaches a cluster by restore

> Asked for by the owner on 2026-10-03. The catalog that was harvested and curated on a
> local slot must reach staging, then production. Both clusters start from empty catalog
> and harvester databases, so the first move copies two whole databases and merges
> nothing. A merge is backend backlog plan `0019`, for the moves after this one.
>
> **Needs plan `0011` first.** The task this plan adds is the first to state a window, a
> production release and a `check.sh`. Without `0011` it has no gate, and tasks `0001` and
> `0002` can still empty what it restores.
>
> Prerequisite reading: `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md` (what
> the two dumps hold and the five conditions it sets), `k8s/helm/restore-database.sh`,
> `k8s/release-tasks/README.md`, `k8s/catalog-reset/README.md`, k8s plan `0005`.

## Brief for the agent

### Objective

Add a release task that puts `catalog.dump` and `harvester.dump` in place of a cluster's
empty catalog and harvester databases, proves that the result is the documented state,
and leaves the old databases beside the new ones for a week.

### Context

- **The artifact** is two `pg_dump -Fc` files, taken on 2026-10-03 at 20:44 Madrid time,
  in the git ignored folder
  `.curation-runs/2026-10-deza-staging/harvest-curation/final-dumps/` on the owner's
  machine. Slot 1 holds the same data, locked with `--keep-data`.
- **The state they hold** (`initial-catalog-2026-10.md`, "The state in numbers"): 5
  supermarkets, 103 price scopes, 275 categories, 2,782 brands, 19,791 products, 22,335
  price rows, 25,725 queue rows of which 21,751 are `ACTIVE`.
- **Why a restore and not an import through the services.** Every id in the dumps must
  survive. `source_catalog_entries.itemId`, `item_prices.sourceRunId` and core's
  `list_line_items.itemId` name rows across three databases with no foreign key between
  them. The bulk routes of the gateway create rows with random ids. Only 4,190 of the
  19,791 products have an EAN, so nothing else can tell two copies of a product apart.
  A whole database restore also carries what the services derive on a write
  (`supermarket_items`, the search documents), so nothing has to be computed again.
- **Where the ids came from.** The local catalog started as a dump of staging
  (2026-10-03T00:16:54Z). Staging then held 139 brands, 5 supermarkets, 102 price scopes,
  40 locations and no products, and the local work kept those ids. Production's ids are
  its own, and the owner decided to empty production's catalog and harvester first
  (release task `0001`).
- **`restore-database.sh` already does the first half.** It downloads an object from the
  backup bucket inside the database pod, checks that `pg_restore --list` reads it, and
  restores it into `<database>_restore` beside the real one. It never writes to the real
  database. The second half, the swap, is typed by hand today.
- **There is no road to a cluster's Postgres from outside.** The databases are ClusterIP
  StatefulSets. Everything runs on the VPS as `deploy`, through `kubectl exec`.

### Target state

1. `k8s/catalog-import/restore-first-catalog.sh`: dry run by default, `--apply` to change
   anything (section 2).
2. `k8s/release-tasks/tasks/0003-restore-the-first-catalog/` with `task.env`, `check.sh`
   and `post.sh`, which calls the script (section 3).
3. `k8s/catalog-import/first-catalog.manifest`: the checksums and row counts the script
   holds the dumps to (section 1).
4. `k8s/catalog-import/README.md`: what it changes, how to run it by hand, how to revert.
5. `restore-database.sh` verifies a SHA-256 when it is given one.
6. `initial-catalog-2026-10.md`, section "What production must do before it serves this
   state", says which of its five conditions the task now enforces.

### Scope

- Work only in: `k8s/catalog-import/` (new), `k8s/release-tasks/tasks/0003-*` (new),
  `k8s/helm/restore-database.sh`, `k8s/release-tasks/README.md`,
  `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md`,
  `k8s/helm/values.staging.yaml` and `values.production.yaml` (one comment each, section
  5).
- Do NOT touch: any service code, any migration, the chart templates, tasks `0001` and
  `0002`, the two dumps, slot 1 and its volumes.

### Constraints

- Bash, `kubectl exec` and `psql`, as the scripts in `k8s/catalog-reset/` are written.
  The same `CATALOG_PSQL`, `HARVESTER_PSQL` and `CORE_PSQL` overrides, so that a rehearsal
  runs against a local stack.
- The script never deletes a database. It renames. Removing the old databases is a manual
  step, a week later.
- Every check runs before the first write. A refusal after the swap is a design error.
- Only make the changes this plan names.

### Action boundaries

- Proceed with edits and with rehearsals on **copies**: restore the two dumps into
  scratch containers (`docker run postgres:16-alpine` on a free port), never on slot 1's
  volumes and never on slot 0.
- **Stop and ask before you set the windows and the production release in `task.env`.**
  They are the owner's values, and they follow the release that carries task `0001`.
- **Stop and ask for the two SHA-256 values and the upload.** The owner uploads the dumps
  to each bucket (section 1). You cannot and must not do it.
- Never run the script, the runner or `kubectl` against staging or production.

### Progress evidence

Report each acceptance criterion in section 6 with the command and its output.

## 1. The artifact and its manifest

The owner uploads both files to each cluster's backup bucket, under a prefix that the
nightly dumps never use:

```
imports/2026-10-first-catalog/catalog.dump
imports/2026-10-first-catalog/harvester.dump
```

Staging needs `luna-shopper-backend-backup-secret` for this, pointing at a bucket of its
own (`k8s/release-tasks/README.md`, "Staging"). The same Secret is what lets release
tasks dump staging at all.

`first-catalog.manifest` is a shell file the script sources:

```sh
CATALOG_KEY="imports/2026-10-first-catalog/catalog.dump"
CATALOG_SHA256="<64 hex, from the owner>"
HARVESTER_KEY="imports/2026-10-first-catalog/harvester.dump"
HARVESTER_SHA256="<64 hex, from the owner>"

CATALOG_LAST_MIGRATION="DiaCategoryTree1758500000000"
CATALOG_MIGRATIONS=26
HARVESTER_LAST_MIGRATION="DiscoveredPlaceFootprint1757900000000"
HARVESTER_MIGRATIONS=17

EXPECT_SUPERMARKETS=5
EXPECT_PRICE_SCOPES=103
EXPECT_CATEGORIES=275
EXPECT_BRANDS=2782
EXPECT_ITEMS=19791
EXPECT_ITEM_PRICES=22335
EXPECT_SOURCE_ENTRIES=25725
EXPECT_SOURCE_ENTRIES_ACTIVE=21751
```

A count that differs is a refusal, not a warning. The numbers come from the document, and
the document was written from the same databases the dumps were taken from.

## 2. `restore-first-catalog.sh`

A dry run does steps 1 to 4 and stops. It leaves the two scratch databases in place, so
that a person can read them. `--apply` does every step.

1. **The target is empty.** `luna_catalog.items` holds 0 rows and
   `luna_harvester.source_catalog_entries` holds 0 rows. Anything else is a refusal that
   names the count. This is what makes the move a copy and not a merge.
2. **Restore both dumps into scratch databases** (`luna_catalog_restore`,
   `luna_harvester_restore`) through `restore-database.sh`, which now takes the expected
   SHA-256 as a third argument and refuses a download that does not match.
3. **The scratch databases are the documented state.**
   - Every `EXPECT_` count matches.
   - The `migrations` table of each scratch database holds the stated count and last
     name, and holds the same names in the same order as the live database's own
     `migrations` table. A cluster whose release carries one migration more or less
     refuses here (condition 1 of the document).
   - No `harvest_runs` row is in a running state.
4. **Nothing the target holds is lost.** For `supermarkets`, `price_scopes`,
   `supermarket_locations`, `brands` and `product_groups`, list every id that the live
   database holds and the scratch database does not. On an emptied production the list is
   empty. On staging it can name rows that the local work removed (the brand "D.O." was
   deleted locally). The script prints the list and refuses, unless each id is in
   `expected-losses.txt` beside the manifest, with a reason on the same line.
5. **Prepare the scratch databases for a cluster.**
   - `UPDATE supermarket_sources SET enabled = false` (condition 2 of the document, plan
     `0083`). The dumps hold four rows that are on. A cluster starts with every chain off,
     and the owner turns one on from the back office when production begins to harvest by
     itself.
   - Write the marker of step 9 on both.
6. **Stop the writers.** Record the replica count of `luna-shopper-backend-catalog` and
   `luna-shopper-backend-harvester`, scale both to zero and wait for the pods to go, as
   `0001/pre.sh` does.
7. **Swap by rename**, catalog first, each in one `psql` call against `postgres`:

   ```sql
   ALTER DATABASE luna_catalog RENAME TO luna_catalog_before_first_catalog;
   ALTER DATABASE luna_catalog_restore RENAME TO luna_catalog;
   ```

   If the harvester swap fails after the catalog swap succeeded, the script renames the
   catalog back before it exits. Two databases share no transaction, so this is the one
   place where the script undoes its own work.
8. **Start the writers** at the recorded replica counts and wait for the rollout.
9. **Clear core.** Run `k8s/catalog-reset/cleanup-core-catalog-refs.sh --apply`. It keeps
   every id that catalog holds, so on staging the references to the five chains and their
   shops survive, and whatever points at nothing is cleared (condition 3).
10. **Read the result back** from the live databases: the `EXPECT_` counts again, and
    `SELECT count(*) FROM supermarket_sources WHERE enabled` is 0.

**Safe to run again.** Step 5 writes
`COMMENT ON DATABASE ... IS 'first catalog restored by release task 0003-restore-the-first-catalog'`
on both scratch databases, and the comment moves with the rename. A run that finds the
comment on the live catalog does nothing.

**What a shopper sees.** The catalog and the harvester are down between steps 6 and 8,
which is the time of two renames and a rollout. Redis holds catalog reads for 60 seconds.
A phone that cached a product id from the old production catalog asks for an id that no
longer exists, and `getMany` leaves a missing id out of its answer.

## 3. Release task 0003

```sh
# task.env
RUN_UNTIL_STAGING="<the owner's date>"
RUN_UNTIL_PRODUCTION="<the owner's date>"
PRODUCTION_RELEASE="<the owner's version>"
DATABASES="catalog harvester core"
```

- **`check.sh`** passes when the live catalog carries the marker (nothing to do), or when
  `items` and `source_catalog_entries` are both empty. It refuses in every other case.
  It also refuses when the backup Secret is missing, because the script cannot download
  without it.
- **`post.sh`**, not `pre.sh`. The restore compares the dumps' migrations with the ones
  this release just ran, so it runs after `helm upgrade`.
- **In the same release as task `0001`** this works in number order: `0001/pre.sh` drops
  the databases, the upgrade migrates them empty, `0001/post.sh` clears core,
  `0002/post.sh` finds no product, and `0003/post.sh` restores.
- **The runner's dumps** of catalog, harvester and core are the second way back, for 14
  days.

### How to revert

Within a week, by rename (stop the two services first):

```sql
ALTER DATABASE luna_catalog RENAME TO luna_catalog_first_catalog_failed;
ALTER DATABASE luna_catalog_before_first_catalog RENAME TO luna_catalog;
```

Core is not reverted by a rename. Restore the core dump that the ledger names, as
`k8s/release-tasks/README.md` describes. `README.md` in `k8s/catalog-import/` also gives
the two `DROP DATABASE` commands for the old databases, to type by hand once the new
catalog is a week old.

## 4. The order of the whole move

1. Plan `0011` is merged. Tasks `0001` and `0002` have windows and ceilings.
2. The owner uploads both dumps to the staging bucket and gives the checksums.
3. This plan merges to `dev`, then to `main`. The staging deploy runs task `0003`.
4. The owner reads staging: the back office queue (3,974 rows wait for a person), a
   search in velista, a basket with prices.
5. The owner uploads the same two files to the production bucket.
6. A release whose version is `PRODUCTION_RELEASE` runs `0001`, `0002` and `0003` in
   production.

Staging is the rehearsal of exactly what production runs: the same files, the same
checksums, the same script.

## 5. What stays true afterwards

- **The reference seed stays off in both clusters.** `referenceSeed.enabled` is false in
  both values files. If it is turned on, every deploy upserts 238 authored products by a
  derived id and writes `imageUrl` and `sku` as null on them. Add one comment above each
  of the two `referenceSeed` blocks that says so and names this plan.
- **Prices age** (condition 5). Every price in the dumps was observed on 2026-10-03, and
  the Deza leaflet prices end on 2026-10-08. A restore after that day carries prices that
  the read side already treats as expired. Nothing in this plan changes them.
- **The audit trail names four actors that production's auth does not hold** (condition
  4). They are history, and nothing reads them to decide.
- **Pending work in the harvester travels too.** The dry run prints the count of
  `postal_code_discovery_requests` that a worker will pick up and of `discovered_places`
  in state `NEW`, so that the owner knows what a cluster with `harvestEnabled: true`
  starts to do after the swap.
- **After this, the three databases share ids.** That is what backlog plan `0019` needs
  to merge later local work into a cluster that also changed.

## 6. Acceptance criteria

- [ ] A dry run against two empty local databases (migrated by the built `migrate.js` of
      each service) restores both dumps to scratch, prints every count and exits 0.
- [ ] The same with `--apply` leaves `luna_catalog` with 19,791 products, the old
      database under `_before_first_catalog`, and every `supermarket_sources` row off.
- [ ] A second `--apply` prints "already restored" and changes nothing.
- [ ] A target with one product is refused at step 1, before any download.
- [ ] A manifest with one wrong count is refused at step 3. The live database is
      unchanged.
- [ ] A wrong SHA-256 is refused by `restore-database.sh`. No scratch database is created.
- [ ] A live `migrations` table with one name more is refused at step 3.
- [ ] A target that holds a brand the dump does not hold is refused at step 4 and names
      the id. With that id in `expected-losses.txt`, it passes.
- [ ] A harvester swap that fails (rename the scratch database away first) leaves the
      catalog under its old name.
- [ ] `node k8s/release-tasks/check-tasks.mjs` (plan `0011`) passes with task `0003`.
- [ ] After the local `--apply`, the catalog service starts on the restored database and
      `GET /v1/catalog/items?query=leche` answers products through the gateway.

## 7. What this plan leaves out

- **A merge.** A cluster that already holds products is refused. Backlog plan `0019`.
- **Auth and core data.** Neither dump holds any, and users stay where they are.
- **Moving the catalog back down** (production to local). `initial-catalog-2026-10.md`,
  stage 1, records how the staging copy was taken.
