# 0033: zone presence is an intent, not a subscription

> Prerequisite reading: `0028` section 2.2 (presence in Redis), `0032` (zone level list
> presence) and velista `0017` section 5.1 (why an intent needs its room first).
>
> Companion plan: `velista/plans/0023`, which holds the intent from the screens that
> know where somebody is. Neither half works alone, and section 5 says why the server
> half must land first.

## 1. The bug, stated plainly

One person was reported as being in every group they belong to, at once, permanently.

`zone.subscribe` called `presence.joinZone` inside its own handler. That looks right
until you ask who subscribes and when, and the answer is in the client: `ZoneStore`
holds a zone room for **every zone in `myZones()`**, from the moment the dashboard
loads until the app closes, because that is how the live counts on the group cards stay
live. So zone presence was never a statement about where somebody was. It was a
restatement of their membership list, computed the expensive way.

Two things follow, and the second is the one that made it feel broken rather than
merely wrong.

- **It over reports, always.** A member of six groups is present in six. The `online`
  array on `presence.zoneUpdated` is, for practical purposes, "everybody in this group
  who currently has the app open", which is a fact the product never asked for.
- **It never changes.** Navigation does not touch a zone subscription, so nothing a
  person does inside the app moves them from one group to another. The only events that
  ever changed zone presence were connecting and disconnecting. That is why it reads
  from the outside as "presence is only sent on page load": from the user's seat, that
  is exactly what was happening.

`0032` made this worse in an interesting way rather than a coincidental one. It was
written on the reading that holding a zone room means being in the zone, and it is
correct on its own terms; but every surface it lit was then fed by a presence set that
could not distinguish a person shopping in the kitchen group from a person who had
opened the app once that morning.

## 2. The fix is the split that already exists for lists

velista `0017` had this exact problem for lists and solved it. `list.subscribe` is
observing and `presence.view` is announcing, and the interface documents why they are
two things:

> Observing, not announcing. A caller that also wants to be **seen** on the list calls
> `viewList` instead, which takes this subscription on its behalf.

Zones get the same shape, and the reason is stronger, because a list room has an open
list behind it while a zone room has only a membership.

- `zone.subscribe` joins `zone:{id}` (and the staff room, and `0032`'s list presence
  rooms). **It no longer touches presence.**
- `presence.enterZone` says somebody is on this group's screen. `presence.leaveZone`
  stops saying it.

### 2.1 The intent is gated on the room, not on core

`enterZone` refuses a socket that is not in `zone:{id}`, exactly as `presence.view`
refuses one that is not in `list:{id}`. This is the whole access check and it is
sufficient: a socket cannot be in that room without `zone.subscribe` having asked core
and been told yes, so re-asking would spend a round trip answering a tautology.

`leaveZone` is acknowledged whatever state the socket was in, like every other stop
intent here. A client walking away from a screen must never be left announcing it
because the room went first.

### 2.2 Unsubscribing still clears presence

`zone.unsubscribe` keeps its `presence.leaveZone` call, and the eviction sweep in
`room-sync.service.ts` keeps its own. Both are cleanup for a room going away underneath
an intent, and neither is the ordinary path. The ordinary path is a screen being
destroyed, which is `presence.leaveZone`.

## 3. What the numbers mean afterwards

`ZonePresence.online` becomes "who has this group's screen open right now", which is:

- **Usually empty**, and that is correct. Most groups have nobody looking at them most
  of the time, and `PresenceRow` already draws nothing rather than zero.
- **At most one screen per socket.** A person is on one page. Two tabs is two sockets
  and genuinely two presences, which is honest rather than a bug.
- **A superset of the list case**, because velista `0023` has the list page announce
  its zone as well: somebody shopping a list in the kitchen group is in the kitchen
  group. That is the reading that makes the dashboard's "Ana is here now" mean
  something a person would act on.

## 4. What is deliberately not changed

- **`PresenceService` is untouched.** `joinZone` and `leaveZone` already do the right
  thing; the defect was entirely in who called them and when. Redis keys, the
  heartbeat, the per member TTL and the pruning all stand.
- **No new room.** The intent rides on `zone:{id}`, so there is nothing new to join,
  evict, or sweep, and `parseRoom` needs no new case.
- **No presence on the members screen from the server's side.** Whether the members
  page counts as being in the group is a client decision, and velista `0023` makes it.

## 5. Sequencing

The server half ships first and is backward compatible in the direction that matters:
an old client that never sends `presence.enterZone` simply stops appearing in zone
presence, which under reports. Presence is advisory and under reporting is its designed
failure (plan 0004, section 6.7), so the window between the two deploys is a dashboard
with fewer dots, not a wrong one.

The reverse order is not safe and is worth naming: a new client sending `enterZone` to
an old server gets `{ ok: false }` from a gateway with no such handler, and the registry
latches the refusal for the connection.

## 6. Acceptance

1. Two accounts in one group. Neither appears in the other's zone presence while both
   sit on the dashboard, however many groups they share.
2. One opens that group. The other's dashboard card for it lights within a broadcast.
3. That account navigates to a **different** group. The first card goes dark and the
   second lights, from one navigation, with no reload and no reconnect.
4. Opening a list in the group keeps the group lit, and leaving the list leaves the
   group.
5. `zone.subscribe` alone puts nobody in `zonePresenceKey`. Asserted in
   `zone-presence.spec.ts`, which is the regression test for section 1.
6. `presence.enterZone` from a socket that never subscribed is refused, and the socket
   is not added to the room by the refusal.
