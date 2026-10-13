# 0204: a basket event carries what moved on its lines

> Reported by the owner on 2026-10-11: "The sync time between two devices is about 2 to 3
> seconds, maybe even more. When a device settles a line, it takes approx. that time for it
> to be settled in another device."
>
> The cause, read from the code the same day: the event that reaches the other device
> carries line ids and nothing else, so that device waits 1500 ms and then reads the whole
> basket again. The owner's decision: "Let's try to settle the row from the event, and
> avoid the reload if possible."
>
> **This plan reverses one sentence of plan `0130` section 6**: "a basket broadcast carries
> line ids and a kind and nothing else, and an entitled client reads again." Section 1
> says why the new payload is still the least privileged view.
>
> Velista plan `0143` is the client half. Plan `0203` is not needed to build this plan,
> and section 7 says what the two share. Plan `0205` makes the read that remains cheaper.
>
> Prerequisite reading: plan `0130` sections 4, 6 and 7, plan `0139` in full (the
> audience on the envelope, `BasketAnnouncer`, every emit site), plan `0136` (the basket
> read), plan `0137` (skips), plan `0138` sections 5 and 7 (marks), plan `0201` sections 1
> to 4 if it is on your base branch,
> `core/src/app/baskets/basket-announcer.service.ts`, `basket-coverage.service.ts`,
> `basket-rows.ts`, `basket-read.service.ts` (`rowsOf`), `basket-settle.service.ts`,
> `basket-revert.service.ts`, `basket-skip.service.ts`, `basket-demand.service.ts`,
> `core/src/app/baskets/changes/basket-marks.reader.ts`,
> `core/src/app/events/core-events.publisher.ts`,
> `libs/luna-shopper/contracts/src/lib/events/realtime.events.ts`,
> `realtime/src/app/consumer/jetstream.consumer.ts`, and the memory notes on guest
> reachable routes and on framework free libraries that a browser can reach.

## Review of 2026-10-11: settle these before you build

A review of pull request #694 checked this plan against the code on `dev`. Where this
section and a later section disagree, this section is right.

1. **"`list_lines.version` rises on every settle and revert" in section 2 is false.** In
   `basket-settle.service.ts` the version rises only for a `BOUGHT` settle with units.
   "They had none" moves no version, and a skip moves none.
2. **A patch can thus arrive after a newer one and stay.** Patches are computed after the
   commit, in parallel, one for each basket. A patch that was read before a later skip or
   close can be published after the patch of that write. Velista `0143` applies a patch
   with an equal version with no condition, so the other phone shows the older state
   until another event touches the line. Give a patch an order of its own, for example
   the database time of its read. The other way is that the client reads when the
   version is equal and `skipped` or `closed` differs. State which.
3. **"Neither plan waits for the other" is true in one order only.** This plan covers the
   case that backend `0203` is on the base branch. Backend `0203` has no such clause for
   this plan. Its review section now states it.
4. **Section 7 says that whichever of this plan and backend `0201` is built second adds
   `tripItemId`.** Backend `0201` (pull request #693) did not name the field. Its review
   section now does.
5. **"`npx nx build velista` passes, which proves the new library compiles for a
   browser" proves nothing.** Nothing in velista imports the library before velista
   `0143`. Use a check that does compile it, for example a type check of the library
   with no Node types.

## What the build decided

The build of 2026-10-13 settled the points below. Each one is a choice of the builder that the
owner can overturn. Where this section and a later section disagree, this section is right.

1. **The order of two patches (review point 2): the client rule.** A client that holds an
   entry of the same `version` whose `skipped` or `closed` differs from the patch reads the
   basket again and does not apply the patch. The payload has no order of its own. The other
   way adds a field that section 2 does not list, and the action boundaries say to stop and
   ask before that. Velista `0143` must build this rule. `BasketEntryPatch` in the contracts
   states it.
2. **An announcement is not awaited.** The settle and the revert awaited one coverage read
   before they answered. A patch is up to five reads for each covering basket, so the writes
   now start the announcement and answer. A test that reads the event must wait for it.
3. **A change of demand from a basket sends one envelope for each basket, not two.**
   `LineService.addQuantity` announces the patch with `marksMoved`. The second announcement
   of `BasketDemandService` is removed, because it computed the same patch again.
4. **`rowStateOf` takes the entries alone.** Section 4 writes `rowStateOf(entries, facts)`.
   `skipped` and `closed` on an entry already hold what the facts said, so the library needs
   no second argument and no clock.
5. **`act.participantId` can be null.** `line_settlements.settledByParticipantId` is
   nullable, and `touchedBy` on a row was nullable before this plan.
6. **One read changes for one rare case.** A `GENERATED` basket closes a row ("they had
   none"), then skips it, and the skip runs out after its window. That row read
   `NOT_AVAILABLE` before. It reads `WANTED` with the note `SKIPPED_EARLIER` now. The entry
   states one newest act, the skip is that act, and plan `0137` section 3.2 says that a skip
   ends a close that came before it. Every other case reads as it did, and the 584
   integration tests of core pass with no change to a state they assert.
7. **Only a basket socket can apply entries.** Each envelope also reaches the `user:` room of
   the owner of its basket, and nothing in a payload names the basket. A person who owns two
   baskets over one list hears both envelopes in that room. Velista `0143` must apply entries
   only on the socket that joined one basket room, which is what `BasketSocket` is today.
8. **The event has a JSON Schema of its own** (`event/BasketLinesChangedEvent`). The envelope
   schema still declares `payload` as anything, which is the open defect of plan `0149`. The
   build did not change that.

The measurement that "Progress evidence" asks for, on a list of 100 lines with two `LIVE`
baskets and one `GENERATED` basket, 200 rounds each:

| | Median | 95th percentile | Maximum | Queries | Envelopes |
| --- | --- | --- | --- | --- | --- |
| Before (ids alone) | 1.18 ms | 1.47 ms | 1.74 ms | 1 | 1 |
| After (entries) | 4.37 ms | 5.19 ms | 8.13 ms | 14 | 3 |

The patch adds 13 queries over the three baskets: five for a `LIVE` basket with a session, and
four for each of the other two. It adds about 3.2 ms, which is below the limit of 50 ms.

## Brief for the agent

### Objective

Make `basket.linesChanged` carry the state of each line that moved, computed for the
basket it is addressed to, for the writes that only move numbers. Move the two rules a
client needs to rebuild a row into one library that core and velista both call. Add one
small read of the marks.

### Context

Every statement below was read on `dev` at `6cced1bd`. Check each one before you rely on
it.

- **The payload is `{ lineIds }`.** `BasketAnnouncer.announce` sends one envelope that
  names every covering basket in `basketIds` and every owner in `userIds`. One payload
  serves all of those rooms.
- **The backend adds no timer.** Core publishes with a plain NATS `emit` after the commit
  (`core-events.publisher.ts`). There is no outbox and no poller. The realtime service
  consumes `LUNA_EVENTS` serially and emits to the rooms with no window. Its only delays
  are on failure.
- **A settle awaits one coverage read before it announces.** `basket-settle.service.ts`
  emits `line.settled` for each entry to the zone and list rooms, then calls
  `BasketAnnouncer.linesChanged`, which reads `coveringBaskets(listId)`.
- **A basket socket joins the room of its basket and nothing else.** It does not hear
  `line.settled`.
- **Every reader of a basket, a guest too, already reads the numbers of each line.**
  `BasketRowEntryView` carries `lineId`, `left`, `bought`, `boughtElsewhere`, `state` and
  `approvalStatus`. Only `listId` is held back from a reader who cannot write the list.
  `touchedBy` on a row is a participant id, and every reader gets the participants.
- **A write through a basket recomputes the whole view** to answer `progress`
  (`BasketReadService.view`), so the pieces of a read for a few lines exist.
- **A row is a group that core computes today** (`groupEntries`, by `mergeKey`). After
  plan `0201` the group depends on the prices of one read, and a write answers `entries`
  and no row.
- **`list_lines.version` rises on every settle and revert** (`zoneLine.version += 1`). A
  skip is a row of its own table and moves no line.
- **`@portfolio/luna-shopper/postal-codes` and `osm-places` are framework free libraries
  that velista compiles.** Neither names `process`.

### Target state

1. For a write that only moves numbers, each covering basket receives its own envelope,
   with the entry of each line as that basket reads it (sections 1 to 3).
2. Every other write sends what it sends today (section 3).
3. The rules that turn entries into the state of a row and into the progress are in one
   framework free library (section 4).
4. `BasketRowEntryView` carries what a client needs to apply a patch (section 5).
5. `GET /v1/baskets/:id/changes/marks` answers the marks and the count with no rows and
   no catalog (section 6).

### Scope

- `libs/luna-shopper/basket-rules` (new, created with the `nx-generate` skill).
- `libs/luna-shopper/contracts`: the event payload, the entry view, the new pattern, the
  schemas.
- `apps/luna-shopper-backend/core/src/app/baskets/`: the announcer, the read service, the
  mappers, `basket-rows.ts`, the marks reader, the emit sites of section 3.
- `apps/luna-shopper-backend/gateway/src/app/baskets/`: the new route, `openapi.json`.
- `libs/luna-shopper-admin/models`: the regenerated wire types only.

### Constraints

- **A payload holds nothing that the least privileged reader of that room does not
  already read.** No list id, no zone, no name, no account id, no basket id.
- **Every value in a patch is absolute.** No delta. Applying a patch twice gives the
  result of applying it once.
- **An announcement never fails a write and never delays its answer.** It runs after the
  commit, and a failure is logged (`safely`). When the patch cannot be computed, the
  envelope goes out with the ids alone.
- **The realtime service does not change.** It routes on the envelope and never reads a
  payload.
- **The library of section 4 is framework free**: no Nest, no TypeORM, no Angular, no
  `process`, no import from `contracts`. It compiles under both builds.
- **`openapi.json` and the wire types are generated output.**

### Action boundaries

- Do not build velista plan `0143`, plan `0203` or plan `0205`.
- Do not change any `line.*` event, the envelope, the dedupe, or the rooms.
- Stop and ask before a payload carries a field that section 2 does not list.
- Stop and ask if the patch of one write costs more than the measurement of "Progress
  evidence" allows.

### Progress evidence

- `npx nx run-many -t lint test -p luna-shopper/basket-rules luna-shopper/contracts luna-shopper-backend-core luna-shopper-backend-gateway luna-shopper-backend-realtime`
  passes, and the integration specs of section 8 run on a slot.
- `npx nx build velista` passes, which proves the new library compiles for a browser.
- **A measurement in the pull request**, on a slot with two `LIVE` baskets and one
  `GENERATED` basket over one list of 100 lines: the time from the commit of a settle to
  the publish of the last envelope, before and after. State the number of queries the
  patch adds. If the added time is above 50 ms, say so and stop.
- `npx nx run luna-shopper-backend-gateway:openapi` and
  `npx nx run luna-shopper-admin/models:wire-types` are run and their diffs committed.

## 1. Why numbers are allowed in the room

Plan `0130` section 6 kept numbers out of a broadcast "because a room cannot be projected
per socket". That reason stands. Its conclusion went too far. The least privileged reader
of a basket room is a guest, and a guest reads `left`, `bought` and the state of every
entry on every read. What a guest is not told is **where**: the list, the zone and the
household. A patch that names a line id and its numbers is inside that view.

Two things a patch cannot carry, for the same reason:

- **Anything that differs between two readers of one basket**: `listId`, the names of
  plan `0201`, `canWrite`, the marks of plan `0138` (they depend on what each viewer
  acknowledged).
- **Anything about a row.** A row is a group, and after plan `0201` two readers of one
  basket at two shops group the same lines differently.

So the patch is about lines, and the client rebuilds its rows with the library of
section 4.

## 2. The payload

```ts
interface BasketLinesChangedEvent {
  /** As today. Empty means the coverage moved. */
  lineIds: string[];
  /**
   * The state of each line, as the addressed basket reads it now.
   * Present only when every line in `lineIds` has one, or left the basket.
   * Absent means: read the basket again.
   */
  entries?: BasketEntryPatch[];
  /** The write recorded a change that this basket is shown. Read the marks. */
  marksMoved?: boolean;
}

interface BasketEntryPatch {
  lineId: string;
  /** `list_lines.version` after the write. */
  version: number;
  left: number;
  bought: number;
  boughtElsewhere: number;
  state: BasketRowState;
  approvalStatus: LineApprovalStatus;
  /** A standing skip of this basket that is inside its window. */
  skipped: boolean;
  /** The newest standing act of this basket on the line is "they had none", inside its window. */
  closed: boolean;
  /** The newest standing act of this basket on this line, or null. */
  act: {
    participantId: string;
    at: string;
    outcome: SettlementOutcome | 'SKIPPED';
  } | null;
}
```

- A line of `lineIds` with no patch in `entries` **left the basket**: it is at zero with
  no buy that keeps it a row. The client removes its entry.
- `act.at` is for the order of two acts and for display. A client never compares it with
  its own clock.
- The JSON Schema of the event gains the two optional fields. An envelope written before
  the deploy has neither, and a client reads the basket again for it, as today.

## 3. Which writes send a patch

| Write | Envelope |
| --- | --- |
| A basket settle, revert, skip, skip taken back | one for each covering basket, with `entries` |
| A change of demand from a basket, on a line that exists | the same |
| A buy on the list page (`SettlementService.settle`) | the same |
| A quantity edit of a line on the list page that touches nothing else | the same |
| An add, a rename, a merge, a delete, an approval, a product set edit, the group sync | ids only, one envelope, as today |
| The coverage moved | `lineIds: []`, as today |
| A write that names more than 25 lines | ids only |

`BasketAnnouncer` gains one method for the first four rows. For each covering basket it
computes the entries of the named lines with the queries the read already has, narrowed
to those lines: the session of the basket, its settlements, the outside buys, its skips.
Narrow `rowsOf` or extract what it shares. Do not write a second copy of a rule. Then it
emits one envelope to `{ basketIds: [that basket], userIds: [its owner] }`.

- The baskets of one write are computed in parallel.
- A basket whose patch fails is sent the ids alone.
- A skip belongs to one basket, so it is one envelope, as `basketChanged` is today.
- **`marksMoved`** is true for a basket when the write recorded a `list_line_changes` row
  and that row was not made through that basket. A change of demand made through a basket
  is the one exception: it is true for that basket too, because its other people are
  shown the mark (plan `0138`, section 5).

The acting basket hears its own envelope, as today. Its client already holds the answer
of the request, and applying the patch over it changes nothing.

## 4. One library for the two rules

`@portfolio/luna-shopper/basket-rules`, tagged like `postal-codes`. It holds:

- `rowStateOf(entries, facts)`: the state table of plan `0130` section 4, moved out of
  `stateOf` and `isSkipped` and `closeHolds` in `basket-rows.ts`.
- `rowNumbersOf(entries)`: `left`, `bought`, `asked` and `boughtElsewhere` as sums, and
  the newest act of the row.
- `progressOf(rows)`: moved out of `basket-rows.ts`.

Each takes plain structural types that the library declares itself: an entry is
`{ left, bought, boughtElsewhere, skipped, closed, act }`. Core maps its own rows into them and
keeps calling the same functions, so the read of today answers exactly what it answered.
Velista maps its own models into them (plan `0143`). **One rule, two callers.** The spec
of the library is the state table, case by case.

This is not a backend type passed through to the client (rule D4 of velista). It is a
pure function over numbers, as the postal code rules are.

If plan `0203` is on your base branch, the state `BOUGHT_ELSEWHERE` and its rule for the
progress move into the library with the rest.

## 5. The entry view

`BasketRowEntryView` gains `version`, `skipped`, `closed` and `act`, with the meaning of
section 2.
A client needs them on the entries it read, to apply a patch over them and to drop a
patch that is older than what it holds. The row keeps `touchedBy` and `touchedAt`.

`BasketRowResult`, the answer of a write, carries the same four fields on its entries.

## 6. The marks alone

`GET /v1/baskets/:id/changes/marks`, participant guard, pattern `basket.changes.marks`.

```ts
interface BasketMarksView {
  unseenChangeCount: number;
  newestUnseenChangeId: string | null;
  /** One for each covered line that carries a mark for this viewer. */
  lines: { lineId: string; mark: BasketRowMark }[];
}
```

It runs the marked changes query of `BasketMarksReader` and the coverage, and nothing
else: no rows, no people, no catalog. A client folds the marks of the lines of a row with
the rule of today (`ADDED` wins over `CHANGED`). A line that was removed is not in this
answer. A removal is a write that sends ids only, so the client reads the basket for it.

## 7. With plans 0201 and 0203

- **Plan `0203`** adds the state `BOUGHT_ELSEWHERE` and the change rows of a buy. With it,
  a buy through basket A reaches basket B as a patch whose entry has that state, with
  `marksMoved: true`. Without it, the patch says `DONE`, as the read does today. Neither
  plan waits for the other.
- **Plan `0201`** makes the product of a line follow its latest buy in the trip. A buy
  with a product that is not the product of the row moves the line to another row, and
  no patch can say which. When `0201` is on the base branch, `BasketEntryPatch` and the
  entry view gain `tripItemId: string | null`, the product of that latest buy. The client
  reads the basket again when it differs from the product of the row that holds the
  line. Whichever of the two plans is built second adds the field.

## 8. Tests

Unit specs for the library and for the announcer with fakes. Integration specs on a real
Postgres, with two `LIVE` baskets A and B over one list and a `GENERATED` basket C of the
owner of A:

1. A settles one of three. Three envelopes are published. The entry for A has `bought: 1`
   and `act` with the participant of A. The entries for B and C have `bought: 0` and
   `boughtElsewhere: 1`. Every entry has `left: 2` and the new `version`.
2. A buys the line to zero. The entry for B has the state the read of B gives for that
   line. Assert it against a read of B made in the same test.
3. A reverts. Every entry has the units back.
4. A skips a line. One envelope, to A, with `skipped: true`. B and C hear nothing.
5. A change of demand through A: `marksMoved` is true for A, B and C.
6. A buy on the list page: every envelope has `entries`.
7. An add sends one envelope with ids alone.
8. A line that ends at zero with no buy inside the window is in `lineIds` and has no
   patch.
9. A write over 26 lines sends ids alone.
10. A patch that throws for B still sends B the ids, and sends A and C their entries.
11. No payload of any test holds a list id, a zone id, a user id or a basket id.
12. The marks route: a guest and a member get the marks of their own cursor, and the
    answer equals the marks of a full read made in the same test.
13. `openapi-document.spec.ts` and `wire-types.spec.ts` pass.

## 9. Not in this plan

- What the client does with a patch (velista `0143`).
- A patch for an add, a rename, a merge or a delete. Each needs names, products or prices
  that a room must not carry or that core does not hold.
- The card on the dashboard. It keeps its own coalesced read of the listing.
- The time a write takes on the device that makes it.
