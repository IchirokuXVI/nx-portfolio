# 0032 Zone level list presence

> Depends on 0009 (realtime), 0028 (Redis cache and presence) and **0031** (eviction),
> which is a hard dependency: this plan joins rooms the client never asked for, so the
> client has nothing to release when access is lost.
>
> Companion plan: `apps/velista/plans/0022` section 3.3, which renders it.
>
> Verified against the source on 2026-08-28.

## 1. What is wanted

The group page lists a zone's lists, and the dashboard's zone cards preview up to three of
them. Each row should say whether somebody is shopping from that list right now, live,
without the client opening a room per row.

Today list presence is broadcast into `list:{id}` and nowhere else, and a client is only
in that room while it has the list open. So a group page showing eight lists would need
eight subscriptions to light eight dots.

## 2. The room is the access control

A socket joins `list:{id}:presence` for every list in a zone it may read, and
`presence.listUpdated` is emitted there.

That is the whole design, and its virtue is that it answers the hard question
structurally instead of by filtering. **List read access is opt in per membership**:
`ListAccessService.requireRead` needs an approved zone membership *and* either being a
manager of the list or an explicit `ListAccess` row. So a summary broadcast into
`zone:{id}`, whose audience is every approved member, would tell somebody that a list they
may not read exists and that named colleagues are in it right now. That is what per list
access exists to prevent, and it is the same objection 0017 raised against putting
`listCount` in a room broadcast.

Room membership decides it once, at join time, against the same check every other room
uses. One payload, no per recipient variation, and nobody who should not have it is in the
room to receive it.

An earlier draft of this plan filtered per recipient and emitted into the user room from
0030. It was discarded: it needed a new event, a `listId -> zoneId` mapping, a per
recipient emit loop on every broadcast, and a dependency on another plan, to reach the
same place this reaches with a room join.

## 3. A second room, and why it cannot be `list:{id}`

`list:{id}` is not a presence room. The JetStream consumer routes every list scoped domain
event to it: `line.added`, `line.updated`, `line.deleted`, `line.reordered` and
`comment.added`.

If everyone with access joined `list:{id}` eagerly, then every edit to every line of every
list a member can read would be pushed to every one of their devices, permanently, whether
or not they have that list open. That is a large traffic increase and it destroys what the
room means: today, being in `list:{id}` means "I am looking at this list".

So `list:{id}:presence` is a room of its own. `list:{id}` keeps the domain traffic and
keeps its meaning, and the presence room carries `presence.listUpdated` and nothing else.

`presence.listUpdated` is emitted to **both**, so a client with the list actually open
does not have to be in the presence room to keep working, and nothing about the existing
list page changes.

## 4. Joined per zone, not per connection

The tempting placement is `handleConnection`: join every list the user may read, across
every zone, the moment they connect. It is rejected on cost and on where that cost lands.

Connecting is currently a token verification and a presence registration, with no round
trip to core at all. Enumerating every readable list across every zone would put a real
query on the critical path of every connect, and connects are frequent on mobile
(backgrounding, network changes) and bursty in exactly the worst conditions (a deploy
reconnects every client at once, producing a thundering herd of the most expensive query
this service makes).

So the join happens on **`zone.subscribe`**, which:

- is already a round trip to core, so it adds a field to an answer rather than a new call,
- is already issued by the client for every zone it holds (`ZoneStore._syncRooms`), so the
  dashboard and the group page are both covered with no new client behaviour,
- scopes the enumeration to one zone, so the query is small and bounded,
- and is already re-issued on reconnect, so the rooms come back the same way every other
  room does.

`zone.unsubscribe` leaves the zone's list presence rooms alongside `zone:{id}` and
`zone:{id}:staff`, for the same reason it leaves the staff room: they were acquired by that
subscription and are not rooms of their own on the client.

### 4.1 Where the list ids come from

`RealtimeAccessController.checkZone` currently answers `{ allowed }`. It gains the
caller's readable list ids for that zone:

```ts
{ allowed: true, listIds: ['...', '...'] }
```

filled from the same access filtered query shape core already runs twice for the zone
summary: `counts.listCount` is access filtered per caller, and the preview selects the
caller's readable lists ordered by activity with `LIMIT 3`. This is that query without the
limit and selecting only ids.

Cached in Redis beside the other access answers, keyed per zone and user, and **invalidated
by the events that already invalidate zone access** plus `list.created`, `list.deleted` and
`list.accessChanged`, which are the three that change the set without changing zone access.
Those three are added to `ACCESS_INVALIDATING_EVENTS` alongside a note saying which answer
each is for, since that set now guards two different caches.

### 4.2 A list created while somebody is subscribed

`list.created` invalidates the set, but invalidation alone does not join anybody to
anything: the sockets already subscribed to the zone are not in the new list's presence
room and nothing will put them there until they re-subscribe.

The consumer therefore joins them, on `list.created`, through the same relay directive
mechanism `0031` uses for eviction and in the same place. Each pod takes its local sockets
in `zone:{zoneId}`, re-asks for the readable set, and joins any presence room they are
missing.

This is the mirror image of `0031`, and the two are written as one helper taking a
direction, because a join sweep and a leave sweep that drift apart is how a member ends up
correctly evicted from one room and never joined to its replacement.

## 5. Volume

`presence.listUpdated` currently reaches whoever has the list open, typically nobody or
one person. It will now also reach everyone with access, on every open and close.

Bounded by the fact that the presence rooms are only joined by sockets subscribed to the
zone, which means connected clients with that group on screen or in their dashboard. For a
household app that is a handful of devices. The emit itself is unchanged: one
`server.local.to(room)` per room, as today, with no loop over recipients.

If it does prove chatty, the lever is coalescing the broadcast per list over a short
window, since presence is advisory and a second of lag is invisible. Deliberately not
built now: a debounce added before it is needed is a correctness risk with no measurement
behind it.

## 6. Contract additions

In `libs/luna-shopper/contracts`:

- `listPresenceRoom(listId): string`, beside `zoneRoom`, `zoneStaffRoom` and `listRoom` in
  `realtime.messages.ts`.
- `AccessCheckResult.listIds?: readonly string[]`, documented as "on a zone check only:
  the lists in that zone this caller may read".

**No new event.** `presence.listUpdated` already carries exactly the right payload and the
velista client already maps and applies it. That is the clearest measure of this design
against the one it replaced.

## 7. Tests

- Subscribing to a zone joins the presence room of every list the caller may read and of
  no list they may not.
- Somebody opening a list produces `presence.listUpdated` in both `list:{id}` and
  `list:{id}:presence`, and a zone member who may read that list receives it while holding
  no subscription to the list itself.
- A zone member who may **not** read that list receives nothing naming it.
- `zone.unsubscribe` leaves every one of the zone's presence rooms.
- Creating a list joins the zone's already subscribed sockets to its presence room, on a
  pod other than the consuming one.
- Losing read access to a list removes the socket from its presence room (`0031`), and the
  socket keeps the zone's other list presence rooms.
- The readable set is cached and a second `zone.subscribe` makes no further core call for
  it; `list.created`, `list.deleted` and `list.accessChanged` each drop it.

## 8. The OpenAPI document

Nothing here changes an HTTP request or response DTO. Run the generator and confirm the
empty diff rather than assuming it:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 9. Acceptance

1. Two accounts in one group with access to the same list, both on the group page. One
   opens it; the other's row for that list lights up while holding no subscription to it.
2. A third member with no access to that list sees nothing change and their socket
   receives no payload naming it.
3. Closing the list clears the row on the other's group page.
4. The same works on the dashboard, for the lists previewed inside a zone card, with no
   client change beyond the zone subscription it already holds.
5. Creating a list in a zone somebody is looking at lights its row when somebody opens it,
   without either client reconnecting.
6. Connecting a socket still makes no query to core.
