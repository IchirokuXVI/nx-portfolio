# 0008 Realtime (WebSocket and SSE)

Wires the domain events published throughout 0005 through 0007 out to clients. Realtime lives
in `luna-shopper-gateway`, so the domain services stay free of socket concerns and keep
publishing plain broker events.

## 1. Placement and why

Core publishes domain events onto the broker after each successful mutation. The gateway
already holds the client connections and verifies tokens, so it is the natural relay: it
subscribes to core's events and pushes them to the right clients. Core never knows a socket
exists, which keeps it independent and testable.

## 2. Transports

- **WebSocket (primary)**: a NestJS Socket.IO gateway. On connect, authenticate the socket
  from the same access token (verified offline with the auth public key). A client then
  subscribes to rooms it is authorized for. Rooms: `zone:{zoneId}` and `list:{listId}` (room
  name prefixes from the `RealtimeRoom` enum in `contracts`).
- **SSE (secondary, read only)**: `GET /zones/:id/stream` and `GET /lists/:id/stream` return
  the same event stream for clients that cannot hold a socket. Authorization mirrors the
  socket rooms.

Both transports publish identical payloads from a single internal relay, so there is one
source of truth for what an event looks like.

## 3. Authorization on subscribe

Joining a room requires the caller to be an approved member of that zone (and, for a list
room, to have `ListAccess`). The gateway confirms this by asking core (a cheap request/reply
membership check) before adding the socket to the room, so a client cannot listen to a zone or
list it has no access to.

## 4. Event routing

The gateway maps each broker event to a room and emits it:

- Zone and membership events (`zone.updated`, `member.approved`, `member.kicked`, ...) go to
  `zone:{zoneId}`.
- List, line, and comment events (`list.created`, `line.added`, `comment.added`, ...) go to
  `list:{listId}` and, where useful for a zone level list index, also to `zone:{zoneId}`.
- Merge events go to `zone:{zoneId}`.

All event names come from the `RealtimeEvent` enum so client and server never disagree on a
string literal.

## 5. Scaling note

If the gateway ever runs more than one replica, socket fan out needs a shared backplane so an
event delivered to one instance reaches sockets held by another. The Socket.IO Redis adapter
(the same Redis introduced for presence in 0001) covers this. Single replica does not need it;
it is called out so the choice is deliberate rather than discovered in production.

## 6. Exit criteria

- A client opens a socket, authenticates with its token, and subscribes only to zones and
  lists it may access.
- Mutations from 0005 through 0007 appear in real time to subscribed clients over WebSocket.
- The SSE endpoints deliver the same events for read only clients.
- Event names and room prefixes are enum driven and shared through `contracts`.
