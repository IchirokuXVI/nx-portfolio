> **PR:** [#369](https://github.com/IchirokuXVI/nx-portfolio/pull/369)

# 0114: a basket shared with people you know

> Client half: `apps/velista/plans/0085`.
>
> A basket is shared today by link only. The owner cannot hand it to the people in their
> groups, and a signed in person who joined through the link never finds it again, because
> the history lists only the baskets you own. This plan adds a contacts read, lets the owner
> choose people when creating a basket and afterwards, lists the baskets shared with you,
> lets a member leave, and makes every loss of access close the live socket.
>
> Prerequisite reading: `0051` (sharing with guests), `0054` (participant names), the
> memory note on guest reachable routes, `generated-list-sharing.service.ts` in full, and
> `realtime/src/app/consumer/sweeps.ts`.

## Brief for the agent

### Objective

Build the contacts route, invited members, the shared baskets read, leaving, the events
and the socket eviction in sections 2 to 10, and fix the four defects in section 11.

### Context

- `generated_list_participants`: `kind` (`OWNER`, `REGISTERED`, `GUEST`), `userId`,
  `shareLinkId` (null for the owner), `username`, `joinedAt`, `revokedAt`, unique on
  `(generatedListId, userId)` where `userId` is not null, **revoked rows included**.
- `join` returns a live row as is, refuses a revoked row with 401, and does not catch a
  unique violation, so two concurrent first joins give one of them a 500.
- `DELETE share-link?revokeParticipants=true` revokes live rows whose `shareLinkId` is the
  live link. `DELETE participants/:participantId` sets `revokedAt`.
- `listMine` reads baskets by `ownerUserId` only.
- A socket in `generated:{id}` is checked for liveness only at connect. Revocation leaves it
  receiving broadcasts until it disconnects. `room-sync.service.ts` can re-check
  participant liveness when a sweep asks.
- `GeneratedListDeleted` goes to the owner only.
- `MembershipView.username` is set per zone. `users.username` in auth is the global name.
  Auth has no pattern that answers usernames for several user ids.
- `toParticipantView` sends `joinedAt` and `lastSeenAt` to every reader, though its comment
  says join time is gated like `userAgent`.
- `sourceNames` and `sourceSnapshot` come from the snapshot, while `seesZoneData` is decided
  from origins.

### Target state

Every acceptance criterion in section 14 holds, integration specs cover sections 3 to 10,
and `openapi.json` and the wire types are regenerated.

### Scope

- Work only in: `core/src/app/generated-lists/`, `core/src/app/zones/` (the contacts query),
  a new core migration, `auth/src/app/` (one read pattern), the gateway's generated lists and
  zones controllers and DTOs, `realtime/src/app/consumer/sweeps.ts` and its spec,
  `libs/luna-shopper/contracts`, `libs/luna-shopper/platform/src/lib/errors/` if a code is
  needed, and the generated files.
- Do NOT touch: guest joining beyond section 7, the settle and line services, the Helm chart.

### Constraints

- The migration is additive and backfills existing revoked rows. Show it before running it.
- Every existing `revokedAt IS NULL` check stays the definition of a live participant.
- Broadcasts carry the least privileged reader's view. Invitee events go to `user:{id}` and
  carry ids only.
- Regenerate `openapi.json` and the wire types, never hand edit them.

### Action boundaries

- Proceed with in-scope edits, unit and integration specs, and generators.
- Stop and ask before running the migration against anything but a throwaway slot, and if
  the contacts answer has no natural bound (section 2).

### Progress evidence

Report after the migration, after each route with its integration spec, after the sweep,
and after the defects, each with its spec run.

## 1. What is being built

| Piece                                              | Where                                                 |
| -------------------------------------------------- | ----------------------------------------------------- |
| `GET /v1/contacts`                                 | gateway zones module, core zones                      |
| `invitedAt`, `invitedByUserId`, `endedReason`      | a migration, `generated-list-participant.entity.ts`   |
| Members on create                                  | `CreateGeneratedListDto`, `generated-list.service.ts` |
| `POST /v1/generated-lists/:id/participants`        | sharing controller and service                        |
| `DELETE /v1/generated-lists/:id/participants/mine` | participant controller, sharing service               |
| `GET /v1/generated-lists/shared`                   | generated lists controller, core service, auth read   |
| Invitee events                                     | `realtime.events.ts`, the sharing service             |
| Socket eviction                                    | `sweeps.ts`                                           |
| Four defects                                       | section 11                                            |

## 2. Contacts

`GET /v1/contacts?cursor&limit` answers the people the caller shares a group with, one
membership per row, a page at a time:

```ts
{
  items: {
    userId: string;
    zoneId: string;
    username: string;
  }
  [];
  nextCursor: string | null;
}
```

- Every membership whose status is `APPROVED`, in every group where the caller's own
  membership is `APPROVED`. The caller is excluded.
- Temporary accounts are included.
- `username` is the membership's name in that group, so a person in two groups is two rows.
- **The answer is neither grouped nor ordered for display.** Nothing in the code caps the
  members of a group or the groups one person joins. So the answer is paged by membership
  with the house cursor, and a page holds a fixed number of rows however large one group is.
  The client groups the rows by `zoneId` with the group names it reads from `GET /v1/zones`,
  and sorts them. This replaced a grouped answer, by the user's decision while the plan was
  built.

## 3. The participant row learns how it began and ended

Migration, additive:

- `invitedAt timestamptz null` and `invitedByUserId uuid null`: set when the owner adds the
  person.
- `endedReason varchar null`, one of `REMOVED`, `LINK_REVOKED`, `LEFT`, set together with
  `revokedAt`. Backfill `REMOVED` on every row that already has `revokedAt`.

A live row with `invitedAt` set and `shareLinkId` null is an **invited member**. A live
registered row with `shareLinkId` set joined **by link**.

## 4. Adding people

**On create.** `CreateGeneratedListDto` gains `memberUserIds?: string[]`, unique, and at most
`maxParticipants - 1` long. Every id must be one of the owner's contacts at that moment,
otherwise `validation_failed` naming the ids. Each becomes a `REGISTERED` row with
`invitedAt` and `invitedByUserId` set, `shareLinkId` null, `joinedAt` now, and the username
from section 9's name rule.

**Afterwards.** `POST /v1/generated-lists/:id/participants`, owner only, body
`{ userId: string }`, same contact check and the participant limit:

| The person's row      | Result                                                             |
| --------------------- | ------------------------------------------------------------------ |
| none                  | inserted as on create                                              |
| live, joined by link  | becomes invited: `shareLinkId` null, `invitedAt` now               |
| live, already invited | unchanged, answered as is                                          |
| ended, any reason     | brought back: `revokedAt` and `endedReason` null, invited as above |

The answer is the participant view. The basket room hears `GeneratedListParticipantJoined`
when a row becomes live.

**Removing** keeps its route. It sets `endedReason = REMOVED`.

## 5. Revoking the link

Unchanged in who it revokes: live rows whose `shareLinkId` is the live link, only when
`revokeParticipants` is true. It sets `endedReason = LINK_REVOKED`. Invited members have no
`shareLinkId` and keep access.

## 6. Leaving

`DELETE /v1/generated-lists/:id/participants/mine`, behind `ParticipantGuard`. A `REGISTERED`
participant only: a guest gets `forbidden`, the owner gets `validation_failed`. It sets
`revokedAt` and `endedReason = LEFT`, and the basket room hears
`GeneratedListParticipantLeft`.

## 7. Joining by link

| The person's row                           | Result                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| live                                       | as today                                                                                                                                          |
| ended with `LEFT`                          | brought back by the link: `revokedAt` and `endedReason` null, `shareLinkId` the live link, `invitedAt` null, `joinedAt` now, subject to the limit |
| ended with `REMOVED` or `LINK_REVOKED`     | refused with 401, as today                                                                                                                        |
| none, and the insert hits the unique index | read the row again and apply this table (section 11)                                                                                              |

## 8. The baskets shared with you

`GET /v1/generated-lists/shared?cursor&limit`, account authenticated. Rows are the
caller's live `REGISTERED` participant rows on baskets whose status is not `ARCHIVED`,
ordered by `sharedAt` descending, then `id`. Each row is the `GeneratedListSummaryView` plus:

```ts
owner: {
  userId: string;
  name: string;
}
sharedAt: string; // invitedAt when set, otherwise joinedAt
```

## 9. The owner's name

The name rule, used for `owner.name` in section 8 and for an invited row's `username` in
section 4:

- When the two people share exactly one approved group, the name is that group's
  membership username.
- Otherwise it is the global username from auth.

Add `auth.getUsernames({ userIds })`, answering `{ userId, username }[]`, and compose in the
gateway, as the join already composes core and auth.

## 10. Events and sockets

- **Invitee's own room.** `GeneratedListShared { generatedListId }` when a row becomes live
  through sections 4 or 7. `GeneratedListUnshared { generatedListId }` when it ends for any
  reason, or when the basket is deleted. Both go to `user:{userId}` and join the JetStream
  subjects.
- **Deleting a basket** also sends `GeneratedListUnshared` to every live participant with a
  user id.
- **Sweeps.** `GeneratedListParticipantLeft` and `GeneratedListDeleted` ask for an evict
  sweep of `generatedListRoom(id)` and `generatedListPresenceRoom(id)`, so every socket whose
  participant is no longer live leaves the room at once. Read how the envelope names the
  basket before writing the rule, and add a spec row for each event.

## 11. Four defects fixed on the way

1. **Join time reaches guests.** `toParticipantView` includes `joinedAt` and `lastSeenAt`
   only for readers who get `userAgent`, as its comment already says.
2. **List names from the snapshot.** `sourceNames` and `sourceSnapshot` keep only lists that
   appear in the basket's origins, so a reader who passes the origins test never sees a list
   they did not pass on.
3. **Concurrent first joins.** The join insert catches a unique violation, reads the row,
   and continues with section 7's table.
4. **A deleted basket tells nobody.** Section 10.

## 12. Errors

| Case                                                 | Code                       |
| ---------------------------------------------------- | -------------------------- |
| Adding a person who is not a contact, or yourself    | `validation_failed`        |
| Adding or removing people on a basket you do not own | `not_found`                |
| Over the participant limit                           | the existing limit refusal |
| A guest leaving                                      | `forbidden`                |
| The owner leaving                                    | `validation_failed`        |
| A removed or link revoked person using the link      | `unauthorized`             |

## 13. Tests

Integration specs, except the sweep table.

1. Contacts lists approved groups and approved members, excludes the caller, includes a
   temporary account, and names people by their group username.
2. Creating with members writes invited rows, and a non contact is refused.
3. Adding a link joined person turns them into an invited member. Revoking the link with the
   cascade then leaves them live.
4. Adding a removed person brings their old row back.
5. A removed person and a link revoked person are refused by the link. A person who left is
   brought back by it.
6. Leaving works for a registered participant and is refused for a guest and the owner.
7. The shared read lists live registered rows, excludes archived baskets, orders by shared
   date, and names the owner by the one common group, or globally.
8. `GeneratedListShared` and `GeneratedListUnshared` reach the invitee's room for every path
   in sections 4 to 7 and for a deleted basket.
9. `sweepsFor` answers an evict sweep of both basket rooms for a left participant and a
   deleted basket.
10. A guest's basket read has no `joinedAt` or `lastSeenAt` for anyone.
11. `sourceNames` omits a snapshot list with no origin in the basket.
12. Two concurrent first joins by one user both succeed with the same row.

## 14. Acceptance criteria

- [ ] An owner shares a basket with chosen people from their groups, at creation and later.
- [ ] A signed in person finds every basket shared with them, with the owner and the date.
- [ ] Revoking the link removes only the people who came through it.
- [ ] A member can leave, and come back through the link.
- [ ] A removed member cannot come back through the link.
- [ ] Losing access closes the live socket at once.
- [ ] The four defects in section 11 are fixed.
- [ ] `openapi.json` and `wire-types.ts` are regenerated and committed.

## 15. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-auth luna-shopper-backend-realtime luna-shopper/contracts luna-shopper-admin/models
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n>
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
```

Run the migration and the integration targets against the ephemeral slot, then `--down <n>`.
