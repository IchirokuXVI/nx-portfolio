# 0139: a list change reaches every basket that covers it

> Client half: `apps/velista/plans/0093`. Series record: `0130`, section 7 above all.
>
> Since plan `0136` a basket stores no lines. It reads the lines of the lists it covers, so
> every write to a list line is a write to every basket that covers the list, and none of
> those baskets hears about it. Today the traffic runs the other way only: a basket settle
> tells the zone room, and "no basket room hears anything" is a comment in
> `line.service.ts` and a rule in plan `0112` section 5. A shopper in a shop sees a line
> their partner added at home when they next touch the screen, and not before.
>
> This plan is the fan out. Core works out which baskets cover the list a write touched,
> and tells each of their rooms one thing: these line ids moved, read again. Realtime has no
> database and routes on the envelope alone (`0130` section 7), so the envelope learns to
> name several baskets. The same plan makes a finish reach the people in the basket room,
> who never heard one, keeps presence off a `LIVE` basket, and deletes the four basket line
> events whose emitters `0136` removed.
>
> Prerequisite reading: `0130` in full, `0133` (kinds, `basket_sources`,
> `BasketCoverageService`), `0136` (the row writes), `0137` (skip), `0030` section 3 (the
> audience on the envelope), `0051` sections 7 and 9 (the basket rooms and the participant
> socket), `0052` section 3.1 (one event per room per write), `0114` section 10 (the evict
> sweep), `realtime/src/app/consumer/jetstream.consumer.ts`, `realtime/src/app/consumer/
> sweeps.ts`, `realtime/src/app/socket/realtime.gateway.ts`, and
> `core/src/app/events/core-events.publisher.ts`.

## Brief for the agent

### Objective

Make every list line write, every basket row write and every skip reach the room of every
basket that covers the line, as one `basket.linesChanged` event addressed through a new
`basketIds` audience on the envelope. Make `basket.updated` reach the basket room. Keep
presence off `LIVE` baskets. Delete the four dead basket line events.

### Context

Verified in the worktree on 2026-09-19:

- `DomainEvent` (`libs/luna-shopper/contracts/src/lib/events/realtime.events.ts:365`) names
  its audience with `zoneId`, `listId`, `userIds` and **one** `generatedListId` (line 395).
  `EventAudience` in `core/src/app/events/core-events.publisher.ts:23` mirrors it, and
  `emitToGeneratedList` (line 86) is the only way a basket room is addressed.
- `roomsFor` (`realtime/src/app/consumer/jetstream.consumer.ts:376`) turns the envelope into
  rooms and never reads a payload. `sweepsFor` (`realtime/src/app/consumer/sweeps.ts:33`)
  reads `generatedListId` for `GeneratedListParticipantLeft` and `GeneratedListDeleted` and
  sweeps both basket rooms.
- The relay publishes once and each pod emits with `server.local.to(message.rooms)`
  (`realtime/src/app/socket/realtime.gateway.ts:119`). socket.io unions the rooms of one
  emit, so a socket in two of them receives the event once. Deduplication is
  `dedupe:event:{eventId}`, one key per envelope.
- A participant socket is joined at connect, with no subscribe message, to
  `generated:{id}` and `generated:{id}:presence`, and enters presence
  (`realtime.gateway.ts:156` to `178`). Core's answer comes from
  `RealtimeAccessController.checkParticipant`
  (`core/src/app/realtime/realtime-access.controller.ts:101`), which reads
  `livePresenceEntry`, and it is never cached (`realtime/src/app/messaging/
  core-access.client.ts:217`).
- The list line events and their emit sites in core:

  | Event            | Site                                                                                              |
  | ---------------- | ------------------------------------------------------------------------------------------------- |
  | `line.added`     | `lists/line.service.ts:710` (`add`), `:880` (`addMany`), both through the private `emit` at `:578` |
  | `line.updated`   | `line.service.ts:1341` (plain edit), `:2169` (`announce`), `:2314` (`applyApproval`), `lists/product-group-sync.service.ts:363` |
  | `line.deleted`   | `line.service.ts:1534` (a merge), `:1898` (`announceListRename`), `:2420` (`applyLineDeletion`)   |
  | `line.settled`   | `lists/settlement.service.ts:218`                                                                 |
  | `line.reordered` | `line.service.ts:2349`                                                                            |

  Four more sites sit in `generated-lists/` (`generated-list-origins.service.ts:581`,
  `generated-list-settle.service.ts:383`, `generated-list-reopen.service.ts:467`,
  `waiting-settlement.service.ts:226`). Plan `0136` deletes those services and replaces them
  with its row writes, which emit the same list events from new files.
- `generatedList.updated` goes to the owner's user room alone
  (`generated-lists/generated-list.service.ts:810`), so a guest never hears a rename or a
  finish. `generatedList.deleted` already names both audiences (`:874`), since plan `0114`.
- The four events `generatedList.lineUpdated`, `lineAdded`, `lineRemoved` and `lineSettled`
  (`realtime.events.ts:183`, `196`, `206`, `226`) carried a redacted basket line. Every
  emitter of them is in a file `0136` deletes.
- Event payloads have JSON Schemas under `libs/luna-shopper/contracts/src/schemas/events/`
  and an AsyncAPI document built from them (`schemas/asyncapi.ts`).

### Target state

Every acceptance criterion in section 11 holds, and
`npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-realtime luna-shopper/contracts`
is green. No gateway route changes, so `openapi.json` moves only if a schema it references
moved, and the generator is run to prove it.

### Scope

- Work only in:
  - `libs/luna-shopper/contracts` (the envelope, the two events, their payload types and
    schemas, `DOMAIN_EVENT_SUBJECTS`, the room helpers in `realtime.messages.ts`,
    `AccessCheckResult`),
  - `core/src/app/events/core-events.publisher.ts`,
  - a new `core/src/app/baskets/basket-announcer.service.ts` beside the coverage service,
    with its spec,
  - `core/src/app/baskets/basket-coverage.service.ts` and its SQL file, for
    `coveringBaskets` and `basketsOfZoneMembers` when `0133` did not leave them,
  - the emit sites of sections 3, 4 and 5, and nothing else in those files,
  - `core/src/app/realtime/realtime-access.controller.ts`,
  - `realtime/src/app/consumer/jetstream.consumer.ts`, `consumer/sweeps.ts`,
    `socket/realtime.gateway.ts`, `socket/room-sync.service.ts`,
    `messaging/core-access.client.ts`, and their specs,
  - one migration, only if section 2's index is missing.
- Do NOT touch: any payload of a `line.*` event, `LineClaimChangedEvent`, the zone and list
  rooms, the presence store, the gateway, anything under `libs/velista`.

### Constraints

- A basket event carries line ids and nothing else (`0130` section 6). A room cannot be
  projected per socket, so the only payload that is safe for a guest is one that says
  nothing. A client that is entitled to more reads again.
- Every announcement is made **after** the commit, as everywhere in core.
- The coverage read runs outside any transaction, because the access queries draw their own
  connections.
- One event per write, never one per basket and never one per line (`0052` section 3.1).
- Realtime keeps reading the old `generatedListId` field until plan `0144`. Section 1 says
  why.
- Only make changes this plan names.

### Action boundaries

- Proceed with in scope edits, specs, and the generators.
- Stop and ask if a site that writes `list_lines` is found that emits no `line.*` event at
  all. It is a defect of its own, and hiding it behind a basket announcement is wrong.
- Stop and ask if `0136` left an emitter of one of the four dead events alive.

### Progress evidence

Report after the envelope and the consumer with their specs, after `coveringBaskets` with
its integration spec, after every site of section 3 announces, after `basket.updated`, and
after presence, each with the spec run.

## 1. The envelope names several baskets

```ts
export interface DomainEvent<T = unknown> {
  event: RealtimeEvent;
  eventId: string;
  zoneId?: string;
  listId?: string;
  userIds?: readonly string[];
  /** The baskets whose rooms hear it. Replaces `generatedListId`. */
  basketIds?: readonly string[];
  /** @deprecated Written by nothing since plan 0139. Read by realtime until plan 0144. */
  generatedListId?: string;
  payload: T;
}
```

- `EventAudience` gains `basketIds` and loses `generatedListId`. `emitToGeneratedList` is
  replaced by `emitToBaskets(event, basketIds, payload)`, and every caller (the members
  service's two announcements, the deletion) passes a one element array. **Core writes one
  field, and it is the new one.**
- `roomsFor` adds one room per id of `basketIds`, and still adds the room of
  `generatedListId` when it is set. `sweepsFor` reads
  `envelope.basketIds ?? (generatedListId ? [generatedListId] : [])`.
- **Why realtime reads both for one release.** Staging deploys only the affected services,
  so a new core can publish to an old realtime and the reverse, and the durable JetStream
  consumer replays envelopes written before the deploy. An envelope whose audience the
  consumer cannot read is "addressed to nobody", which it drops as a fault. Reading both
  costs three lines and plan `0144` removes them with the last of the old names.
- `basketRoom(id)` and `basketPresenceRoom(id)` are added to `realtime.messages.ts` and
  return what `generatedListRoom` and `generatedListPresenceRoom` return today. New code
  calls the new names. The room string itself is `0144`'s to change, and no client ever sees
  it: a participant socket is joined server side.
- An envelope with `basketIds: []` and no other audience is not published at all. The
  publisher returns early, because a write to a list nobody's basket covers is the ordinary
  case and the consumer treats an empty audience as a fault.
- An envelope carries at most `BASKET_FAN_OUT_MAX`, 200, ids. Past that the publisher sends
  several envelopes of 200, each with its own `eventId`, and logs a warning, because a list
  with 200 open baskets over it is a number somebody wants to know about.

**Nothing changes about deduplication or order.** One envelope is one `eventId`, one dedupe
key, one relay publish and one `local.to(rooms).emit` per pod, however many rooms it names.
A participant socket is pinned to one basket, so it is in one of those rooms at most.

## 2. Which baskets cover a list

`BasketCoverageService.coveringBaskets(listId): Promise<CoveringBasket[]>`, the reverse of
`listsOf` (`0130` section 3), each row a `{ basketId, ownerUserId }`. **Plan `0133` builds
it** and nothing called it until now. This plan is its first caller, proves it against the
SQL below with the integration spec of section 10, and changes it only if that spec fails.

```sql
SELECT gl.id AS "basketId", gl."ownerUserId" AS "ownerUserId"
FROM "shopping_lists" sl
JOIN "zone_memberships" m ON m."zoneId" = sl."zoneId"
JOIN "generated_lists" gl ON gl."ownerUserId" = m."userId" AND gl."status" = 'OPEN'
WHERE sl.id = $1::uuid
  AND ${WRITABLE_LIST}
  AND (
    gl."kind" = 'LIVE'
    OR EXISTS (
      SELECT 1 FROM "basket_sources" bs
      WHERE bs."basketId" = gl.id
        AND bs."zoneId" = sl."zoneId"
        AND (bs."listId" IS NULL OR bs."listId" = sl.id)
    )
  )
```

- `WRITABLE_LIST` is the fragment in `generated-list.sql.ts:30`, over the aliases `m` and
  `sl`, unchanged. **The definition of "a list this person draws a basket from" stays in one
  place**, and this query is that definition read from the other end.
- A `LIVE` basket exists only once its owner opened it (`0136` creates it on first read), so
  a writer who never opened theirs contributes no row.
- A `FINISHED` or `ARCHIVED` basket reads frozen trip rows and hears nothing.
- **Cost.** One query per write, after the commit. It starts from one list by primary key,
  walks the zone's memberships, which is a household, and probes `generated_lists` by owner
  and `basket_sources` by basket. The answer is bounded by the writers of one list times the
  handful of baskets each has open.
- **Indexes.** `shopping_lists` by primary key, `zone_memberships` by its `(zoneId, userId)`
  key, `basket_sources` by the unique key `0133` gave it, which leads with `basketId`. For
  `generated_lists`, `ix_generated_lists_owner (ownerUserId, generatedAt)` serves the probe
  and drags every finished basket of the owner through the `status` filter. Add
  `ix_generated_lists_owner_open ON "generated_lists" ("ownerUserId") WHERE "status" = 'OPEN'`
  in a migration of this plan when `0133` did not. Down drops it.

`basketsOfZoneMembers(zoneId): Promise<string[]>` is the same query without the list and
without the writable predicate: every `OPEN` basket owned by an approved member of the zone.
Section 5 uses it.

## 3. `basket.linesChanged`

```ts
/** These list lines moved. Read the basket again. */
export interface BasketLinesChangedEvent {
  lineIds: string[]; // [] means the coverage itself moved, section 5
}
```

`RealtimeEvent.BasketLinesChanged = 'basket.linesChanged'`, in `DOMAIN_EVENT_SUBJECTS`, with
a schema beside the other event schemas. The payload names no basket, because one envelope
reaches many rooms with one payload. It names no list either, because a guest is in the room
and `0130` section 6 lets a guest know how much and never where.

**`BasketAnnouncer`**, one small service so that no emit site composes an audience by hand:

```ts
@Injectable()
export class BasketAnnouncer {
  /** A write to lines of one list. After the commit, never inside it. */
  async linesChanged(listId: string, lineIds: readonly string[]): Promise<void>;
  /** A write that belongs to one basket and to no list: a skip. */
  basketChanged(basketId: string, lineIds: readonly string[]): void;
  /** Section 5. */
  async coverageMoved(zoneId: string): Promise<void>;
}
```

`linesChanged` reads `coveringBaskets(listId)` and emits one envelope addressed to
`{ basketIds, userIds }`: every covering basket's room, and the `user:` room of every
covering basket's owner, once each. The owner's room is there for the reason
`generated-list-settle.service.ts` gave when it emitted a settle to it: the owner is usually
not in the basket's room, they are at home looking at the dashboard while somebody else
shops, and the card counts what is left. It never throws
into its caller: a failed coverage read is logged and swallowed, because the write it
follows has committed and the household's own event has gone out. A client that missed a
nudge still reads the truth on its next read.

**Every site.** The list event stays exactly as it is, and the announcement follows it:

| Site                                                            | Announces                                                |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| `LineService.emit` (`line.service.ts:578`), the private helper  | `linesChanged(list.id, [line.id])`. It serves `add`, `addMany`, the plain edit, `announce` and `applyApproval`, so an approval change is covered by construction. |
| the merge in `applyRename` (`:1534`)                            | `linesChanged(list.id, [absorbedId, survivorId])`, once, replacing the two single calls the helper and the delete emit each make on that path |
| `announceListRename` (`:1898`)                                  | once per list, with every line id the outcome names      |
| `applyLineDeletion` (`:2420`)                                   | `linesChanged(listId, [id])`                             |
| `SettlementService.settle` (`settlement.service.ts:218`)        | `linesChanged(list.id, [line.id])`                       |
| `ProductGroupSyncService` (`product-group-sync.service.ts:363`) | `linesChanged` per list, because a row's options moved   |
| the settle, the revert and the demand write of `0136`           | once per list the write touched, with that list's entries |
| the add and the rename of `0136`                                | nothing of their own. They go through `LineService.add` and `writeListRename`, which announce. |
| the skip and the take back of `0137`                            | `basketChanged(basketId, lineIds)`. A skip belongs to one basket, so no other basket hears it. |
| `LineService.reorder` (`:2349`)                                 | nothing. A basket computes its own order (`0141`).       |
| `LineClaimService.announce` (`line-claim.service.ts:180`)       | nothing. A basket draws no claim.                        |

- `addMany` announces once for the whole write, with every line id, and not once per line.
  The private `emit` therefore gains a way to be told "the caller announces", so the batch
  path collects ids and calls `linesChanged` once after its loop.
- A write that touches two lists (a basket settle over a merged row, a basket rename)
  announces once per list. Two envelopes, because two lists have two coverages.
- The basket that **made** the write hears its own event. The acting client already holds
  the answer of its request, and merging a read over it is idempotent, which is how
  `lineSettled` reached the owner twice before.

## 4. `basket.updated` reaches the room

```ts
export interface BasketUpdatedEvent {
  basketId: string;
  kind: BasketKind;
  name: string | null;
  status: BasketStatus;
}
```

`RealtimeEvent.BasketUpdated = 'basket.updated'` replaces `generatedList.updated`. One
envelope with two audiences, `{ userIds: [ownerUserId], basketIds: [id] }`, from
`GeneratedListService.update` (`generated-list.service.ts:810`), which the sweep also goes
through, so a swept basket tells its room.

- The payload is the four fields a guest already reads on the basket itself. It replaces a
  whole `GeneratedListView`, which since `0136` has no lines to carry and which named
  sources a guest must not see.
- The owner's dashboard hears it on the user room and the people in the shop hear it on the
  basket room. The owner in both hears it twice, on two sockets, and the client merges by id.
- **A finish evicts nobody.** `listAccepts` stops new joins and the people already there
  keep reading a finished basket, which is plan `0051` section 3.4's reasoning and stays.
- **The deletion is not folded into this event.** `generatedList.deleted` already names both
  audiences and is what `sweepsFor` turns into an evict sweep of both rooms. It keeps its
  name until `0144` and only its audience field moves to `basketIds`.
- `generatedList.created`, `shared`, `unshared`, `participantJoined` and `participantLeft`
  are untouched here beyond the audience field.

## 5. When the coverage itself moves

A list is created, deleted or has its access changed. A member is approved, kicked, banned
or moved between roles. A zone is deleted. None of these is a write to a line, and each of
them adds or removes whole lists from somebody's basket.

`BasketAnnouncer.coverageMoved(zoneId)` sends `basket.linesChanged { lineIds: [] }` to
`basketsOfZoneMembers(zoneId)`. It addresses every open basket of the household and not the
baskets that gained or lost the list, on purpose: the set before the write and the set after
it differ, the superset needs neither, and an empty payload costs a client one debounced
read. The sites, by the event each already emits:

| Event                                                          | Site                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `list.created`, `list.deleted`, `list.accessChanged`           | `lists/list.service.ts:269`, `:395`, `:646`                 |
| `member.approved`, `member.kicked`, `member.banned`, `member.roleChanged` | `zones/membership.service.ts:143`, `:223`, `:232`, `:259`, `:274` |
| `merge.approved`                                               | `merge/merge.service.ts:187`                                |
| `zone.deleted`, `zone.ownershipChanged`                        | `zones/zone.service.ts`, `account/zone-reaper.service.ts:176`, `account/account-deletion.service.ts:81` |

Read each site before wiring it: the line numbers name where the event is emitted today, and
the announcement goes beside it, after the commit. For a deletion the basket ids are read
**before** the delete, as `tripListsOfBasket` is.

**No basket room needs an evict sweep for any of this.** A socket is in a basket room because
its participant is live on the basket, and that does not change when the owner loses a list.
What the participant is allowed to read is decided per request by the coverage, so the room
stays and the next read is smaller. `sweepsFor` gains no case.

## 6. Presence on `GENERATED` baskets only

- `AccessCheckResult` gains `basketKind?: BasketKind`, filled by
  `RealtimeAccessController.checkParticipant` from the basket row in the same read.
- `RealtimeGateway.handleConnection` always joins `basketRoom(id)`. It joins
  `basketPresenceRoom(id)`, calls `registerParticipant` and `joinGeneratedList` only when the
  kind is `GENERATED`. `client.data.basketKind` is kept so the disconnect path does not try
  to leave a presence it never entered.
- `RoomSyncService` re-asks core for the rooms a socket holds. A `LIVE` socket holds no
  presence room, so nothing changes there. The check at `room-sync.service.ts:359` is read
  and left alone.
- The gateway's `presentCount` (`gateway/src/app/generated-lists/basket-presence.service.ts`)
  reads the same Redis hash and answers zero for a `LIVE` basket by itself.
- An old realtime that receives no `basketKind` treats the basket as `GENERATED`, which is
  what every basket was.

Why: `0130` section 7. "X is here" on a basket that everybody holds all the time says nothing,
and a permanent presence room per person is a Redis key that never expires.

## 7. What is deleted

`RealtimeEvent.GeneratedListLineUpdated`, `GeneratedListLineAdded`,
`GeneratedListLineRemoved`, `GeneratedListLineSettled` and `GeneratedListUpdated`, their
entries in `DOMAIN_EVENT_SUBJECTS`, the payload types `GeneratedListLineMovedEvent`,
`GeneratedListLineRemovedEvent` and `GeneratedListLineAddedEvent` in
`generated-list-sharing.messages.ts`, and their schemas. Grep core for each name first. A hit
outside a spec means `0136` left an emitter, which is a stop and ask.

The JetStream stream keeps old messages of the deleted subjects until its limits drop them.
The consumer acknowledges an event it has no rooms for, as it does today for any subject it
does not know.

## 8. Not in this plan

- What the client does with the event. Velista `0093`. It already debounces a basket read by
  1.5 seconds, and `lineIds` lets a later client read less than the whole basket.
- A catch up for events missed while a socket was down. The client reads again on reconnect
  and on resume, which velista `0090` builds.
- Renaming the rooms, the remaining `generatedList.*` events and the presence event. `0144`.
- A change record. `0138`. This event says that something moved, and that plan says what.

## 9. Migration

Only the partial index of section 2, and only when `0133` did not create it. Up creates
`ix_generated_lists_owner_open`. Down drops it. No data moves.

## 10. Tests

Unit specs:

1. `roomsFor` answers one room per id of `basketIds`, still answers the room of a lone
   `generatedListId`, and unions both without a duplicate.
2. `sweepsFor` sweeps both rooms of every id for a participant left and a deletion, from
   either field.
3. The publisher sends nothing for an empty `basketIds` with no other audience, and splits
   450 ids into three envelopes with three `eventId`s.
4. `BasketAnnouncer.linesChanged` swallows a failed coverage read and logs it.
5. Each site of section 3 announces once per list, after its list event, with the ids the
   table says. `addMany` of five lines announces once. `reorder` and a claim announce
   nothing.
6. A rename that merges announces one event naming both ids.
7. `update` emits one `basket.updated` to both audiences, and the sweep's finish does too.
8. The gateway joins the presence room for `GENERATED` and not for `LIVE`, and a missing
   `basketKind` means `GENERATED`.

Integration specs, real database:

9. `coveringBaskets`: a `LIVE` basket of an owner with `WRITE`, none for a member with `READ`
   alone, a `GENERATED` basket whose source names the list, one whose source names the whole
   zone, none whose source names another list of the zone, none for a `FINISHED` basket, none
   for an owner who lost their membership.
10. `basketsOfZoneMembers` answers the open baskets of approved members and no others.

## 11. Acceptance criteria

- [ ] A line added, edited, renamed, merged, approved, deleted or bought on a list reaches
      the room of every open basket that covers the list, as one event per list per write.
- [ ] A skip reaches its own basket and no other.
- [ ] The event carries line ids and nothing else.
- [ ] A write to a list no open basket covers publishes nothing to any basket.
- [ ] A rename, a finish, a reopen and a sweep reach the people in the basket room.
- [ ] A change of who can write what reaches the open baskets of the household, and sweeps
      nobody out of a basket room.
- [ ] A `LIVE` basket has a room and no presence.
- [ ] The envelope names several baskets, core writes only `basketIds`, and realtime still
      routes an envelope written before the deploy.
- [ ] The four basket line events and `generatedList.updated` are gone from contracts.

## 12. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-realtime luna-shopper/contracts
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run the two integration specs through their own target against a slot. Then, on the same
slot, open a basket in two browsers, edit a line on the list page in a third, and confirm
with the realtime service's log that one envelope named both baskets. Give the slot back.
