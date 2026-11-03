# 0240: One baseline migration per service

> Each database of the server holds the result of a long chain of migrations: 12 for auth,
> 38 for core, 31 for catalog and 23 for harvester today, 104 classes in all (the owner's
> count of 114 also counted each `index.ts` and the specs in the directories). The owner
> decided on 2026-11-02 that the new Velista repository starts with zero migrations. This
> plan replaces each chain with one baseline migration that creates the schema of the head
> of the chain, and the reference rows a fresh database needs, in one step. It proves the
> baseline equal to the chain before the chain is deleted, and keeps that proof as a spec
> that runs in CI.
>
> Existing databases never run the baseline. k8s `0019` adopts it: its cutover script
> empties the `migrations` table of each database and inserts the one baseline row. This
> plan fixes the class names, the timestamps and the invariant that script checks, and it
> puts a guard inside the baseline so that a deploy with the baseline in the image and the
> old rows in the database fails before it changes anything.
>
> Paths below are today's (`apps/luna-shopper-backend/<service>`). Docs `0003` moves them to
> `apps/velista-server/<service>` and this plans directory to `apps/velista-server/plans`;
> the builder works on the paths as they are after that rename. Docs `0003` also renames
> the slot script `luna-slot.sh` to `server-slot.sh` in `k8s/e2e/velista-server`; this plan
> names it `server-slot.sh`.
>
> Prerequisite reading: backend `0027` section 2 (the migration entry point inside the
> image, the ordered index, `transaction: 'all'`), backend `0060` (the postal code points
> ship as a migration), backend `0080` section 3 (`price_policies`), backend `0173` and
> `0179` (the category tree), k8s `0011` (release tasks), k8s `0012` (the first catalog
> restore), and in the code `<service>/src/migrate.ts`, `<service>/src/app/db/data-source.ts`,
> `<service>/src/app/db/migrations/index.ts`, `<service>/src/app/db/cli.js`,
> `k8s/helm/velista/templates/luna-shopper-backend/migration-job.yaml.tpl`,
> `k8s/e2e/luna-shopper-backend/stack.sh` (`up`, `MIGRATED_SERVICES`) and
> `node_modules/typeorm/migration/MigrationExecutor.js` (how pending migrations are chosen).
>
> **Build order.** Step 2 of the series: after docs `0003` (the rename), in parallel with
> docs `0004`, backend `0241`, `0242`, `0243`, velista `0178`, k8s `0020` and `0021`. Before
> k8s `0019`, whose script adopts the baseline on staging and production. Because of the
> guard (D4), a deploy that reaches a database before its adoption fails in the hook and
> changes nothing; k8s `0019` still asks that the rollup to `main` that carries this plan
> carry `0019` too, so that staging never meets that failure. Any branch that adds a migration to the old chain (open today:
> `claude/catalog-merge-0239`, and the unmerged harvester branches of plans `0215`, `0217`
> and `0220`) must land before the baseline is generated, or the baseline is generated
> again on top of it. The series order, as every plan of the series states it: docs `0003`
> first, alone, after the pull request gate; then in parallel docs `0004`, backend `0240` to
> `0243`, velista `0178`, k8s `0020` and `0021` (backend `0242` after velista `0178` for the
> admin mechanism, k8s `0020` after backend `0241` for the generated files); k8s `0019`
> after docs `0003` and backend `0240`, in the same rollup to `main` as `0240`; docs `0005`
> last, with docs `0006` read from the start.

## Brief for the agent

### Objective

For each of the four databases (auth, core, catalog, harvester): write one baseline
migration that creates the head schema from a normalised `pg_dump --schema-only` and
inserts the reference rows; prove on Postgres that a database built by the baseline equals
one built by the old chain, schema and reference rows; then delete the old chain and its
migration specs, and keep a CI spec that compares the baseline against a committed fixture
of the head schema and against the entities.

### Context

- Every migration is listed in an ordered array in `src/app/db/migrations/index.ts`
  (`AUTH_MIGRATIONS`, `CORE_MIGRATIONS`, `CATALOG_MIGRATIONS`, `HARVESTER_MIGRATIONS`). Both
  `migrate.ts` (bundled as `migrate.js`, run by the Helm pre upgrade hook) and the CLI
  `data-source.ts` import it. `migrations.spec.ts` asserts the array matches the files and is
  sorted (auth, core and catalog have one; harvester has none).
- The workspace runs TypeORM 1.1.x (`"typeorm": ">=1.1.0 <1.1.2"`). `MigrationExecutor`
  derives a migration's timestamp from the last 13 digits of the class name, sorts by it,
  and chooses pending migrations **by name**: a migration whose name is not in the
  `migrations` table is pending, whatever its timestamp (`MigrationExecutor.js`, the
  `pendingMigrations` filter; the timestamp check there is commented out). Revert takes the
  row with the highest `id`.
- The chains carry what entity metadata does not describe: the extensions `pgcrypto` and
  `pg_trgm`; the plpgsql functions and triggers of catalog search (`catalog_norm`,
  `catalog_refresh_item_search`, `catalog_refresh_group_members`, `catalog_synonyms_text`,
  from `CatalogSearchAndProductGroups`, `StricterCatalogSearch`, `NormalizedItemSearch`); the
  category triggers (`categories_two_levels`, `item_categories_on_a_leaf`) and the section
  triggers (`ShopSections`); about fifty `CHECK (` clauses; partial and GIN indexes; two
  `DEFERRABLE` constraints (one is `uq_shop_sections_position`); and the `COMMENT ON` lines
  of 53 migration files. No migration creates a database view: `BasketsBecomeViews` is
  named for the product rule (a basket is read from the list lines), it drops tables.
  Search uses the built in `english` and `spanish` text search configurations; no migration
  creates a configuration of its own.
- Reference rows the chain writes and a fresh database needs (read on 2026-11-03):
  - catalog `categories`: written by `CategoryTree1758100000000`, replaced by
    `DiaCategoryTree1758500000000`, extended by `CategoriesBeyondDia1758600000000`. The
    tree lives in constants inside those migration files (`DIA_CATEGORY_TREE`,
    `NEW_LEAVES_UNDER_DIA_ROOTS`, `NEW_ROOTS`), with ids from `categoryId(slug)` in
    `catalog/src/app/db/taxonomy/ids.ts`.
  - catalog `price_policies`: six rows inserted by `ItemPrices1756700000000`.
  - catalog `postal_code_points`: the GeoNames centroids, loaded by
    `PostalCodePoints1756400000000` through `loadPostalCodePoints(queryRunner,
    ALL_POSTAL_CODE_CENTROIDS)` from `@portfolio/luna-shopper/postal-codes/dataset`.
- Not reference rows, and dropped: every other INSERT or UPDATE in the four chains moves or
  backfills rows that only an old database holds. `PriceScopePriority1757200000000`
  backfills `priority` and copies each shop's scope into the new join table.
  `SectionsOfAShop1759000000000` copies `location_sections` into `shop_sections`. Harvester
  `OneSourceProduct1756900000000` folds aliases and refs into `source_catalog_entries`. The
  core migrations with INSERT (`ListPermissionsAndAutoApprove`, `LineProductSet`,
  `BasketKindStatusAndSources`, `BasketTripRows`) are all `INSERT ... SELECT` from existing
  rows. Auth and harvester insert no reference rows. On an empty database each of these
  statements touches zero rows.
- No service fills a table at boot. `supermarket_sources` rows come from the back office
  (`supermarketSource.upsert`), store price scopes from `ensureStoreScope` when a shop is
  written, harvest presets are code. The `onModuleInit` hooks that touch the database
  (`harvest-run.service.ts`, `account-deletion.publisher.ts`) start timers; they insert
  nothing.
- The current specs of the chain: `core/src/app/db/*.migration.integration.spec.ts` (10
  files), `catalog/src/app/db/*-migration.integration.spec.ts` (13 files) and
  `harvester/src/app/db/*.migration.integration.spec.ts` (7 files) drive a single migration
  from the state before it. Three unit specs sit inside the catalog migrations directory:
  `1756400000000-PostalCodePoints.spec.ts` (the batching of `loadPostalCodePoints`, which
  stays useful), `1756500000000-DerivedPostalCodes.spec.ts` and
  `1757400000000-PriceScopeLocalAreaRename.spec.ts`. Each service also has `migrations.integration.spec.ts`,
  which asserts the head schema (tables exist, a column is gone, a cascade works) and mostly
  holds against any database at the head; core's imports
  `LIST_SHARED_WITH_ZONE_BACKFILL_SQL` from a migration file.
- The PR workflow's `verify-infra` job brings the compose stack up with `stack.sh up` and
  runs `test-integration` of every affected `luna-shopper*` project (renamed by docs `0003`).
  The compose databases are `postgres:16-alpine`, and `POSTGRES_USER` is a superuser there,
  so a spec may create and drop scratch databases.
- `k8s/catalog-import/restore-first-catalog.sh` (k8s `0012`) compares the `migrations` rows
  of a dump with the live database and with `first-catalog.manifest`. Release task `0003`
  ran it; its window closed on 2026-10-14. No release task names a migration.

### Target state

1. **Four baseline classes.** `AuthBaseline1780000000000`, `CoreBaseline1780000000000`,
   `CatalogBaseline1780000000000`, `HarvesterBaseline1780000000000`, each in
   `src/app/db/migrations/1780000000000-<Service>Baseline.ts`, each with
   `name = '<Service>Baseline1780000000000'`. Each index array holds exactly its baseline
   after the chain is deleted.
2. **The schema comes from a dump.** Each baseline runs one `queryRunner.query` of SQL taken
   from `pg_dump --schema-only --no-owner --no-privileges --exclude-table=migrations` of a
   database at the head of its chain, kept in a TypeScript module beside it
   (`src/app/db/baseline/<service>-schema.ts`, exporting one string) so webpack inlines it
   into `migrate.js`. Stripped from the dump: `SET` lines, `SELECT pg_catalog.set_config`
   lines, `\restrict` and `\unrestrict` lines, `--` comment lines, `COMMENT ON EXTENSION`,
   `CREATE SCHEMA public` and anything that names the `migrations` table or its sequence. Kept:
   extensions (`CREATE EXTENSION IF NOT EXISTS`), types, tables, sequences, defaults, check
   and deferrable constraints, indexes, functions, triggers and `COMMENT ON` for tables,
   columns and functions.
3. **The reference rows travel.** The catalog baseline inserts, after the schema: the
   `categories` rows of the head tree (roots before leaves, from a committed module
   `src/app/db/baseline/catalog-categories.ts` generated once from a head database), the six
   `price_policies` rows, and the postal code points through `loadPostalCodePoints`, which
   moves out of the deleted migration into `src/app/db/reference/postal-code-points.ts`, so a
   dataset refresh stays a migration of one line. Auth, core and harvester baselines insert
   no rows.
4. **The guard.** Each baseline's `up` first reads the `migrations` table and the tables of
   schema `public`. When the ledger holds any row, or `public` holds any table other than
   `migrations`, it throws, naming the database, the rows found, and the remedy (the
   adoption step of k8s `0019`, `k8s/bootstrap/rename-release.sh`, or `stack.sh` on a
   slot). On an empty database it passes.
5. **No way back through `down`.** Each baseline's `down` throws with a message that says a
   baseline cannot be reverted and names the backup restore of k8s `0005`.
6. **The proof, once.** Before the chain is deleted, an integration spec per service
   (`src/app/db/baseline.integration.spec.ts`) creates two scratch databases on the compose
   instance, runs the old chain on one and the baseline on the other, and asserts: the
   normalised `pg_dump --schema-only` outputs are equal, and the rows of the reference tables
   (`categories`, `price_policies`, `postal_code_points` for catalog) are equal, compared
   without `createdAt` and `updatedAt`. It runs green in `verify-infra` on a pushed commit.
7. **The committed record.** `src/app/db/baseline/<service>-head-schema.sql` is the
   normalised dump of the head schema, written by the proof run. After the chain is deleted,
   the same spec runs the baseline on a scratch database and compares its normalised dump
   with this fixture, byte for byte after normalising line endings.
8. **The entities agree.** The same spec runs
   `dataSource.driver.createSchemaBuilder().log()` with the service's entities against the
   baseline database and asserts the `upQueries` equal a committed list
   (`src/app/db/baseline/<service>-entity-drift.json`), each entry with a one line reason.
   The list is empty unless the head chain already disagrees with the entities, which the
   builder measures on a head database before writing anything (see action boundaries).
9. **The chain is gone.** The old migration files, the specs that drive single migrations
   (the 30 integration specs listed in the context, `1756500000000-DerivedPostalCodes.spec.ts`
   and `1757400000000-PriceScopeLocalAreaRename.spec.ts`) and every import of a deleted
   migration module are removed. `1756400000000-PostalCodePoints.spec.ts` moves with
   `loadPostalCodePoints` to `src/app/db/reference/`. Each
   `migrations.integration.spec.ts` keeps the assertions about the head schema and loses
   those that need a migration module or a pre migration state.
10. **The index spec.** Each service (harvester included) has a `migrations.spec.ts` that
    asserts: the array matches the files, it is sorted, the first entry is the baseline, and
    every later timestamp is greater than `1780000000000`.
11. **The tools keep working.** `migration:run`, `migration:revert` and `migration:generate`
    targets are unchanged. `migration:generate` against a database at the baseline reports
    no changes. `stack.sh up` and `server-slot.sh --up` migrate a new slot with the baseline.
    `npx nx run velista-server:seed` (today `luna-shopper-backend:seed`) seeds a baseline
    database.
12. **The adoption contract is written down** in this plan (section "The adoption
    contract" below), and the builder copies the four head names it found at the final
    rebase into that section if they differ from today's.

### Scope

In: the four `src/app/db/migrations` directories, `src/app/db/baseline/` and
`src/app/db/reference/` (new), the migration specs under `src/app/db`, the proof spec, the
four `migrations.spec.ts`, `k8s/e2e/luna-shopper-backend/stack.sh` (the message on a slot
that the guard refuses, and the `adopt-baseline` verb only if the owner picks the
alternative of the locked slots decision).

Out: the adoption on staging and production (k8s `0019`), the namespace and database
rename (k8s `0019`), `restore-first-catalog.sh` (named below, changed by nobody here), the
seed data, any entity change, any change to `migrate.ts` beyond what the baseline needs
(nothing is expected).

### Constraints

- Generate the dump from a database built by the chain, never from the entities: the
  entities do not describe the functions, triggers, checks and comments listed above.
- Run `pg_dump` inside the database container of the compose stack (`docker compose exec -T
  <svc>-db pg_dump ...`), so its major version equals the server's. A host `pg_dump` of
  another major version is refused.
- The baseline SQL must run inside `transaction: 'all'`. Nothing in it may need its own
  transaction (no `CREATE INDEX CONCURRENTLY`, no `ALTER TYPE ... ADD VALUE` followed by a
  use of the value).
- The reference rows are data the baseline inserts, never a separate seed step: the hook
  Job is the only thing that runs everywhere (backend `0060` made the same choice).
- No new dependency. The proof uses `pg`, TypeORM and the compose stack that exist.
- The SQL module is generated output. Its header names the command that wrote it; nobody
  edits it by hand.

### Action boundaries

Stop and ask before:

- Deleting the chain, if the proof (target state 6) is not green in CI on a pushed commit.
- Writing the drift list (target state 8) with any entry. Measure first on a head database;
  if `log()` reports anything, report the queries and stop. Each entry is the owner's call:
  fix the entity in another plan, or accept the drift.
- Changing any entity, any existing table, or any data on a slot that is locked
  (`--keep-data`). A locked slot holds data the owner measures on.
- Touching staging, production, the chart or the migration Job template.
- Adding a package.

### Progress evidence

- `npx nx run velista-server-<svc>:test-integration` (each of the four) on a slot runs the
  proof spec and passes; the PR's `verify-infra` job is green on the commit that still holds
  the chain beside the baseline, and green again after the chain is deleted.
- `npx nx test velista-server-<svc>` runs `migrations.spec.ts` with the four new assertions.
- On an ephemeral slot (`server-slot.sh --ephemeral --up <n>`): `stack.sh up` migrates four
  empty databases, `migrate.js` from a fresh `nx build` reports `applied 1 migration(s)` for
  each, and a second run reports `applied 0 migration(s)`.
- On the same slot, a database restored from a head-of-chain dump makes `migrate.js` exit
  non zero with the guard's message, and nothing in the database changes.
- `npx nx run velista-server-<svc>:migration:generate` against the baseline database writes
  no file.
- `npx nx run velista-server:seed` succeeds on the baseline databases.
- `git grep` finds no import of a deleted migration module.

## The adoption contract

k8s `0019`'s cutover script performs the adoption. What it relies on is fixed here.

- **Names.** The row it inserts in each database is `(timestamp, name)` =
  `(1780000000000, '<Service>Baseline1780000000000')`.
- **Invariant before it writes.** The last applied migration of each database, by `id`,
  must be the head of its chain as the baseline was generated from. On 2026-11-03 these are
  `OAuthNonces1773400000000` (auth), `AssistantAllowance1756004000000` (core),
  `SectionsOfAShop1759000000000` (catalog) and `HarvestSchedules1759400000000` (harvester),
  and each `migrations` table holds exactly the names of its chain. A database behind the
  head, or holding a name the chain does not know, is refused: it was not built by the image
  the baseline was proved against.
- **Idempotence.** A database whose ledger already holds exactly the baseline row is left
  alone.
- **Order.** The adoption runs before the first deploy of an image that carries the
  baseline. If it does not, the guard (target state 4) fails the hook Job, nothing changes,
  and the adoption followed by the deploy again succeeds.
- **No rollback across it.** After adoption, an image from before this plan sees every one
  of its migrations as pending (TypeORM chooses by name), runs `InitialAuthSchema` or its
  peer, fails on an existing table and rolls back. The hook fails safely, but the old image
  cannot deploy. k8s `0019` makes the adoption release the floor of `redeploy.yml` for the
  velista unit, as k8s `0016` did for the first release.
- **Restores.** A dump taken before adoption and restored afterwards carries the old rows.
  The next deploy's guard refuses it, and running the adoption again fixes it.
  `restore-first-catalog.sh` compares migration rows and refuses every pre adoption dump; it
  is k8s `0012`'s tool and its task window is closed, so this plan leaves it unchanged and
  k8s `0019` decides whether to retire it (its owner decision 5, which recommends
  retiring it).

## Decisions taken in this plan

- **D1. The schema comes from `pg_dump` of a head database, not from
  `migration:generate`.** `migration:generate` writes what the entity metadata describes.
  It would lose every function and trigger of catalog search and of the category tree, the
  check constraints written by hand, the deferrable constraints, the comments, and the
  extensions, and the first search on a fresh database would return nothing. The dump is
  what the chain produced, by definition. Rejected: generating from the entities and adding
  the missing objects by hand, which is a second hand written schema.
- **D2. Reference rows are code, and two come from their existing source.** The postal code
  points stay loaded from the dataset module, so the attribution and the refresh path of
  backend `0060` keep working. The category rows are generated once into a module, because
  their source today is three migration files that this plan deletes, and the module is what
  remains reviewable. Rejected: `pg_dump --data-only` lines inside the schema SQL, which
  would turn eleven thousand postal code rows into SQL nobody can diff.
- **D3. Timestamp `1780000000000`, above every head and below today's clock.** TypeORM orders
  by timestamp, so a migration numbered below the baseline would run before it on an empty
  database and fail. A number above every head (the highest is auth's `1773400000000`)
  makes the baseline first; a number below `Date.now()` (about `1793000000000` in November
  2026) keeps `migration:generate`'s numbers after it, and the index spec refuses anything
  lower. The timestamp does **not** hide the baseline from an old image: TypeORM 1.1 picks
  pending migrations by name, so the protection against an old image is the redeploy floor
  of k8s `0019`, not the number.
- **D4. A guard inside the baseline, as well as a coordinated release.** k8s `0019` plans to
  ship in the same rollup, and the guard is what makes a slip harmless: a few lines that turn
  "the baseline ran over an existing schema" into a refusal with the remedy in it. Rejected:
  relying on the release order alone, which fails badly the one time the adoption is
  skipped (a restore, a hand deploy, a slot).
- **D5. `down` throws.** On an adopted production database the inverse of a baseline is
  `DROP` of every table. A revert is never the way back; a backup restore is.
- **D6. Slots are disposable, and the guard says so.** A slot that holds a head-of-chain
  database is refused by the guard on its next `stack.sh up`, and `stack.sh` prints the
  remedy: `server-slot.sh --down` and `--up`. Locked slots are the owner decision below.
- **D7. Keep the head schema fixture.** It is the record of what 104 migrations produced, it
  makes a later change to the baseline SQL visible as a diff, and it lets the spec run with
  no chain to compare against. Rejected: comparing only against the entities, which is the
  check D1 rejects as incomplete.
- **D8. The entity check is a list, not a zero.** The chain may already disagree with the
  entities (TypeORM proposes to drop indexes it does not know). An empty list is the goal; a
  reviewed list is what stops new drift today.

## Owner decisions

- **Keep the fixture dump in the repository.** Recommendation: yes (D7). It is a few
  thousand lines of SQL per catalog and less for the others.
- **Locked slots.** A slot kept with `--keep-data` (slot 3 holds the realistic catalog the
  owner measures on) is refused by the guard after this plan. k8s `0019` D9 owns the slot
  side of the adoption: the first `server-slot.sh --up` or `stack.sh up` after `0019`
  renames a kept slot's databases and adopts the baseline in place, through the shared
  `k8s/bootstrap/rename-release/rename-database.sh`, with the invariant of "The adoption
  contract". **Decided by the owner on 2026-11-03:** a locked slot stays down between the
  merge of this plan and that of k8s `0019` (they ship in one rollup), and this plan adds
  no `stack.sh adopt-baseline` verb. Rejected: that verb for the gap, and a dump of the
  catalog restored into a fresh slot.
- **Entity drift found by the measurement**, if any (action boundaries): fix each entity in a
  follow up plan, or accept it in the drift list.

## Owner steps outside the code

None. The adoption on staging and production is k8s `0019`.
