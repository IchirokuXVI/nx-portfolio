# 0212: a private list speaks only to its readers

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". This is finding F4.1 of
> `docs/reports/2026-10-16-velista-e2e-slot1.md`, the first of its two blockers. A group
> member whose socket holds the zone room receives the lines and comments of a list that is
> private to the owner. The UI draws none of it, but the data reaches the device.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0042` (list access), plan `0114` section 5 (what a link gives),
> `apps/luna-shopper-backend/realtime/src/app/consumer/jetstream.consumer.ts` (`roomsFor`,
> the sweeps call order), `realtime/src/app/socket/realtime.gateway.ts` (`subscribeZone`,
> `subscribeList`), `realtime/src/app/consumer/sweeps.ts`, `core/src/app/events/core-events.publisher.ts`,
> `core/src/app/lists/list-access.service.ts` (`readableListIds`), and the doc comments at
> `libs/luna-shopper/contracts/src/lib/messages/realtime.messages.ts:45-61`.

## Brief for the agent

### Objective

No socket receives an event about a list its user may not read. The group page, the list
page and the purchase store of velista keep receiving every event they consume today.

### Context

- **Core addresses list events to the zone and to the list.** `CoreEventsPublisher.emit`
  passes `{ zoneId, listId }` (`core-events.publisher.ts:62-69`) and `emitTo` copies both onto
  the envelope (`:147-154`). Realtime's `roomsFor` (`jetstream.consumer.ts:376-397`) adds
  `zone:{id}` when zoneId is set and `list:{id}` when listId is set, and the doc comment at
  `:367-368` says the zone copy exists "so a zone level list index hears them too".
- **The zone room holds every approved member.** `subscribeZone` joins it after
  `checkZoneWithLists` (`realtime.gateway.ts:254-301`). The `checkList` gate of
  `subscribeList` (`:335-346`) never runs for zone room traffic.
- **These events carry a listId and reach the zone room:** `line.added` (`line.service.ts:979`,
  `:1169`), `line.updated` (`:2812`, `:3003`, `product-group-sync.service.ts:374-386`),
  `line.deleted` (`:2100`, `:2501`, `:3230`), `line.reordered` (`:3037-3045`), `line.settled`
  (`settlement.service.ts:293`, `basket-settle.service.ts:273-285`,
  `basket-revert.service.ts:292-304`), `comment.added` (`comment.service.ts:100`, `:193`),
  `comment.updated` (`:293`), `list.created` (`list.service.ts:278`), `list.updated` (`:610`),
  `list.deleted` (`:665`), `list.accessChanged` (`:408-415`) and `list.myAccessChanged`
  (`:435-439`, `:622-626`). The line, settle and comment events and the two list views leak
  content. `list.deleted` and `list.accessChanged` carry ids only.
- **A second leak the report did not see.** `list.myAccessChanged` carries
  `{ listId, zoneId, permissions }` and names no user, and it goes to the zone room. Velista's
  `list-store.ts:236-243` drops the list when `permissions` is empty. So one member's revoke
  can make every other member's cache drop the list, and hands them a permission set that is
  not theirs.
- **A room of exactly the readers already exists.** `subscribeZone` joins
  `list:{id}:presence` for every list in `zone.listIds` (`realtime.gateway.ts:276-291`), a set
  that core computes with `readableListIds` (`list-access.service.ts:190-196`). The admit
  sweep on `list.created` (`sweeps.ts:101-104`, `room-sync.service.ts:220-240`) and the evict
  sweep on `list.accessChanged` (`sweeps.ts:86-95`) keep it current. Sweeps run after the fan
  out (`jetstream.consumer.ts:343`, `:347-362`).
- **What velista reads from the zone room.** `zone-store.ts:866-879` ignores `line.*` and
  `comment.*`, and uses `list.created`, `list.updated` and `list.deleted`. `list-store.ts:266-277`
  does the same plus the two access events. `purchase-store.ts:46`, `:328-333` refetches on
  `line.settled` for any list. The only `list:{id}` room is joined from the list page
  (`list-page.ts:1226`). So routing list events to `list:{id}` alone would break the group
  page and the purchases, and that is why the presence room is the right target.
- **Realtime keeps no per socket list of allowed lists**, on purpose
  (`realtime.gateway.ts:310-320`). `checkList` is a NATS request to core cached in Redis for
  60 seconds (`core-access.client.ts:64-100`, `:172-177`), invalidated on every envelope with
  a listId (`jetstream.consumer.ts:459-468`).
- `line.claimChanged` is emitted with no listId (`line-claim.service.ts:167`) and carries ids
  only. It is out of scope.

### Target state

1. `roomsFor` sends an envelope that carries a listId to `list:{id}` and `list:{id}:presence`,
   and no longer to `zone:{id}`. The envelope keeps its zoneId, so cache invalidation and the
   sweeps are unchanged.
2. `list.created` of a list that is created private is addressed by `userIds`: the creator
   and every approved OWNER and ADMIN of the zone. A list created shared keeps the audience
   of today. The admit sweep runs after the fan out, so the presence room of a new list is
   empty when its `list.created` is published, and this is the only event that needs an
   audience of its own.
3. `list.myAccessChanged` is addressed to `{ userIds: [member.userId] }` at both emit sites.
4. The doc comments that describe the presence room as presence only
   (`realtime.messages.ts:45-61`) and the `listId` field (`realtime.events.ts:440-441`) say
   what the room carries now. The comment at `jetstream.consumer.ts:367-368` says why the
   zone room is no longer a target.
5. The SSE zone stream (`sse.controller.ts:68-84`) listens on the zone room only, so it stops
   receiving list events. That is the intended consequence, and the plan records it.

### Scope

- `apps/luna-shopper-backend/realtime/src/app/consumer/jetstream.consumer.ts` and
  `audience-routing.spec.ts` (its line 120 asserts today's behaviour and must flip to
  `[listRoom('l1'), listPresenceRoom('l1')]`).
- `apps/luna-shopper-backend/core/src/app/lists/list.service.ts` at `:278`, `:437` and `:624`,
  and a small query for the staff of a zone if none fits (`zone` membership repository).
- Specs: `core-events.publisher.spec.ts`, `list-create-sharing.spec.ts`,
  `list-set-access.spec.ts`, and a new gateway spec beside `list-presence.spec.ts` that
  proves a zone socket without access to a list receives none of its events after this change.
- The two contract doc comments. No schema changes, so no OpenAPI regeneration.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- No per socket access lookup at fan out. The presence room is the filter, and the sweeps
  keep it current. Do not add bookkeeping that `realtime.gateway.ts:310-320` rejects.
- Velista changes nothing. If a velista spec fails after this change, the routing is wrong,
  not the spec.
- The zone room still receives `list.deleted` of a shared list through the presence room,
  because the deleted list's presence room still holds its readers until the evict sweep.
  Verify this in the spec rather than assume it.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you change an event schema in
  `libs/luna-shopper/contracts`, the Redis cache keys, or anything in `libs/velista`.
- If the presence room turns out not to hold a socket that must receive an event (a case
  the sweeps do not cover), stop and report it with the event and the sequence. Do not
  widen the audience back to the zone room.

### Progress evidence

- New specs, each failing before the change:
  - a zone socket with no access to list L receives no `line.added`, `comment.added`,
    `line.updated`, `line.deleted`, `list.updated` or `list.myAccessChanged` of L;
  - a zone socket with access to L, not on the list page, still receives `list.updated`,
    `list.deleted` and `line.settled` of L;
  - `list.created` of a private list reaches the creator and the zone staff and nobody else;
  - `list.created` of a shared list reaches every approved member.
- `npx nx run-many -t lint test -p luna-shopper-backend-realtime luna-shopper-backend-core`
  passes.
- One live check on an ephemeral luna slot with two users, repeating the socket capture of
  the report (section F4.1): B's socket receives nothing for A's private list.

## 1. Not in this plan

- `line.claimChanged` is zone only and carries ids. A later plan can give it a listId.
- A velista spec that pins which events each store consumes from which room. Useful, not
  needed for the fix.
- Backend `0214` (comment counts on the lines read) touches `toLineView`, which this plan
  does not.

## 2. Choices that are mine

- **The presence room, not a new room.** It is already exactly the set of sockets whose user
  may read the list, and two sweeps already maintain it. A new room would duplicate that.
- **A private `list.created` goes to staff by user id.** The alternative, publishing after
  the admit sweep, changes the consumer's order for one event kind. Addressing by user id is
  what `list.myAccessChanged` already does.
