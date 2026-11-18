# 0272: a release task re-keys the DEZA entries before the first walk on the new split

> The owner's decision 48b of 2026-11-18: a release task re-keys the stored DEZA source entries
> before the first DEZA walk that runs on the new size split. It replaces decision 28a (plan
> `0270` D4) for DEZA: a moved row is no longer left to age out while the owner relinks its
> product from a review list. The task moves the row's key, and the row keeps its product, its
> prices, its shops and its decision. Decision 39a (plan `0270` D5) stands: the key stays
> `entryKey(name, sizeFormat)` of the split. Checked against `origin/dev` and the branch of PR
> #1007 on 2026-11-18.
>
> Prerequisite reading: plan `0270` (on the branch of PR #1007 until it merges, sections 4 and
> 5 and D4 to D7), plan `0266` (the split change already on `dev`), plan `0271` (the closest
> precedent, a release task that runs a command of the harvester bundle), plan `0085` section 6
> (the site has no product id), plan `0244` section 7 (release task `0006`),
> `k8s/release-tasks/README.md`, `k8s/release-tasks/tasks/0006-kilo-pieces-state-their-weight/`
> and the section "A release task runs in a window, on data it expects" in `CLAUDE.md`.
>
> **Builds on `dev` after PR #1007 is merged**, so the specs of section 7 run against the split
> that the release carries. **Ships in the first velista release that carries plan `0266`**,
> which is the next one (section 5.3). Never in a release after the one that carries #1007.

## Brief for the agent

### Objective

Add the next free release task under `k8s/release-tasks/tasks/` (expect `0007`, or `0008` if
the task of plan `0271` lands first; verify) and the command it runs. The task rewrites the key
of every stored DEZA walk row whose key the deployed split no longer builds, in place, so the
next walk finds the same row. Add a guard so that no DEZA walk runs while such a row exists.
Nothing is deleted and no decision changes.

### Context

- **The key of a DEZA row is ours.** The site prints no product id, no EAN and no product link
  (plan `0085` section 6, `DezaProductRow` in `libs/luna-shopper/deza/src/lib/types.ts`). The
  runner keys a row on `entryKey(row.name, row.sizeFormat)` (`deza-catalog.runner.ts`,
  `record`, near line 813). `entryKey` is the SHA-1 hex of
  `normalizeName(name) + '|' + normalizeName(sizeFormat ?? '')` (`harvester/src/app/harvest/matching.ts`,
  near lines 49 to 89). `name` and `sizeFormat` come from one call of
  `splitSize(description)` (`deza/src/lib/rows.ts`, near line 80).
- **A change of the split moves keys.** `Calcetines 3 pares` hashes `calcetines 3 pares|` on
  `dev` and `calcetines|3 pares` under PR #1007. The next walk does not find the stored row. It
  writes a new `UNRESOLVED` row, and the old row, which a person bound to a product, is no
  longer seen: no price, no shop, and the delisting counter of plan `0220` marks it gone.
- **Two changes move keys, and neither has run in a cluster.** Plan `0266` (PR #970, on `dev`
  since 2026-11-18) reads a size that ends in a full stop or `aprox`, and reads `u` and
  `servicios`. PR #1007 (plan `0270`) reads `pares`, `bolsitas`, `porciones` and their singular
  forms, and a capital `X` join. Neither `origin/main` nor the release `velista-v0.19.0` holds
  plan `0266`, so no DEZA walk in staging or production has run on either split.
- **The stored row holds what is needed to compute the new key exactly.** For every DEZA row,
  `name`, one space and `sizeFormat` (or `name` alone when `sizeFormat` is null) is the
  description as the parser read it, byte for byte (plan `0270` section 5.3, 39b costs). And
  `externalId === entryKey(name, sizeFormat)` proves the stored pair is the pair the key was
  built from: that is `isNameKeyed` (`matching.ts`, near line 310).
- **Production, read only through the admin API on 2026-11-18** (decision 42a):
  - 14,538 DEZA entries: 13,638 `ACTIVE`, 900 `UNRESOLVED`; 14,350 owned by a walk
    (`OFFICIAL_WEB`), 188 by a leaflet (`OFFICIAL_LEAFLET`). Every `ACTIVE` row has
    `matchedBy` `MANUAL`.
  - All 14,538 are name keyed: the stored key equals `entryKey` of the stored name and size.
  - Under the split of `dev`, 66 walk rows move: 54 `ACTIVE`, 12 `UNRESOLVED`. These are the
    rows of plan `0266`: 49 with a size that ends in a full stop or `aprox`, 17 with the newly
    read `u`. Each stored row held the whole description as its name and no size text.
  - Under the split of PR #1007, those 66 and 71 more move, 137 in all: 125 `ACTIVE`, 12
    `UNRESOLVED`. The 71 are all `ACTIVE`: `pares` 51, `bolsitas` 10, `porciones` 8, capital
    `X` 2. They too held the whole description as the name and no size text.
  - No new key is already held by another row, and no two old keys give one new key.
  - Of the 188 leaflet rows, 39 hold a key that the walk split does not rebuild from their
    text. They are keyed on the document's name and label (`file-import.runner.ts`, near lines
    216 to 218), not on the walk split, so no walk key moves them. The task leaves every leaflet
    row alone (section 1).
- **What references the row.** Every table that hangs off a source entry joins on its `id`, not
  on its key: `source_entry_prices.entryId`, `source_entry_availability.entryId`,
  `source_entry_scope_presence.entryId`, `source_catalog_entries.candidateEntryId`, and in
  catalog `item_linked_images.sourceEntryId`. Catalog holds no DEZA key: the only key outside
  the harvester is `createdFromEntry` of a `CREATE` audit row, which only task `0006` sends,
  for Mercadona. So a rewrite of `externalId` in place keeps every reference.
- **What a walk does with a row it finds.** `touch` rewrites the source group and leaves the
  decision group alone (`applySourceGroup`, `source-snapshot.ts`, near line 128). So once the
  key is right, the walk rewrites the text and the size of the row, and `itemId`, `status`,
  `matchedBy`, `confidence` and `decidedAt` stay.

### Target state

1. A task directory `k8s/release-tasks/tasks/<NNNN>-deza-keys-follow-the-split/` with
   `task.env`, `check.sh` and `post.sh`, in the shape of task `0006`.
2. A command `deza-keys.js` in the harvester bundle with `--count` (writes nothing) and a write
   mode with `--max <n>`.
3. After the task, every DEZA walk row that the deployed split moves holds the key, the name
   and the size text that the split builds, and nothing else on it changed.
4. A DEZA catalog walk is refused while a row that the task would re-key exists (section 5).
5. The counts by `status` and `matchedBy`, the number of rows, and the `itemId` of every row
   are the same before and after.

### Scope

- `apps/luna-shopper-backend/harvester`: the command `deza-keys.ts` (a third webpack entry,
  as `kilo-pieces.js` is, and its line in the hand written `package.json` list of
  `project.json` if it reaches a package the others do not), its selection in
  `src/app/release-tasks/deza-keys.ts`, the guard of section 5 in `harvest-run.service.ts` and
  `deza-catalog.runner.ts`, and their specs.
- `k8s/release-tasks/tasks/<NNNN>-deza-keys-follow-the-split/`: `task.env`, `check.sh`,
  `post.sh`.
- `k8s/release-tasks/README.md`: a section for the task, like the one of task `0005`.
- No change to `splitSize`, `entryKey`, `normalizeName` or any adapter. No migration. No change
  to catalog. `openapi.json` does not change, unless the guard's refusal adds an error code
  (section 5.1), and then it is regenerated with the generator.

### Constraints

- **It deletes nothing and inserts nothing.** Every write is an `UPDATE` of three columns of a
  row that exists.
- **It changes no decision.** `itemId`, `status`, `matchedBy`, `confidence`, `decidedAt` and
  `candidateEntryId` stay. No price, no availability and no presence row is touched.
- **It reads nothing out of a name.** The new key is what the deployed `splitSize` and
  `entryKey` build from the stored text, the same pure functions the walk calls. No rule of its
  own.
- **The key is computed by the code of the image, never by a second copy of it** (section 2).
- **No product name, key or id reaches the deploy log.** `check.sh` and `post.sh` print counts
  only. The Actions logs are public.
- `task.env` holds only comments and `NAME="value"` lines, with no blank line.
- The windows and `PRODUCTION_RELEASE` are written in the pull request that ships the task,
  within 14 days of that commit (`check-tasks.mjs` enforces it).

### Action boundaries

- Rehearse on a copy of real data, never on a cluster: the locked slot 4 copy dumped into the
  ephemeral slot the build brief names (`luna-slot.sh --ephemeral`), or a staging dump restored
  into one. Do not unlock or start slot 4.
- No live walk of any storefront. A walk on the rehearsal copy runs against the fake listing of
  `deza-catalog.runner.spec.ts`, never against the site.
- Run `--count` on the copy first and put its output in the PR before any write.
- Stop and report if the count on the copy is more than twice the production count of the
  Context for the same code, or if any check of section 6 fails on the copy.
- Production is read only, through the admin API, as on 2026-11-18. Nothing is written there.

### Progress evidence

The `--count` output on the copy before and after a write run, the second run printing 0
moves, the before and after counts of section 6, the specs, a read only recount of production
with the code of the branch (section 7.3), `node k8s/release-tasks/check-tasks.mjs`, and
`check.sh` and `post.sh` run against the copy through the override.

## 1. Which rows move

In the harvester database, read the source whose `adapterKey` is `deza-web` in
`supermarket_sources`. Then, for every `source_catalog_entries` row of that `supermarketId`:

1. **Only walk rows.** `sourceKind` is `OFFICIAL_WEB`. A leaflet row is keyed on the document's
   own name and label, which no size table changes, and the next leaflet must find it under that
   key. A row a walk took over from a leaflet is `OFFICIAL_WEB`, because the walk owns its text
   (plan `0190`), so it is included.
2. **Only rows whose stored key the stored text proves.** `externalId === entryKey(name,
sizeFormat)` (`isNameKeyed`). A row that fails this is never touched. Its description cannot
   be rebuilt with certainty, so the task cannot say what its new key is. It is counted as
   `unkeyed` (section 3). Production has 0.
3. **Every status.** An `ACTIVE` row keeps its product. An `UNRESOLVED` or `CANDIDATE` row keeps
   its place in the queue instead of a second copy of itself appearing beside it. A `REJECTED`
   row stays rejected instead of coming back as a new `UNRESOLVED` row.
4. **The move.** `description` is `name + ' ' + sizeFormat`, or `name` when `sizeFormat` is
   null. `split = splitSize(description)`. `newKey = entryKey(split.name, split.sizeFormat)`.
   The row moves when `newKey !== externalId`.

The selection reads the old key from the row and never runs old code. So one command covers
plan `0266` and plan `0270` alike, and any later change of the split (section 8, decision 53).

## 2. How the new key is computed

The options found in the code:

- **A. A command in the harvester image (chosen).** `deza-keys.js` is a webpack entry of the
  harvester bundle, beside `main.js` and `kilo-pieces.js`. It imports `splitSize` from
  `@portfolio/luna-shopper/deza` and `entryKey` from `matching.ts`, the same imports the runner
  makes. `post.sh` runs it with `kubectl exec deploy/luna-shopper-backend-harvester -- node
deza-keys.js` after the rollout, so the image that computes the new keys is the image that
  walks next. The key cannot disagree with the walk, by construction, whichever split the
  release carries.
- **B. A committed mapping from old key to new key.** It would be computed on a copy before the
  release. A row added in a cluster after the copy was read is missing from it, staging and
  production hold different rows, and the file would carry product data in a public repository.
  Rejected.
- **C. SQL in the task.** `normalizeName` is an NFD decomposition, a removal of combining marks
  and a JavaScript regular expression, and `splitSize` is a regular expression with a closed list
  of unit words. A second copy in SQL is a second implementation that can disagree with the walk
  (plan `0270`, 39b costs). Rejected.
- **D. A harvester route or NATS subject.** It adds a surface to the running service for a
  change that runs once per split change, and the task would still need the same selection.
  Rejected.
- **E. A migration.** A migration takes no dump and cannot expire, and this rewrites rows a
  harvest wrote (`CLAUDE.md`, release tasks). Rejected.

The command connects as `kilo-pieces.ts` does: a plain `DataSource` on `HARVESTER_DB_URL`, raw
SQL, no Nest. It needs no NATS, because nothing in catalog changes.

## 3. The command

```
node deza-keys.js --count
node deza-keys.js --max <n>
```

`--count` writes nothing and prints one line per fact, numbers only:

```
rows 14350
unkeyed 0
moves 137
moves-active 125
moves-unresolved 12
moves-other 0
collisions 0
active-runs 0
```

- `rows`: the walk rows of the chain the selection read.
- `unkeyed`: rows that fail step 2 of section 1, never touched.
- `moves`: the rows that would be re-keyed, then the same by `status`.
- `collisions`: moved rows that section 4 skips.
- `active-runs`: runs of the chain that are `PENDING` or `RUNNING` in `harvest_runs`.

The numbers are the production count of 2026-11-18 under PR #1007, as an example of the shape.
With no DEZA source row, it prints `rows 0` and every other line 0.

The write mode:

1. Refuses while `active-runs` is above 0. A run in flight writes rows of the chain.
2. Opens one transaction and takes `LOCK TABLE source_catalog_entries IN SHARE ROW EXCLUSIVE
MODE`, so no ingest writes a row between the read and the update. 137 updates hold it well
   under a second; a walk of another chain waits for it.
3. Reads and selects again inside the transaction, and refuses when `moves` is above `--max`.
4. Updates each moved row that section 4 does not skip:
   `SET "externalId" = newKey, "name" = split.name, "sizeFormat" = split.sizeFormat`, with
   `WHERE "id" = $1 AND "externalId" = <old key>`. An update that touches no row aborts the
   transaction.
5. Commits, then prints the same lines as `--count` for the state after, plus `rekeyed <n>`.

**Why the name and the size text change too.** The three columns are one result of one
`splitSize` call, and the walk writes them together. Changing the key alone leaves a row whose
key is not `entryKey` of its own text until the next walk, and `isNameKeyed` answers false for
it, which the word order rung of plan `0221` reads (`source-ingest.ts`, near lines 1709 and
2305). The size columns (`unitSize`, `sizeUnit`, `packCount`) and everything else of the source
group stay as they are. The next walk rewrites them as it rewrites every row, so a doubt check
and a size change happen where they always happen.

**Safe to run again.** A re-keyed row holds the key its text builds, so it does not move. A
second run counts `moves 0` and writes nothing. No marker is needed.

## 4. Collisions

A collision is a moved row whose new key another row of the chain already holds, or two moved
rows that give one new key. Example: a stored `Yogur 2X125 g` with no size, keyed
`yogur 2x125 g|`, and a stored `Yogur` with `2x125 g`, keyed `yogur|2x125 g`. Under PR #1007 the
first one's new key is the second one's key. The unique index `uq_source_catalog_entry` on
(`supermarketId`, `externalId`) refuses the update.

Production has 0 of either shape. The task must still state what it does: by the
recommendation of decision 50, it **skips** every row of a collision, writes nothing to it,
counts it under `collisions`, and lists it in the record of section 4.1. Such a row then
behaves as decision 28a described: the walk writes its observations on the row that holds the
key, and the skipped row ages out. The owner links it by hand. `check.sh` and `post.sh` refuse
when `collisions` is above `MAX_COLLISIONS_<ENVIRONMENT>`.

### 4.1 The record

The write run writes one line per re-keyed or skipped row, tab separated: `entry_id`,
`old_key`, `new_key`, `outcome` (`rekeyed` or `collision`), and for a collision
`new_key_holder` (the id of the row that holds the key, or empty for two moved rows).
No name. `post.sh` copies it into the ConfigMap `release-task-<NNNN>-record` of the namespace,
with `kubectl create configmap ... --from-file=record.tsv --dry-run=client -o yaml | kubectl
apply -f -`, and prints only its line count. A run that re-keyed nothing leaves an earlier
record in place. This is decision 54.

## 5. No walk before the task

### 5.1 The guard

Between the rollout and the end of `post.sh`, the new image runs and nothing has moved the keys
yet. Three things can start a DEZA walk in that gap:

- a person, from the back office;
- in production, a schedule slot that comes due (`HARVEST_SCHEDULER_ENABLED` is true there);
- in production, the one retry of a scheduled run that the deploy stopped
  (`retryInterrupted`, `harvest-schedule.worker.ts`, near line 298), which fires on the first
  tick of the new pod, within 60 seconds.

The phase order alone does not hold the gap shut. So, by the recommendation of decision 51:

- **The spawn refuses.** `validateRequest` (`harvest-run.service.ts`, near line 865) refuses a
  `CATALOG_DISCOVERY` run of a `deza-web` source while the selection of section 1 finds a move
  that section 4 would not skip. The sentence says that the stored keys wait for the release
  task and names the task directory. No run row is written, so `consecutiveFailures` does not
  grow. A scheduled slot is recorded `REFUSED`, which sends the alert of plan `0218` in
  production; that is the point, a refused slot must be heard.
- **The runner checks again.** `DezaCatalogRunner.run` (near line 79) throws the same sentence
  before its first request. It covers a run inserted before the guard existed.
- **Collisions and unkeyed rows do not count** for the guard, because the task never changes
  them. Without this, one collision would refuse every walk forever.
- Leaflet imports and probes are not guarded. A leaflet keys on its own text, and a probe writes
  only `source_probes`.

The selection reads about 14,000 rows of one chain and hashes each one: a few tens of
milliseconds, once per spawn. Use one function for the command and the guard.

If a refusal needs a new error code in the gateway's document, regenerate `openapi.json` and
`wire-types.ts` with the generators. A plain refusal with the existing validation code needs
neither.

### 5.2 Staging and production

- **Staging.** The staging deploy runs `--phase post` after the rollout. The scheduler is off.
  A walk a person starts in the gap is refused by the guard. After `post.sh`, walks run.
- **Production.** `deploy-release.sh` runs the same phases. A slot or a retry in the gap is
  refused by the guard and recorded `REFUSED`. The next slot runs as usual.
- **The DEZA row of `supermarket_sources`.** The task never turns it off or on. That row is the
  owner's decision. A row that is off makes no difference: the task re-keys anyway.

### 5.3 Which release

`velista-v0.19.0`, the release in production, and `origin/main`, the code in staging, do not
hold plan `0266`. The next velista release from `dev` carries it, so **this task ships in that
release**, whether or not PR #1007 is in it. Decision 52 asks the owner how the two land:

- With #1007 in the same release, one run re-keys the 137 rows.
- With #1007 in a later release, this task re-keys the 66 rows of plan `0266`, and a second task
  directory with new windows runs the same command in the release of #1007. The guard makes a
  forgotten second task loud: the first DEZA walk on that release is refused.

Never later than #1007: a release that carries #1007 without this task in it or before it moves
the keys of 71 rows a person linked.

## 6. The task

### 6.1 `task.env`

```sh
# Re-key the stored DEZA walk rows whose key the deployed split no longer builds
# (backend plan 0272).
UNIT="velista"
RUN_UNTIL_STAGING="<a UTC date, at most 14 days after the commit that writes it>"
RUN_UNTIL_PRODUCTION="<a UTC date, at most 14 days after the commit that writes it>"
PRODUCTION_RELEASE="<the version, such as 0.20.0, without its v>"
DATABASES="harvester"
MAX_MOVES_STAGING="<n>"
MAX_MOVES_PRODUCTION="<n>"
MAX_UNKEYED_STAGING="0"
MAX_UNKEYED_PRODUCTION="0"
MAX_COLLISIONS_STAGING="0"
MAX_COLLISIONS_PRODUCTION="0"
```

The builder writes the windows and `PRODUCTION_RELEASE` in the pull request that ships the
task. The release is the velista release of section 5.3. `MAX_MOVES` is the count of each
environment rounded up to the next ten: 140 for production from the count of 2026-11-18 under
#1007 (70 if #1007 is not in the release), and the staging count read the same way, stated in
the PR for the owner to confirm. `MAX_UNKEYED` and `MAX_COLLISIONS` are 0, because both were 0
in production. `DATABASES` is `harvester`, the one database the task writes.

### 6.2 The dump

The runner dumps `harvester` before the pre phase through its backup CronJob, and keeps the key
in the ledger. The dump is the way back for 14 days. A restore also removes what walks wrote
after the task, so the README section says to prefer, for a single row, an update that puts its
`old_key` back from the record of section 4.1, with the whole description as the name and no
size text. That was the stored shape of every moved row counted on 2026-11-18; a row of
another shape is read from the dump while it exists.

### 6.3 `check.sh`

Copy task `0006`. It reads only, and:

- passes where there is no harvester deployment;
- passes where the harvester pod has no `deza-keys.js` yet, because it runs before `helm
upgrade`, and prints that `post.sh` counts after the rollout;
- refuses a ceiling that is not a number;
- runs `deza-keys.js --count` and refuses when `moves`, `unkeyed` or `collisions` is above its
  ceiling;
- refuses anything it cannot read: a deployment it cannot look up, a command that fails or
  prints no count;
- passes with `moves 0`, which is also how it finds its own earlier run.

### 6.4 `post.sh`

Copy task `0006`. It refuses where the pod has no `deza-keys.js`, so the runner leaves the task
at `pre-done` and the next deploy finishes it. Then:

1. Counts with `--count`, prints the output, and refuses as `check.sh` does.
2. While `active-runs` is above 0, waits and counts again, every 30 seconds for at most 15
   minutes, then refuses. Only a leaflet import can be active here, because the guard refuses a
   walk.
3. Does nothing more when `moves` is 0.
4. Runs `deza-keys.js --max <ceiling>`, writes the record ConfigMap, and counts again for the
   record.

One transaction holds every update, so a failure leaves no row re-keyed and the next deploy runs
the whole set again.

## 7. Verification of the data

### 7.1 Before and after

The command and the rehearsal assert, on the same database, before and after a write run:

- the number of rows of the chain is the same;
- the counts by (`status`, `matchedBy`) are the same;
- every row keeps its `itemId`, and the rows with an `itemId` are the same set;
- the counts of `source_entry_prices`, `source_entry_availability` and
  `source_entry_scope_presence` rows of the chain are the same;
- every re-keyed row satisfies `isNameKeyed`, and `--count` prints `moves 0`.

The write mode prints the first three as lines `status <status> <matchedBy> <n>` before and
after, and refuses to commit when a count differs.

### 7.2 A walk after the task

On the rehearsal copy, a DEZA walk against the fake listing, with descriptions taken from rows
the task re-keyed, records each one under the row the task re-keyed: no new row, the same
`itemId`, the row's size columns rewritten by the walk. A row the task did not re-key because of
a collision lands on the holder of its key.

### 7.3 Production, read only

The builder reads the DEZA entries of production through the admin API, as decision 42a did,
and runs the selection of the branch over them in a script outside the repository that imports
the built `splitSize` and `entryKey`. The PR quotes the counts of section 3. It quotes no row.

## 8. Later changes of the split

Under decision 39a, every later change of the split moves keys again. The command and the guard
are written for any split, not for the words of plan `0270`. A later plan that changes the split
adds a new task directory that runs the same command in its release. The guard refuses a DEZA
walk on that release until it has run. Decision 53 asks whether the guard stays.

## Tests

- The selection spec: `Calcetines 3 pares` with no size moves to `Calcetines` and `3 pares`;
  `Yogur 2X125 g` moves to `Yogur` and `2X125 g`; `Manguera 15 m.` with no size moves under the
  split of plan `0266`; `Calcetines` with `3 pares` does not move; a leaflet row with the same
  text does not move; a row whose key is not `entryKey` of its text is `unkeyed` and does not
  move; a row of another chain is not read.
- Collisions: a moved row whose new key another row holds is skipped and counted; two moved rows
  with one new key are both skipped; the guard does not count either.
- The command, against real Postgres (the integration project, `LUNA_INTEGRATION`): `--count`
  writes nothing; a write run then a second `--count` print `moves 0`; `--max` below the count
  refuses before any write; an active run of the chain refuses the write; the counts of section
  7.1 hold; a forced failure on the last update leaves no row re-keyed; the prices,
  availability and presence rows of a re-keyed row still join to it.
- The guard: `validateRequest` refuses a DEZA `CATALOG_DISCOVERY` while a move exists, and
  accepts it after the write run; a Mercadona run and a DEZA leaflet import are not refused; the
  runner throws the same sentence; a scheduled start is `REFUSED` and writes no run.
- The walk after the task (section 7.2), through `deza-catalog.runner.spec.ts` and the fake
  listing.
- `post.sh` against the copy: the record ConfigMap is written once, a second run replaces it,
  and the script prints no key, id or name.
- `node --test k8s/release-tasks/check-tasks.test.mjs` and `node k8s/release-tasks/check-tasks.mjs`.

## Acceptance criteria

- [ ] The task directory has `task.env`, `check.sh` and `post.sh`, and `check-tasks.mjs`
      passes.
- [ ] `--count` on the copy and the read only production count of section 7.3 are in the PR,
      before any write.
- [ ] After the write run on the copy, the checks of section 7.1 hold and a second run counts
      `moves 0`.
- [ ] A walk on the copy after the task writes no new row for a re-keyed description.
- [ ] A DEZA walk is refused while a move exists, and runs after the task.
- [ ] Nothing is deleted or inserted, no decision changed, and nothing that names a product or
      a key is printed by `check.sh` or `post.sh`.
- [ ] The windows and `PRODUCTION_RELEASE` are within 14 days of the commit that writes them,
      and name the release of section 5.3.

## Verification

```sh
npx nx test luna-shopper-backend-harvester -t "deza keys"
npx nx run luna-shopper-backend-harvester:test-integration
node k8s/release-tasks/check-tasks.mjs
node --test k8s/release-tasks/check-tasks.test.mjs
npx nx affected -t lint test
```

## Decisions

**D1 (owner, 2026-11-18, decision 48b):** a release task re-keys the stored DEZA entries before
the first DEZA walk that runs on the new split. It replaces decision 28a (plan `0270` D4) for
DEZA. The review list of plan `0270` section 4.1 (`tmp/plan-0270/moved-rows-production.tsv`)
is then no longer a list of rows to relink: after the task the old rows keep their products. It
stays as the record of what moved.

**D2 (owner, 2026-11-17, decision 39a, plan `0270` D5):** the key stays `entryKey(name,
sizeFormat)` of the split. This plan does not change the key's shape.

**C1 (planner choice, for the owner):** the new key is computed by a command in the harvester
image (section 2, option A), so the key the task writes is the key the next walk builds.

**C2 (planner choice, for the owner):** the task re-keys walk rows of every status and no
leaflet row (section 1), and rewrites the name and the size text with the key, and no other
column (section 3).

**C3 (planner choice, for the owner):** one transaction for the whole chain, under a short
table lock. 137 rows do not need batches, and all or nothing makes a failed run simple to
repeat.

## Open questions

**50 (owner, open): what the task does with a collision.** Example: a stored `Yogur 2X125 g`
with no size and a stored `Yogur` with `2x125 g`. Under PR #1007 both build the key
`yogur|2x125 g`, and the unique index refuses the second. Production has 0 today; a walk or a
leaflet before the release can make one.

- **50a:** refuse. `post.sh` fails, nothing is re-keyed, and the guard keeps refusing DEZA walks
  until a person resolves the pair by hand.
- **50b:** skip the colliding rows, count them, list them in the record, refuse only above the
  ceiling (0 today). A skipped row behaves as under 28a: the walk lands on the holder, and the
  owner links by hand.
- **50c:** fold the moved row into the holder: move its prices, shops and presence rows, keep
  the decision of whichever row has one, and delete the moved row. This links two rows by
  machine and deletes a row a harvest wrote.

Recommendation: **50b**, with the ceilings at 0. With 0 the task still refuses a collision it
was not written for, and the owner raises the ceiling in a commit to let it skip one. 50c is a
merge rule, and the owner has declined machine links before.

**51 (owner, open): how no DEZA walk runs before the task.** Example: production stops a
scheduled DEZA walk for the deploy. The new pod's first scheduler tick retries it within 60
seconds, before `post.sh` has run, and the walk writes 137 new rows.

- **51a:** the guard of section 5: the spawn refuses a DEZA walk while a move exists, and the
  runner checks again. A refused slot sends the `REFUSED` alert.
- **51b:** no code guard. Before each deploy that carries the task, the owner turns the DEZA row
  of `supermarket_sources` off, and turns it on after the task is `done`. Slots in between are
  `REFUSED` with `SOURCE_DISABLED`.
- **51c:** rely on the phase order alone.

Recommendation: **51a**. 51b is a manual step on every such deploy in two clusters, and 51c
loses the race above.

**52 (owner, open): how plan `0266` and PR #1007 reach a release.** Example: dev is rolled into
main with plan `0266` and without #1007. The task re-keys 66 rows. When #1007 ships later, its
71 rows need a second task.

- **52a:** hold the next rollup from `dev` to `main` until #1007 and the build of this plan are
  both in `dev`. One task, one run, 137 rows.
- **52b:** ship this task with plan `0266` alone, and add a second task directory for the
  release of #1007.

Recommendation: **52a**. One window per cluster and one record. 52b works too, because the
guard refuses the first walk of a release that forgot its task.

**53 (owner, open): whether the guard stays after this task.** Example: a later plan adds
`sobres` to the split. Its DEZA rows move.

- **53a:** the guard and the command stay. Every later change of the split ships a new task
  directory that runs `deza-keys.js`, and a release that forgets it cannot walk DEZA.
- **53b:** remove the guard and the command once the task is `done` in both clusters. A later
  change of the split moves keys as plan `0270` D4 described, unless its plan adds its own task.

Recommendation: **53a**. Under 39a the split will change again, and the guard costs a few tens
of milliseconds per spawn.

**54 (owner, open): whether the task keeps a record of what it re-keyed.** Example: after three
weeks a row turns out to have been re-keyed wrongly, and the dump is gone.

- **54a:** keep the record ConfigMap of section 4.1 (entry id, old key, new key, outcome; no
  name) until the owner deletes it.
- **54b:** keep nothing beyond the dump and the counts in the deploy log.

Recommendation: **54a**. It is small, it names no product, and it is the only way back for one
row after 14 days.
