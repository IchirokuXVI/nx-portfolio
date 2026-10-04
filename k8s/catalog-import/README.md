# Restoring the first catalog

This procedure replaces the empty catalog and harvester databases of a cluster
(k8s plan 0012). The new databases hold the catalog that was harvested and
curated on a local slot.
`apps/luna-shopper-backend/docs/initial-catalog-2026-10.md` records what the
two dumps hold and how they were built.

It copies two whole databases and merges nothing. A cluster that already holds
products is refused. Merging later local work into a cluster that also changed
is backend backlog plan `0019`.

**It runs by itself** as release task
`k8s/release-tasks/tasks/0003-restore-the-first-catalog`, once in staging and
once in production. The steps below are what that task does, and they are the
way to run it by hand, on the VPS as `deploy`.

**The task is disarmed.** Both windows in its `task.env` say `never`. The owner
arms it in a pull request that writes the two dates and the production release.

| File                       | What it is                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `restore-first-catalog.sh` | The procedure. A dry run by default, `--apply` to change anything.                                     |
| `first-catalog.manifest`   | The object keys, the two SHA-256 values, the migrations and the row counts that the dumps are held to. |
| `expected-losses.txt`      | The rows of the live catalog that the restore is allowed to lose, each with a reason.                  |

## Why a restore and not an import

Every id in the dumps must survive. `source_catalog_entries.itemId`,
`item_prices.sourceRunId` and core's `list_line_items.itemId` name rows across
three databases with no foreign key between them. The bulk routes of the
gateway create rows with random ids. Only 4,190 of the 19,791 products have an
EAN, so nothing else can tell two copies of a product apart. A whole database
restore also carries what the services derive on a write (`supermarket_items`,
the search documents), so nothing is computed again.

## What changes

- **Catalog and harvester are replaced as a whole.** Each restored database
  takes the name of the live one. Nothing of the old databases is carried over.
- **The old databases stay**, as `luna_catalog_before_first_catalog` and
  `luna_harvester_before_first_catalog`. The script never deletes a database.
- **Every `supermarket_sources` row is off after the restore.** The dumps hold
  four rows that are on. A cluster starts with every chain off (backend plan
  0083), and the owner turns one on from the back office.
- **Lost in the harvester:** every row the cluster's own harvests wrote, and
  every decision a person took on a discovered place. The dry run prints the
  counts and the decided places. On 2026-10-03 production held 40 imported
  places and 1 rejected place. After the restore, store discovery offers those
  40 shops again although catalog already holds them, and the rejected place
  comes back.
- **Core keeps catalog ids** with no foreign key. The script runs
  `k8s/catalog-reset/cleanup-core-catalog-refs.sh --apply` last, which keeps
  every id that catalog holds and clears the rest.
- **The catalog and the harvester are down** between step 6 and step 8, which
  is the time of two renames and a rollout. Redis holds catalog reads for 60
  seconds. A phone that cached a product id from the old catalog asks for an id
  that no longer exists. `getMany` leaves a missing id out of its answer.
- **Pending work in the harvester travels too.** The dry run prints the postal
  code requests and the discovered places that the dump brings. A cluster with
  `harvestEnabled: true` starts to work on them after the swap.
- **Prices age.** Every price in the dumps carries the day it was observed.
  The read side treats a price as expired after the last day of its validity.
  Nothing in the restore changes that.

## The steps of the script

1. **The target holds no more than the owner said it holds.** The script
   counts `items` in catalog and `source_catalog_entries` in harvester. Each
   count is within its ceiling (`MAX_ITEMS_REPLACED`,
   `MAX_SOURCE_ENTRIES_REPLACED`, default 0).
   The release task passes the ceilings of its `task.env`. This is what makes
   the move a copy and not a merge.
2. **Both dumps are restored into scratch databases**, `luna_catalog_restore`
   and `luna_harvester_restore`, through `k8s/helm/restore-database.sh`. It
   refuses a download whose SHA-256 is not the one in the manifest, before a
   scratch database exists.
3. **The scratch databases are the documented state.** Every count of the
   manifest matches. Each `migrations` table holds the count and the last name
   that the manifest states, and the same names as the live database. No
   harvest run is pending or running.
4. **Nothing the target holds is lost.** The script reads the ids of
   `supermarkets`, `price_scopes`, `supermarket_locations`, `brands` and
   `product_groups`. It prints every id that the live catalog holds and the
   dump does not. It refuses unless each one has a line in
   `expected-losses.txt`.
5. **The scratch databases are prepared.** Every `supermarket_sources` row is
   turned off, and both databases get the comment that marks this restore.
6. **The writers are stopped.** The replica counts of
   `luna-shopper-backend-catalog` and `luna-shopper-backend-harvester` are
   recorded, and both are scaled to zero. The checks of steps 1 and 4 then run
   a second time. The restore takes minutes and the services write in the
   meantime, so the first answers are old by now. A refusal here starts the
   services again, and it is still before the swap.
7. **The swap, by rename**, catalog first. Both renames of one database run in
   one transaction. If the harvester swap fails, the script renames the catalog
   back before it exits. It never believes the exit code of a rename. It reads
   the comment of the live database, and that decides what it says and does.
8. **The writers are started** at the recorded replica counts.
9. **Core is cleared.**
10. **The result is read back** from the live databases.

A dry run does steps 1 to 4 and stops. It leaves the two scratch databases in
place, so that a person can read them. Every check runs before the first write
to a live database.

Step 1 also refuses a writer that is already at 0 replicas. A run that was
killed while the services were down leaves them there. The script then cannot
know the count to bring them back to, and a recorded 0 keeps a service down for
good. Scale the deployment to the count in `values.yaml`, then run again.

The migrations are compared in the order of their timestamps and not in the
order they ran. Two databases that ran the same migrations in different batches
hold the same schema, and they compare equal.

## Before the release

1. Upload both dumps to the backup bucket of the cluster, under the keys of the
   manifest. This is the owner's step.

   ```
   imports/2026-10-first-catalog/catalog.dump
   imports/2026-10-first-catalog/harvester.dump
   ```

   Staging's bucket is `velista-staging` and production's is `velista`. The
   nightly dumps never use the `imports/` prefix.

2. Run a dry run on the VPS and read all of it.

   ```sh
   k8s/catalog-import/restore-first-catalog.sh
   ```

   - If step 1 refuses, it names the number of rows and the ceiling. The
     ceilings are the owner's values. Give one for a dry run like this:

     ```sh
     MAX_SOURCE_ENTRIES_REPLACED=18537 k8s/catalog-import/restore-first-catalog.sh
     ```

   - If step 4 refuses, it prints one line per row that the restore loses, in
     the format of `expected-losses.txt`. Put each line the owner accepts in that
     file, with the reason in place of the text between the angle brackets.

3. Write what the dry run gave into the repository, in a pull request: the
   lines of `expected-losses.txt`, the ceilings in `task.env`, and the two
   windows and the production release that arm the task.

## Running it by hand

```sh
k8s/catalog-import/restore-first-catalog.sh           # dry run
k8s/catalog-import/restore-first-catalog.sh --apply
```

**By hand, the ceilings default to 0** and no window applies. The runner takes
no dump either, so take one of catalog, harvester and core first
(`k8s/catalog-reset/README.md`, step 1 of the procedure).

Safe to run again. A run that finds the comment of this restore on the live
catalog leaves both databases alone. With `--apply` it still runs the core
cleanup, which changes nothing a second time. It then reads the result back, as
step 10 does. So a second run refuses after somebody changed a count of the
manifest or turned a source on. That refusal changes nothing. It means that the
catalog moved on, and that this task has no more work in this cluster.

## A run that was cut

- **Before step 7**, every live database is as it was. If the scratch databases
  exist, the next run drops them and restores them again.
- **While the two services were down**, the script starts them again when it
  stops for any reason it can see. A run that was killed leaves them at zero.
  The task's `post.sh` then fails with the name of the deployment, and a
  deploy scales both back.
- **After step 7**, both databases are the restored ones, and the next run
  finds the comment and only clears core.
- **The script refuses a pair it cannot explain**: a split pair (the next
  section), or an instance that answers and holds no database under the live
  name. An instance that does not answer is a different refusal, and it says
  so.

### A refusal inside `post.sh` repeats on every deploy

The runner writes `pre-done` for the task before `helm upgrade`, and `post.sh`
runs after it. A refusal of the script inside `post.sh` (a checksum, a count, a
migration, a loss nobody accepted, a ceiling) fails that deploy and leaves the
task at `pre-done`.

A task at `pre-done` always finishes (k8s plan 0011). So every later deploy
runs `post.sh` again, with no window and no release in the way. This is true
after the window closed, and in production it is true for every later version.
The restore then happens at the first deploy where the refusal is gone, for
example after somebody uploads the right file.

To stop it, a person sets the ledger key by hand. The task then never runs in
this cluster again:

```sh
kubectl -n nx-portfolio patch configmap release-tasks --type merge \
  -p '{"data":{"0003-restore-the-first-catalog":"expired 2026-10-20T10:00:00Z by-hand"}}'
```

To let it run, fix what it refused and deploy again.

## A split pair

The pair is split when one live database is the restored one and the other is
the old one. Two databases share no transaction, so a failure between the two
swaps can leave it. The script tries to rename the catalog back. If that fails
too, it prints `THE PAIR IS SPLIT` and what it read from each instance.

**The script leaves both services at 0 replicas then, on purpose.** An old
harvester beside a restored catalog runs its own sources, and production's old
harvester had four of them on. `check.sh` and the script both refuse a split
pair, so no deploy changes it. A person does these steps:

1. Read both instances. The comment tells the restored database from the old
   one.

   ```sh
   kubectl -n nx-portfolio exec luna-shopper-backend-catalog-db-0 -- \
     psql -U luna_catalog -d postgres -c "SELECT datname, shobj_description(oid, 'pg_database') FROM pg_database"
   kubectl -n nx-portfolio exec luna-shopper-backend-harvester-db-0 -- \
     psql -U luna_harvester -d postgres -c "SELECT datname, shobj_description(oid, 'pg_database') FROM pg_database"
   ```

2. Choose one direction, and make both instances agree.
   - **Go back.** Rename the restored database away and the old one back, on
     the instance that was swapped. For the catalog:

     ```sh
     kubectl -n nx-portfolio exec luna-shopper-backend-catalog-db-0 -- psql -U luna_catalog -d postgres \
       -c 'ALTER DATABASE luna_catalog RENAME TO luna_catalog_restore' \
       -c 'ALTER DATABASE luna_catalog_before_first_catalog RENAME TO luna_catalog'
     ```

   - **Go forward.** Swap the other instance by hand. The scratch database
     already holds the comment and has every source off. For the harvester:

     ```sh
     kubectl -n nx-portfolio exec luna-shopper-backend-harvester-db-0 -- psql -U luna_harvester -d postgres \
       -c 'ALTER DATABASE luna_harvester RENAME TO luna_harvester_before_first_catalog' \
       -c 'ALTER DATABASE luna_harvester_restore RENAME TO luna_harvester'
     ```

3. Scale both services to the counts that the script printed.

   ```sh
   kubectl -n nx-portfolio scale deploy/luna-shopper-backend-catalog deploy/luna-shopper-backend-harvester --replicas=1
   ```

4. Run the script again with `--apply`. After "go forward" it finds the
   comment on both, clears core and reads the result back. After "go back" it
   starts from step 1.

## How to revert

Within a week, by rename. Stop the two services first.

```sh
kubectl -n nx-portfolio scale deploy/luna-shopper-backend-catalog deploy/luna-shopper-backend-harvester --replicas=0
kubectl -n nx-portfolio exec luna-shopper-backend-catalog-db-0 -- psql -U luna_catalog -d postgres \
  -c 'ALTER DATABASE luna_catalog RENAME TO luna_catalog_first_catalog_failed' \
  -c 'ALTER DATABASE luna_catalog_before_first_catalog RENAME TO luna_catalog'
kubectl -n nx-portfolio exec luna-shopper-backend-harvester-db-0 -- psql -U luna_harvester -d postgres \
  -c 'ALTER DATABASE luna_harvester RENAME TO luna_harvester_first_catalog_failed' \
  -c 'ALTER DATABASE luna_harvester_before_first_catalog RENAME TO luna_harvester'
```

Then scale both services back to the count in `values.yaml`.

Core is not reverted by a rename. Restore the core dump that the ledger names,
as `k8s/release-tasks/README.md` describes under "Reverting a task". The
runner's dumps of catalog, harvester and core are the second way back, for 14
days.

## Removing the old databases

Once the new catalog is a week old and nobody wants the old one back, type
these by hand. Nothing in the repository runs them.

```sh
kubectl -n nx-portfolio exec luna-shopper-backend-catalog-db-0 -- \
  psql -U luna_catalog -d postgres -c 'DROP DATABASE luna_catalog_before_first_catalog'
kubectl -n nx-portfolio exec luna-shopper-backend-harvester-db-0 -- \
  psql -U luna_harvester -d postgres -c 'DROP DATABASE luna_harvester_before_first_catalog'
```

## When slot 1 is final

Every value of `first-catalog.manifest` is provisional. It describes the dumps
of 2026-10-03 20:44, and the owner went on editing slot 1 after that. When the
owner says that slot 1 is final:

1. Bring slot 1 to the migrations of the release that will carry the task. The
   dumps of 2026-10-03 hold 26 catalog migrations and 17 harvester migrations.
   The code on `dev` on 2026-10-04 holds 29 and 20, so those dumps are refused
   at step 3 by any cluster that runs it.
2. Take both dumps again, with the slot's services stopped so that nothing
   writes.

   ```sh
   docker exec luna-slot1-catalog-db-1 pg_dump -Fc -U luna_catalog -d luna_catalog -f /tmp/catalog.dump
   docker cp luna-slot1-catalog-db-1:/tmp/catalog.dump ./catalog.dump
   docker exec luna-slot1-harvester-db-1 pg_dump -Fc -U luna_harvester -d luna_harvester -f /tmp/harvester.dump
   docker cp luna-slot1-harvester-db-1:/tmp/harvester.dump ./harvester.dump
   sha256sum catalog.dump harvester.dump
   ```

3. Read every `EXPECT_` count and both `migrations` tables from slot 1 again.
   Write them and the two checksums into the manifest.
4. Upload those two files, and no earlier ones, to both buckets.
5. Bring `initial-catalog-2026-10.md` to the same numbers, or say in it that
   the state moved on after it was written.

A manifest that still holds the values of 2026-10-03 refuses the new files at
the checksum, which is the intended failure.

## Rehearsing it

Never rehearse on slot 1 or on its volumes. Restore copies of the two dumps
into scratch containers, and give the script the overrides its header lists.
Naming `CATALOG_PSQL` tells the script that there is no cluster: it then calls
no `kubectl`, scales nothing, and needs every other override.

```sh
CATALOG_PSQL='docker exec -i my-catalog-db psql -U luna_catalog -d luna_catalog' \
HARVESTER_PSQL='docker exec -i my-harvester-db psql -U luna_harvester -d luna_harvester' \
CORE_PSQL='docker exec -i my-core-db psql -U luna_core -d luna_core' \
CATALOG_RESTORE_POD_EXEC='docker exec -i my-catalog-db' \
CATALOG_RESTORE_DB_URL='postgres://luna_catalog:<password>@localhost:5432/luna_catalog' \
HARVESTER_RESTORE_POD_EXEC='docker exec -i my-harvester-db' \
HARVESTER_RESTORE_DB_URL='postgres://luna_harvester:<password>@localhost:5432/luna_harvester' \
RESTORE_S3_ENDPOINT='http://my-s3:9090' RESTORE_S3_BUCKET='my-bucket' \
RESTORE_S3_ACCESS_KEY_ID='<key>' RESTORE_S3_SECRET_ACCESS_KEY='<secret>' \
  bash k8s/catalog-import/restore-first-catalog.sh
```

The database containers must reach the S3 endpoint, because the download runs
inside them, as it does inside the pod. `MANIFEST` and `EXPECTED_LOSSES` point
the script at other files. In Git Bash on Windows, set `MSYS_NO_PATHCONV=1`, or
the shell rewrites `/bin/sh` on its way to `docker exec`.

### How it was tested

On 2026-10-04, against Postgres 16 containers and a local S3 server. The two
dumps were only read: copies of them were uploaded. No cluster and no Luna slot
that holds data was touched.

| Case                                                                                                | Result                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The committed manifest against the dumps of 2026-10-03                                              | Both checksums and all eight counts matched. Step 3 then refused, because the databases held the 29 and 20 migrations of `dev` and the dumps hold 26 and 17.                                                                                                                                  |
| Dry run on empty migrated databases                                                                 | The input was copies of the dumps after the migrations of `dev` ran over them. A manifest described those copies. It restored both, printed every count and exited 0. No live database changed.                                                                                               |
| `--apply`                                                                                           | `luna_catalog` held 19,791 products, the old database was `luna_catalog_before_first_catalog`, and all four `supermarket_sources` rows were off.                                                                                                                                              |
| Second `--apply`                                                                                    | It printed "already restored", left both databases alone, and the core cleanup changed 0 rows.                                                                                                                                                                                                |
| One product, ceiling 0                                                                              | Refused at step 1, before any download. With a ceiling of 1 it passed step 1.                                                                                                                                                                                                                 |
| One wrong count in the manifest                                                                     | Refused at step 3. The live databases were unchanged.                                                                                                                                                                                                                                         |
| A wrong SHA-256                                                                                     | Refused by `restore-database.sh`. No scratch database was created.                                                                                                                                                                                                                            |
| One more migration in the live database                                                             | Refused at step 3, with the name.                                                                                                                                                                                                                                                             |
| A live brand that the dump does not hold                                                            | Refused at step 4, with the id. With the id in the accepted losses, it passed.                                                                                                                                                                                                                |
| A harvester swap that fails                                                                         | The catalog was renamed back, and both live databases were what they were.                                                                                                                                                                                                                    |
| A live row in a table that is empty in the dump                                                     | Refused at step 4, with the id. A reason of only `#` accepted nothing.                                                                                                                                                                                                                        |
| An instance that cannot be reached                                                                  | Refused as unreadable, and not as "a run was cut".                                                                                                                                                                                                                                            |
| A brand written to the live catalog during the restore                                              | Refused by the second pass of step 4, after the writers stopped and before the swap.                                                                                                                                                                                                          |
| A catalog swap that happens and answers an error                                                    | Read back as restored, and the run went on to the end.                                                                                                                                                                                                                                        |
| A harvester swap that fails, and a catalog that cannot be renamed back                              | `THE PAIR IS SPLIT`. Both services stayed at 0 replicas. `check.sh` and the next run both refused the pair.                                                                                                                                                                                   |
| `kubectl` that cannot reach the cluster, a database pod that does not exist, a writer at 0 replicas | `post.sh` exited 1 each time, and nothing was scaled.                                                                                                                                                                                                                                         |
| The deploy path                                                                                     | The runner of plan 0011 ran the task from a copy of `k8s/` with an armed `task.env`. A stand in for `kubectl` mapped the pods onto the containers. Check, pre and post passed, both services were scaled to zero and back, and a second run with the ledger removed left the databases alone. |
