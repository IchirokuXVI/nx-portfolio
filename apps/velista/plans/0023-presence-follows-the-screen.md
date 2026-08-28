# 0023: presence follows the screen you are on

> Prerequisite reading: `0017` (presence over the socket) and `0022` (presence on groups
> and lists), whose section 3.1 this plan contradicts and explains.
>
> Companion plan: `luna-shopper-backend/plans/0033`, which splits the intent out on the
> server. That half must be deployed first; its section 5 says why.

## 1. What was wrong

`0022` section 3.1 said this, and it was true:

> `PresenceStore.onlineIn(zoneId)` needs no intent: the server computes zone presence
> from who holds the zone room, and `ZoneStore._syncRooms` already holds one per zone.
> So this data is arriving today, for every group on the dashboard, and nothing reads
> it.

Every clause is accurate and the conclusion is the defect. `_syncRooms` holds a room for
**every zone in `myZones()`**, for the whole session, because that is what keeps the
counts on the group cards live. So "who holds the zone room" is not who is in the group;
it is who is a member of it and has the app open. A person in three groups appeared in
three, and stayed in all three until they closed the tab.

From the user's seat this reads as presence being sent on page load and never again,
which is the report that started this plan, and it is a fair description of the
behaviour even though nothing about page load was involved.

The mistake is worth naming precisely, because `0022` made it with its eyes open and
the reasoning looked sound: it read a room as a statement of where somebody is, when
that room is held to receive data about somewhere they are not. `0017` had already
drawn the same distinction for lists, in the same file, and this plan is that
distinction applied one level up.

## 2. The change

`RealtimeClientI` gains `enterZone`, beside `viewList` and shaped exactly like it: it
takes the room on the caller's behalf, because the server refuses the intent from a
socket that is not in `zone:{id}`, and it returns one release that gives back both.

`subscribeZone` keeps its meaning and its callers. `ZoneStore._syncRooms` is unchanged
and must be: the dashboard still wants every group's counts live, and that is what the
subscription was always for.

`RoomRegistry` gains `presenceHolders` on the zone desire and a zone pass in
`reconcilePresence`, mirroring `viewHolders` and the view pass line for line. Everything
that made the list version correct carries over unchanged: the intent is proposed only
for a room already recorded as joined, a refusal latches for the connection and is
lifted by the room being re-subscribed, a timeout is retried, and a room going away
takes the announcement with it silently because `zone.unsubscribe` already drops
presence on the server.

## 3. Which screens announce, and why each

**A screen holds the intent, never a store.** That is the whole idea: a store outlives
navigation and a screen does not, and the thing being answered is where the person is.

- **The group page.** The obvious one. It is the screen about one group.
- **The list page.** Shopping a list in the kitchen group is being in the kitchen group,
  and it is the case the dashboard's "here now" row most wants to be true for. It
  already held `subscribeZone` for `list.deleted` and `list.accessChanged`; that call
  becomes `enterZone`, one room and one refcount as before.
- **The members page.** A screen about one group, so it counts. Its existing
  `subscribeZone(zoneId, { staff: true })` stays a plain subscription and the intent is
  separate and **unconditional**, because that one is held only for an owner or an
  admin: presence that depended on the reader's role would light up for staff and leave
  every ordinary member invisible.

**The dashboard announces nothing**, and this is the rule that keeps the feature
honest. It is the mirror of `0022` section 2.1's decision for the resume card:

> Reading the dashboard is not shopping.

Reading the dashboard is not being in any particular group either. A dashboard that
announced would put every user into every group at once, which is the bug this plan
exists to remove, reintroduced by a different route.

## 4. What this does to the surfaces `0022` built

Nothing structural. All four still read `onlineIn` and `viewersOf` and still draw
nothing for nobody. What changes is that the answers become sparse and start moving:

- A zone card's presence row now appears when somebody opens that group and disappears
  when they leave it, rather than standing permanently for every member with the app
  open.
- `0022` section 8's `hasOthers` gate on `MemberNames.ensure` becomes load bearing in a
  way it was not before. It already counts a viewer on any of the zone's lists as
  somebody being here, which is what keeps names resolving now that zone presence is
  usually empty. Had that fix not landed with `0022`, this plan would have had to make
  it.

## 5. Acceptance

1. Two accounts sharing three groups, both on the dashboard. Neither appears in any of
   the three presence rows.
2. One opens a group. Exactly that group's card lights on the other's dashboard.
3. That account navigates to another group. The first card goes dark and the second
   lights, from the navigation alone.
4. Opening a list keeps its group lit; leaving the list to the group page keeps it lit;
   going back to the dashboard clears it.
5. A registry spec asserts that a plain `subscribeZone` proposes no intent, that the
   intent waits for its room, and that releasing the screen's hold leaves the
   subscription in place.
6. Killing the socket clears everything at once, as `0022` section 5 already requires,
   and the intent is announced again on the next connection.
