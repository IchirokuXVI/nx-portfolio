# 0009 Realtime (WebSocket and SSE)

Builds `luna-shopper-backend-realtime`, the dedicated service that pushes the domain events published
throughout 0006 through 0008 out to clients. It is its own service (not part of the gateway),
so the domain services stay free of socket concerns and keep publishing plain broker events.

## 1. Why a dedicated realtime service

The standard microservice pattern is **one realtime server for the whole system**, not one
socket server per domain service. Clients hold a single connection here. Domain services (in
any language) just publish events to NATS/JetStream after a mutation; this service consumes
them and fans them out. Core never knows a socket exists, which keeps it independent and
testable, and keeps realtime the only place that needs socket libraries.

## 2. socket.io and the polyglot backend

- The socket.io protocol is spoken only on the **browser to realtime service** hop. Everything
  behind realtime is NATS, which is language agnostic, so .NET or Spring domain services work
  unchanged: they publish events and never touch socket.io.
- socket.io is a Node centric protocol (its non Node server implementations are second class),
  so this service **stays Node/NestJS**. That is fine precisely because it is a dedicated
  service; the polyglot services live behind the broker.
- Caveat recorded for the future: if the realtime server itself were ever to be rewritten in
  .NET or Spring as a learning exercise, socket.io would be dropped in favor of standard
  WebSocket (or .NET SignalR / Spring STOMP) with a matching client, or SSE (fully standards
  based and trivially polyglot). SSE is already the read only fallback here, so a more
  portable path exists if it is ever wanted.

## 3. Transports

- **WebSocket (primary)**: a NestJS Socket.IO gateway. On connect, authenticate the socket
  from the access token (verified offline with the auth public key). A client then subscribes
  to rooms it is authorized for. Rooms: `zone:{zoneId}` and `list:{listId}` (prefixes from the
  `RealtimeRoom` enum in `contracts`).
- **SSE (secondary, read only)**: `GET /v1/zones/:id/stream` and `GET /v1/lists/:id/stream`
  return the same event stream for clients that cannot hold a socket. Authorization mirrors the
  socket rooms.

Both transports publish identical payloads from a single internal relay, so there is one
source of truth for what an event looks like.

## 4. Consuming domain events

- The service attaches **durable JetStream consumers** to the domain event streams. Durable
  consumers survive restarts and replay missed events, and because JetStream is at least once,
  the relay is **idempotent** (dedupe by event id per 0004 section 9) so a redelivered event is
  not pushed twice.
- The `correlationId` on each event (0004 section 3) is carried through to the client push, so
  a realtime update can be traced back to the request that caused it.

## 5. Authorization on subscribe

Joining a room requires the caller to be an approved member of that zone (and, for a list
room, to have `ListAccess`). The service confirms this with a cheap NATS request/reply
membership check to core before adding the socket to the room, so a client cannot listen to a
zone or list it has no access to.

## 6. Event routing

- Zone and membership events (`zone.updated`, `member.approved`, `member.kicked`, ...) go to
  `zone:{zoneId}`.
- List, line, and comment events (`list.created`, `line.added`, `comment.added`, ...) go to
  `list:{listId}` and, where useful for a zone level list index, also to `zone:{zoneId}`.
- Merge events (`merge.requested`, `merge.approved`, ...) go to `zone:{zoneId}`.

All event names come from the `RealtimeEvent` enum so client and server never disagree on a
string literal.

## 7. Presence (online, viewing, editing)

The realtime service tracks and broadcasts presence:

- **Online in a zone**: when a socket authenticates and joins `zone:{zoneId}`, the user is
  marked online there; on disconnect or leave, cleared. The zone room receives a
  `presence.zoneUpdated` event with the current online users.
- **Viewing / editing a list**: a client signals intent over the socket (opened a list =
  viewing; focused an input = editing), and the `list:{listId}` room receives a
  `presence.listUpdated` event listing current viewers and editors. This is what surfaces "who
  is looking at or editing this list right now".
- Presence is **ephemeral** state held in the realtime service's memory for now (single
  replica). When Redis is added (see section 9 below) presence moves to a shared store so it is
  correct across replicas.
- New `RealtimeEvent` entries: `PRESENCE_ZONE_UPDATED`, `PRESENCE_LIST_UPDATED`.

## 8. Concurrency: last write wins with reconciliation

Confirmed model for collaborative edits: **last write wins**, reconciled through realtime.

- The server is the single source of truth. On a line edit, core applies the write, bumps the
  line `version` (0007), and broadcasts `line.updated` with the new `version` and content.
  Clients reconcile to whatever the server last accepted; there is no locking, which keeps plain
  text edits fast.
- The **editing** presence indicator (section 7) is the social mechanism that keeps collisions
  rare, since users see who else is editing a line before they clash.
- Explicitly out of scope: character level co-editing (operational transforms or CRDTs). If that
  is ever wanted it is a separate, much larger effort; field level last write wins is the
  deliberate choice for a shopping list.

## 9. Zero downtime and scaling

- On deploy the realtime pod drains gracefully (0002 section 6 and 0004 section 7): it stops
  accepting new sockets, and socket.io clients auto reconnect to a healthy pod. Brief reconnects
  are expected and handled client side.
- **Redis backplane (later, not now):** if realtime ever runs more than one replica, socket
  fan out needs a shared backplane so an event delivered to one instance reaches sockets held
  by another. The Socket.IO Redis adapter covers this and rides on the same Redis that is
  planned later for caching (see 0001). A single replica does not need it; this is recorded so
  scaling out is a deliberate step, not a production surprise.

## 10. Exit criteria

- A client opens a socket, authenticates with its token, and subscribes only to zones and
  lists it may access.
- Mutations from 0006 through 0008 appear in real time to subscribed clients over WebSocket,
  and identically over SSE for read only clients.
- Event consumers are idempotent durable JetStream consumers; correlation ids thread through to
  the client.
- A deploy cycles the realtime pod with only transparent client reconnects, no lost updates.
- Event names and room prefixes are enum driven and shared through `contracts`.
