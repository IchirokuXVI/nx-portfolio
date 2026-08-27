# 0028 Redis: cache, presence and the socket backplane

Introduces the Redis instance that plans 0001 (section 2.4), 0002 (section 1), 0003, 0009
(sections 7 and 9) and 0027 (section 3) have all deferred to. Every one of those deferrals
named the same instance, so this plan is the single place that decides what it holds, what it
deliberately does not, and what changes the day it exists.

The headline is not caching. It is that **`replicaCount` is pinned at 1 today because of a
missing backplane** (0027, section 3), and three other pieces of shared state are wrong at two
replicas in ways that are quiet rather than loud. Redis is the thing that makes a second
replica honest.

## 1. What is wrong today

The stack runs one replica of every service. That is not a capacity decision, it is a
correctness one, and four separate pieces of state are the reason.

**Socket fan out.** `realtime/src/app/socket/realtime.gateway.ts` is a `@WebSocketGateway`
on socket.io's default in memory adapter. A broadcast to `zone:{id}` reaches only the sockets
held by the pod that emitted it, and a long polling handshake that lands on a different pod per
request fails outright. 0027 states this plainly: at two replicas the realtime service is not
redundant, it is wrong about half the time.

**Presence.** `presence.service.ts` holds four `Map`s keyed by socket id, and its own doc
comment says it moves to a shared store when Redis lands. At two replicas each pod broadcasts a
snapshot built only from its own sockets, so every presence event overwrites the other pod's
view and the online list flaps between two halves of the truth. This is worse than being
absent, because it looks like it works.

**Rate limiting.** `ThrottlerModule.forRoot(createThrottlerOptions())` in the gateway uses the
package's in memory storage. Two replicas behind one Service means two independent counters, so
every limit doubles. That is a tuning annoyance for the default bucket at 120 a minute, and a
real defect for the tight ones: `verifyResend` and `passwordReset` are `limit: 1` per minute,
and `throttler-config.ts` says of both that **the whole of the enforcement is this bucket**.
`identity.service.ts` reads `throttleWaitSeconds(THROTTLE_LIMITS.verifyResend)` to tell the
client how long to wait, so a doubled bucket also makes the countdown the client renders a lie.

**Event dedupe.** `jetstream.consumer.ts` keeps a bounded in memory `seen` map of event ids
because JetStream delivery is at least once (0004, section 9). A shared durable consumer
redelivering to a *different* pod finds an empty map there and pushes the event twice.

None of these is a caching problem. They are all the same problem: per pod state that the
design assumed was per system.

## 2. What goes in Redis

Ordered by whether it blocks the second replica, not by how interesting it is.

### 2.1 The socket.io adapter (required)

`@socket.io/redis-adapter` with an `ioredis` pair (the adapter needs a separate duplicated
connection for its subscriber, since a Redis connection in subscribe mode cannot issue other
commands). Installed as a custom `IoAdapter` subclass in `realtime/src/main.ts`, before
`app.listen`, so the gateway's `@WebSocketServer()` server is created with the adapter already
attached.

This makes room broadcasts reach sockets on every pod. It is the only change that
`replicaCount: 2` strictly requires, and it is roughly thirty lines.

Sticky sessions stay unnecessary for the WebSocket transport but are **still required for the
HTTP long polling fallback**, whose handshake is several requests that must land on the same
pod. Either configure session affinity on the realtime Service and its HTTPRoute, or set the
client to `transports: ['websocket']` and accept that a client behind a proxy that blocks
WebSocket cannot connect at all. The SSE endpoint already exists as the fallback for exactly
that client, so preferring WebSocket only is the cheaper answer here; decide it explicitly
rather than discovering it from a support report.

### 2.2 Presence (required)

The four `Map`s become Redis keys, one set per fact, with the socket id as the member so a user
counts as present while any of their sockets is (the current rule, unchanged):

```
presence:zone:{zoneId}          set of "{userId}:{socketId}"
presence:list:{listId}:viewers  set of "{userId}:{socketId}"
presence:list:{listId}:editors  hash socketId -> "{userId}:{lineId}"
presence:socket:{socketId}      hash of what that socket joined, for disconnect cleanup
```

Two properties the in memory version got for free and that the shared version must buy back:

- **A crashed pod must not leave ghosts.** `disconnect()` cleans up only when the pod runs the
  handler; a pod that is OOM killed never does, and its sockets stay online in Redis forever.
  Every presence key therefore carries a TTL (say ninety seconds) refreshed by a periodic
  heartbeat per pod, so a dead pod's presence expires on its own. This is the single largest
  piece of work in the plan and the one to write tests for first.
- **The broadcast must stay one snapshot.** `broadcastZone` and `broadcastList` currently read
  local maps and publish the full room state. They become a read of the Redis key followed by
  the same publish. Two pods can race and publish two snapshots; that is acceptable, because
  both are read after the write, so clients converge. Do not try to make it transactional.

### 2.3 The relay, SSE, and the duplicate delivery trap (required)

This one is easy to get wrong, so it is written out.

`EventRelayService` is an in process RxJS `Subject`. The JetStream consumer publishes into it;
the socket gateway and the SSE controller subscribe. At two replicas the behaviour depends
entirely on how the durable consumer is named, and both obvious choices are broken in opposite
directions:

- **One shared durable consumer** (each event delivered to exactly one pod) plus the Redis
  adapter: sockets are correct, because the adapter fans the emit out to both pods. **SSE
  breaks**, because the SSE controller on the pod that did not consume the event never sees it
  on its local `Subject`.
- **A per pod consumer** (every pod receives every event) plus the Redis adapter: SSE is
  correct, and **sockets get every event twice**, because both pods emit to the same room and
  the adapter fans each emit out to all sockets.

The rule to hold on to is that **an event crosses the pod boundary exactly once**, whether that
hop is the adapter or the relay, and a spec should assert a single delivery per client for a
single published event.

The arrangement that satisfies it: keep **one shared durable consumer**, and give the relay a
Redis pub/sub hop. The consumer publishes the `RelayMessage` to a Redis channel, every pod
subscribes and feeds its local `Subject` from it, SSE and the socket gateway both read that
`Subject`, and the socket gateway emits with `server.local.to(room)` so the adapter does not
fan the same event out a second time. The relay channel is then the one boundary crossing, and
the adapter is carrying only the long polling handshake and the room bookkeeping, which is
still why it must be installed.

### 2.4 Throttler storage (required)

Swap the throttler's in memory storage for a Redis backed one
(`@nest-lab/throttler-storage-redis`, which tracks `@nestjs/throttler` v6). One `storage`
option on `ThrottlerModule.forRoot`, in the gateway's `app.module.ts`.

Nothing in `throttler-config.ts` changes. `ProblemThrottlerGuard` already reads `timeToExpire`
and `timeToBlockExpire` off whatever storage is configured, and its spec already injects a
`ThrottlerStorage` double, so the guard is storage agnostic by construction and the existing
tests keep passing.

### 2.5 The JetStream dedupe window (required, small)

`jetstream.consumer.ts`'s `seen` map becomes `SET dedupe:event:{eventId} 1 NX EX <window>`,
where the reply tells the consumer whether it is the first delivery. The current bounded map
becomes a TTL, which is a better fit anyway: the window today is a count of events, and what it
wants to express is a span of time longer than JetStream's redelivery backoff.

### 2.6 Realtime access checks (worth doing, not required)

`CoreAccessClient` makes a NATS request/reply to core on **every** room subscribe. A deploy
cycles every socket at once, and each reconnecting client re subscribes to every zone and list
it had open, so an ordinary rolling update is a burst of access checks proportional to
connected clients times open rooms. This is the best cache in the system.

Key `access:zone:{userId}:{zoneId}` and `access:list:{userId}:{listId}`, TTL sixty seconds,
caching both the allow and the deny (a deny is the cheaper thing to cache and the more likely
thing to be hammered).

The cost is a revocation delay: a kicked member keeps receiving a room's events for up to the
TTL. That is not acceptable on its own, and the fix is already sitting in the service. Realtime
**already consumes** `member.kicked` and the membership events, so the consumer deletes the
matching access keys when it sees one, and the TTL is only the backstop for a case nobody
modelled. Build the invalidation in the same change as the cache, never as a follow up.

### 2.7 The gateway stats cache (nice to have)

`stats.service.ts` holds a single entry sixty second cache of the public platform totals, and
its own comment calls itself the first of two guards. Moving the entry to Redis makes the cache
shared, so N replicas do one origin call a minute between them instead of N. The response
already carries the snapshot timestamp so the cache is visible rather than hidden, and that
field keeps meaning what it meant. Small win, near zero risk, do it last.

### 2.8 Catalog reference reads (recorded, not scheduled)

Supermarkets, items and locations (0012) are close to static reference data read on many list
screens, which is the textbook cache. It is listed here so the shape is known, and left unbuilt
because nothing has measured that those queries are slow, and a cache over data that platform
admins edit needs an invalidation story that this plan does not owe anyone yet.

### 2.9 What deliberately stays out of Redis

Recorded so it is not relitigated when somebody notices there is now a fast key value store:

- **Refresh tokens, OAuth state, email verification and password reset grants.** 0023 section
  4.1 chose Postgres for `oauth_states` on purpose: the property that matters is single use
  consumption, and a replayed state is how an attacker attaches their Google identity to your
  account. Those live in auth's database with the other grants, they are durable, and the
  existence of Redis changes none of that reasoning.
- **Sessions.** There are none. Access tokens are verified offline against the auth public key
  by every service, which is the decoupling in 0001 section 3.2. Do not introduce a session
  store because Redis is now available.
- **Zones, lists, lines and comments.** Collaborative, mutable, last write wins with a version
  bump (0009 section 8). Caching them puts a stale read in front of the exact data whose
  freshness the realtime service exists to guarantee.
- **A queue, a lock, or a scheduler.** NATS with JetStream is already the broker, and adding a
  second messaging substrate with different delivery semantics is how a system stops being
  explainable.

## 3. Deployment shape

**Helm.** A `redis.yaml.tpl` beside `nats.yaml.tpl` in
`k8s/helm/templates/luna-shopper-backend/`, following the NATS template rather than the
Postgres one: one replica, a ClusterIP Service, Guaranteed QoS with a modest memory limit, and
`maxmemory` plus `maxmemory-policy` set so it evicts rather than being OOM killed. The policy
is the one judgement call in the template. `allkeys-lru` would let an eviction drop presence or
a dedupe key under pressure; `volatile-lru`, restricted to keys carrying a TTL, is the safer
default here, given that every key this plan defines has one.

**Persistence: none.** Everything in section 2 is either ephemeral by nature (presence, relay
messages) or reconstructible (caches, throttle counters, the dedupe window). Redis restarting
empty is a brief loosening of rate limits and a presence resync, not data loss. No PVC, and say
so in the template so it reads as a decision rather than an omission.

**Values.** A `redis` block under the same stateful dependencies section that holds `postgres`
and `nats`, and a `redisUrl` beside `natsUrl` in the shared env block. `replicaCount` goes back
to 2, and the PDB condition that 0027 tied to it starts rendering again.

**Config.** `REDIS_URL` joins the validation schema of gateway, realtime and any service that
caches. It is **required** in realtime (the service is incorrect at more than one replica
without it) and, for the reason in section 5, required in the gateway too. `app-config.ts` in
realtime already carries the comment saying these variables join it later; that comment gets
replaced by the variables.

**Local stack.** A `redis:7-alpine` service in `k8s/e2e/luna-shopper-backend/compose.yml`
alongside `nats` and the Postgres instances, so `nx serve` and the integration suite run
against the same shape as the cluster. 0002 section 2 says Redis is not part of the compose
stack yet; that sentence is what this change edits.

**Secret.** None. A URL of `redis://luna-shopper-backend-redis:6379` on a cluster local Service
with no auth is consistent with how NATS is already deployed here. If that ever changes it
changes for both at once, and `provision-release.sh` grows a seventh Secret.

## 4. One client, in the platform library

`libs/luna-shopper/platform` gets the Redis module: connection creation from `REDIS_URL`,
lifecycle bound to Nest's shutdown hooks, a health indicator, and the `ioredis` version pinned
in one place. Four services reaching for `ioredis` independently is four different retry
strategies and four different opinions about what to do when it is down.

The adapter's second, duplicated connection is created there too, so the rule that a subscriber
connection cannot issue commands is encoded once rather than rediscovered.

## 5. When Redis is down

Decided per use, because the right answer genuinely differs, and this is the section to read
before writing any of the code:

- **Adapter and relay:** the realtime service is degraded but must keep serving. Sockets stay
  connected, locally consumed events still reach local clients, cross pod fan out stops. Log
  loudly, fail readiness so the pod stops taking new connections if the outage persists, do not
  crash.
- **Presence:** fails open and empty. A presence snapshot that cannot be read is broadcast as
  no one present, never as an error to the client. Presence is a social affordance, not a
  guarantee.
- **Throttler:** fails **closed**, and this is the one that will be argued about. The throttler
  package's default on a storage error is to let the request through, which turns a Redis
  outage into an open registration and password reset endpoint. Refusing with the ordinary 429
  problem response is the right failure, and it is the reason `REDIS_URL` is required in the
  gateway rather than optional: a gateway that silently starts without a limiter is the worst
  of the available outcomes.
- **Caches (access checks, stats):** fail open, straight through to the origin. That is what a
  cache miss already means.

## 6. Order

1. The platform Redis module, the compose service, and the Helm template with `REDIS_URL` wired
   but unread. Nothing behaves differently, and everything after this is a code change against
   a dependency that already exists in every environment.
2. Throttler storage. Smallest correct change, entirely inside the gateway, and it is the one
   piece worth having even at one replica because it removes a per pod counter that would
   otherwise silently double the moment step 6 happens.
3. The dedupe window. Also small, also independent.
4. The adapter and the relay channel together, with a spec asserting exactly one delivery per
   client per published event. These two cannot land separately without a window where events
   are duplicated or SSE is deaf.
5. Presence, with the heartbeat and TTL, and a test that a pod which stops heartbeating drains
   out of every room it held.
6. `replicaCount: 2`, the PDB rendering again, and the session affinity or WebSocket only
   decision from 2.1. This is the step that cashes in the previous five, and it is the first
   one that can be verified by actually running two pods.
7. Access check caching with its event driven invalidation, then the stats entry.

Steps 1 through 3 are safe at one replica. Steps 4 and 5 are only observable at two, so bring
the second replica up locally, in compose, before the cluster.

## 7. Exit criteria

- Two realtime replicas serve one logical room: a client on pod A receives an event caused by a
  mutation whose event was consumed by pod B, exactly once.
- Presence is correct across replicas, and a killed pod's users leave every room within the
  heartbeat TTL without any pod running a disconnect handler.
- One rate limit bucket governs the whole gateway: `verifyResend` refuses the second request in
  a minute regardless of which pod served the first, and the `retryAfterSeconds` the client
  renders matches the real remaining window.
- A JetStream redelivery landing on a different pod than the original is dropped.
- Killing Redis degrades the system along the four documented lines and takes nothing down:
  sockets stay up, presence empties, the gateway keeps refusing over limit requests, caches
  miss through to their origins.
- `helm template` renders Redis, renders the PDB again at two replicas, and
  `provision-release.sh --check` passes unchanged, since no new Secret is introduced.

## 8. How much work this is

Sections 2.1, 2.4 and 2.5 are each a day or less and mostly configuration. Section 2.3 is a
half day of code and the thinking already done above. Section 2.2 is the real work, two or
three days with its tests, because it is a rewrite of a service's entire state model plus a
liveness mechanism it did not previously need. Section 3 is a day of Helm and compose.

The honest total is about a week, and the risk is concentrated in one file.
