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

**The task is armed for staging and for production.** Its `task.env` gives
staging a window until 2026-10-09 and production a window until 2026-10-14.
Release `0.13.2` is the one version that runs it in production.

| File                       | What it is                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `restore-first-catalog.sh` | The procedure. A dry run by default, `--apply` to change anything.                                     |
| `first-catalog.manifest`   | The object keys, the two SHA-256 values, the migrations and the row counts that the dumps are held to. |
| `expected-losses.txt`      | The rows of the live catalog that the restore is allowed to lose, each with a reason.                  |

## Why a restore and not an import

Every id in the dumps must survive. `source_catalog_entries.itemId`,
`item_prices.sourceRunId` and core's `list_line_items.itemId` name rows across
three databases with no foreign key between them. The bulk routes of the
gateway create rows with random ids. Only 4,013 of the 22,203 products have an
EAN, so nothing else can tell two copies of a product apart. A whole database
restore also carries what the services derive on a write (`supermarket_items`,
the search documents), so nothing is computed again.

## What changes

- **Catalog and harvester are replaced as a whole.** Each restored database
  takes the name of the live one. Nothing of the old databases is carried over.
- **The old databases stay**, as `luna_catalog_before_first_catalog` and
  `luna_harvester_before_first_catalog`. The script never deletes a database.
- **Every `supermarket_sources` row is off after the restore.** The dumps hold
  four rows, and all four are on. A cluster starts with every chain off (backend plan
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
   manifest. This is the owner's step. **On 2026-10-07 it is done for staging
   and not for production: `velista-staging` holds the two files, with the
   sizes and checksums of the manifest, and `velista` does not.**

   ```
   imports/2026-10-first-catalog/catalog.dump
   imports/2026-10-first-catalog/harvester.dump
   ```

   Staging's bucket is `velista-staging` and production's is `velista`. The
   nightly dumps never use the `imports/` prefix.

   After each upload, download the object again and run `sha256sum` on it. The
   answer must be the value of the manifest ("When slot 1 is final" has both).
   The script makes the same check before it restores, so a wrong upload is a
   refusal at step 2 and not a wrong catalog.

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

**The manifest describes the dumps of 13:53 of 2026-10-07.** They were taken
at 2026-10-07T11:53:13Z (2026-10-07 13:53 Madrid time). Only the gateway was
served, and it holds no database, so nothing wrote. They hold three data stages
of that day, which came after the three changes that the owner asked for:

- **The re-file.** 2,250 products moved onto the leaves that backend plan 0179
  added. It changed no count of the manifest.
- **The second curation walk.** 2,586 queue rows that the first walk could not
  place were decided. 2,430 became new products, 14 were bound to a product
  that exists, and 142 stay in the queue.
- **The data step of backend plan 0193 (section 4).** One El Jamón store
  discovery recorded 53 places. 19 of them were linked to the 19 El Jamón
  shops, and 27 OpenStreetMap places were linked to their shop by reference.
  14 El Jamón shops got the address, the city or the postal code that they
  lacked, so all 19 hold all three now. It changed no count of the manifest.

The values of four earlier pairs of dumps are gone from the manifest: those of
2026-10-07T10:28:17Z (2026-10-07 12:28 Madrid time), which held the first two
stages and not the third, those of 2026-10-06T23:32:21Z (01:32), those of
2026-10-06T22:33:14Z (00:33) and those of 2026-10-06T21:12:47Z. So are those of
2026-10-03 20:44.

| File             |      Bytes | SHA-256                                                            |
| ---------------- | ---------: | ------------------------------------------------------------------ |
| `catalog.dump`   | 51,094,969 | `e81ba4c20a3535d0a6b9aa9184b3913c13248f46a89fce97d10054e1211f9650` |
| `harvester.dump` | 11,636,411 | `93cc20ab47eb4f93ed46ef54ab61602622f79d173c281d08a2a98ea0a56cd2ec` |

- The catalog dump holds 29 migrations, the last one `ItemEans1758800000000`.
  The harvester dump holds 21, the last one `SourceEntryPriceKind1759200000000`.
  That is the code of `dev` at `b9eece51`. A cluster that runs other migrations
  is refused at step 3.
- No count of the manifest changed against the dumps of 12:28. Only the two
  checksums did. The eight counts are 5 chains, 105 price scopes, 309
  categories, 2,830 brands, 22,203 products, 25,074 price rows and 25,861 queue
  rows, 24,223 of them `ACTIVE`. 1,638 queue rows are `UNRESOLVED`.
- What did change is outside the manifest. The harvester dump holds 138
  discovered places (85 before): 91 are `NEW` and 47 are `IMPORTED`, which is
  the mark of a place that names its shop. It holds 16 harvest runs (15). The
  catalog dump holds 341,021 audit rows (341,006).
- The catalog dump holds 42 shops, and all 42 hold coordinates. The owner read
  those of the tenth Deza shop from Google Maps on 2026-10-07: latitude
  37.89862387806124, longitude -4.772603355414682.
- The two files stand in the folder
  `.curation-runs/2026-10-audit-repair/stage-c8/final/` of the checkout that did
  the work. Git ignores that folder. A `VERIFY.txt` stands beside them, and so
  does `manifest-values.json`, which states how each value was read. The folder
  `stage-c7/final/` holds the dumps of 12:28, `stage-c5/final/` those of 01:32,
  `stage-c4/final/` those of 00:33, and `stage-c3/final/` those of 2026-10-06.
  None of the four pairs ships.
- Slot 1 is down and locked, with its databases kept.
- `apps/luna-shopper-backend/docs/initial-catalog-2026-10.md` holds the first
  two stages under "The re-file and the second walk (2026-10-07)" and the third
  under "The places and the El Jamón addresses (plan 0193, 2026-10-07)".

**These dumps ship unless slot 1 is written again, and one more write is
known.** The owner decided that the brand Eden is two brands. The registry
cannot hold two brands with one label, so nothing was written, and the step
waits for the owner to name the second label. That write means one more pair
of dumps. On 2026-10-07 the owner said that slot 1 is final for now, so these
dumps go to staging without that write.

**Staging is ready (2026-10-07).** Both files are in `velista-staging`, and
each object, downloaded again, has the size and the SHA-256 of the table above.
The dry run on the staging VPS ran after the deploy of `main` at `02373347`:

- Step 1 found 0 products and 0 queue rows, with 2 catalog replicas and 1
  harvester replica.
- Step 2 restored the catalog in 118 seconds and the harvester in 49 seconds.
- Step 3 matched all eight counts and both `migrations` tables.
- Step 4 named one row that the live catalog holds and the dump does not: the
  brand "D.O.". `expected-losses.txt` accepts it, with the reason. The live
  catalog held 5 chains, 102 price scopes, 40 shops and 139 brands, and every
  other id is in the dump.

What is still to do, for production:

1. Upload both files to `velista`, under the keys of the manifest.
2. Check the SHA-256 of each object after the upload ("Before the release",
   step 1).
3. Run the dry run on the production VPS, then arm the task for production
   ("Before the release", steps 2 and 3).

After any later write to slot 1, take the dumps again:

1. Bring slot 1 to the migrations of the release that will carry the task.
2. Take both dumps, with the slot's services stopped so that nothing writes.

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

A manifest that holds the values of other dumps refuses the files at the
checksum, which is the intended failure.

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
that holds data was touched. Those were the dumps of 2026-10-03. The last five
rows of the table are the tests of the later dumps, and none of them ran the script.
The last row is the one test of the dumps that the manifest describes.

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
| The dumps of 2026-10-06, restored on 2026-10-06                                                     | Not a run of the script. Copies of both files were restored with `pg_restore --exit-on-error` into two throwaway `postgres:16-alpine` containers, and both exited 0. Every count and both `migrations` tables of the manifest, read from the copies, equal the values read from slot 1.       |
| The dumps of 00:33 of 2026-10-07, restored on 2026-10-07 (2026-10-06T22:34Z)                        | Not a run of the script. Copies of both files were restored with `pg_restore --exit-on-error` into two throwaway `postgres:16-alpine` containers, and both exited 0. All 37 values read from the copies equal the values read from slot 1, the 105 price scopes among them.                   |
| The dumps of 01:32 of 2026-10-07, restored on 2026-10-07 (2026-10-06T23:33Z)                        | Not a run of the script. Copies of both files were restored with `pg_restore --exit-on-error` into two throwaway `postgres:16-alpine` containers, and both exited 0. All 37 values read from the copies equal those of slot 1. The copy holds the coordinates of the tenth Deza shop.         |
| The dumps of 12:28 of 2026-10-07, restored on 2026-10-07 (2026-10-07T10:28Z)                        | Not a run of the script. Copies of both files were restored with `pg_restore --exit-on-error` into two throwaway `postgres:16-alpine` containers, and both exited 0. All 39 values read from the copies equal those of slot 1, and all 35 tables hold the row count and the hash of slot 1.   |
| The dumps of 13:53 of 2026-10-07, restored on 2026-10-07 (2026-10-07T11:53Z)                        | Not a run of the script. Copies of both files were restored with `pg_restore --exit-on-error` into two throwaway `postgres:16-alpine` containers, and both exited 0. All 39 values read from the copies equal those of slot 1, and all 35 tables hold the row count and the hash of slot 1.   |
