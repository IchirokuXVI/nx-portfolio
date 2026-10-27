# 0232: a deleted account takes the person and leaves what others use

> Deleting an account removes the `users` row in auth, and the cascade there is complete.
> Everything outside auth is a different story. Core deletes the person's baskets and retires
> their memberships, and stops. Their shopping profiles with street addresses and postal codes,
> their voice recordings, their rows on other people's baskets, their name in the audit trails,
> and every user id on their lines, comments and purchases all stay. Catalog, which holds the
> shop walks they recorded, never hears about the deletion at all. And the event that carries
> it is delivered at most once, so a deletion that meets a restarting core is half a deletion
> forever. This plan closes each gap with the owner's rule: delete what is personal, keep what
> is useful to others without the link to the person.
>
> Prerequisite reading: `0011` (the deletion saga), `0075` (the audit trails), `0008` (the per
> zone merge, the closest thing to this rewrite), `0045` (voice comments), `0047` section 3.1
> (a settlement belongs to the household), and in the code `core/src/app/account/` and
> `realtime/src/app/consumer/jetstream.consumer.ts`.

## Brief for the agent

### Objective

Make an account deletion remove every personal row it misses today, replace the user id on
every row it keeps with an id that leads nowhere, scrub the person out of the auth and core
audit trails, deliver `user.deleted` reliably to core and to a new consumer in catalog, and
prove each table on real Postgres.

### Context

Every statement below was read on `dev` on 2026-10-27.

- Auth deletes the user row in one statement (`auth/src/app/identity/identity.service.ts:1132`
  to `:1138`). Every child table cascades (`auth/src/app/db/migrations/1756000000000-InitialAuthSchema.ts:83`,
  `:98`, `:114`, `:130`, `:150`, `:173`; `1772700000000-ImpersonationSessions.ts:35`, `:55`).
- The operator path audits the delete with a snapshot of the whole user row
  (`identity.service.ts:1120`, `auth/src/app/audit/auth-audit.service.ts:253` to `:270`, which
  excludes only ids, timestamps and hashes at `:37` to `:45`). **The deletion itself writes the
  person's email, display name and username into a row nothing ever prunes.** Operator renames
  and edits do the same (`identity.service.ts:1223`, `:1266`, `:1295`), as do impersonation
  sessions with their free text `reasonNote` (`auth/src/app/impersonation/impersonation.service.ts:138`,
  `:155`, `:260`).
- `user.deleted` is a fire and forget `ClientProxy.emit` on plain NATS
  (`auth/src/app/events/identity-events.publisher.ts:54` to `:56`), sent after the delete
  commits (`identity.service.ts:1085` to `:1087`, `:1125` to `:1127`). Core consumes it with
  `@EventPattern` on plain NATS in a queue group (`core/src/app/account/reconciliation.controller.ts:27`
  to `:30`, `core/src/main.ts:29` to `:43`). No outbox, no stream: if no core replica is
  connected, the event is gone.
- Core's handler records the idempotency key before the work, outside any transaction
  (`core/src/app/account/account-deletion.service.ts:43` to `:47`,
  `core/src/app/events/idempotency.store.ts:20` to `:30`). A failure halfway leaves the key, so
  a redelivery skips the rest. The key is `user.deleted:<userId>`, kept forever.
- `apply` (`account-deletion.service.ts:49` to `:96`) deletes the person's baskets
  (`basket.service.ts:821` to `:828`, which cascades their participants, links, sources, skips
  and trip rows), marks owned zones for deletion, and per membership sets an anonymized username
  and `KICKED` while keeping `userId` (`:81` to `:83`). Nothing else.
- No other service consumes `user.deleted`. Catalog's `shop_walks` and `shop_walk_entries` carry
  `createdByUserId` of an ordinary account (`catalog/src/app/entities/shop-walk.entity.ts:64`,
  `:117`; `gateway/src/app/catalog/shop-walks.controller.ts:48`, `:90` to `:101`). Harvester user
  columns hold admin ids only (`gateway/src/app/harvest/harvest.controller.ts:122` to `:124`).
  Realtime keeps only Redis keys with TTLs (`realtime/src/app/presence/presence.service.ts:20`
  to `:29`). The assistant stores nothing (`assistant/src/app/app.module.ts:32`).
- `item_prices` has no user column, and nothing writes `USER_RECEIPT` or `USER_REPORTED` today
  (`libs/luna-shopper/contracts/src/lib/enums/catalog.enums.ts:100` to `:107`). There are no
  user submitted prices to unlink yet.
- The per zone merge already rewrites a user id across core's zone tables
  (`core/src/app/merge/merge.service.ts:115` to `:185`): `shopping_lists.createdByUserId`, the
  three user columns of `list_lines`, `line_comments.authorUserId`, `list_access`. It is the
  model for section 3.
- A voice recording is a `bytea` in core (`core/src/app/entities/comment-audio.entity.ts:41`,
  `:60`), keyed by comment. The audio read already answers 404 when the row is gone
  (`core/src/app/lists/comment.service.ts:220` to `:228`).
- Realtime's JetStream consumer creates or updates its stream and durable consumer at boot
  (`realtime/src/app/consumer/jetstream.consumer.ts:125` to `:141`). It is the model for
  section 5.

### Target state

- After a deletion, no row in any database holds the deleted user id, their email, display
  name, username, address text, postal code, user agent, or voice recording, except the
  `account_deletions` outbox row of section 5 for the seconds before it is published.
- Every row that other people still use stays, and still renders: a comment says "former
  member", a purchase still counts in the household's history, a shop walk still draws its map.
- A deletion that meets a stopped core or catalog completes when they return.
- Accounts deleted before this plan, whose core and catalog rows were left behind, are cleaned
  by a release task.

### Scope

- Work in: `auth/src/app` (audit, identity, events, a new outbox entity and migration),
  `core/src/app` (account, audit, events, a migration), `catalog/src/app` (a new `account/`
  folder and its module wiring), `libs/luna-shopper/contracts` (the deletion stream names, one
  reconciliation pattern), `k8s/release-tasks/tasks/` (one new task), and this plan file.
- Do NOT touch: harvester, realtime, assistant, gateway routes, velista, the back office, the
  chart (no new env is needed), `package.json`.

### Constraints

- No new dependency. `nats` (`package.json:61`) already provides JetStream.
- Rows that a person or a harvest wrote are deleted by the running service only for the person
  being deleted. The backfill of section 7 is a release task, by the repository's rule for
  deleting rows people wrote.
- Each service's work for one deletion is one database transaction, and its realtime events go
  out after the commit.
- Prettier on each changed file, never on a directory, with `--end-of-line auto`.

### Acceptance criteria

- [ ] Every row of the table in section 2 behaves as its decision says, proved by an
      integration spec on real Postgres per service (section 8).
- [ ] A `user.deleted` published while core and catalog are stopped is processed when they
      start, and a handler that throws halfway leaves nothing changed and is redelivered.
- [ ] The operator delete writes an audit row that holds no email, display name or username.
- [ ] The release task passes `node k8s/release-tasks/check-tasks.mjs`.
- [ ] `nx affected -t lint test build` and the `test-integration` targets of auth, core and
      catalog pass.

### Action boundaries

- Proceed with in-scope edits, migrations, specs and integration specs on an ephemeral slot.
- Stop and ask before deleting any row of a table section 2 marks keep, before changing a
  NOT NULL column to nullable, and before running the release task anywhere.

### Progress evidence

Report after each service's integration spec passes and after the stopped consumer test.
Ground each claim in a command's output.

## 1. The rule, and the id that leads nowhere

The owner's rule: delete everything personal, keep what is useful to others without
identifying the person, and remove the link to the user unless the law requires deletion.

Removing the link means the kept row must not carry the deleted user id. Most of those columns
are NOT NULL and are read by code that joins on them, so setting them to null would touch every
reader. Instead each kept row gets a **tombstone id**: a fresh random uuid generated during the
deletion, written into the user columns of the kept rows, and stored nowhere else. It joins
nothing in auth, because auth never had it, and it is not derived from the user id, so nobody
holding the old id can find the rows.

One tombstone **per zone** in core, and one per deletion in catalog. Within a zone, the
person's comments, lines and membership keep pointing at one another, so the zone keeps
saying "former member" for all of them exactly as it does today for a `KICKED` membership.
Across zones and services nothing links them. The unique key `uq_membership_zone_user`
(`core/src/app/entities/zone-membership.entity.ts:19`) holds, because each zone gets its own.

Columns that are already nullable and whose rows mean nothing without a person (who settled, who
invited) are set to null instead.

## 2. Every table, and what happens to it

### Auth

| Table | Personal | Decision |
|---|---|---|
| `users`, `credentials`, `refresh_tokens`, `oauth_identities`, `email_verifications`, `password_resets`, `oauth_states`, `impersonation_sessions`, `terms_acceptances` (plan `0231`) | yes | Deleted by the existing cascade. No change. |
| `auth_audit` | yes, in `before` and `after` | Scrubbed, section 4 |
| `admin_login_failures` | an operator's typed username and IP, not linked to accounts | Untouched here. Plan `0233` gives it 90 days. |

### Core

| Table | Personal | Decision |
|---|---|---|
| `shopping_profiles` and, by cascade, `profile_postal_codes`, `profile_supermarket_preferences`, `profile_location_preferences`, `profile_generation_sources` | `name`, `addressText`, postal codes and their labels | **Delete** |
| `user_app_state` | setup and tour times | **Delete** |
| `comment_audio` of the person's comments | the voice | **Delete**, and null the three audio columns of the comment (`audioContentType`, `audioByteLength`, `audioDurationSeconds`, `core/src/app/entities/line-comment.entity.ts:46` to `:62`) so it reads as a comment with no recording. `transcription` stays: it is the transcript's state, and the owner keeps transcripts. The builder checks how velista draws a comment whose transcription state says voice but which has no audio, and names any gap in the PR. |
| `line_comments` | `authorUserId` | **Keep**, `authorUserId` to the zone's tombstone. The body and any transcript stay: they are part of the list's conversation. |
| `list_lines` | `createdByUserId`, `approvedByUserId`, `deletedByUserId` | **Keep**, the three to the tombstone |
| `list_line_changes` | `actorUserId` | **Keep**, to the tombstone |
| `shopping_lists` | `createdByUserId` | **Keep**, to the tombstone |
| `zone_memberships` | `userId`, `username`, `approvedByUserId` | **Keep**, as today (anonymized username, `KICKED`), plus `userId` to the tombstone. `approvedByUserId` on other people's memberships pointing at this person: to the tombstone of that zone. |
| `merge_requests` | `sourceUserId`, `targetUserId`, `requestedByUserId`, `resolvedByUserId` | **Keep**, each to the tombstone of the request's zone |
| `baskets` of the person, with their participants, share links, sources, skips, trip rows | yes | **Delete**, as today |
| `basket_participants` on other people's baskets | `userId`, `displayName`, `username`, `userAgent`, `sessionSecretHash` | **Keep the row**, because settlements, skips and trip rows of somebody else's basket point at it. `userId`, `userAgent` and `sessionSecretHash` to null, `username` and `displayName` to the zone's anonymized name. |
| `basket_participants.invitedByUserId` pointing at the person | a link | To null |
| `line_settlements` | `settledByUserId` (nullable) | **Keep**, to null. The purchase is the household's (plan `0047` section 3.1). This also empties the person's recent shops, which are read from it. |
| `zones` owned by the person | `ownerUserId` | As today: null, marked for deletion, reaped later |
| `core_audit` | yes, in `before` and `after` | Scrubbed, section 4 |
| `processed_events` | the key `user.deleted:<userId>` | The key becomes `user.deleted:<sha256 of the id>`, section 5 |

### Catalog

| Table | Personal | Decision |
|---|---|---|
| `shop_walks` | `createdByUserId`; `name` and the `document` notes describe a shop | **Keep**, `createdByUserId` to the deletion's tombstone |
| `shop_walk_entries` | `createdByUserId`; `events` hold steps, headings and marks about a shop | **Keep**, to the same tombstone |
| `item_prices`, `catalog_audit` | no user column, admin and service actors only | No change. When a user submitted price exists (`USER_RECEIPT`, `USER_REPORTED`), the plan that writes it adds it to this consumer. |

### Elsewhere

Harvester holds admin ids only, realtime only expiring Redis keys, the assistant nothing, the
gateway nothing. No consumer is added there. The builder checks again, with
`grep -rn "UserId\b" apps/luna-shopper-backend/*/src/app/entities`, that no table was added
since 2026-10-27, and adds any new one to this table before building.

## 3. Core: one transaction per deletion

`AccountDeletionService.apply` becomes one transaction, in this order:

1. Delete the person's baskets (as today).
2. For each membership of the person, generate the zone's tombstone `t`, then in that zone:
   rewrite the columns of section 2 from the user id to `t`, the same statements as
   `merge.service.ts:115` to `:185` scoped by zone, plus `list_line_changes.actorUserId`,
   `zone_memberships.approvedByUserId` and the four `merge_requests` columns; scrub the
   person's `basket_participants` rows on baskets of that zone; then the membership itself
   (anonymized username, `KICKED`, `userId = t`) and the owned zone fallback, as today.
3. Outside any zone: delete `comment_audio` of every comment the person wrote (before step 2
   rewrote the author, so select those comment ids first), null their audio columns, null
   `line_settlements.settledByUserId` and `basket_participants.invitedByUserId`, delete
   `shopping_profiles` and `user_app_state`.
4. Scrub `core_audit` (section 4).
5. Insert the idempotency key (section 5).

Then, after the commit, emit the events the loop emits today (`MemberKicked`, coverage moved,
zone counts), from a list the transaction collected. An event for a write that rolled back is
the defect this order prevents.

A comment written outside any membership the person still holds (they left the zone before
deleting the account) is caught by step 2 only if the membership row still exists. A `LEFT`
membership row does exist; the builder confirms that leaving keeps the row and, if some path
deletes it, rewrites that zone's rows by `zoneId` of the line instead.

## 4. The audit trails

Two halves: stop writing the person into the trail at deletion, and scrub what is already there.

**Writing.** `recordDelete(User, …)` in `deleteAccountAsOperator` records only `kind`, `roles`
and `createdAt` in `before`. That still answers the question 0077 asked of the trail, what kind
of account was lost and who removed it, with nothing that identifies the person.

**Scrubbing**, in the same transaction as the deletion in each service:

- Auth, `AuthAuditService.scrubUser(manager, userId)`: for every row whose `entityId` is the
  user id or whose `before` or `after` holds the user id as a value, set `email`,
  `displayName`, `username`, `reasonNote` and `userAgent` keys to null in both columns, replace
  the user id wherever it is a value with a tombstone generated for the deletion, and set
  `entityId` to the same tombstone. In the user facing path this runs inside the delete's
  transaction, which becomes a transaction for the first time (today it is a bare statement on
  `dataSource.manager`, `identity.service.ts:1082`).
- Core, `CoreAuditService.scrubUser(manager, userId, tombstoneOfZone)`: the same, with the
  zone's tombstone for rows that name a zone, and `username` keys set to the anonymized name
  the membership got.
- Catalog: nothing, its trail holds no end user data.

The scrub is written in SQL with `jsonb` functions, one `UPDATE` per key set, and the builder
writes it against real rows in the integration spec, because `jsonb` path updates are the kind
of statement only Postgres can prove.

## 5. Delivery that survives a restart

**Auth, an outbox.** The delete inserts `account_deletions (userId uuid pk, deletedAt)` in the
same transaction. A publisher in `auth/src/app/events/` publishes each row with a JetStream
publish that waits for the stream's ack, then deletes the row. It runs at once after the commit
and on a 30 second timer for anything left over. The row holds the user id for as long as it
takes to hand the event to the stream, which is the only purpose it has.

**The stream.** `LUNA_ACCOUNT_DELETIONS`, subject `user.deleted` only, file storage, `max_age`
30 days. Names in `libs/luna-shopper/contracts/src/lib/events/identity.events.ts`. Auth ensures
it at boot, the way realtime ensures its own (`jetstream.consumer.ts:125` to `:141`), because
auth is the one that must never publish into nothing.

**The consumers.** Core and catalog each own a durable consumer, `core-account-deletion` and
`catalog-account-deletion`, explicit ack, `ack_wait` 60 seconds, unlimited deliveries with a
backoff. Each acks after its transaction commits and naks on a throw. Core's `@EventPattern`
handler at `reconciliation.controller.ts:27` is removed, so a deletion is processed once.

**Idempotency.** Core keeps `runOnce`, but the key is inserted inside the transaction (step 5
of section 3), so a rollback rolls the key back and the redelivery does the whole thing. The key
is the sha256 of the user id, so `processed_events` no longer holds ids. Catalog needs no key:
its rewrite finds no rows the second time.

The comment at `libs/luna-shopper/platform/src/lib/idempotency/idempotency.ts:4` says JetStream
redelivers; it becomes true for this path, and the builder corrects it for the other paths
where it is not.

## 6. Catalog's consumer

`catalog/src/app/account/account-deletion.service.ts`: one transaction, one tombstone, two
`UPDATE` statements on `shop_walks` and `shop_walk_entries` by `createdByUserId`. Wired in the
catalog app module beside its NATS microservice.

## 7. Accounts deleted before this plan

Core and catalog hold rows of accounts that no longer exist in auth. A release task under
`k8s/release-tasks/tasks/` with the next free number (`0005` at the time of writing), with
`task.env` windows and a `check.sh` that refuses to run when the reconciliation answers more
than a ceiling the builder sets from a staging count:

- A reconciliation subject in auth, `auth.existingUserIds`, takes up to 500 ids and answers the
  ones that exist (the mirror of `RECONCILIATION_PATTERNS.usersWithoutMemberships`).
- The task's `post.sh` runs a one off command in core and in catalog that collects the distinct
  user ids of the tables in section 2, asks auth in batches, and runs the same deletion for
  each id auth does not know.
- Its windows follow k8s plan `0011`: at most 14 days after the commit, production named by its
  release.

## 8. Tests

- **Auth integration**, `account-deletion.integration.spec.ts`: an operator rename then an
  operator delete leaves `auth_audit` rows with no email, display name or username and no user
  id; the outbox row exists after the delete and is gone after a publish against a real NATS of
  the slot.
- **Core integration**, `account-deletion.integration.spec.ts`: seed a person with a profile and
  postal codes, app state, two zones, lines, a typed and a voice comment, a merge request, a
  participant row on somebody else's basket with a settlement, and audit rows; delete; assert
  each row of section 2's core table by name. Then the same deletion with a fault injected after
  step 2, and assert that nothing changed and the key is absent.
- **Catalog integration**: a walk with entries; delete; both rewritten, the map still reads.
- **Redelivery**: with the ephemeral slot running `--services auth,core,catalog`, stop core and
  catalog, delete an account through the gateway, start them, and assert the rows changed. Put
  the commands and their output in the PR body.

Run them as the backend spec notes describe: an ephemeral slot, `LUNA_INTEGRATION=1`, the
service's DB URL on the slot's port, `npx nx run luna-shopper-backend-<svc>:test-integration
--testFile=<path>`, and `--ephemeral --down` afterwards.

## 9. Dependencies

- Plan `0231` adds `terms_acceptances` with a cascade; nothing here is needed for it, and this
  plan works whether or not it is built.
- Plan `0233` sweeps the audit trails after 180 days. It does not replace section 4: a deleted
  person's name must leave the trail at deletion, not half a year later.
- Velista needs nothing new: a comment with no audio already draws as typed, a former member
  already has a label.

## 10. Decisions

The owner's: delete profiles, preferences, app state and voice recordings; keep walks,
settlements, comments, transcripts and prices with the link removed; scrub the audit snapshots.

Mine, for the owner to change:

1. **A random tombstone per zone** in place of the user id, rather than null. Nullable
   columns would touch every reader; one id across all zones would keep the person's activity
   linkable across households.
2. **Participant rows on other people's baskets are kept and scrubbed, not deleted**, because
   that basket's settlements and skips point at them.
3. **Transcripts stay** with the comment, as the owner said; only the recording goes.
4. **The operator delete's audit row keeps `kind`, `roles` and `createdAt`.**
5. **An outbox and a JetStream stream** rather than a periodic reconciliation, plus a release
   task for what earlier deletions left behind.
6. **The idempotency key is a hash of the id.**
7. **`admin_login_failures` is left to plan `0233`**: it names what somebody typed at the
   operator login, which is not an account.
