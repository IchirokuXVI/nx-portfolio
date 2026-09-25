> **PR:** [#429](https://github.com/IchirokuXVI/nx-portfolio/pull/429)

# 0140: a link that lasts twelve hours

> Client half: `apps/velista/plans/0094`. Series record: `0130`, sections 3, 5 and 11
> (decision 6) above all.
>
> A basket link is a standing key today. It is minted with a cap of thirty days, a person who
> opens it while signed in is attached to the basket for as long as the basket exists, and a
> guest's session has no end at all: nothing but a revoke stops it. That was defensible when
> "a basket lives about as long as a shopping trip" (the comment on the link entity). The
> series gives every person a basket that never ends and that covers every list they write,
> so a link to it is a link to a household's whole shopping, for ever.
>
> The product owner's rule: **a link is valid for twelve hours and never binds to an
> account. Keeping access means being added by name.** This plan builds that, and it has to
> answer the four things the audit found the rule runs into. Nothing on the hot path reads a
> link, so an expiry on the link evicts nobody. A connected socket outlives its token, and no
> timer sweeps rooms. An expired link still holds the one live link slot, so sharing again
> hands back a dead link. And every attribution in core is a participant, so "never binds"
> cannot mean "writes no row".
>
> Prerequisite reading: `0130` in full, `0051` sections 3, 4 and 11 (links, participants, the
> hot path, the open question on expiry), `0114` sections 3 to 7 (named people, endings, the
> rejoin table), `0133` (kinds and the `OPEN` status), `0136` (the participant surface),
> `core/src/app/generated-lists/generated-list-sharing.service.ts` and
> `generated-list-members.service.ts` in full, `realtime/src/app/consumer/sweeps.ts`, and the
> memory note "A 401 about a resource signs out".

## Brief for the agent

### Objective

Make every share link expire twelve hours after it was created, give every link visitor an
access that ends twelve hours after their own join, make every liveness check read that
expiry from one definition, evict expired participants with a sweep, let the owner keep a
link visitor by adding them by name, and regenerate the OpenAPI document and the wire types.

### Context

Verified in the worktree on 2026-09-19, all in
`core/src/app/generated-lists/generated-list-sharing.service.ts` unless another file is
named:

- `ensureLink` (line 103) returns `liveLink` when there is one and mints otherwise, with
  `expiresAt` from `resolveExpiry` (line 987): the request's value capped at
  `GENERATED_LIST_SHARING_LIMITS.defaultLinkTtlDays`, 30
  (`libs/luna-shopper/contracts/src/lib/messages/generated-list-sharing.messages.ts:254`).
- `liveLink` (line 956) is `revokedAt IS NULL` and **ignores `expiresAt`**, as does the
  partial unique index `uq_generated_list_share_links_live`. `linkAccepts` (line 965) reads
  the expiry, and only `preview` (337) and `join` (371) call it. So an expired link that
  nobody revoked is refused by `join` and handed back by `ensureLink` and `getLink`.
- A participant is live when `revokedAt IS NULL`, and that predicate is written out in:
  `linkView` (1009), `preview` (355), `join`'s `rejoin` (511), `isParticipantLive` (625),
  `livePresenceEntry` (649), `liveParticipantById` (679), `findLiveParticipant` (two
  lookups, 689 and 703), `listParticipants` (849), the cascade in `revokeLink` (191),
  `GeneratedListMembersService.checkRoom` (`generated-list-members.service.ts:157`),
  `liveRegistered` (`:247`), `invite` (`:193`), `SHARED_BASKETS_SQL`
  (`generated-list-members.sql.ts:65`), and the partial index
  `ix_generated_list_participants_user_live`.
- `resolveParticipant` (591) is the hot path: one indexed lookup, no cache, and it never
  reads the link. Plan `0051` section 3.3.
- `join` attaches a signed in caller as `REGISTERED` with no session secret (397 to 409),
  and `uq_generated_list_participants_user` makes that one row per person per basket.
  `rejoin` (505) is plan `0114` section 7's table: live, `LEFT`, or refused.
- `GeneratedListMembersService.invite` (`generated-list-members.service.ts:179`) already
  promotes a live row that joined by link: it clears `shareLinkId` and sets `invitedAt` and
  `invitedByUserId`.
- `announceEnded` (`:289`) emits `generatedList.participantLeft` to the basket room, and
  `realtime/src/app/consumer/sweeps.ts:90` turns that event into an evict sweep of both
  basket rooms, where every socket re-asks `checkParticipant`. It also tells a registered
  person's own sessions `generatedList.unshared`.
- `endedReason` is a `varchar` behind `ck_generated_list_participants_ended_reason`
  (`core/src/app/db/migrations/1756002000000-ParticipantInvitesAndEndings.ts:73`), beside
  `ck_generated_list_participants_ended`, which ties it to `revokedAt`.
- `EnsureShareLinkDto` (`gateway/src/app/generated-lists/generated-list-sharing.dto.ts:44`)
  carries one optional field, `expiresAt`.
- `not_a_participant` is `ERROR_CODES.NOT_A_PARTICIPANT`
  (`libs/luna-shopper/platform/src/lib/errors/error-codes.ts:25`), status 401 (`:240`).
- The participant socket token lives fifteen minutes and is verified at connect only.
  Nothing re-checks a connected socket except an evict sweep.

### Target state

Every acceptance criterion in section 13 holds, the predicate of section 3 is the only
definition of a live participant in core, and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper/platform luna-shopper-admin/models`
is green with `openapi.json` and the wire types regenerated.

### Scope

- Work only in:
  - `core/src/app/entities/generated-list-participant.entity.ts` and
    `generated-list-share-link.entity.ts`,
  - `core/src/app/db/migrations/` (one migration and `index.ts`),
  - `core/src/app/generated-lists/generated-list-sharing.service.ts`,
    `generated-list-members.service.ts`, `generated-list-members.sql.ts`,
    `generated-list-sharing.sql.ts`, `generated-list-sharing.mappers.ts`, a new
    `live-participant.ts` beside them, and a new `basket-access-sweep.service.ts` with its
    spec, all under whatever folder plan `0136` left these files in,
  - `core/src/app/config/app-config.ts`,
  - `gateway/src/app/generated-lists/generated-list-sharing.controller.ts` and
    `generated-list-sharing.dto.ts`,
  - `libs/luna-shopper/contracts` (the enum, the views, the request, the limits, schemas),
  - `libs/luna-shopper/platform/src/lib/errors/` (one code, its status, its catalog entry),
  - the generated files.
- Do NOT touch: the realtime service (the sweep it needs exists), the auth service, the
  participant guard's order of credentials, `line_settlements`, anything under `libs/velista`.

### Constraints

- The hot path stays one indexed lookup and still never reads the link. The expiry is
  copied onto the participant row at join, which is what makes that possible.
- One clock. Every comparison with an expiry is the database's `now()`, in the predicate of
  section 3 and in the sweep. No `Date.now()` decides whether somebody is live.
- A revoked, an expired, a finished and a never existing link stay indistinguishable to an
  unauthenticated caller (plan `0051` section 3.1).
- Raw SQL quotes every camelCase column by hand.
- Regenerate `openapi.json` and the wire types, never hand edit them.
- Only make changes this plan names.

### Action boundaries

- Proceed with in scope edits, the migration, specs, the generators.
- Stop and ask if a read of `generated_list_participants` that filters on `revokedAt` exists
  outside the list in the Context. Name it. A predicate left behind is an expired person who
  can still do one thing.
- Stop and ask before changing how the participant guard chooses between the secret header
  and the bearer token.

### Progress evidence

Report after the migration with its spec, after the one predicate replaces every site, after
the link lifetime and `ensureLink`, after the join and the promotion, and after the sweep,
each with the spec run.

## 1. What is being built

| Piece                                                        | Where                                              |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `generated_list_participants.expiresAt`, its constraint, its index | migration, entity                            |
| `generated_list_share_links.expiresAt NOT NULL`              | migration, entity                                  |
| `LIVE_PARTICIPANT` and `liveParticipantWhere()`              | `live-participant.ts`                              |
| the link lifetime, `ensureLink` over an expired link         | `generated-list-sharing.service.ts`                |
| an expiry on every link visitor, the rejoin table            | `join`, `mint`, `rejoin`                           |
| the promotion of a link visitor to a named person            | `GeneratedListMembersService.invite`               |
| `ParticipantEndedReason.EXPIRED`, `BasketAccessSweepService` | contracts, `basket-access-sweep.service.ts`        |
| `participant_expired`                                        | platform errors, `resolveParticipant`              |
| `expiresAt` on the participant view                          | contracts, mappers                                 |

## 2. Two lifetimes, and what "never binds" means

| Config key                | Default | Becomes                          | Decides                                                     |
| ------------------------- | ------- | -------------------------------- | ----------------------------------------------------------- |
| `BASKET_LINK_TTL`         | `12h`   | `core.basket.linkTtlMs`          | how long a link accepts joins, counted from its `createdAt` |
| `BASKET_LINK_SESSION_TTL` | `12h`   | `core.basket.linkSessionTtlMs`   | how long a link visitor's access lasts, from their own join |

They are two numbers because they are two decisions (`0130` section 11, decision 6). A link
opened in its eleventh hour still buys a whole shop, and a link from yesterday opens
nothing. A person reached at the worst moment has access for just under a day from the
moment the owner pressed share, which is the bound.

- `GENERATED_LIST_SHARING_LIMITS.defaultLinkTtlDays` is deleted, with `resolveExpiry`, the
  `expiresAt` field of `EnsureShareLinkRequest`, and `EnsureShareLinkDto` itself: the route
  takes no body. A caller cannot ask for a longer link or a shorter one. The product owner
  decided the number, and a field nobody sets is a field somebody sets to a year.
- **"Never binds to an account" does not mean "writes no row".** Every settle, every skip
  and every change record names a participant (plan `0051` section 3.2), so a signed in
  visitor still gets a `REGISTERED` row, keyed by their user id, and their name is still
  their account's. What changes is that the row **ends by itself**. The account gains
  nothing durable: the basket leaves their shared listing at the expiry, and only the owner
  adding them by name makes it stay.
- A named person and the owner have `expiresAt` null. `0130` section 3.

## 3. One definition of a live participant

`live-participant.ts`:

```ts
/** The SQL of a live participant, over the alias `p`. */
export const LIVE_PARTICIPANT = `
  p."revokedAt" IS NULL AND (p."expiresAt" IS NULL OR p."expiresAt" > now())
`;

/** The same rule as a TypeORM `where`, decided by the database's clock. */
export function liveParticipantWhere(): FindOptionsWhere<GeneratedListParticipant> {
  return {
    revokedAt: IsNull(),
    expiresAt: Raw((alias) => `(${alias} IS NULL OR ${alias} > now())`),
  };
}
```

Every site in the Context spreads `liveParticipantWhere()` where it writes
`revokedAt: IsNull()` today, and `SHARED_BASKETS_SQL` interpolates `LIVE_PARTICIPANT`. The
sites, all of them: `linkView`, `preview`, `isParticipantLive`, `livePresenceEntry`,
`liveParticipantById`, both lookups of `findLiveParticipant`, `listParticipants`, the
cascade in `revokeLink`, `checkRoom`, `liveRegistered`, and the shared listing. A spec
greps the folder for `revokedAt: IsNull()` and fails on any hit outside `live-participant.ts`.

- `Raw` and not `MoreThan(new Date())`, so the application's clock and the database's
  never disagree about the last second of somebody's access, and the sweep of section 7
  reads the same clock.
- `rejoin` and `invite` read `existing.revokedAt` on a row they already hold, to tell a live
  row from an ended one. They also treat `expiresAt <= now` as ended, through one helper
  `hasEnded(row, now)` that takes the transaction's `now()` read once from the database.
- `ix_generated_list_participants_user_live` keeps its predicate. An index cannot read a
  clock, and it still narrows the shared listing to rows that were never revoked.
- **The hot path is unchanged in shape.** `findLiveParticipant` is still one lookup on
  `uq_generated_list_participants_secret` or on `(generatedListId, userId)`, and the expiry
  is a column of the row it finds.

## 4. The link

- `GeneratedListShareLink.expiresAt` is `timestamptz NOT NULL`. `ensureLink` writes
  `createdAt + linkTtlMs`, computed in the insert as
  `now() + ($n::double precision * interval '1 millisecond')` so the two columns come from
  one clock.
- `liveLink` becomes a link that is not revoked **and not expired**, in SQL.
- **`ensureLink` over an expired link mints a new one.** Inside one transaction, under
  `members.lock`, it sets `revokedAt = now()` on any link of the basket that is unrevoked
  and expired, then inserts. The partial unique index cannot read a clock, so freeing the
  slot is a write, and the lock is what keeps two devices pressing share at once from
  racing through it. The unique violation branch stays, for the two that race past the
  read.
- Revoking an expired link this way **never cascades to its people**. They have their own
  expiry, and `revokeLink` with `revokeParticipants` is still the owner's gesture for
  throwing everybody out.
- `getLink` answers no link for an expired one, which is the state the share sheet draws
  "Share" in.
- `GeneratedListShareLinkView.expiresAt` becomes `string`, no longer nullable.
- `preview` and `join` keep `linkAccepts`, now reading the database's clock, and keep
  answering a dead link exactly as they answer a link that never existed.
- **A `LIVE` basket is shared through the same routes.** `loadOwned` finds it, and
  `listAccepts` reads `status = 'OPEN'` since `0133`. Its preview carries `name: null`,
  which leaks nothing, and the client words it (velista `0094`).

## 5. The people a link lets in

`mint` writes `expiresAt = now() + linkSessionTtlMs` for a guest and for a registered
visitor alike. The owner's row and an invited row are written with null.

**The rejoin table** (plan `0114` section 7), extended. "A person" is a signed in caller who
already has a row on the basket and opens a link that still accepts:

| Their row                              | Result                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| live, a named person                   | unchanged. `expiresAt` stays null. A link never turns a named person into a visitor.       |
| live, a link visitor                   | `expiresAt = GREATEST(expiresAt, now() + ttl)`, `shareLinkId` becomes this link            |
| ended with `LEFT`                      | brought back by the link, as today, now with an expiry                                     |
| ended with `EXPIRED`, or past `expiresAt` and not yet swept | brought back, same row, same id, a new expiry. Nobody refused them.   |
| ended with `REMOVED` or `LINK_REVOKED` | refused with `not_a_participant`, as today                                                 |

- The row is the same one because `uq_generated_list_participants_user` allows one per
  person per basket, and that is what keeps their past purchases attributed to one
  participant across visits.
- **A guest whose access expired is a new guest.** A guest has no identity to find a row by,
  so a fresh link mints a fresh row with the next `guestNumber`. Their old secret answers
  `participant_expired` (section 8) and the client forgets it.
- `checkRoom` counts live rows by section 3, so expired visitors stop counting toward
  `maxParticipants` at their expiry and not at the next sweep.

## 6. Keeping somebody: the promotion

`POST :id/participants` (`participant.add`) on a person who is on the basket by link already
promotes them, and gains one line. `invite`'s table:

| The person's row        | Result                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| none                    | a `REGISTERED` row, invited, `expiresAt` null                                                    |
| live, a link visitor    | `invitedAt` and `invitedByUserId` set, `shareLinkId` cleared, **`expiresAt` cleared**, same id   |
| live, a named person    | unchanged                                                                                        |
| ended, any reason       | brought back, invited, `expiresAt` null. The owner adding somebody outranks every ending.        |

- **The contact rule of plan `0114` section 4 applies to a person with no live row, and is
  waived for a live link visitor.** That rule exists so that nobody is put on a basket by a
  stranger who guessed a user id: "every one a contact of the owner's now". A link visitor
  is not that case. The owner handed them the link, they are on the basket already, and
  the redesign says keeping access means being added by name, which a friend outside every
  group of the owner's is otherwise never able to be. So `requireContacts` runs only on the
  first row of the table above and on the last, and the promotion of the second row checks
  nothing but that the row is live and carries a `userId`.
- A guest cannot be kept at all, having no account. Velista `0094` says so in the people
  sheet, and never as an invitation to register.
- The promotion emits nothing new. The room hears `participantJoined` only when a row became
  live, and a promoted row already was. The owner's people read carries the cleared expiry,
  and the promoted person's next `participants/mine` does.

## 7. The sweep, which is what evicts a socket

`BasketAccessSweepService`, shaped like `GeneratedListSweepService`: an `unref`ed interval,
a `running` flag, a batch cap per tick, a `sweep()` a spec calls with no timers.

```sql
UPDATE "generated_list_participants" p
SET "revokedAt" = now(), "endedReason" = 'EXPIRED'
WHERE p.id IN (
  SELECT id FROM "generated_list_participants"
  WHERE "revokedAt" IS NULL AND "expiresAt" IS NOT NULL AND "expiresAt" <= now()
  ORDER BY "expiresAt" LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING p.*
```

For each returned row it calls `members.announceEnded`, after the statement committed. That
one call is the whole eviction: the basket room hears `participantLeft`, realtime sweeps both
rooms of the basket, each socket re-asks `checkParticipant`, and the expired one leaves. A
registered visitor's other sessions hear `generatedList.unshared` and drop the basket from
their shared listing. **Realtime needs no change**, and a connected socket outlives its
access by one sweep interval at most.

A second statement in the same tick sets `revokedAt = now()` on links that are unrevoked
and expired, so the table says what the reads already believe. It announces nothing.

| Config key                        | Default | Becomes                               |
| --------------------------------- | ------- | ------------------------------------- |
| `BASKET_ACCESS_SWEEP_ENABLED`     | `true`  | `core.basket.accessSweep.enabled`     |
| `BASKET_ACCESS_SWEEP_INTERVAL`    | `1m`    | `core.basket.accessSweep.intervalMs`  |
| `BASKET_ACCESS_SWEEP_BATCH`       | `200`   | `core.basket.accessSweep.batchSize`   |

**HTTP never waits for the sweep.** The predicate of section 3 refuses an expired row at the
instant of its expiry. The sweep exists for the two things a predicate cannot do: close a
socket that is already open, and write down why a row ended.

`SKIP LOCKED` lets two core replicas sweep at once without announcing a row twice.

## 8. What an expired person is told

`ParticipantExpiredException`, code `participant_expired`, the same HTTP status
`not_a_participant` has. `resolveParticipant` raises it when its one lookup found nothing
live and a second lookup, made only on that failure, finds the caller's row ended with
`EXPIRED` or past its `expiresAt`. Everybody else keeps `not_a_participant`.

- It is not a leak. The caller presented a credential that **was** valid for this basket,
  so telling them it ran out tells them nothing they did not hold. The preview and the join,
  which take no credential, stay silent as ever.
- It exists so the client can say "your twelve hours are over, ask to be added" instead of
  "you were removed". The memory note "A 401 about a resource signs out" applies: velista
  `0094` treats the code the way it treats `not_a_participant`, and never as a dead session.
- `GeneratedListParticipantView` gains `expiresAt: string | null`, on every projection. It is
  not sensitive, and the people sheet needs it for everybody to offer "keep". It rides on the
  join answer, on `GET :id/participants`, on `GET :id/participants/mine` and on the
  `participantJoined` event. The client shows a warning from it. It treats the value as a
  moment to display and asks the server, by reading again, whether it has passed.

## 9. Migration

`BasketLinkAndAccessExpiry`, the next free timestamp, registered in `index.ts`. One
transaction, as the runner gives it. No enum is involved: `endedReason` is a `varchar`.

**Up**, in this order:

1. `ALTER TABLE "generated_list_participants" ADD COLUMN "expiresAt" timestamptz NULL`.
2. Backfill every row that is neither the owner's nor invited
   (`"kind" <> 'OWNER' AND "invitedAt" IS NULL`): a live row gets
   `now() + interval '12 hours'`, an ended row gets its own `revokedAt`. The literal is
   twelve hours because a migration cannot read configuration, and it says so in a comment.
3. `ck_generated_list_participants_expiry CHECK (("kind" = 'OWNER' OR "invitedAt" IS NOT
   NULL) = ("expiresAt" IS NULL))`: the owner and a named person never expire, and
   everybody else always does.
4. Drop and recreate `ck_generated_list_participants_ended_reason` with `'EXPIRED'` added.
5. `CREATE INDEX "ix_generated_list_participants_expiring" ON "generated_list_participants"
   ("expiresAt") WHERE "revokedAt" IS NULL AND "expiresAt" IS NOT NULL`, for the sweep.
6. `UPDATE "generated_list_share_links" SET "expiresAt" = "createdAt" + interval '12 hours'`
   on every row, then `ALTER COLUMN "expiresAt" SET NOT NULL`, then
   `ck_generated_list_share_links_expiry CHECK ("expiresAt" > "createdAt")`.

**What this does to people who are on a basket today.** Every link older than twelve hours
stops accepting joins at the deploy, which is nearly all of them. Every guest and every
registered visitor keeps working for twelve more hours and is then swept. **The owner is told
nothing, because nothing in the product can tell them**: there is no notification surface,
and the share sheet shows "Share" again. Nobody's intent can be recovered from the
rows, since a visitor the owner meant to keep and one they forgot look identical, so the
migration keeps nobody. The release note says it in one sentence, and the owner adds by name
whoever they want back. The grace is there so that a deploy during somebody's shop does not
end it.

**Down.** Drop the two new constraints and the index. Rewrite `endedReason = 'EXPIRED'` to
`'LEFT'`, the one earlier reason that lets the person come back by a link, and recreate the
old constraint. Drop `participants.expiresAt`. `ALTER COLUMN "expiresAt" DROP NOT NULL` on
links. Lossy in two ways, and stated: the thirty day expiries are not restored, and every
visitor becomes permanent again.

## 10. What this reverses

- **Plan `0051` section 11** left link expiry as a leaning, "implemented rather than
  settled", and the code says why it leaned: "an unauthenticated read of somebody's shopping
  habits should not outlive the trip." That sentence becomes a rule with a number, and it
  now covers the visitor's session as well as the link, which the leaning never did.
- **Plan `0051` section 3.4**: "stop it spreading, do not throw out the people in the shop."
  Still true of a revoke, which evicts nobody without the cascade. No longer true of time:
  the people in the shop are out twelve hours after they came in, unless the owner keeps
  them.
- **Plan `0114` section 7**: a person who `LEFT` "is brought back by the link". Still true,
  with an expiry, and `EXPIRED` joins `LEFT` as a reason the link can undo.
- **`defaultLinkTtlDays: 30`**, "long enough for a weekly shop to be planned ahead, short of
  a standing key". Planning ahead is what a named person is for.
- **Velista `0086` section 1 and `0064` section 3**: a signed in opener "joins as
  `REGISTERED`". They still do. They no longer stay.

## 11. Not in this plan

- The share sheet's countdown, the "keep" action, the join page's wording and the expired
  state. Velista `0094`.
- A notification that a link or somebody's access is about to end.
- A way to extend a visitor's access without adding them by name. The owner presses share
  again, and the visitor opens the new link.
- Per list redaction, which `0136` built, and presence, which `0139` restricts.
- Hashing the link secret. A link that is dead in twelve hours weakens the case for it
  further, and the owner still has to be able to copy it again.

## 12. Tests

Unit specs for the rejoin and the promotion tables, row by row, and for
`participant_expired` against `not_a_participant`. Integration specs, real database, for
everything that is a predicate or an upsert:

1. The migration: a live visitor gets twelve hours, an ended one gets its `revokedAt`, the
   owner and an invited row stay null, every link is `createdAt + 12h`, and both new
   constraints hold over the backfilled table. Down restores the old shape.
2. `liveParticipantWhere()` refuses a row one second past its expiry and admits one a second
   before, with the clock moved by writing the column and never by waiting.
3. The grep spec: no `revokedAt: IsNull()` outside `live-participant.ts`.
4. `ensureLink` on a basket whose link expired revokes it and mints another, and two
   concurrent calls end with one live link.
5. `getLink` answers no link for an expired one. `preview` and `join` answer an expired link
   exactly as they answer an unknown secret.
6. A guest and a registered visitor both get `joinedAt + ttl`. The owner opening their own
   link gets null.
7. A registered visitor whose row expired opens a fresh link and gets **the same participant
   id** with a new expiry. One who was `REMOVED` is refused.
8. A live visitor opening a second link never shortens their access. A named person opening
   a link stays a named person.
9. `participant.add` on a live visitor clears the expiry and keeps the id, and a later
   `revokeLink` with the cascade does not reach them.
10. An expired visitor's settle is refused with `participant_expired` before the sweep ran.
11. The sweep ends every expired row once, with `EXPIRED`, emits one `participantLeft` per
    row after the commit, revokes expired links silently, and two sweeps running at once
    announce no row twice.
12. `checkRoom` stops counting an expired visitor at the expiry.
13. The shared listing drops a basket at the visitor's expiry and keeps it for a named
    person.
14. A `LIVE` basket mints a link, previews with a null name, and joins a guest.

## 13. Acceptance criteria

- [ ] A link accepts joins for twelve hours from its creation, and no caller can ask for
      another lifetime.
- [ ] Pressing share on a basket whose link expired gives a working link.
- [ ] A guest and a signed in visitor both lose access twelve hours after they joined, on
      HTTP at that instant and on their socket within a sweep interval.
- [ ] The owner and a named person never expire, and a check constraint says so.
- [ ] The owner adding a link visitor by name keeps them, under the same participant id.
- [ ] A visitor who comes back by a fresh link is the same participant, unless the owner
      removed them.
- [ ] One definition of a live participant, read by every site, decided by the database's
      clock.
- [ ] The hot path is one indexed lookup and reads no link.
- [ ] An expired person is told so, and an unauthenticated caller learns nothing about why a
      link is dead.
- [ ] A `LIVE` basket can be shared.
- [ ] `openapi.json` and the wire types are current.

## 14. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper/contracts luna-shopper/platform
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
npx nx run luna-shopper-admin/models:test
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run the integration specs through their own target against a slot. On the same slot, set
`BASKET_LINK_SESSION_TTL=2m` and `BASKET_ACCESS_SWEEP_INTERVAL=10s` in core's `.env`, restart
core with `--restart --services core`, join a basket as a guest in a second browser, and
watch the socket close on its own a little after two minutes. Put the two keys back, and
give the slot back.
