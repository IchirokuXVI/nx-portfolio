# 0025 Squashing the migrations to one baseline per service

Twelve migrations across three services, 751 lines, and **not one of them has ever run outside a
developer laptop or a CI container**. `lunaShopperBackend.enabled` is `false` in
`k8s/helm/values.yaml`, so there is no production database and no staging database. The migration
history exists only where it can be thrown away.

This plan collapses that history into a single initial migration per service, and resets the local
Docker databases so they match.

## 1. Why, and why not for the reason it looks like

The prompt for this was provisioning cost, and that reason does not survive contact with the
numbers. 751 lines of DDL against an empty Postgres finishes in well under a second, and
`k8s/helm/templates/luna-shopper-backend/migration-job.yaml.tpl` is a `pre-install,pre-upgrade`
hook, so it runs **once per Helm release**, not once per pod and not once per "instance". Squashing
buys no measurable time anywhere.

The reasons that do hold up are about what the files say to the next person who reads them.

**There is dead code in the history.** `1756000700000-GlobalUsername` adds `users.username`
nullable, backfills every existing row from an inline pool of English adjectives and nautical
nouns keyed on `hashtext(id)`, then sets `NOT NULL`. That backfill exists to name rows that predate
the feature. **No such row has ever existed.** Its own comment concedes the inline pool is a subset
of the real generator's and "is allowed to drift from it", which is a documented trap: the next
reader has to work out that this pool is not the pool, and that neither of them matters.

**There is a full round trip in the history.** `1756000100000-InitialCoreSchema` creates
`uq_membership_zone_username`; `1756000710000-DropZoneUsernameUniqueness` drops it and replaces it
with a plain index. The constraint existed for the length of a history nobody ran. Same shape for
`FormalizeLineItemRef`, `AccountDeletion` and `CountIndexes`: all of them edit a baseline that no
database has ever held. `CountIndexes` alone creates four indexes and drops three that
`InitialCoreSchema` and `ListsAndLines` had just created.

**The schema is not readable in one place.** To know what `zone_memberships` looks like today you
read seven files and apply them in your head. After this, you read one.

**And this is the last free moment.** Once `enabled: true` and a production database holds rows in
its `migrations` table, squashing costs a fake apply on every existing database, forever. The
window is open now and closes at the first deploy.

## 2. What is not changing

The **append only rule stays in force** (plan 0002, section on the deploy Job). This is not a
licence to edit migrations from now on; it is a one time reset of the baseline, taken while the
baseline is still free. Every migration after this one is append only against the new initial
migrations, exactly as before.

`synchronize` remains `false` everywhere and is not reintroduced. Nothing about how migrations are
applied changes: same CLI target, same data source, same Helm hook.

**Catalog is not touched.** It has exactly one migration, `1756000500000-InitialCatalogSchema`.
There is nothing to squash, and renaming or retimestamping it would be churn for symmetry's sake.

**Realtime and gateway have no migrations** and are out of scope.

## 3. The resulting schema, service by service

The squashed migrations must produce a schema **byte for byte identical** to what the twelve
produce today. Section 6 makes that a mechanical check rather than a claim.

### 3.1 auth: 4 into 1

New `1756000000000-InitialAuthSchema`, keeping the earliest timestamp so ordering against any
future migration is unchanged.

Absorbs `GlobalUsername1756000700000`, `PasswordResets1756000800000` and
`OAuthStates1756000900000`. Result:

- `pgcrypto`; types `user_kind`, `auth_provider`.
- **users** with `username varchar NOT NULL` **created that way**, not added and backfilled. The
  backfill and its inline word pool are deleted outright. `uq_users_email` (partial, `WHERE email
  IS NOT NULL`) and `ix_users_username`, still deliberately non unique.
- **credentials**, **oauth_identities**, **email_verifications**, **refresh_tokens** unchanged from
  the current initial migration, including `ix_refresh_tokens_user`.
- **password_resets** and **oauth_states** as their own tables, with `ix_password_resets_user` and
  `ix_oauth_states_user`. `oauth_states.userId` stays nullable, which is the one thing that
  distinguishes it from the other two grant tables and the reason it is a table of its own.

The three merged files carry real reasoning in their doc comments about why each grant gets its own
table rather than a `purpose` column on `email_verifications`. **That reasoning moves into the
merged file's comment**; it is not lost with the file.

### 3.2 core: 7 into 1

New `1756000100000-InitialCoreSchema`, earliest timestamp again. Absorbs `ListsAndLines`,
`MergeRequests`, `FormalizeLineItemRef`, `AccountDeletion`, `CountIndexes` and
`DropZoneUsernameUniqueness`.

The only places the merge is more than concatenation:

- **`zones`** is created with `markedForDeletionAt` already present, plus its partial index
  `ix_zones_marked_for_deletion`.
- **`zone_memberships`** is created **without** `uq_membership_zone_username`. The constraint and
  its later removal both disappear. What remains is `uq_membership_zone_user` on
  `("zoneId", "userId")`, plus `ix_membership_zone_username`.
- **The three superseded indexes are never created.** `ix_membership_user`, `ix_lines_list` and
  `ix_lists_zone` were each a strict prefix of an index `CountIndexes` added, and each was dropped
  in the same migration that added its replacement. Only the survivors get created:
  `ix_memberships_zone_status`, `ix_memberships_user_status`,
  `ix_memberships_zone_pending_created` (partial, `WHERE status = 'PENDING'`),
  `ix_lines_list_status`, `ix_lists_zone_updated`.
- **`list_lines.itemId`** is created with its `COMMENT ON COLUMN` and `ix_lines_item` already in
  place, rather than added bare in one migration and formalized in another. The comment explaining
  that this is a cross service reference validated in application code and never a foreign key is
  preserved verbatim: it is the single most load bearing sentence in the core schema.

Tables in the result: `zones`, `zone_memberships`, `shopping_lists`, `list_access`, `list_lines`,
`line_comments`, `merge_requests`, `processed_events`. Types: `zone_status`, `zone_role`,
`membership_status`, `list_role`, `line_approval_status`, `line_status`, `merge_request_status`.

### 3.3 `down()` stays honest

Each squashed `down()` drops exactly what its `up()` created, in reverse dependency order. It is
now a true teardown to nothing rather than a step back to an intermediate state, which is the
correct meaning for a migration that is a baseline.

One deliberate loss: `DropZoneUsernameUniqueness.down()` carried a note that reverting would fail
if duplicate usernames existed by then, and that this was correct rather than something to paper
over. That warning has nowhere to live once the constraint is never created, and it does not need
one.

## 4. Blast radius

Checked before writing this plan, all of it negative, which is what makes the change cheap:

- **No code references a migration class name.** Grep across `apps`, `libs`, `k8s` and `tools` for
  `InitialCoreSchema`, `GlobalUsername`, `CountIndexes`, `FormalizeLineItemRef` and
  `DropZoneUsername` returns only the migration files themselves.
- **The integration specs assert the schema, not the history.** `migrations.integration.spec.ts` in
  each service checks that the expected tables exist and that entities round trip. It never reads
  the `migrations` table. They pass unchanged, and they are the check that this squash was faithful.
- **`migration:run` and the Helm hook are history agnostic.** They apply whatever is in the
  directory.
- **Plan documents do cite migration filenames**: `0017` section 4.3, `0018` sections 8.1 and 8.2,
  and `backlog/0001`. Those stay as they are. **Plans are a historical record of decisions, not a
  live index of files**, and rewriting them to match a later refactor would falsify that record.
  The pointer goes the other way instead: each squashed migration's doc comment names the plans it
  absorbed, so a reader who arrives from plan 0018 finds where its migration went.

## 5. Resetting the local Docker databases

The local stack is currently **wrong in a way that is worth recording**, because it is the concrete
version of the problem this plan removes. As of writing:

- `luna_core` has all 7 core migrations applied.
- `luna_catalog` has its 1.
- `luna_auth` has **2 of 4**: `InitialAuthSchema` and `GlobalUsername`, but neither
  `PasswordResets` nor `OAuthStates`. The local auth database predates plans 0022 and 0023.

So the reset is not bookkeeping. The local auth schema is genuinely missing two tables.

After the squash the recorded migration names no longer match anything in the directory, so all
three databases have to be rebuilt from empty.

**The reset is scoped to the three application databases, not the whole stack.** The obvious
command, `nx run luna-shopper-backend:stack:down`, is `compose down -v --remove-orphans`, and the
`-v` takes **every** volume with it, including Grafana and Prometheus. The observability stack has
hours of history in it and the stack script itself argues, in its own `-p` notes, that losing that
to a teardown of something else "is not a tradeoff anybody chose". Dropping and recreating the
`public` schema in each of the three databases achieves the same reset and leaves NATS, Mailpit,
Grafana and Prometheus untouched.

For each of `luna_auth`, `luna_core`, `luna_catalog`, against the running container:

```sh
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

then `nx run luna-shopper-backend-<svc>:migration:run` for `auth`, `core` and `catalog`.

This drops the `migrations` table along with everything else, so each service records exactly one
row afterwards. The full `stack:down` + `stack:up` remains available and produces the same database
state; it just costs the observability history as well.

Anyone else with a checkout does the same thing, or runs `stack:down` and `stack:up` and does not
care about Grafana.

## 6. How this is verified

The claim to prove is narrow and mechanical: **the squashed migrations produce the same schema the
twelve produce.** It is not proved by reading the diff, because the whole point is that the diff is
large and rearranged.

1. Apply the **twelve original** migrations to three scratch databases and capture
   `pg_dump --schema-only` for each. This is the reference. It is built fresh rather than dumped
   from the running stack, because the running auth database is two migrations behind and would
   make a false reference.
2. Apply the **squashed** migrations to three more scratch databases and dump those.
3. **Diff the pairs.** Anything other than an empty diff is a defect in the squash and gets fixed
   until the diff is empty. `pg_dump --schema-only` includes the `migrations` table's definition
   but not its rows, so the expected difference from the history itself is nil.
4. Reset the real local databases per section 5.
5. Run the integration suites against the reset stack (`LUNA_INTEGRATION=1`), which is the
   independent check that entities and schema still agree.
6. `nx affected -t lint test` for the three services.

Step 3 is the one that matters. Steps 5 and 6 catch the case where the reference itself was wrong.

## 7. Order of work

1. Build the reference dumps from the current twelve migrations (verification step 1), before
   deleting anything.
2. Write the two squashed migrations; delete the ten superseded files.
3. Dump, diff, fix until empty.
4. Reset the local databases and re-run migrations.
5. Integration suites, then lint and test.

Steps 1 through 3 are reversible and touch nothing outside the two new files. Step 4 destroys local
data, which on this stack is throwaway seed data and nothing else.
