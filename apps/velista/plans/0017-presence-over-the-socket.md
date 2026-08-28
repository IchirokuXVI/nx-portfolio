# 0017: presence over the socket

> Prerequisite reading: `0016` section 3.5 (finding F4, the gap this closes) and section
> 5.3 (the seam it left), plus `0004` section 6.7 (presence is advisory).
>
> Backend facts below were verified against the source on 2026-08-28 and are cited by
> file. The backend half of this is already built: plan `0028` of
> `luna-shopper-backend` moved presence into Redis, which is what makes it worth
> consuming.

## 1. Goal

Give Velista the presence half of the realtime layer: the four intents the server has
always accepted and no client has ever sent, a store that applies the two presence
events the mapper has always understood, and one screen that renders the result.

`0016` built the transport and recorded presence as a **designed** hole (F4). It stayed a
hole for a good reason, written down in `0004` section 6.7: presence was held in one
pod's memory, so it was correct at one replica and quietly wrong at two, and the
deployment did not prevent two. Backend plan `0028` is the change that removes that
reason. Presence now lives in Redis sorted sets scored by a heartbeat, a pod that is
OOM killed drains out of every room within the window with no disconnect handler, and
`replicaCount` is back to 2 because all four pieces of per pod state became per system
state.

So this plan is the client catching up to a server that became honest.

## 2. What already exists

More than is comfortable, which is the shape `0004` aimed for: everything except the
sending and the storing.

| Piece                                                               | Where                                        | State                              |
| ------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| `presence.zoneUpdated` / `.listUpdated` in the event union          | `realtime/realtime-events.ts`                | Built                              |
| `toZonePresence` / `toListPresence`                                 | `mapping/mappers.ts`                         | Built, total                       |
| `ZonePresence` / `ListPresence` / `PresenceUser` / `PresenceEditor` | `velista/models`                             | Built                              |
| The resume card's presence row                                      | `ui/.../resume-list-card.html`               | Built, rendered                    |
| `home.presence.shopping` in both locales                            | `ui/assets/i18n/{en,es}.json`                | Built                              |
| `shoppers`                                                          | `feature-home/.../select-home-state.ts`      | **`[]`, with a comment saying so** |
| The four intents                                                    | nowhere on the client                        | **This plan**                      |
| `PresenceStore`                                                     | nowhere, though `0004` section 6.5 names one | **This plan**                      |

No new dependency. No change to the lifecycle in `0016` section 6.

## 3. What the server actually does

Four facts decide the shape of everything below, and three of them are not what a
reader would guess.

### 3.1 Zone presence needs no intent at all

`zone.subscribe` calls `presence.joinZone` inside its own handler
(`realtime.gateway.ts`), the same way it joins the staff room. So **being subscribed to
a zone is being present in it**, and there is no `presence.joinZone` message for a
client to send. Everything Velista already does puts the user in zone presence; nothing
had ever read the result.

### 3.2 A list presence intent requires the list room

`presence.view` and `presence.edit` both answer `{ ok: false }` when
`client.rooms.has(listRoom(listId))` is false, and neither costs a round trip to core
because they trust the membership that `list.subscribe` already established. Two
consequences the client cannot avoid:

- **Viewing a list implies subscribing to it.** The client cannot announce presence on a
  room it is not in, so the two are one acquisition, not two.
- **An intent cannot be sent in the same breath as the subscription that permits it.**
  The subscribe has to be acknowledged first. Section 5 is where that ordering lives.

### 3.3 Leaving the list room clears both intents, and the client must not say so twice

`list.unsubscribe` calls `presence.unviewList`, which removes the viewer **and** the
editor entry for that socket (`presence.service.ts`). So an unsubscribe is a complete
presence cleanup, and a client that politely sent `presence.unview` before it
unsubscribed would be paying for two round trips to accomplish one thing.

### 3.4 Presence payloads carry a user id and no name

`broadcastZone` publishes `online: [{ userId }]` and `broadcastList` publishes
`viewers: [{ userId }]` and `editors: [{ userId, lineId }]`. There is no username on the
wire, and `toPresenceUser` already defaults it to the empty string rather than inventing
one.

This is the same hole `MemberNames` was built for in plan `0012`: the only place in the
API that pairs a user id with a human name is `MembershipView`, and a name is **per
zone**, because a membership's username is what that person goes by in that group. So
presence stores ids, and the screen that renders names resolves them through
`MemberNames` for the zone it is rendering. Nothing may carry a name across zones.

## 4. The client contract

Two methods on `RealtimeClientI`, and they are deliberately different shapes because the
two intents are different things.

```ts
/** Announce that this client is looking at a list. Refcounted; the release stops. */
viewList(listId: string): () => void;

/** Say which line of a list this client is editing, or null for none. */
setEditingLine(listId: string, lineId: string | null): void;
```

- **`viewList` is refcounted and returns a release**, like `subscribeZone` and
  `subscribeList`, because two things on one screen can want it and the last one out
  turns the light off. It **acquires the list room too** (section 3.2), so a caller
  never has to hold two subscriptions to express one fact.
- **`setEditingLine` is state, not a release.** The server holds exactly one edited line
  per socket per list (`presence.edit` overwrites, `presence.stopEdit` takes a `listId`
  and no line), so a release closure would be a lie: a stale one firing late would stop
  an edit that had already moved to another line. Passing the current value, including
  `null`, is the only shape that cannot drift from what the server holds.

`REALTIME_CLIENT_MESSAGES` gains the four names it has been missing:
`presence.view`, `presence.unview`, `presence.edit`, `presence.stopEdit`.

## 5. Where the state lives, and the ordering rule

Presence desire goes in `RoomRegistry`, beside room desire, for the reason the registry
exists at all: **it is per connection state that has to survive a reconnect**. A socket
that drops and comes back is in no rooms and is present nowhere, however sure the app is
that it is viewing a list. Rule R6 of `0016` already says rooms are resubscribed from the
registry rather than from a queue, and presence is subject to exactly the same rule for
exactly the same reason.

The registry therefore holds, per list: the room refcount, the **view** refcount, and the
editing line. Its per connection joined state gains the views it has announced and the
edit it has sent, and `onConnected` / `onDisconnected` clear those with everything else.

### 5.1 Rooms first, presence second, in one pass

Section 3.2 means an intent is only sendable once its room is joined, so `reconcile()`
keeps its existing meaning and answers about rooms alone, and a second method,
`reconcilePresence()`, answers about intents and only ever proposes one for a list the
registry has already recorded as joined.

The transport runs them in that order inside one reconcile pass: await the room asks,
then compute the presence plan, then await those. **Not a loop.** Letting the existing
do/while carry the second phase looks tidier and is wrong: a room ask that failed clears
its pending flag so the next pass would re-ask it immediately, turning R7's deliberate
five second retry into a tight loop against a slow core.

### 5.2 An unsubscribe is a silent presence cleanup

Following 3.3: when a list room is being left, the registry drops its joined view and
joined edit **without proposing a message for either**. The server does that work inside
its own unsubscribe handler, and saying it again costs two acks for nothing.

### 5.3 A refused intent latches for the connection, and is cleared by a re-join

`{ ok: false }` from `presence.view` means the server does not think we are in the room.
We only ask when we believe we are, so it is a disagreement rather than an ordinary
refusal, and asking again on the same connection would spin. It latches, and the latch is
dropped when that list room is subscribed again, which is the event that could actually
change the answer. This is R8 applied one level down.

A timeout, exactly as in R7, is not a refusal: the intent stays unsent and the reconcile
already scheduled by the failed ask retries it.

## 6. `PresenceStore`

`libs/velista/data-access/src/lib/presence/presence-store.ts`, provided by the app
alongside the other stores (rule D5, since it resolves `REALTIME_CLIENT`).

It applies the two presence events, keeps the last snapshot per zone and per list, and
answers `onlineIn(zoneId)`, `viewersOf(listId)`, `editorsOf(listId)` and
`editorOfLine(listId, lineId)`. Three properties are worth stating because each is a
decision rather than an accident:

- **A snapshot replaces, it does not merge.** The server sends the whole room every time
  and the whole room is the only self consistent thing to hold. Merging deltas into a
  snapshot feed is how a viewer who left stays on screen forever.
- **It clears when the connection drops.** Presence is per connection, so the moment the
  socket goes away every snapshot describes a room this client is no longer in, and
  showing it would be the `0016` failure mode: looking live while being stale.
- **It does not filter out the current user.** The store keeps what the server said;
  whether "you" belong in a sentence is a rendering decision, and the home card makes it.
  A store that quietly dropped a user id would make `viewersOf` disagree with the count
  the server broadcast, which is a bad thing for a debugging surface to do.

## 7. The one screen

The resume card on home, which has rendered presence since `0003` and has been handed an
empty array ever since. It needs three things joined together: the list's viewers, their
names, and everyone except the reader.

- **Home subscribes to the resume list's room.** `0016` section 10 item 3 says not to add
  list subscriptions to get updates that already arrive over the zone room, and that rule
  is intact here rather than broken: `presence.listUpdated` is broadcast to `list:{id}`
  **only** (`presence.service.ts` publishes `rooms: [listRoom(listId)]`), so this is a
  subscription for something that genuinely does not arrive otherwise. One room, for one
  card, released when the remembered list changes.
- **Subscribed, not viewing.** Home holds the room to observe it and sends no
  `presence.view`, because somebody looking at their dashboard is not shopping that list,
  and a card that lists the reader as a shopper is a card that is wrong about the only
  thing it says.
- **Names come from `MemberNames` for the resume list's zone**, and a viewer whose name
  does not resolve is left out of the sentence rather than rendered as an id. The card's
  copy is `{{names}} are shopping now`, and there is a count form beside it in both
  locales for when there are more names than a sentence wants.

## 8. Testing

`RoomRegistry`, pure, where the bugs are:

- A view acquires the list room too, and releasing it releases both.
- A view is proposed only for a list already joined, never in the same plan as its
  subscribe.
- A list being unsubscribed proposes no unview and no stop edit, and forgets both.
- `setEditingLine` to a second line proposes one `presence.edit` and no stop in between.
- `onDisconnected` forgets the announced view, so the next connection announces it again.

`RealtimeSocket`, against the existing `FakeSocket`:

- A view is sent after the subscribe it depends on is acknowledged, in that order.
- A refused view is not re-sent on that connection, and is sent again after the list room
  is subscribed on the next one.
- A reconnect re-announces every held view and the current edited line.

`PresenceStore`: a snapshot replaces the previous one; a drop of the connection clears
everything; an unmapped payload never reaches it, which the transport's counter already
covers.

`selectHomeState`: the reader is not in their own shoppers list, and an unresolved name
is absent rather than an id.

## 9. Scope

**Out**, and each for a reason rather than for time:

- **Presence on the list page.** `0012` section 9 put it out of scope and that plan's
  judgement holds: showing who else is looking is a good screen and it is not what makes
  the list page work. The layer this plan builds is what makes it a component rather than
  a project, and `editorOfLine` exists for it.
- **Presence on the group page.** Same, one step further out.
- **A typing or dwell heuristic that decides when an edit starts.** `setEditingLine` is
  the mechanism; when to call it is a decision the screen that owns the editor makes, and
  there is no such screen in this plan.
- **Any use of presence to gate an action.** `0004` section 6.7 is unchanged: presence is
  advisory, it may under report, and nothing destructive is ever guarded by "nobody else
  is here".

## 10. What changed while building it

The plan above is left as written, for `0016` section 14's reason: a plan quietly edited
to match what was built stops being evidence of anything. This section is the diff.

### 10.1 The last viewer out stops editing

Section 4 makes `viewList` refcounted and `setEditingLine` a single value, and says
nothing about what happens to the second when the first reaches zero. Left alone, a page
that released its view without clearing its line would leave the registry wanting an edit
on a list nobody is looking at, which the server would go on broadcasting to everybody
else. Releasing the last **view** holder clears the edited line, so the one intent that
cannot be refcounted is bounded by the one that can.

### 10.2 A refused edit latches the same set as a refused view

Section 5.3 covers `presence.view`. The server's only reason for refusing
`presence.edit` is the same room check, so it latches the same list rather than getting a
set of its own. Two latches for one server condition would be two things to clear, and
one of them would eventually be missed.

### 10.3 A stop keeps its record until it is acknowledged

The registry proposes an unview or a stop edit and does **not** forget it at the same
moment. A stop that timed out has to be proposed again, because the server still believes
this client is viewing or editing, and forgetting locally is precisely how the two ends
stop agreeing with nobody left to notice. Only the acknowledgement clears it.

### 10.4 `forList` exists as well as the accessors

A signal view of one list, for a container that holds it in a `computed`. `ListStore`
already offers `forZone` for the same reason: the accessors read a signal and are
reactive where they are called, but a container that wants to keep one list's presence
should be able to keep a thing rather than a call.

### 10.5 The fake takes ids, not names

`fakePresenceStore` in `store-doubles.ts` accepts user ids and fills the username with
the empty string, because that is what the wire carries. A double that accepted names
would let a screen pass its test by rendering a field the server never sends, which is
the specific bug section 3.4 exists to prevent.

### 10.6 The home spec asserts on the card's input

The testing translator returns a key without interpolating it, so the rendered sentence
never contains a name whatever the container computed. The presence tests read
`ResumeListCard`'s input instead, which is the boundary that matters anyway: the
container resolves who is shopping, and the card renders a list of names.

### 10.7 Measured

`0016` recorded 341.96KB initial after adding the transport. With presence: **342.40KB**,
against the 1mb budget. The layer added no dependency and no initial chunk, which is what
it should cost.
