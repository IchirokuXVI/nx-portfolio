# 0026: joining a group left it stale, and its new member nameless

> Prerequisite reading: `0016` section 3.2 (refused rooms and the "not live" notice),
> `0021` section 4.3 (the approval that arrives on the caller's own channel) and
> backend `0030` section 4.1 (why it has to).
>
> Two independent defects with one trigger. Neither causes the other, and fixing either
> alone leaves half the report standing.

## 1. The report

Somebody joins a group with a code. The owner accepts. The joiner's dashboard updates
by itself and the group becomes tappable, so the live connection is plainly working.
They open the group and it says **"not updating live right now"**, permanently, until
the page is reloaded.

And from the other side: the owner cannot see the new member's presence indicator, even
once that member is on the group's screen.

## 2. The first defect: an ask that could only ever be refused

`ZoneStore._syncRooms` subscribes to a room for every zone in `myZones()`. `myZones()`
includes a zone the caller has only **requested** to join, because a join request loads
a pending summary so the dashboard can show the request it is waiting on.

The server's `checkZone` is `requireApproved`. So that subscription is a guaranteed
`{ ok: false }`, and `RoomRegistry` latches a refusal for the whole connection, on
purpose:

> A `{ ok: false }` acknowledgement is not retried on the same connection: it means core
> says the caller is not in the zone, and asking again gets the same answer.

Every word of that is right, and its last clause is the bug: asking again gets the same
answer **until the owner accepts**, which is an authorization change inside one
connection. The latch's own doc anticipated only the other kind:

> Every latch clears on the next `connect`, because authorization can change between
> connections.

Which is why reloading has always fixed it. A reload is a new connection.

### 2.1 Why approval did not clear it

The approval does reach the client: backend `0030` addresses it to the member's own
`user:{userId}` room, precisely because a pending member is not in the zone room where
their own approval is announced. `myStatus` flips and `_syncRooms` runs again.

And `_syncRooms` does nothing, because the zone is **already held**. Its first loop
releases a room only when the zone is gone or its staff intent changed, and neither is
true; its second loop skips a zone already in `_rooms`. Even had it re-asked, the
registry skips a latched zone.

So the notice stood, on a group the caller was by then a full member of, with a healthy
socket, for the life of the connection.

### 2.2 The fix

`_syncRooms` wants only zones the caller is **approved** in.

Both halves fall out of that one line. A pending zone is never asked for, so no refusal
is ever latched and no false notice is ever drawn. And when the approval lands, the zone
enters `wanted` for the first time and is subscribed fresh, on the same connection.

It is also self-healing in the other direction, which is worth noticing rather than
relying on by accident: the registry drops a zone's latch with its last holder, so a
standing that changes releases the room and clears whatever was latched against it.

**No new mechanism.** An earlier draft of this plan added `retryZone(zoneId)` to the
client interface and called it on a membership change. That works, and it is strictly
more machinery to express "stop asking a question whose answer is known to be no".

## 3. The second defect: a name cache with no end

`MemberNames.ensure` is idempotent, which it must be: every row in a comment sheet would
otherwise ask for the same list. It was also **permanent**. A zone asked for once was
never asked again and never told anything, so a member who joined afterwards had no name
for the rest of the session.

That is invisible in the worst way, because `presenceNames` drops whoever it cannot
name, deliberately:

> To the person reading, "not loaded yet", "left the group" and "not allowed to see
> them" are one fact, and none of the three is a hex string.

So the new member was in `onlineIn`, carried in the view model, and then silently
dropped for want of a name. The presence indicator was the symptom that got reported;
their comments and the lines they added were equally anonymous.

It is a **separate** defect from section 2 and survives that fix. Section 2 is about the
joiner's client not being live. This one is about the **owner's** client not knowing who
the joiner is, and it bites whenever the owner had already loaded that zone's members,
which visiting any list in the group does unconditionally.

### 3.1 The fix

`MemberNames` subscribes to the realtime events and folds a membership into a zone it
has already asked for.

The six membership events carry a whole `Membership`, username included, so this costs
**no request**: the name is in the event that announces the person. Re-fetching the zone
on every membership change would put a request behind an indicator that is only ever
advisory.

Three rules go with it.

- **Only zones already asked for.** A zone nobody has loaded must not acquire a one
  entry cache from a passing event, or `membersOf` hands the share sheet a single row
  and looks complete rather than empty.
- **Nothing is ever removed**, kick and ban included. The class's existing rule stands:
  a comment outlives its author's membership.
- **`_absorb` replaces by membership id rather than appending.** It had one caller and
  appending was safe; now that events feed it too, an append would give the share sheet
  two rows for one person the moment somebody was renamed, and leave the old name in
  `membersOf` beside the new one.

## 4. Acceptance

1. A pending zone puts nothing in `refusedZones`, so no group ever shows the "not
   updating live" notice on the strength of a request that has not been accepted.
2. Being approved is enough: the room is joined on the same connection, with no reload,
   and the notice is absent when the group is opened.
3. The newly approved member can announce presence in that group, because they are in
   the room the intent requires (plan `0023`).
4. An owner whose client already loaded the zone's members sees the new member's name,
   and therefore their presence indicator, with no request made for it.
5. A rename reaches `membersOf` as one row, not two.
6. A kicked member keeps their name on the comments they wrote.
