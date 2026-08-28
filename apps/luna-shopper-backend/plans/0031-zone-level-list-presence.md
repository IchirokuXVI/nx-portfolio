# 0031 Zone level list presence

> Depends on 0009 (realtime), 0028 (the Redis cache and presence) and **0030** (the user
> channel), whose room this plan delivers into. Section 4 says why it cannot be a zone
> room broadcast.
>
> Companion plan: `apps/velista/plans/0022` section 3.3, which renders it.
>
> Verified against the source on 2026-08-28.

## 1. What is wanted

The group page lists a zone's lists. Each row should say whether somebody is shopping from
that list right now, live, without the client opening a room per row.

Today that costs one `list.subscribe` per visible row, because list presence is broadcast
into `list:{id}` and nowhere else. A group page showing eight lists would hold eight
subscriptions to light eight dots.

## 2. It is not the counts broadcast, and that matters

`apps/velista/plans/0022` section 3.3 described this as "a zone-level summary in the
counts broadcast". That description was wrong in two ways and the correction is the first
design decision here, not a quibble:

- **`zone.countsUpdated` is published by core**, which holds no presence data at all.
  Presence lives in the realtime service's Redis, computed from live connections. Core
  cannot fill a field it cannot see.
- **It fires when counts change.** Somebody opening a list changes no count, so a
  presence summary riding on that event would go out at exactly the wrong moments and
  never at the right ones.

Presence broadcasts are the realtime service's own (`presence.zoneUpdated`,
`presence.listUpdated`), emitted straight to a room and deliberately excluded from
`DOMAIN_EVENT_SUBJECTS` because nothing feeds them into JetStream. This plan adds a third
of the same kind.

## 3. The access constraint, which shapes everything else

**A zone member cannot necessarily read a zone's lists.** `ListAccessService.requireRead`
requires an approved zone membership *and* either being a manager of the list or an
explicit `ListAccess` row for that membership. Access is per list and opt in.

So a summary broadcast into `zone:{id}`, whose audience is every approved member, would
tell a member that a list they may not read exists and that named colleagues are looking
at it right now. That is precisely what per list access exists to prevent, and it is the
same objection 0017 raised against putting `listCount` in a room broadcast:

> `listCount` is access filtered per caller, so the counts broadcast cannot carry it.

The naive shape is therefore rejected outright. It is worth being blunt about that,
because the naive shape is the obvious one and somebody will propose it again: **there is
no correct version of this that goes to the zone room.** A room broadcast has one payload
and this payload differs per recipient.

## 4. So it goes to the user room, per recipient

0030 introduces `user:{userId}`, joined at connect from the verified token. That is the
one room in the system whose audience is a single person, which is what a per recipient
payload requires.

New event, computed and emitted by the realtime service:

```
presence.zoneListsUpdated  ->  { zoneId, lists: [{ listId, viewers: [{ userId }] }] }
```

Emitted into `user:{userId}` for each **online member of the zone**, carrying only the
lists that member may read. A list nobody is viewing is absent from the array rather than
present with an empty `viewers`, so absence is the single representation of "nobody", and
a member who may read no list in the zone receives an empty array rather than nothing at
all, which is a meaningful difference to a client deciding whether it has an answer yet.

`PresenceUser` carries `userId` only, as it already does on the wire; the client resolves
names from the membership rows it holds, exactly as it does for `presence.zoneUpdated`.

## 5. Two things the service does not currently know

### 5.1 Which zone a list belongs to

`PresenceService` tracks `socket.zones` and `socket.lists` and has no mapping between
them. It needs one to know which zone a list presence change concerns.

The answer is already being computed. `list.subscribe` calls
`CoreAccessClient.checkList`, which asks core, which loads the list. So
`AccessCheckResult` gains an optional `zoneId`, filled by
`RealtimeAccessController.checkList` from the `ShoppingList` that `requireRead` already
returns and currently discards.

It is cacheable **forever**, and that is a fact about the domain rather than an
optimisation: `UpdateListRequest` carries `userId`, `listId` and `name` and nothing else,
there is no endpoint that moves a list between zones, and `ShoppingList.zoneId` is
non-nullable. A list's zone is immutable. It is cached in its own key rather than in the
per user access hash, because it is not a per user answer and must survive the
invalidations that hash takes on every access change.

### 5.2 Which of the zone's online members may read a given list

Also already being computed, and already cached in the right shape.
`listAccessKey(listId)` is one Redis hash per list with fields keyed by user id, holding
each user's read answer, and `invalidateList` drops the whole hash on `list.accessChanged`
(`jetstream.consumer.ts:398`).

So the recipient set for a list is: the zone's online members, from
`zonePresenceKey(zoneId)`, filtered by that hash. A cache miss falls back to asking core,
exactly as `checkList` already does, and the answer is written back.

That bounds the work honestly: **one hash read per broadcast, plus a core round trip per
online member whose answer is not cached.** This is a household shopping app, so a zone's
online members are a handful, and the misses only happen on the first list somebody opens
after an access change.

## 6. When it fires, and what that costs

`presence.zoneListsUpdated` is recomputed and emitted whenever a list's viewer set
changes: `viewList`, `unviewList`, the disconnect sweep, and the heartbeat's expiry
pruning. Those are the four places `broadcastList` is already called from, so this is a
second call beside an existing one rather than a new trigger to reason about.

The cost is real and should be stated rather than discovered: **opening a list now
notifies the zone's online members as well as the list's viewers.** Before this, opening a
list was one room emit. It is now one room emit plus one emit per online zone member.

Two things bound it. The recipient set is the zone's *online* members, not its
membership, so an idle group costs nothing. And the emit is a per user room emit through
the same relay every other event uses, with no extra Redis round trip per recipient beyond
the one hash read in 5.2.

If that proves too chatty in practice, the lever is coalescing: recompute at most once per
zone per short window, since presence is advisory and a second of lag is invisible. That
is deliberately **not** built now, because a debounce added before it is needed is a
correctness risk with no measurement behind it. Measure first.

## 7. Contract additions

In `libs/luna-shopper/contracts`:

- `RealtimeEvent.PresenceZoneListsUpdated = 'presence.zoneListsUpdated'`, alongside the
  two existing presence events and, like them, **excluded from `DOMAIN_EVENT_SUBJECTS`**:
  nothing publishes it into JetStream, and the comment there already explains that
  exclusion for its two siblings.
- `ZoneListsPresence { zoneId: string; lists: ZoneListPresence[] }` and
  `ZoneListPresence { listId: string; viewers: PresenceUser[] }`.
- `AccessCheckResult.zoneId?: string`, documented as "the list's zone, on a list check
  only, and immutable".

## 8. Tests

- A member who may read two of a zone's three lists receives a summary naming those two
  and never the third, while somebody looking at the third is present in it.
- A member who may read no list receives an empty `lists` array.
- Opening a list emits `presence.listUpdated` to the list room and
  `presence.zoneListsUpdated` to each online zone member's user room.
- A list with no viewers is absent from the array rather than present and empty.
- The zone id returned by `checkList` is cached and a second subscribe to the same list
  makes no further core call for it.
- `list.accessChanged` drops the access hash, and the next summary reflects the new
  answer.
- The disconnect sweep and the heartbeat expiry both re-emit the summary.

## 9. The OpenAPI document

Nothing here changes an HTTP request or response DTO. Run the generator and confirm the
empty diff rather than assuming it:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 10. Acceptance

1. Two accounts in one group, both on the group page, with access to the same list. One
   opens it; the other's row for that list lights up without holding that list's room.
2. A third member with no access to that list sees nothing change, and their socket
   receives no payload naming that list.
3. Closing the list clears the row on the other's group page within the presence timeout.
4. A pod killed without running its disconnect handlers drains out of both the list room
   and every zone summary inside `PRESENCE_TTL_MS`.
5. An idle zone, with members connected but nobody on a list, produces no
   `presence.zoneListsUpdated` traffic.
