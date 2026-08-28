# 0031 Rooms a socket should no longer be in

> Depends on 0009 (realtime) and 0028 (the Redis cache, presence and the backplane).
>
> `0032` (zone level list presence) depends on **this** plan, and section 3 says why it
> is a hard dependency rather than a nicety.
>
> Verified against the source on 2026-08-28.

## 1. The hole

**Nothing in this service ever removes a socket from a room it has lost the right to be
in.** The only `leave` calls in the gateway are inside the two client-initiated
unsubscribe handlers:

```
realtime.gateway.ts:152   await client.leave(zoneRoom(body.zoneId));
realtime.gateway.ts:153   await client.leave(zoneStaffRoom(body.zoneId));
realtime.gateway.ts:176   await client.leave(listRoom(body.listId));
```

Every one of those runs because a client asked. There is no path from an access change to
a room.

0028 added the access cache and `ACCESS_INVALIDATING_EVENTS`, and it is easy to read those
as covering this. They do not. The cache gates the **next subscribe**; it says nothing
about a socket already in a room. Its own comment is precise about the scope it claims:

> a **missing** one costs a revoked member up to a minute of a room they should no longer
> be in

That sentence describes a socket that re-subscribes. A socket that never re-subscribes
keeps the room for the life of its connection.

## 2. Why it looks like it works today

Because the client cooperates. A kicked member's app receives `member.kicked` in the zone
room, `ZoneStore` removes the zone, and removing it releases the subscription, which emits
`zone.unsubscribe`, which runs line 152 above. The room is left promptly and correctly.

That is a well behaved client choosing to leave. It is not an access control. Three ways
it fails, in increasing order of how much they matter:

- **A client that does not cooperate.** An old build, a build with a bug in that release
  path, or a socket driven by anything other than this app keeps receiving every event in
  the zone until it disconnects.
- **A revocation with no client-visible cause.** `list.accessChanged` carries `{ listId }`
  and names nobody (`list.service.ts:127`). A client cannot tell from it that *it* is the
  one that lost access, so it has no reason to release anything.
- **Rooms nothing prompts a release for.** This is the one that makes the plan mandatory
  rather than tidy, and it is section 3.

## 3. Why `0032` cannot ship without this

`0032` joins a socket to a presence room for every list in a zone it may read, at
`zone.subscribe` time, on the server's initiative. The client never asked for those rooms
and therefore has nothing to release: there is no client-side refcount, no unsubscribe
call, and no event that means "drop room X".

So under `0032` the cooperative mechanism in section 2 does not merely have holes, it does
not exist. Losing access to a list would leave a socket in that list's presence room until
it reconnected, which on a long lived mobile connection can be hours.

Eager rooms and server side eviction are two halves of one design. Neither is correct
alone.

## 4. The mechanism: re-validate, do not compute the difference

The obvious implementation is to work out from each event exactly who lost what and remove
precisely them. It is rejected, on one fact that settles it: **`list.accessChanged` names
nobody.** Its payload is `{ listId }`. There is no set to target, and the service would
have to reconstruct one by asking core who used to have access, which it never knew.

So eviction is a **sweep**, and the rule is deliberately blunt:

> When an event says an access answer may have changed, take every socket it could
> concern, re-ask the access question for **every room that socket holds**, and leave the
> rooms that now answer no.

Three properties follow, and each is the reason for the bluntness:

- **It cannot be wrong by omission.** Re-checking a room that was never at risk costs one
  cached lookup. Failing to check one costs a socket a room it should not have. That is
  the same asymmetry `ACCESS_INVALIDATING_EVENTS` already resolved the same way, and its
  comment ("erring wide on purpose") is the precedent to follow rather than argue with.
- **Every room, not the room the event names.** A member kicked from a zone loses every
  list in that zone too, and `requireRead` enforces that by calling `requireApproved`
  first. Sweeping only the named room would leave the list rooms behind, and working out
  which lists belong to the zone is exactly the lookup this design refuses to need.
- **It is cheap where it runs.** These events are rare. A kick, a ban, a role change, a
  zone deletion, an access change: a handful in a group's lifetime. The sweep touches the
  sockets of the users concerned, each holding a handful of rooms.

The scope only decides **which sockets** to sweep, never which of their rooms to check.

## 5. Ordering, which is load bearing

Per event, in this order:

1. **Invalidate the access cache.** Already happens, already before fan out (0028, section
   2.6). The sweep must re-ask against fresh answers or it will confirm the stale ones.
2. **Fan out the event.** Unchanged.
3. **Sweep.**

The sweep runs **after** the fan out and not before, and this is the detail to get right:
a member kicked from a zone learns about it *through the zone room*. Evicting them first
would remove them from the room carrying the news, and their client would sit on a group
it no longer belongs to with no idea why. Fanning out first means the notification lands,
the cooperative release usually happens on its own, and the sweep is the backstop that
makes it not matter whether it did.

`0030` addresses membership events to the user's own room as well, which makes the
notification independent of the zone room and this ordering merely preferable rather than
required. This plan does not depend on `0030` and keeps the ordering either way.

## 6. Which events sweep which sockets

| Event                                          | Sockets swept                                    |
| ---------------------------------------------- | ------------------------------------------------ |
| `member.kicked`, `member.banned`               | the payload's `userId`                           |
| `member.roleChanged`                           | the payload's `userId` (a demotion loses `:staff`) |
| `zone.ownershipChanged`                        | every socket in `zone:{zoneId}`                  |
| `zone.deleted`, `zone.markedForDeletion`       | every socket in `zone:{zoneId}`                  |
| `list.accessChanged`                           | every socket in `list:{listId}` and its presence room |
| `merge.approved`                               | both user ids it names (it implies a kick)       |
| `member.rejected`                              | nothing. See below.                              |

`member.rejected` is the one deliberate omission and it is safe rather than an oversight: a
rejected membership was `PENDING`, `checkZone` calls `requireApproved`, so that user was
never admitted to the room in the first place.

`zone.ownershipChanged` sweeps the whole room rather than a named user because the payload
is a `ZoneView` and names none of the memberships it changed. It is cheap and it is
correct; after `0029` the two `member.roleChanged` events it now emits sweep the two
people precisely, and this row becomes redundant belt and braces that costs one pass over
an online household.

## 7. Crossing pods

A user's sockets can be on any pod, so the sweep has to reach all of them.

**It goes through the relay**, as a directive published beside the event, and every pod
sweeps its own local sockets. Not `fetchSockets()` and not remote `leave` calls: 0028
established that an event crosses the pod boundary exactly once and that the gateway emits
with `server.local.to(room)` precisely so the adapter does not carry things across twice.
An eviction that reached across pods by a second mechanism would be a second answer to a
question that already has one.

**The index each pod needs already exists.** `PresenceService` keeps a local map of
`socketId -> { userId, zones, lists, editing }`, which is exactly "which of my sockets
belong to this user, and which rooms do they hold". Its header already describes it as the
per pod half whose union lives in Redis. It gains a read accessor; nothing about its shape
changes.

## 8. Leaving a room is more than `leave`

A socket removed from a room must also come out of that room's **presence**, or a kicked
member stays lit up in a group they are no longer in, which is worse than the room
membership itself because it is visible to everybody else.

So the eviction path reuses the existing methods rather than calling `client.leave`
directly:

- leaving a zone goes through `PresenceService.leaveZone`, which removes the member from
  `presence:zone:{zoneId}` and rebroadcasts,
- leaving a list goes through `unviewList`, which removes the viewer, drops any line the
  socket was editing, and rebroadcasts,
- the `:staff` room has no presence and is a plain `leave`.

Which means a kick produces a presence broadcast that the remaining members see
immediately, rather than the kicked member fading out on the ninety second heartbeat
timeout.

## 9. What this does not do

- **It does not disconnect the socket.** Losing one zone is not losing the session, and a
  user with three groups who is removed from one keeps the other two. Account deletion is
  a different question, handled by `user.deleted` and out of scope here.
- **It does not tell the client it was evicted.** The client already learns from the event
  that caused it. Adding a second "you were removed from room X" message would be a
  parallel channel that can disagree with the first.
- **It does not sweep on a timer.** The cache TTL is the backstop for an access change
  that publishes no event at all, and it stays that. A periodic re-validation of every
  socket would be a large recurring cost buying an already covered case.

## 10. Tests

- A socket in `zone:{id}` receives `member.kicked` for itself and is then out of the room,
  **without its client sending `zone.unsubscribe`**. That is the whole plan in one test,
  and it fails on today's code.
- The same socket is also out of every `list:` room for that zone, and out of
  `presence:zone:{id}`, and the remaining members receive a presence broadcast.
- A demoted admin leaves `zone:{id}:staff` and stays in `zone:{id}`.
- `list.accessChanged` sweeps a list's rooms and removes only the sockets whose re-check
  now fails, leaving the rest in place.
- A socket connected to pod B is evicted by an event consumed on pod A.
- The evicted socket **received the event first**: fan out precedes the sweep.
- A user in three zones kicked from one keeps the other two and stays connected.
- `member.rejected` evicts nothing.

## 11. The OpenAPI document

Nothing here changes an HTTP request or response DTO. Run the generator and confirm the
empty diff rather than assuming it:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 12. Acceptance

1. A member kicked from a zone stops receiving that zone's events immediately, with a
   client that never unsubscribes.
2. They disappear from the zone's presence at once rather than on the heartbeat timeout.
3. A member who loses read access to one list stops receiving that list's events and
   presence, and keeps every other list in the zone.
4. A demoted admin stops receiving the governance counts and keeps the ordinary ones.
5. All of the above hold when the socket and the consuming pod are different pods.
6. A well behaved client's own unsubscribe still works and the sweep is a no-op after it.
