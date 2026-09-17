> **PR:** [#398](https://github.com/IchirokuXVI/nx-portfolio/pull/398)

# 0122: the trips of a zone list

> Client half: `apps/velista/plans/0088`. Mock: `apps/velista/plans/mocks/list-trips/`.
>
> A zone list is going to be drawn as groups: what is still to buy, then one group per
> shopping trip that touched the list, newest first. A trip is a basket that drew from the
> list, or a run of purchases somebody settled by hand. Everything such a group says is
> already stored: `generated_list_line_origins` holds what each basket asked of each zone
> line, and `line_settlements` holds every purchase with its date. Nothing serves it per
> list. This plan adds the two reads and the one event the client needs, and it is where
> the question "does the zone list need pagination" is answered.
>
> Prerequisite reading: `0047` (settlements), `0052` (the claim, and section 3.1 on event
> fan out), `0093` (waiting settlements), `0094` (siblings on one zone line),
> `core/src/app/lists/settlement.service.ts` in full (the id only cursor),
> `core/src/app/generated-lists/line-claim.sql.ts`, and the memory notes on raw SQL in
> TypeORM and on integration specs.

## Brief for the agent

### Objective

Build `GET /v1/lists/:id/trips`, `GET /v1/lists/:id/trips/:kind/:tripId/rows` and the
`list.tripsChanged` event in sections 3 to 6, with integration specs against a real
database, and regenerate the OpenAPI document and the wire types.

### Context

- `line_settlements` is the purchase record: `lineId`, `listId`, `outcome` (`BOUGHT`,
  `NOT_AVAILABLE`), `quantity`, `settledAt`, `revertedAt`, `settledByUserId`,
  `generatedListLineId`. A manual settle leaves `generatedListLineId` null. A basket settle
  sets it. The column has **no foreign key**, so after a basket is deleted it names a row
  that no longer exists. It is stored and never served today.
- `generated_list_line_origins` holds `(generatedListLineId, zoneId, listId, lineId,
  quantity)`. It cascades away with its basket line, and a basket line cascades away with
  its basket.
- `generated_lists` has `name` (null means "shown as its date"), `status` (`DRAFT`,
  `ACTIVE`, `COMPLETED`, `ARCHIVED`) and `generatedAt`. `LIVE_GENERATED_LIST_STATUSES` and
  `core.generatedList.claimWindowMs` (60 hours by default) define a live basket, and
  `generated-list-sweep.service.ts` completes one that outlives the window.
- `GET /v1/lists/:id/lines` pages by `(position, id)`, 20 by default and 100 at most. The
  client asks for 100 and loads every further page in a background loop
  (`LineStore._loadRest`), because search, reorder and the header counts all read the
  whole list.
- `SettlementService` pages with an **id only cursor** and a subselect for the boundary
  key, because an ISO timestamp in a cursor loses the microseconds of a `timestamptz`.
- The list page joins two rooms: `list:{id}` (guarded by core's `READ` check) and the zone
  room. `line.settled` and `line.claimChanged` go to the zone room.
- `LineClaimChangedEvent` deliberately carries no generated list id (`0052`).

### Target state

Every acceptance criterion in section 9 holds, the SQL rules are proven by integration
specs, and `npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-realtime luna-shopper/contracts luna-shopper-admin/models`
is green with `openapi.json` and the wire types regenerated.

### Scope

- Work only in: a new `core/src/app/lists/trips/` folder (service, SQL file, mappers,
  specs), the emit sites named in section 6 inside `core/src/app/generated-lists/`,
  `gateway/src/app/lists/` (controller, DTOs), `libs/luna-shopper/contracts` (messages,
  schemas, the event, `DOMAIN_EVENT_SUBJECTS`), the realtime consumer only if a new subject
  needs routing to the list room, and the generated files.
- Do NOT touch: `LineView`, `LineClaimChangedEvent`, the settle services' behaviour, the
  claim SQL, any migration. This plan adds **no column and no table**.

### Constraints

- Read only. Every number a trip shows is derived on read from origins and settlements.
- `revertedAt IS NULL` is the definition of a purchase that counts, as everywhere else.
- Both reads start with `listAccess.requireRead`.
- Cursors are id only, after `SettlementService`.
- Every `@Query()` value lives on the DTO (memory note on sibling params).
- Regenerate `openapi.json` and the wire types, never hand edit them.

### Action boundaries

- Proceed with in scope edits, unit and integration specs, and the generators.
- Stop and ask if the union in section 3 cannot be paged by keyset without a migration, or
  if any emit site in section 6 turns out to run outside a place where the basket's origin
  lists are known.

### Progress evidence

Report after the trips read with its integration spec, after the rows read with its spec,
and after the event, each with the spec run.

## 1. What is being built

| Piece                                          | Where                                               |
| ---------------------------------------------- | --------------------------------------------------- |
| `GET /v1/lists/:id/trips`                      | gateway lists controller, core `lists/trips`        |
| `GET /v1/lists/:id/trips/:kind/:tripId/rows`   | the same                                            |
| `TripView`, `TripRowView`, the two page shapes | `contracts` `list.messages.ts` and its schemas      |
| `list.tripsChanged`                            | `realtime.events.ts`, emit sites in generated lists |

## 2. Does the zone list need pagination

**The lines do not, and the trips do.**

- **Lines stay whole.** They are already paged on the wire and loaded in full by the
  client, 100 at a time. That is deliberate: reorder renumbers only the lines it names,
  search is in memory, and the header counts loaded lines. The grouped view adds no line.
  It draws the same lines in more places. A list grows by what a household buys, not by
  how long it shops, so its size levels off.
- **Trips grow without bound.** One trip a week is fifty two groups a year, each with its
  own rows, and rows repeat the same lines trip after trip. If they load with the page,
  every visit costs more than the last.
- **So the history is paged twice.** Trip heads come a page at a time, newest first, and
  the rows of one trip are read only when somebody opens it. A closed group costs one head.
- **Live trips are not paged.** They are bounded by the claim window, the page opens one of
  them by default, and a client needs all of them to know where a claimed line is drawn.
  They ride on the first response and nowhere else.

## 3. The trips of a list

`GET /v1/lists/:id/trips?cursor&limit`, `READ` on the list.

```ts
interface TripView {
  id: string; // the basket id, or the id of the session's earliest settlement
  kind: 'BASKET' | 'LOOSE';
  name: string | null; // BASKET only. null is "shown as its date"
  live: boolean;
  startedAt: string; // generatedAt, or the earliest settledAt of the session
  lineCount: number; // zone lines of THIS list the trip touched
  boughtLineCount: number; // of those, the ones it left nothing of
}

interface TripPage {
  live: TripView[]; // first response only, newest first. [] with a cursor
  items: TripView[]; // ended trips, newest first
  nextCursor: string | null;
}
```

**A basket trip** is a basket that has at least one origin row whose `listId` is this list.
It is live while `isLiveGeneratedList(status)` and `generatedAt` is inside the claim window,
which is the claim's own definition and must be read from the same two places.

**A loose trip** is a session of purchases that belong to no basket: live settlements of
this list whose `generatedListLineId` is null, **or names a basket line that no longer
exists**. Order them by `settledAt` and start a new session whenever the gap to the previous
one is more than `LOOSE_TRIP_GAP_MS`, six hours, a constant beside the SQL. A session is
elapsed time and never a calendar day, so no time zone is involved and a shop that crosses
midnight stays one trip. The client prints the date.

- A session's id is the id of its earliest settlement. It is stable while the session grows
  at its newer end, which is the only end an ordinary purchase can reach.
- A reverted settlement drops out of every session. If it was the one bridging two halves,
  the session splits and one id disappears. That is accepted: section 4 answers the house
  not found error for it, and the client reads the heads again.
- `NOT_AVAILABLE` settlements belong to a session like any other.

**One answer, two sources.** `items` is the union of ended basket trips and loose trips,
ordered by `(startedAt DESC, id DESC)`, `limit + 1` rows, 20 by default. The cursor carries
`{ kind, id }` and the boundary `startedAt` is looked up inside the SQL. The sessions are a
window function over the list's loose settlements, which `ix_settlements_list` serves.

`lineCount` counts distinct zone lines that still exist. A purchase whose line was deleted
or merged away (`lineId` null, or naming no row) is skipped, and a trip left with no line
is not returned at all.

## 4. The rows of one trip

`GET /v1/lists/:id/trips/:kind/:tripId/rows?cursor&limit`, `READ` on the list, `kind` being
`basket` or `loose`. The answer is the house page, 100 at most, ordered by the zone line's
`(position, id)`. The client loads every page of a trip it opens, as it does with lines.

```ts
interface TripRowView {
  lineId: string;
  asked: number | null; // BASKET: the sum of this trip's origin quantities for the line
  bought: number; // units in live BOUGHT settlements of this trip for the line
  left: number | null; // BASKET: max(0, asked - bought). LOOSE: null
  outcome: 'BOUGHT' | 'PARTLY' | 'NOT_AVAILABLE' | 'NOT_BOUGHT';
  settledByUserId: string | null; // LOOSE only, the latest buyer, null if they left the zone
}
```

- **One row per zone line**, however many sibling basket lines (`0094`) or origins fed it.
- `outcome`: `NOT_AVAILABLE` when the trip's latest live settlement for the line says so
  and `left > 0`. Otherwise `BOUGHT` when `left = 0` and `bought > 0`, `PARTLY` when both
  are above zero, `NOT_BOUGHT` when nothing was bought. A loose row is `BOUGHT` or
  `NOT_AVAILABLE`.
- **No name and no current quantity.** The client holds every line and joins on `lineId`.
  The row is a fact about the trip, and the line is read from where lines are read.
- **The numbers freeze by themselves.** Origins and settlements stop changing when the
  basket ends, so an old row never follows the line's live quantity. Nothing is copied.
- A basket that was deleted has no origins left. Its purchases surface as loose trips with
  `asked` null, and what it asked for and did not buy is gone. The product owner accepted
  that on 2026-09-17.
- A trip that does not exist, or touches no line of this list, answers the house not found
  error.

## 5. What this discloses, and the rule it reverses

A reader of a list now learns the **name and id of a basket** owned by somebody else.
`0052` refused that for the claim event: "an id in a payload is an invitation for a client
to fetch it". The product owner decided on 2026-09-17 that people with read access to a
list see the names of the baskets that drew from it. The reversal is kept narrow:

- It applies to these two reads and to the `list:{id}` room, which are both behind the
  list's `READ` check. `LineClaimChangedEvent` and the zone room stay exactly as they are.
- A trip says its name, its date and what it did to **this** list. It never says what else
  the basket holds, who takes part, where it shops or what anything costs.
- The basket routes stay behind the participant guard, which was always the real refusal.

## 6. The event

`list.tripsChanged`, payload `{ listId: string }`, to `list:{listId}`, captured in
`DOMAIN_EVENT_SUBJECTS`. It says "read the trips again" and nothing else, so it cannot leak
and cannot drift from the read. Emit it once per distinct origin `listId` when a basket:

| Change                                                   | Known site                                         |
| -------------------------------------------------------- | -------------------------------------------------- |
| is created with origins                                  | `generated-list.service.ts`                        |
| is renamed or moves between statuses, the sweep included | the update path, `generated-list-sweep.service.ts` |
| is deleted (read the origin lists **before** the delete) | the delete path                                    |
| gains or loses an origin in a list                       | `generated-list-origins.service.ts`                |

Purchases need no new event. `line.settled` and `line.claimChanged` already reach a client
on the list page, and the client treats both as the same signal (velista `0088`). Follow
`0052` section 3.1: one event per list per write, never one per line.

## 7. Not in this plan

- Moving a line added during a trip into the live basket. On hold.
- A quantity raised on the zone line reaching the live basket in the same request. It is
  the first item of the improvements phase and needs its own plan.
- Suggestions: `0123`.

## 8. Tests

Integration specs, real database, because every rule here is a `WHERE` or a window:

1. A basket with origins in two lists is a trip of each, with each list's own counts.
2. `asked`, `bought` and `left` over two origins and two sibling basket lines of one zone
   line come out as one row. A reverted settlement counts for nothing.
3. Each of the four outcomes, and `NOT_AVAILABLE` after a partial purchase.
4. Manual settles five hours apart are one loose trip, seven hours apart are two, and two
   either side of midnight UTC are one.
5. Settlements of a deleted basket become a loose trip with `asked` null.
6. A trip whose only line was deleted is not returned. A deleted line's row is skipped.
7. `live` holds a `DRAFT` basket inside the window and not one outside it, and is empty on
   a response to a cursor.
8. Paging the union visits every trip once across a boundary where a basket and a session
   share a `startedAt` to the millisecond.
9. A caller without `READ` is refused on both routes.
10. Each site in section 6 emits once per origin list, and delete still knows its lists.

## 9. Acceptance criteria

- [ ] A list's trips are served newest first, a page at a time, with live trips on the
      first response only.
- [ ] A trip's rows say what it asked, bought and left per zone line, with one row a line.
- [ ] Purchases made by hand, and purchases of deleted baskets, appear as loose trips
      grouped by a six hour gap with no time zone anywhere.
- [ ] No migration, and `LineView` and the claim event are unchanged.
- [ ] A client in the list room is told when a basket that touches the list changes.
- [ ] `openapi.json` and the wire types are current.

## 10. Verification

```sh
npx nx run-many -t lint test -p luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-realtime luna-shopper/contracts
npx nx run luna-shopper-backend-gateway:openapi
npx nx run luna-shopper-admin/models:wire-types
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --list
```

Run the integration specs through their own target against a slot (memory note on Luna
backend spec traps), then give the slot back.
