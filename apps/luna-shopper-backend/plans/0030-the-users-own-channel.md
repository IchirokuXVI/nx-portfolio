# 0030 The user's own channel

> Depends on 0009 (realtime), 0018 (global username) and 0028 (the Redis backplane).
>
> Companion plan: `apps/velista/plans/0021`, the client half.
>
> Verified against the source on 2026-08-28.

## 1. The hole, stated once

Every realtime room in this system is scoped to a **resource**: `zone:{id}`,
`zone:{id}:staff`, `list:{id}`. Every event is routed from `DomainEvent.zoneId`, and
`zoneId` is a required field on the envelope. A socket hears about a thing only after it
has been granted access to the thing.

That is the right default and it has one consequence nobody designed for:

> Nothing can be told to a **person**. Only to a person who is already in the room where
> it happened.

Three ordinary things fall in that hole, and they are the three defects this plan closes:

| What happens                            | Why no client hears it                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| A join request is **approved**           | `checkZone` calls `requireApproved`, so a PENDING member is refused `zone:{id}`. They are not in the room where their own approval is announced. |
| A user **creates a group**               | There is no `zone.created` event at all, and the new zone's room contains nobody but the creating tab, which never joined it. |
| A user **changes their global username** | `user.usernameChanged` is an auth event that never enters the realtime stream, so it never reaches a socket. `member.usernameChanged` covers the per zone half only. |

The last one is the one to keep in mind while reading, because it is the one that cannot
be patched with a wider room: a user with no zones has no room at all, and their username
is still theirs to change.

`apps/velista/plans/0018` section 6 already reached this conclusion and named it as
out of scope:

> Making it live would mean publishing an identity event to the socket, which is a
> backend decision and a backend plan.

This is that plan.

## 2. `user:{userId}`

One new room. A socket joins it **at connection**, from the id the token already gave:

```ts
async handleConnection(client: Socket) {
  const claims = await this.tokenVerifier.verify(this.tokenOf(client));
  client.data.userId = claims.sub;
  await client.join(userRoom(claims.sub));
  this.presence.register(client.id, claims.sub);
}
```

Three properties fall out of that placement and each is deliberate:

- **No `subscribe` message, and no access check.** Every other room is asked for and
  checked because the socket is claiming a relationship to a resource. Here the token
  *is* the claim, it was just verified, and asking core "may this user hear about this
  user" would be a round trip to answer a tautology.
- **No refcount, no client-side registry.** `RoomRegistry` exists because two containers
  can want the same zone. Nothing wants or releases this room; it exists for the life of
  the connection.
- **It is joined before any subscribe can arrive**, so an event published in the same
  tick as a client connecting is not lost to a race between connect and subscribe.

`userRoom(userId)` goes in `libs/luna-shopper/contracts/src/lib/messages/realtime.messages.ts`
beside `zoneRoom`, `zoneStaffRoom` and `listRoom`, because the client half needs to know
nothing about it and the server halves all do.

**The SSE controller joins it too.** 0009 built two transports over one relay so a
WebSocket client and an SSE client receive byte identical payloads; a room that only one
of them can be in would break that property quietly, in the transport nobody develops
against.

## 3. The envelope grows an audience

`DomainEvent.zoneId` is `string`, required, and `JetStreamConsumer.handle` builds
`const rooms = [zoneRoom(envelope.zoneId)]` from it unconditionally. Neither survives an
event about a user.

```ts
export interface DomainEvent<T = unknown> {
  event: RealtimeEvent;
  eventId: string;
  /** The zone room, when the event belongs to a zone. */
  zoneId?: string;
  /** Present on list-scoped events, for `list:` routing. */
  listId?: string;
  /** Users whose own sessions must hear this, whatever rooms they hold. */
  userIds?: readonly string[];
  payload: T;
}
```

The consumer builds its room list from whichever are present, and **an envelope with no
audience at all is dropped and logged as a fault** rather than fanned out to nothing.
That branch is unreachable today and it is written anyway: it is the one mistake this
change makes possible, and a silent no-op is how it would be found six months later by
somebody wondering why one event never arrives.

### 3.1 Why `userIds` is on the envelope and not read from the payload

The consumer deliberately does not know payload shapes. 0009 put `listId` on the envelope
for exactly that reason:

> ... so the realtime service can route them to the `list:{listId}` room without having
> to know each payload's shape.

`userIds` follows it. The producer states the audience and the consumer routes, where the
producer is core, which built the payload and knows whose membership it is. A consumer that reached into
a payload for `userId` would be correct for six membership events and wrong the first time
an event's payload named a user for some other reason.

### 3.2 Making `zoneId` optional is a change to every producer's type, not to its code

`CoreEventsPublisher.emit(event, zoneId, payload)` keeps its signature, so no existing call
site changes. What changes is that a second overload exists for an audience, and the
compiler stops guaranteeing `zoneId` to the consumer, which is the point, and which is
why the consumer's fault branch above is mandatory rather than defensive.

## 4. The three events

### 4.1 Approval reaches the person approved

`member.approved`, `member.rejected`, `member.kicked` and `member.banned` are already
emitted with the zone's id. They additionally carry `userIds: [membership.userId]`.

The approved member's own sessions then receive their approval whether or not they hold
the zone room, which for a PENDING member they never do. The kicked and banned cases gain
the same guarantee against a race the current code wins only by timing: the realtime
service invalidates the access cache **before** fanning out, so a socket removed from the
room in the same tick can miss the event that says why. Routing to the person as well
makes that unlosable.

`member.joined` also carries it, so a person's own PENDING join request lands on their
other tab.

`member.roleChanged` carries it too. It is not one of the three reported defects, since
the promoted member is in the zone room and does receive it, and it is included because
the audience is a property of the event and not of a defect. An event about a person's
standing is addressed to that person.

**The payload does not change.** A `MembershipView` is what every one of these already
sends and what the client already maps.

### 4.2 A created zone reaches the creator's other sessions

A new event, `RealtimeEvent.ZoneCreated = 'zone.created'`, added to the enum and to
`DOMAIN_EVENT_SUBJECTS`. `ZoneService.create` emits it with `userIds: [req.userId]` and
**no** `zoneId`: nobody is in the new zone's room, so routing it there sends it nowhere.

The payload is the `ZoneView` the endpoint returns, which is what the creator's own
session already receives as an HTTP response. It is enough for the receiving tab to
identify the zone and ask for the rest, which is the client's job (velista `0021` section
4) and not this plan's. Composing a full `MyZoneView` for an event would mean running the
summary query for a zone that is one member, no lists and no requests, to save a client a
request it is going to make on the next reload anyway.

Joining a group needs no equivalent: `member.joined` already exists and 4.1 addresses it
to the joiner.

### 4.3 A global rename reaches the person renamed

`user.usernameChanged` is an **identity** event, published by auth on the broker
(`identity-events.publisher.ts:56`), with its own envelope
(`UserUsernameChangedEvent`) and its own consumer contract. It is not in
`DOMAIN_EVENT_SUBJECTS` and it must not be added there: the realtime consumer decodes a
`DomainEvent`, and teaching it a second envelope shape gives it a `switch` on which kind
of message it is holding before it can do anything at all.

**Core re-publishes it as a domain event.** `UsernamePropagationService.handleUsernameChanged`
already consumes it, already runs at most once per change through the processed-events
inbox, and already emits `member.usernameChanged` per affected membership. It emits one
more thing:

```ts
this.events.emitToUsers(RealtimeEvent.UserUsernameChanged, [event.userId], {
  userId: event.userId,
  username: event.newUsername,
});
```

Placed in `handleUsernameChanged` **outside** the `GLOBAL_ONLY` early return in `apply`,
because GLOBAL_ONLY is precisely the mode where no membership changed and therefore the
mode where this is the only event the user's other tabs will ever see. Getting that
backwards produces a rename that is live in every mode except the one that renamed only
the global name.

Inside `runOnce`, so a JetStream redelivery of the identity event does not publish it
twice.

The new `RealtimeEvent.UserUsernameChanged = 'user.usernameChanged'` shares its string
with the identity event, and that is fine and worth one sentence: they are on different
streams with different envelopes, the identity one is a service-to-service message and
this one is a fan-out subject. If the shared string proves confusing in the stream
configuration, the subject is `user.usernameChanged.broadcast`; decide it when the stream
is configured, and write down which was chosen.

**Chosen when it was built: `user.usernameChanged.broadcast`.** The shared string does
not survive contact with the stream configuration, because the stream captures by
subject on the same broker auth publishes to: `user.usernameChanged` in
`DOMAIN_EVENT_SUBJECTS` pulls auth's identity event into the realtime consumer, which
decodes it as a `DomainEvent`, finds no audience on it and logs section 3's fault on
every rename. So the enum value stays `user.usernameChanged`, since that is the name a
client listens on and the socket emits `DomainEvent.event` rather than the subject, and
`domainEventSubject()` maps that one event to its `.broadcast` subject for the publish
and the stream. The same function keys `domainEventContracts`, so the two envelopes are
not two shapes behind one key in the schema registry either.

## 5. Access, and what a user room does not become

The room is not a bypass. What may be sent to it is only what the person may see about
themselves:

- Their own membership, in a zone they are a member of, pending or otherwise.
- A zone they just created.
- Their own username.

Nothing zone-scoped is ever addressed to a user room to save a subscribe. The rule to hold
the line at: **an event goes to a user room when its subject is the user; it goes to a
resource room when its subject is the resource.** An approval is about the person, which is
why it goes to both.

`ACCESS_INVALIDATING_EVENTS` is unchanged. Nothing here changes who may hear a zone; it
changes who hears an event about a person, and there is no cached decision behind that.

## 6. Tests

- The gateway joins `user:{sub}` on connect and a socket receives an event addressed to it
  having sent no `subscribe` message at all.
- An envelope with `userIds` and no `zoneId` fans out to the user rooms and to nothing else.
- An envelope with neither is dropped and logged, and does not throw into the consume loop.
  That last clause matters: `ef827b5` in this repo is a fix for a realtime consume loop
  that never came back.
- `zone.created` is emitted on `POST /v1/zones` addressed to the creator alone.
- `member.approved` reaches a socket belonging to a PENDING member who is in no zone room.
- `user.usernameChanged` is re-published for **every** propagation mode, GLOBAL_ONLY
  included, exactly once per identity event under redelivery.

## 7. The OpenAPI document

Nothing in this plan changes an HTTP request or response DTO, so the gateway's document
should be byte identical. Run the generator anyway and confirm the empty diff, rather than
assuming it:

```sh
npx nx run luna-shopper-backend-gateway:openapi
```

## 8. Acceptance

1. Two tabs signed in as the same user. Creating a group in one makes it appear in the
   other without a reload.
2. Two tabs signed in as the same user. Changing the global username in one changes it in
   the other, in every propagation mode.
3. A user with a PENDING request open on the group's card is approved by an owner. Their
   session receives `member.approved` without holding the zone room.
4. A user in no zones at all changes their username and their other tab updates.
5. Killing the realtime pod mid-stream and restarting it replays and delivers the above,
   unchanged from today's behaviour.
