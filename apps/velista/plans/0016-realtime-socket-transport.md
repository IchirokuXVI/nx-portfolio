# 0016: the realtime socket transport

> Prerequisite reading: `0004` sections 6 to 9 (the realtime contract, the stores, and
> rule D5), and `0010` section 5.3 (rule G3, the staff room).
>
> Every backend and infrastructure fact below was verified against the source on
> 2026-08-27 and is cited by file and line. Where this plan and an earlier plan
> disagree, the code won and the disagreement is written down rather than quietly
> resolved.

## 1. Goal

Give Velista a real live connection: a Socket.IO implementation of `RealtimeClientI`,
bound behind the `REALTIME_CLIENT` token, so that the stores that already apply realtime
events start receiving them from the server instead of from a fake.

The deliverable is **the base, not the coverage**. One transport, one subscription model,
one lifecycle, tested. It does not convert every data source to a live one and it does not
build presence. What it must guarantee is that the next feature which wants a live update
writes a mapper case and a store branch, and touches nothing in this layer.

The second half of the goal is worth as much as the first: **check that the data access
architecture the client already has is right**, because a transport built on a wrong
subscription contract is a transport that has to be built twice. Section 3 is that audit,
and it found two things that block the work and three that should be corrected while the
file is open.

## 2. What already exists, and what this plan actually adds

Most of this layer is built. `0004` was written before `0003` precisely so the contract
would exist before its first consumer, and it worked: everything except the wire is in
place.

| Piece                    | Where                                                          | State                                         |
| ------------------------ | -------------------------------------------------------------- | --------------------------------------------- |
| The interface            | `libs/velista/data-access/src/lib/realtime/realtime-client.ts` | Built, needs one signature change (section 4) |
| The event union          | `.../realtime/realtime-events.ts`                              | Built, 25 events                              |
| The mapper               | `.../realtime/realtime-event-mapper.ts`                        | Built, total and non throwing                 |
| The in-memory client     | `.../realtime/realtime-memory.ts`                              | Built, the token's default                    |
| Event application        | `zones/zone-store.ts`, `lists/list-store.ts`                   | Built                                         |
| Room desire              | `zone-store._syncRooms`, `members-page._syncStaffRoom`         | Built                                         |
| **The socket transport** | nowhere                                                        | **This plan**                                 |

So the addition is narrow: a class implementing an interface that already has two
implementations' worth of consumers, plus one dependency. That narrowness is the payoff
from `0004`, and it is the reason this plan is mostly about getting the lifecycle right
rather than about structure.

**This plan adds exactly one runtime dependency: `socket.io-client`**, at `^4.8.x` to
match the server's `socket.io ^4.8.3` (`package.json:57`). Nothing else.

## 3. The audit: is the current data access architecture correct

### 3.1 What is right, and must not be touched

Recorded because a plan that only lists problems reads like a rewrite, and this is not
one. Five decisions are load bearing and correct:

1. **`REALTIME_CLIENT` is a `serviceToken` whose default is the in-memory client.** The
   whole app runs, and every spec passes, with no server anywhere. That is what makes
   adding the transport a one line binding in `app-providers.ts` instead of a migration.
2. **Every payload goes through `toRealtimeEvent`, which is total and never throws.** For
   a socket this is not merely tidy, it is structural: an exception raised inside a
   Socket.IO listener propagates out of the emit loop, and one malformed payload would
   cost the user every subsequent event on the connection.
3. **Stores live in `data-access`, subscribe once in their constructor, and apply whole
   record replaces.** `0004` section 7.1 has the reasoning; nothing about a real transport
   changes it.
4. **Room desire lives in the store, refcounting lives in the client.** The store knows
   which zones matter; the client knows how many holders a room has and what the socket is
   currently in. Splitting it the other way is how a store ends up owning a reconnect.
5. **The client does not reconnect when the token refreshes** (`0004` section 6.4). Still
   right, and section 6 states it as a rule so nobody adds a `TokenStore` effect later.

The rest of this section is the four findings.

### 3.2 F1. `subscribeZoneStaff` is not a wire operation (blocking)

`RealtimeClientI` declares `subscribeZoneStaff(zoneId)` as a peer of `subscribeZone`, its
own refcounted room with its own release function, and its docstring says the server
"refuses it for a caller who is not OWNER or ADMIN, which surfaces through
`refusedRooms`" (`realtime-client.ts:45-53`).

**None of that is true of the server.** The gateway accepts exactly four subscription
messages (`realtime.gateway.ts:94,115,126,139`), and there is no staff message among them.
`zone:{id}:staff` is joined _inside_ the handler for `zone.subscribe`, silently, when
core's `checkZoneStaff` passes:

```ts
await client.join(zoneRoom(body.zoneId));
if (await this.coreAccess.checkZoneStaff(userId, body.zoneId)) {
  await client.join(zoneStaffRoom(body.zoneId));
}
return { ok: true };
```

`realtime.gateway.ts:105-111`. Three consequences, in ascending order of cost:

- **A staff room cannot be refused.** `zone.subscribe` answers `{ ok: true }` whether or
  not the staff join happened. A non staff caller is not told anything. So the refusal
  path that `ZoneStore.staleZoneIds` and rule G3 reason about
  (`zone-store.ts:160-167`, `zone-store.ts:510-518`) is a path the wire will never take.
  The stale badge those two exist to raise correctly can only ever come from the _whole
  zone_ being refused, which is a different and much louder condition.
- **A staff subscription cannot be released on its own.** `zone.unsubscribe` leaves the
  plain room and the staff room together (`realtime.gateway.ts:120-121`). There is no
  message that leaves one of them.
- **Refcounting the two independently is therefore unsound.** With a real socket,
  `ZoneStore._syncRooms` releasing a zone runs `leaveZone(); leaveStaff?.();`
  (`zone-store.ts:536-546`). The first call takes the zone refcount to zero and emits
  `zone.unsubscribe`, which on the server leaves _both_ rooms. Any other holder of the
  staff room, and `members-page` is exactly that (`members-page.ts:411`), is now silently
  out of a room its refcount says it is in. It looks live and is stale, which
  `realtime-client.ts:60-65` correctly names as the worst outcome available.

The in-memory client cannot expose any of this, because it models rooms as independent
strings (`realtime-memory.ts:72-95`), which is exactly what the server does not do. This
is the failure mode of a fake that is more orthogonal than the thing it fakes.

**Fix in section 4.** It is small, and it is the reason this is a plan rather than a task.

### 3.3 F2. The production realtime URL points at the gateway (blocking)

> **Resolved before this plan was scheduled, by plan 0014.** The two URLs are no longer
> literals: `environment.prod.ts` reads `LUNA_GATEWAY_URL` and `LUNA_REALTIME_URL`, which
> `webpack.prod.config.ts` substitutes at compile time and defaults to `api.` and **`rt.`**
> respectively. The audit below is kept because it is the reason that split exists, and
> because the second symptom, `isGateway` and `isRealtime` answering true for one string,
> is the sort of thing that comes back the moment somebody sets both variables to the same
> host.

`apps/velista/src/environments/environment.prod.ts:15` sets:

```ts
realtimeBaseUrl: 'https://api.ichirokuxvi.com',
```

The realtime service is not deployed there. `values.yaml:277` routes it at
`rt.ichirokuxvi.com`, and `api.ichirokuxvi.com` is the gateway (`values.yaml:269`), which
runs no Socket.IO server. Each host gets its own `HTTPRoute` with a root path prefix
(`httproute.yaml.tpl:87-94`), so there is no path on the gateway host that reaches the
realtime pod. A production client would fail its handshake against `/socket.io` forever.

Nothing has noticed because nothing has ever opened the connection. The moment this plan
lands it becomes the first failure in production, so it is listed first among the
prerequisites.

There is a second, quieter symptom of the same line. With both URLs equal,
`ApiUrl.isGateway(url)` and `ApiUrl.isRealtime(url)` return `true` for the same string
(`api-url.ts:37,42`), so the one guard standing between the app and attaching a bearer
token to a non gateway origin cannot currently tell the two apart. Correcting the host
resolves that as a side effect.

### 3.4 F3. `refusedRooms` is keyed by room and read as a zone id

The interface documents `refusedRooms` as "Zones whose subscription the server refused"
(`realtime-client.ts:59`) but the fake stores full room names (`realtime-memory.ts:74`),
and `ZoneStore.staleZoneIds` compensates by stripping the `zone:` prefix
(`zone-store.ts:160-167`). For `zone:abc:staff` that strip yields `abc:staff`, a zone id
that matches nothing, so a refused staff room would produce a stale entry that never
clears and never renders.

Latent today only because F1 means the wire cannot refuse a staff room. It is still worth
correcting, because the type says `ReadonlySet<string>` and the two ends disagree about
which string. Section 4 makes it a set of **zone ids**, and the transport does the
stripping once, next to the code that knows what it subscribed to.

### 3.5 F4. Presence has no client surface at all

The server accepts four presence intents, `presence.view`, `presence.unview`,
`presence.edit`, `presence.stopEdit` (`realtime.enums.ts`, handlers at
`realtime.gateway.ts:149,163,172,184`). `REALTIME_CLIENT_MESSAGES` lists none of them
(`realtime-events.ts`), `RealtimeClientI` has no method for any of them, and there is no
`PresenceStore` even though `0004` section 6.5 names one and both `presence.*` events map
correctly.

This is a **gap, not a bug**: nothing consumes presence, and `0004` section 6.7 is right
that presence is advisory and correct only at one replica. It is recorded so the hole is a
designed one. Section 10 keeps it out of scope and section 5.3 leaves the one seam that
makes adding it later a method rather than a redesign.

### 3.6 F5. Staging builds carry the production API configuration

> **Resolved before this plan was scheduled, by plan 0014**, and not the way this section
> guessed. There is still one `production` build configuration and no third environment
> file; what changed is that the hosts come from the build environment rather than from
> the file, so `docker-ci.yml` builds the staging image with `api.staging.` and
> `rt.staging.` and `release.yml` builds production with the bare hosts. The severity
> argument below stands as the record of why it mattered.

There are two environment files and one `production` build configuration
(`apps/velista/project.json`), and CI distinguishes staging from production only by
`DOCKER_IMAGE_TAG` and `MFE_BASE_URL`. So a staging Velista image is built with
`environment.prod.ts` and talks to the production gateway.

This predates the socket and is not the socket's to fix. It is listed because the socket
changes its severity: a staging client that reads production data is bad, and a staging
client that **joins production rooms and receives live production events** is worse, and
it is the kind of thing that is discovered by seeing somebody else's group name appear.

## 4. The corrected subscription contract

One change to `RealtimeClientI`, which fixes F1 and F3 together.

```ts
export interface RealtimeSubscribeOptions {
  /**
   * Also ask for the zone's governance side room, `zone:{id}:staff`.
   *
   * Not a room of its own. The server joins it inside its `zone.subscribe` handler
   * when the caller is an OWNER or ADMIN (realtime.gateway.ts:108-109) and leaves it
   * inside `zone.unsubscribe` (:121), and it publishes no message that touches it
   * alone. So it is an intent carried on the zone subscription, and the transport
   * unions the intents of every holder of that zone.
   */
  readonly staff?: boolean;
}

subscribeZone(zoneId: string, options?: RealtimeSubscribeOptions): () => void;
```

`subscribeZoneStaff` is **removed**, not deprecated. It has two call sites, and leaving a
method whose name promises an independent room is how F1 comes back.

The rules that follow from it, which the transport implements and the fake must implement
identically:

- **R-S1. One refcount per zone.** Holders of the same zone share it whatever their staff
  intent.
- **R-S2. The staff intent of a zone is the OR of its live holders' intents.** One staff
  holder is enough to ask for it, and its release is what drops the ask.
- **R-S3. A change in the effective staff intent re-issues `zone.subscribe` for that
  zone**, with no unsubscribe in between. The handler is idempotent for the plain room
  (`client.join` of a room already joined is a no-op) and it re-runs `checkZoneStaff`, so
  a re-subscribe is exactly the promotion and demotion mechanism the server already
  expects (`realtime.gateway.ts:104-107` says so in its own comment). An unsubscribe first
  would open a window in which the caller receives nothing.
- **R-S4. `refusedRooms` becomes `refusedZones: Signal<ReadonlySet<string>>`, holding zone
  ids.** A refusal is `zone.subscribe` answering `{ ok: false }`, which is core saying the
  caller is not in the zone at all. Rename the member so the type and the meaning agree,
  and delete the prefix stripping in `zone-store.ts:160-167`.

### 4.1 What this costs at the call sites

Small, and both get simpler:

- `ZoneStore._syncRooms` (`zone-store.ts:501-549`) keeps its `wanted` map of
  `zoneId -> isStaff` unchanged, and its held entry collapses from
  `{ isStaff, release }` with two closures to one release. The release-and-rejoin on a
  staff change stays, and R-S3 makes it a re-subscribe rather than a leave and a join, so
  the comment at `zone-store.ts:524-531` about a demoted admin holding a refused room
  stays true and gets cheaper.
- `MembersPage._syncStaffRoom` (`members-page.ts:401-413`) becomes
  `subscribeZone(zoneId, { staff: true })`. It gains a refcount on the plain zone room,
  which it always needed and was getting only because `ZoneStore` happened to hold one.

### 4.2 Rule G3 keeps its reason, and loses one of its two justifications

`zone-store.ts:510-518` gives two reasons for reading staff-ness from `myRole` rather than
from the counts. The first, that `member.roleChanged` updates `myRole` immediately, stands
and is sufficient. The second, that a demoted admin asking for a refused room raises a
permanent false stale badge, is void under F1: there is no refusal to raise it. Trim the
comment to the reason that survives, rather than leaving a justification that the wire
contradicts.

## 5. The transport

Three pieces, split so that the part with the bugs in it is the part with no dependencies.

### 5.1 `SocketLike` and `SOCKET_FACTORY`

`libs/velista/data-access/src/lib/realtime/socket-factory.ts`.

A structural interface this app owns, naming only the members the transport uses:
`connect`, `disconnect`, `on('connect' | 'disconnect' | 'connect_error')`, `onAny`,
`timeout(ms).emitWithAck(name, body)`, and `connected`. Plus a token:

```ts
export const SOCKET_FACTORY = serviceToken<SocketFactory>('SOCKET_FACTORY', () => (url, options) => io(url, options) as SocketLike);
```

Two reasons, and the second is the one that pays:

1. **Rule D4's spirit applied to a library boundary.** No `socket.io-client` type crosses
   this file. The SSE implementation `0004` section 6.1 defers, and every test double,
   satisfies six members instead of `Socket`'s several dozen.
2. **No spec imports `socket.io-client`.** A transport spec that has to stub a real socket
   ends up stubbing its reconnection engine, which is precisely the behaviour section 6
   turns off.

### 5.2 `RoomRegistry`

`libs/velista/data-access/src/lib/realtime/room-registry.ts`. A plain class, no Angular,
no socket, no rxjs.

It holds the **desired** state (zone refcounts with staff intent, list refcounts) and the
**joined** state (what the current connection is actually in), and answers one question:
`reconcile(): { subscribe: ZoneAsk[]; unsubscribe: string[]; ... }`. Acquire and release
mutate desire; `onConnected()` clears the joined state, which is what makes a reconnect
the same code path as an ordinary change (see R6).

It is separate and pure because **this is where the bugs are**. Refcount transitions,
staff intent unions, and a release called twice are the things that break, and they are
testable in microseconds with no fake socket, no fake clock, and no `TestBed`.

### 5.3 `RealtimeSocket`

`libs/velista/data-access/src/lib/realtime/realtime-socket.ts`. `implements
RealtimeClientI`. Injects `ApiUrl`, `TokenStore`, `SessionStore`, `SOCKET_FACTORY`,
`DestroyRef`. Owns the lifecycle in section 6, the ack handling, and the event pipeline.

The event pipeline is one `onAny` listener filtered by `REALTIME_EVENT_NAMES`, mapped by
`toRealtimeEvent`, dropped and counted when the mapper returns null, pushed onto the
`Subject` the interface already exposes. **One listener, not twenty five**, so a new
server event costs a union member and a mapper case and touches nothing here.

It also exposes `readonly droppedEvents: Signal<ReadonlyMap<string, number>>`, counts by
event name. Rule D4 says a bad payload is "dropped and counted" (`0004` section 6.5) and
today only the dropping is implemented. A silent drop is the one realtime failure with no
symptom at all, and this counter is the only thing that would ever reveal a backend
payload change.

**The seam for presence (F4)**: presence intents are emits with the same ack shape as a
subscription and no room bookkeeping, so they are `emitWithAck` calls on the same private
helper and nothing else. Adding them later is four methods on this class, four members on
`REALTIME_CLIENT_MESSAGES`, and a `PresenceStore`. No part of section 5 or 6 moves.

## 6. Lifecycle rules

Each is a rule because each has a failure it prevents.

**R1. No socket while anonymous.** The server verifies the token in `handleConnection` and
`client.disconnect(true)`s on failure (`realtime.gateway.ts:79-87`), so an anonymous
connect is a guaranteed drop. Connection is driven by an effect on
`SessionStore.isAuthenticated()`. On sign out: disconnect, clear the registry, clear
`refusedZones`, clear `degraded`. On sign in or the guest handshake: connect.

**R2. Await `ensureFreshToken()` before every connect attempt, reconnects included, and
therefore turn Socket.IO's own reconnection off.** `reconnection: false, autoConnect:
false`. This is the least obvious decision in the plan and the one most likely to be
undone by somebody tidying up. The library's reconnect fires from inside its own engine
and cannot await a promise, so it would reconnect with the token that was just rejected,
against a server that answers a bad token by disconnecting silently
(`realtime.gateway.ts:86`), forever. The transport owns the backoff because only the
transport can await the refresh.

**R3. Backoff with a cap, and a degraded latch.** Exponential from 1s, capped at 30s, full
jitter. After **two consecutive** failed connects where the token was fresh when sent,
`degraded` is set and retrying stops, which is `0004` section 6.2's rule. Reset the
counter and clear `degraded` on a successful `connect`. Re-arm on an identity change, on
the window `online` event, and on an explicit `retry()` a UI can call.

**R4. `degraded` must never reach `ConnectionState`.** The transport calls neither
`reportNetworkFailure` nor `reportReachable`. `ConnectionState.offline` raises `0003`'s
blocking screen and is fed by HTTP requests that got no response
(`connection-state.ts:38-40`); a realtime service that will not accept us is a different
condition with a different, much smaller treatment. Blocking a user whose every REST call
succeeds is the specific harm.

**R5. Never reconnect because the token refreshed.** `0004` section 6.4. The socket reads
`TokenStore` at connect time, so the next reconnect uses the current token by itself.
Tearing down a healthy connection every fifteen minutes buys a full resubscribe cycle and
nothing else.

**R6. Resubscribe from the registry on every `connect`, never from a queue.** Rooms are per
connection and server side, so a reconnect leaves the client in no rooms while its
refcounts say otherwise. `RoomRegistry.onConnected()` clears the joined set and the
ordinary reconcile does the rest. A queue of pending emits is the version that goes wrong,
because an emit queued before an auth rejection is stale by the time it flushes.

**R7. Every emit is `timeout(ms).emitWithAck(...)`, and a timeout is not a refusal.**
Socket.IO waits forever for an ack that never comes, and `zone.subscribe` costs a NATS
round trip to core (`realtime.gateway.ts:100`), so a slow core is an ordinary event. Five
seconds, then treat the room as not joined and let the next reconcile retry it. Latching a
timeout into `refusedZones` would paint a permanent "not live" badge on a group that was
merely slow, which is the false version of the exact signal that badge exists to give.

**R8. `{ ok: false }` latches into `refusedZones` and is not retried on that connection.
Every latch clears on `connect`.** A refusal is core's answer, and repeating the question
on the same connection will get the same answer. Authorization can change between
connections, so a new connection deserves a fresh one.

**R9. Nothing throws out of a handler**, for `0004` section 6.5's reason. The `onAny`
body is wrapped, and the mapper is already total.

**R10. Force `transports: ['websocket']`.** Socket.IO defaults to HTTP long polling and
upgrades, and long polling requires session affinity when more than one server instance is
behind the address. The realtime service runs at `replicaCount: 2` (`values.yaml:169`) and
its `HTTPRoute` declares no `sessionPersistence` (`httproute.yaml.tpl:87-94`), so polling
requests would land on either pod and the handshake would fail intermittently, which is
the worst shape of failure to debug. WebSocket is a single connection pinned to one pod
after the upgrade, so it sidesteps the problem entirely. The cost is losing the fallback on
networks that block WebSockets, and the note in section 11 item 3 is what would let this be
relaxed.

## 7. Wiring

Bind in `apps/velista/src/app/app-providers.ts`, next to `ZoneApi` and `AuthApi` and for
their reason: choosing to talk to a real server is the app's call, and the transport needs
services that exist only in the app injector (rule D5).

```ts
provideService(REALTIME_CLIENT, RealtimeSocket),
```

**Not** in `VELISTA_DATA_ACCESS_PROVIDERS`. `RealtimeMemory` stays the token's default, so
every spec, and every run without a backend, keeps working with no change at all. That is
the property `0004` bought and this plan spends.

No environment initializer. `ZoneStore` injects `REALTIME_CLIENT`
(`zone-store.ts:101`), so the transport is constructed when the store is, and its
constructor effect on `isAuthenticated()` starts the lifecycle. `ConnectionRecovery` needs
an initializer only because nothing injects it (`app-providers.ts:149`).

**One line in `RealtimeSocket` deserves a comment**: it must not import from
`@angular/core/rxjs-interop`. `RokuLocaleStore` records why, and `ZoneStore` gets away with
`takeUntilDestroyed` only because `rxjs-interop` was added to the shell's shared modules
(commit `021d435`, which its own message calls an ugly fix). A new service in this layer
should write its signals and its teardown by hand, as `RealtimeMemory` already does, rather
than lean on that fix.

## 8. Testing

`RoomRegistry`, pure, no `TestBed`:

- Acquire twice, release once: still subscribed. Release twice: unsubscribed.
- A release called twice is idempotent (`realtime-memory.ts:82-94` already guards this;
  the registry must too).
- Staff intent is the OR of holders. The last staff holder releasing re-issues
  `zone.subscribe` without an unsubscribe (R-S3).
- `onConnected()` clears joined state, so the next reconcile asks for everything.

`RealtimeSocket`, with a `FakeSocket` implementing `SocketLike` and driven by hand:

- Anonymous: the factory is never called (R1).
- Connect awaits `ensureFreshToken` and passes its result as `auth.token` (R2), which is
  the first source the server reads (`realtime.gateway.ts:194-198`).
- Two failed connects with a fresh token set `degraded` and stop calling the factory (R3).
- `ConnectionState` is never touched, on any path (R4). Assert on a spy, because this is a
  rule about a call that must not happen and nothing else would catch its return.
- A refresh while connected does not disconnect (R5).
- A `disconnect` then `connect` re-emits every held subscription (R6).
- An ack that never arrives leaves the zone out of `refusedZones` and is retried (R7);
  `{ ok: false }` latches and is cleared by the next `connect` (R8).
- An unmapped payload is dropped, counted in `droppedEvents`, and the next good event on
  the same connection still arrives (R9).

No spec imports `socket.io-client`. If one has to, `SOCKET_FACTORY` is in the wrong shape.

An e2e is deliberately not proposed. Per the `e2e deep links 404 locally` note, no suite in
this workspace runs locally, and a realtime e2e additionally needs two identities and a
running backend. The value is in the unit tests above, which cover the lifecycle that
actually breaks.

## 9. Dependency and module federation

`socket.io-client` at `^4.8.x`. `timeout(...).emitWithAck(...)` needs 4.6 or later, so the
version floor is real and not cosmetic.

Nothing goes on `SINGLETON_LIBRARIES` in `module-federation.shared.ts`. That list exists
for a module whose duplication would be a correctness problem, and this one is not: only
Velista imports the client, the connection is per app injector, and two copies in one page
would simply be two copies of some code. Nx shares discovered npm dependencies with a
required version and no singleton, which is the correct treatment. Adding it would repeat
the mistake that file was written to correct: a rule that looks reassuring and does
nothing.

Bundle cost is roughly 35 to 40KB minified for the client plus `engine.io-client`, in
Velista's own chunks. Worth a look against the 1mb initial budget in `project.json` after
the first build, though the transport is reached from a lazily loaded route and should not
land in the initial chunk.

## 10. Scope: what this plan does not build

Named so that "the bases" has an edge:

1. **The SSE transport.** `0004` section 6.1 defers it until there is evidence the socket
   fails, and the `SocketLike` seam is what keeps that a new class rather than a refactor.
2. **Presence.** No intents, no `PresenceStore`. F4 records the gap and section 5.3 leaves
   the seam.
3. **Per-list subscriptions.** `subscribeList` is implemented and nothing calls it, which
   is correct: list scoped events are broadcast to the zone room as well
   (`jetstream.consumer.ts:181-187`), so the dashboard gets list traffic for free. Do not
   add list subscriptions to get updates that already arrive.
4. **The offline queue.** Out of scope by `0001` section 5; rule D2's choke point is
   already built.
5. **Converting any data source to live-first.** The stores that apply events already do;
   the rest keep loading over REST until a page plan says otherwise.

## 11. Prerequisites owned elsewhere

The first is this plan's to fix. The rest are not, and none of them blocks writing the
code, only trusting it in a deployed environment.

1. ~~**F2, the production realtime host.**~~ Done by plan 0014: the host is
   `LUNA_REALTIME_URL`, defaulting to `https://rt.ichirokuxvi.com`.
2. ~~**F5, a staging environment.**~~ Done by plan 0014, by build variables rather than by
   a third environment file. Staging clients get `rt.staging.ichirokuxvi.com`.
3. **The realtime service is only correct at one replica, and it runs at two.** Three
   independent instances of the same shape, listed together because they have one fix:
   - **Event fanout.** Both replicas consume the same durable JetStream consumer,
     `luna-realtime` (`constants.ts:10`, `jetstream.consumer.ts:117-139`). A durable
     shared by two consumers distributes messages between them, so each domain event
     reaches one replica and is fanned out only to the sockets connected to _that_ replica
     (`realtime.gateway.ts:66-69`). Roughly half of connected clients miss every event.
     This wants verifying on the cluster before it is treated as certain, but the code
     shape says it plainly, and it is the failure that would be blamed on this client.
   - **Presence** is in-process (`presence.service.ts:35-37`), already known and recorded in
     `0004` section 6.7.
   - **Long polling** needs session affinity, which is R10's whole subject.

   The standard fix for all three is a Socket.IO adapter backed by the broker plus a
   per-replica JetStream consumer, and the interim fix is `replicaCount: 1` for the
   realtime service, which costs the zero downtime guarantee `values.yaml:166-169` is
   after. Either way it is a backend decision and belongs in a backend plan.

4. **A `retry()` affordance in the UI.** `degraded` has no rendering today. It does not
   block this plan, but a latched degraded state with no way out and no indication is a
   user permanently and invisibly stale, and R3 already exposes the hook.

## 12. Build order

1. ~~Fix F2.~~ Already done by plan 0014. Nothing to do, and everything after it is
   testable against a real staging backend.
2. Change the interface (section 4), update `RealtimeMemory`, `ZoneStore`, `MembersPage`,
   and their specs. **This step is green with no new dependency**, which is what makes it
   reviewable on its own.
3. `RoomRegistry` and its specs. Pure, fast, and where the bugs are.
4. Add `socket.io-client`. `SocketLike`, `SOCKET_FACTORY`, `FakeSocket`.
5. `RealtimeSocket` and its specs, one rule from section 6 at a time.
6. Bind it in `app-providers.ts`. Run the app against a local backend and watch a second
   browser change a group.
7. `droppedEvents`, and wherever the app decides to surface it.

Steps 2 and 3 are worth doing even if the transport slips, because they correct a contract
that is wrong today and is currently only survivable because nothing implements it.

## 13. Open questions

1. **Should `degraded` distinguish "rejected" from "unreachable"?** It cannot today,
   because the server tells us nothing (`realtime.gateway.ts:86`), and that is a backend
   change: a `connect_error` with a reason before the disconnect. Worth asking for, since
   the two want different copy, and a client that knows it was rejected can clear its
   session rather than retry.
2. **Is five seconds the right ack timeout (R7)?** It covers a NATS round trip to core
   with room to spare, but it has not been measured against a cold core under load. Pick
   it, then look at it once there is a number.
3. **Does the Envoy timeout policy keep an idle WebSocket alive?** `values.yaml:34` refers
   to realtime timeouts in `implementation-envoy.yaml.tpl`. Socket.IO's own ping keeps the
   connection busy at 25 second intervals by default, which should be well inside any
   sane idle timeout, but this is worth confirming rather than discovering as a reconnect
   every N minutes in production.

## 14. What changed while building it

The plan above is left as written, because a plan that is quietly edited to match what
was built stops being evidence of anything. This section is the diff.

### 14.1 Two findings had already been fixed

F2 and F5 were both closed by plan 0014, which landed between this plan being written and
being scheduled. Build order step 1 was a no-op. Sections 3.3, 3.6, 11 and 12 carry the
correction inline.

### 14.2 The fake shares the registry

Section 5.2 gives `RoomRegistry` to the transport. It is used by `RealtimeMemory` too, and
that turned out to be the more valuable half. F1 diagnoses the old fake as *more orthogonal
than the thing it fakes*: it modelled rooms as independent strings, so the one behaviour
most worth faking, a staff intent that rides on a zone subscription, was the one it could
not express. Rebuilding the fake on the registry is what makes that structurally
impossible to reintroduce, and it is why `RealtimeMemory.rooms` is now derived rather than
maintained. Its `refuse` set is keyed by zone id to match `refusedZones`.

### 14.3 `droppedEvents` and `retry()` are on the interface

Section 5.3 puts `droppedEvents` on `RealtimeSocket`, and section 11 item 4 leaves
`retry()` implied. Nothing injects the concrete class, by design, so a member on the class
alone is a member nothing can reach: both are on `RealtimeClientI`, and `RealtimeMemory`
implements both. Counting a dropped payload in the fake costs three lines and closes the
same blind spot on the path every spec takes.

### 14.4 The failure counter is not cleared on `connect`

The one real correction to a rule. **R3 says to reset the counter and clear `degraded` on a
successful `connect`, and that cannot work**, for the reason R2 gives two paragraphs
earlier: the server answers a bad token by disconnecting inside `handleConnection`, which
reaches the client as a `connect` immediately followed by a `disconnect` and no error at
all. Resetting on `connect` therefore resets on the exact failure the counter exists to
catch, the latch never fires, and the client loops forever against a token that will never
be accepted, which is precisely the outcome R2 and R3 were written to prevent.

The counter is cleared when a connection **proves** itself instead: any acknowledgement
from the server, or ten seconds of uptime. The ack is the immediate signal and the timer
covers the case of a caller who is subscribed to nothing. `realtime-socket.spec.ts` asserts
the connect-then-drop loop latches.

Two smaller readings of the same rule, both erring towards not looping:

- **A null token from `ensureFreshToken` counts as a failed attempt.** R3 counts only
  failures "where the token was fresh when sent", which leaves the tokenless case
  unretried or retried forever. Connecting with no token is a guaranteed drop, so an
  uncounted retry is the same forever-loop one step earlier.
- **An acknowledgement that is neither `{ ok: true }` nor `{ ok: false }` is a failure,
  not a refusal.** R7 and R8 name those two shapes and not a third. Refusals latch and
  failures are retried, so ambiguity has to fall on the side that recovers. This is rule
  D4 applied to an ack.

### 14.5 A failed ask schedules the reconcile that retries it

R7 ends "let the next reconcile retry it", and nothing in the design guaranteed there
would be a next one: reconciles are driven by acquires, releases and connects, so a zone
whose subscribe timed out would stay quietly not live until the user happened to navigate.
A single timer, at the ack timeout, is armed when any ask in a reconcile failed.

### 14.6 `onDisconnected()` beside `onConnected()`

Section 5.2 names only `onConnected()`. The joined set has to be cleared when the socket
goes away as well, not only when the next one arrives: the client is in no rooms from the
moment the connection drops, and without it a reconnect can emit an unsubscribe for a room
the previous socket held. Both clear the same per-connection state, and `clear()` drops the
desire too, which is what signing out means.

### 14.7 Two call sites the audit did not reach

- **`list-page` read `refusedRooms().has('list:{id}')`** for its "live" flag, a room
  nothing ever joins, so the flag could only ever answer yes. It now reads the zone, which
  is what actually carries the list's events (`jetstream.consumer.ts:181-187`).
- **`members-page` held its staff subscription without the zone it was for**, so moving
  between two groups kept the first group's subscription and never took one on the second.
  Latent while `ZoneStore` happened to hold a room for every visible group; a real bug on
  a deep link, where it does not. Fixed with the release.

A third, smaller: a refusal is dropped when the last holder of a zone releases, so a group
nobody subscribes to cannot go on reading as stale.

### 14.8 Measured, not estimated

Section 9 guesses 35 to 40KB for the client plus `engine.io-client` and asks for a look at
the budget. Built: **42.8KB raw in one lazily loaded chunk**, initial total 341.96KB
against the 1mb budget. `main.js` mentions `socket.io-client` only as a module federation
share-scope key, which is Nx's ordinary treatment of a discovered dependency and is what
section 9 asks for. Nothing was added to `SINGLETON_LIBRARIES`.
