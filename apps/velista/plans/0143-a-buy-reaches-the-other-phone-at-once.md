> **PR:** [#720](https://github.com/IchirokuXVI/nx-portfolio/pull/720)

# 0143: a buy reaches the other phone at once

> Reported by the owner on 2026-10-11: "The sync time between two devices is about 2 to 3
> seconds, maybe even more. When a device settles a line, it takes approx. that time for it
> to be settled in another device."
>
> The cause, read from the code the same day: the event carries line ids only, so the
> other phone waits `REFRESH_DEBOUNCE_MS` (1500 ms) and then reads the whole shopping list
> again. The wait starts again on every event and has no ceiling, so a person who buys a
> product every second keeps the other phone waiting until they stop.
>
> The owner was offered a shorter wait and answered: "Lever one isn't enough. Let's try to
> settle the row from the event, and avoid the reload if possible."
>
> **Needs backend plan `0204` first.** It sends the state of each line in the event, moves
> the rules of a row into `@portfolio/luna-shopper/basket-rules`, and adds the read of the
> marks. If its contract is not on your base branch, say so and stop. Section 5 uses the
> rows read of backend plan `0205` when it exists, and works without it.
>
> **This plan reverses one rule of plan `0090`**: "Every event is a reason to read again,
> and none is a thing to merge." It also ends the rule that the client never counts the
> progress (plan `0060`, section 4). Section 3 says why and how the count cannot drift.
>
> Prerequisite reading: backend `0204` in full, velista `0090` (the events table and its
> 1500 ms), `0093` (marks and the acknowledgement), `0131`, `0139` section 4 if it is on
> your base branch, `libs/velista/data-access/src/lib/baskets/basket-store.ts` in full,
> `basket-socket.ts`, `basket-memory.ts`,
> `realtime/realtime-event-mapper.ts`, `mapping/basket-mappers.ts`,
> `libs/velista/models/src/lib/basket-view.ts` and `compose-basket-view.ts`, and the
> memory note on framework free libraries that a browser can reach.

## Review of 2026-10-11: settle these before you build

A review of pull request #694 checked this plan against the code on `dev`. The wait of
1500 ms with no ceiling is confirmed (`REFRESH_DEBOUNCE_MS` and `_scheduleRefresh` in
`basket-store.ts`).

1. **A patch with an equal version is applied with no condition (section 2), and it can
   be the older one.** A skip, a close and "They had none" move no version, and patches
   can arrive out of order. The review section of backend `0204` has the detail and the
   two ways out. Section 6 accepts a stale state only for the device that wrote. This
   case is the other phone.
2. **"A burst costs two reads at most" in section 5 does not hold with a ceiling of
   3000 ms.** A burst that lasts longer than the ceiling costs more than two.
3. **This plan reverses velista `0090` and `0060` section 4, and those files have no
   note.** Add one to each in the pull request that builds this plan.

## What the build decided

The build of 2026-10-15 settled the review above as the owner's brief for the build said,
and made the choices below. Each is a choice of the builder that the owner can overturn.
Where this section and a later section disagree, this section is right. Backend `0201`,
`0204` and `0205` and velista `0139`, `0140`, `0142` and `0149` were on the base branch.

**The three review points.**

1. **Review point 1: the client rule of backend `0204`.** An entry and a patch of the same
   `version` whose `skipped` or `closed` differ answer `'read'`. Entries are applied only
   from `BasketSocket`, which joined the room of one basket and no other. The store does
   not listen to `basket.linesChanged` on the account socket, whose user room hears the
   envelopes of every basket the owner holds with no basket named, so nothing changed there.
2. **Review point 2: the ceiling of 3000 ms stays, and a long burst costs more than two
   reads.** A read is asked at once after a quiet time. Later asks wait until 1500 ms pass
   with no ask, and never more than 3000 ms from the first ask the wait gathered. So a
   burst costs one read at once, about one for each 3000 ms it lasts, and one after it
   ends. Ten events one second apart cost four reads, at 0, 4000, 7000 and 10000 ms. The
   store spec "never lets a read asked for wait more than 3000 ms" asserts exactly that,
   and that no ask waited more than 3000 ms for a read that started after it. The waiting
   lives in `CoalescedRead` (`libs/velista/data-access/src/lib/baskets/coalesced-read.ts`).
3. **Review point 3: notes in velista `0090` section 7 and `0060` section 4**, in this pull
   request. Each says which rule this plan reverses and why.

**The patch (sections 1 to 3).**

4. **`applyBasketPatch` is in `libs/velista/models/src/lib/basket-patch.ts`.** It rebuilds a
   touched row with `rebuildBasketRow` of velista `0139`, which calls `rowStateOf` and
   `rowNumbersOf` of `@portfolio/luna-shopper/basket-rules`, and counts with `progressOf`
   through `basketProgressOf`. No state table is written here. A row the patch does not touch
   is the same object, so nothing above it is drawn again, and the scroll and the focus stay.
5. **The note of a row follows core's `noteOf`, and reads where a patch cannot know it.**
   - A skip stands on a line exactly while it is the newest act of that line: core's
     `actOf` names the skip only when no settlement is later, which is `SKIP_STANDS`. So the
     skip note and its time are read off the entries' acts, for a row in a state that carries
     one.
   - **A patch that changes `skipped` answers `'read'`.** The rule of section 3 needed more
     than its words in that direction, and section 3 says to read then.
   - **A patch that moves a row's `boughtElsewhere` answers `'read'`.** The note of a buy
     made elsewhere says whether it was made through a basket or on the list page, and when.
     A patch carries neither.
   - A skip note that leaves a row with something bought elsewhere answers `'read'`: the
     note under it is one this client was never sent.
6. **So four writes of another phone read rather than patch:** a skip, a skip taken back,
   "they had none" and a buy made through another shopping list. "They had none" moves no
   version, so the rule of point 1 already reads for it. Each reads the rows at once when
   it is the first of a burst. A buy, a buy taken back and a change of demand are patched,
   and so is a row crossed out by velista `0142` or brought back from it by a change of
   demand.
7. **`tripItemId` (backend `0201`).** A patch whose `tripItemId` is set and is not the
   product of the row answers `'read'`. A patch that takes a trip buy back answers `'read'`
   too, unless the line then counts as the row's product by its favourite or its first
   product. A line that would count by price is the server's to place.
8. **The held choices of velista `0140`.** The patch is applied to the entries of the read,
   `BasketStore.rows` applies the held choices over them and groups with basket-rules, as
   after a read, and `_pruneHeld` runs after every patch, so a choice is spent exactly when
   velista `0149` spends it. A buy of a held line under another product reads (point 7),
   and the choice is spent when that read lands.

**The store (sections 4 to 6).**

9. **A write that only moves numbers is applied as a patch, and no read follows it**:
   settle, revert, skip, the skip taken back and a change of demand. A write answer the
   patch cannot apply is folded as before and read after. A rename, an add and a change of
   product are always folded and read after: a rename changes a name a patch does not carry
   and can merge rows, and the other two place a line in a row this client may not hold.
10. **A patch that lands while a read is out is kept and applied again to the answer** when
    it lands, by the version rule. When the rule cannot tell, the answer is drawn and the
    rows are read once more at once. A write the patch path applied no longer makes a read
    that is out go round again, because its patch is applied to the answer instead.
11. **The rows read is the read of every event**: an event with no entries, a patch that
    cannot be applied, `basket.updated` and a participant who joins or leaves. It keeps the
    products, the scopes and the shop the store holds, and makes the full read when a row
    names a product the store does not hold. A permanent basket reads by id after its first
    read, as its full read already does, so it asks `GET /v1/baskets/:id/rows` and never
    `live/rows`.
12. **The marks read** waits 300 ms from the first `marksMoved` and does not start the wait
    again, so a burst inside 300 ms costs one request. Marks that move while it is out ask
    one more after it. An answer is dropped when a read landed while it was out, because
    that read brought marks at least as new. An event with no entries asks no marks: the
    read brings them.
13. **The mapper is all or nothing.** One malformed patch makes the whole `entries` null,
    and so does an id of `lineIds` that cannot be read, because the entries are the whole
    truth only about the lines they name. A read whose entry has no `version` reads as 0, so
    every patch applies over it.

**The memory twin (section 7).**

14. **`BasketMemory.events` is the room.** It sends `basket.linesChanged` with the entries
    for a settle, a revert, a skip, the skip taken back, a change of demand and a buy or
    revert made elsewhere, and with the ids alone for a rename, an add and a change of
    product. The version of a line rises on a buy, a buy taken back, a change of demand, a
    rename, a new favourite and a buy elsewhere, and not on a skip or a close. The twin also
    answers the rows read and the marks read. Nothing listens to `events` in the running app.

**The proof.**

15. **The comparison of section 3** is `a read and a patch give the same shopping list` in
    `basket-store.spec.ts`. It reads the twin, applies the events of one write to that read,
    and compares the rows, the progress, `pending` and the banner with a read made after the
    write, field by field. It covers a buy, a buy that finishes a row of two lists, a buy
    taken back, a change of quantity, a line of a row of two lists taken to zero, a row
    crossed out and a crossed out row brought back. A skip, "they had none" and a buy
    through another shopping list are asserted to read (point 6). The held choice is
    compared in the store: a patch over a held choice draws exactly what a read draws.
    A spec breaking `asked` in `applyBasketPatch` made four of these cases fail.
16. **`velista-luna-e2e` gained `sync.spec.ts`.** The page opens a shopping list, a session
    buys the Milk over the gateway, and the page draws the row bought within one second
    with no `GET` of the shopping list in the 2.5 s after it. On `dev` it fails at 2028 ms.
    The suite passed 8 of 8 twice on the final code, and once before a change for lint to
    the new spec alone, on a Luna slot started with
    `LUNA_REFERENCE_SEED=0` and a front end slot of shell and velista pointed at it.

**The measurement (progress evidence).** Two browsers signed in as one owner on one
generated shopping list, development builds, front end slot 1 on Luna slot 2. The first
browser buys one Nails with the row's reel and marks the commit (`performance.mark`). The
second marks the first frame that draws the new number. "Before" is `dev` at `cd0c51f2`.

|                                                                         | Before                   | After  |
| ----------------------------------------------------------------------- | ------------------------ | ------ |
| Ten buys, each after a quiet time: median from the tap to the row drawn | 1789 ms                  | 153 ms |
| Ten buys one second apart: the longest                                  | 10851 ms                 | 159 ms |
| Requests of the second browser for the shopping list                    | 11 `GET /v1/baskets/:id` | none   |

- Before, each buy waited the 1500 ms and a full read. In the burst every event started the
  wait again, so the first buy was drawn after the last one, 10.9 s later, with one read.
- After, the second browser made no request to the gateway at all during the 20 buys. The
  153 ms is the write itself on a slot, where every hop over NATS costs about 50 ms
  (backend `0205`, point 3), and the event that follows it.

**Left as found.** The three lint warnings of `velista/data-access`
(`basket-view-memory.ts`) and the three of `velista/feature-shopping-lists`
(`basket-page.spec.ts`) were on `dev` before this plan.

## Brief for the agent

### Objective

Apply the lines of a `basket.linesChanged` event to the shopping list on screen with no
request. Read again only when an event cannot be applied, and make that read wait less.

Use the `nx-portfolio-angular-developer` skill.

### Context

Every statement below was read on `dev` at `6cced1bd`.

- **`BasketStore` holds the whole shopping list in one signal** and reads it again for
  three events: `basket.linesChanged`, `basket.updated`, and a participant who joins or
  leaves. `_scheduleRefresh` cancels the timer that waits and starts a new one of
  1500 ms.
- **A read that starts while another is out waits behind it** (`_queued`), which adds a
  round trip.
- **The socket coming back and the app coming back read at once**, with no wait.
- **The answer of a write is folded with no read** (`_fold`): it carries the row and the
  progress. With plan `0139` it carries entries, and that plan reads again after it.
- **The store never counts.** `Basket.progress` is the server's, and
  `compose-basket-view.ts` builds the sections from the rows.
- **No store here uses `@angular/core/rxjs-interop`.** It is not deduped by module
  federation and throws `NG0203`.
- **After backend `0204`**: the event can carry `entries` (one `BasketEntryPatch` for each
  line, with `version`, `left`, `bought`, `boughtElsewhere`, `state`, `approvalStatus`,
  `skipped`, `closed` and `act`) and `marksMoved`. An entry of a read carries `version`,
  `skipped`, `closed` and `act` too. `GET /v1/baskets/:id/changes/marks` answers the
  marks of each line and the count. The rules that turn entries into a row are
  `rowStateOf`, `rowNumbersOf` and `progressOf` in
  `@portfolio/luna-shopper/basket-rules`.

### Target state

1. An event with `entries` changes the rows on screen with no request (sections 1 to 3).
2. An event with `marksMoved` reads the marks alone (section 4).
3. An event that cannot be applied reads again, at once for the first of a burst
   (section 5).
4. The device that made a write does not read again after it (section 6).

### Scope

- `libs/velista/models`: `basket-view.ts`, a new pure module that applies a patch, their
  specs.
- `libs/velista/data-access`: `realtime/realtime-event-mapper.ts`, `realtime-events.ts`,
  `mapping/basket-mappers.ts`, `baskets/basket-store.ts`, `basket-api.ts`,
  `basket-service.ts`, `basket-memory.ts`, their specs.
- `apps/velista-luna-e2e`: one spec.

### Constraints

- **Rule D4.** The patch is mapped from `unknown` into a model of velista. A patch with a
  missing or malformed field is no patch, and the store reads again.
- **One rule for a row, and it is not written here.** The state and the numbers of a row
  come from `@portfolio/luna-shopper/basket-rules`. Velista maps its entries into the
  plain types of that library and maps the answer back. Do not write the state table a
  second time.
- **When in doubt, read.** Each case of section 2 that the store cannot apply ends in a
  read. A patch never leaves the screen in a state the server would not answer.
- **No clock on the client.** `act.at` of two entries are compared with each other,
  never with the time of the phone.
- **No `@angular/core/rxjs-interop`** in a store.
- The page keeps its scroll position and its focus when a patch lands. A patch replaces
  the entries of a row. It does not rebuild the list.

### Action boundaries

- Do not change the backend. If the contract lacks something, say what and stop.
- Do not change `BasketListStore` (the card on the dashboard). It keeps its own read.
- Do not make a write appear before its answer arrives. That is a different change, and
  nobody asked for it.
- Do not build plan `0142`.

### Progress evidence

- `npx nx build velista` and
  `npx nx run-many -t lint test -p velista/models velista/data-access velista/feature-shopping-lists`
  pass.
- `npx nx e2e velista-luna-e2e` passes on a slot.
- **A measurement in the pull request**, with two browsers on one slot and the same
  shopping list open in both. For ten buys, the time from the tap in the first browser to
  the row drawn as bought in the second, read from a performance mark on each side.
  State the median before and after. Then ten buys one second apart: state the longest
  time, before and after.
- The network panel of the second browser during those buys: no request to the shopping
  list.

## 1. The patch as a model

`realtime-event-mapper.ts` maps the event into
`{ lineIds, entries: BasketEntryPatch[] | null, marksMoved: boolean }`. `entries` is null
when the wire has none, or when any of its members is malformed.

A pure function in `libs/velista/models` applies it:

```ts
applyBasketPatch(basket: Basket, lineIds: string[], entries: BasketEntryPatch[]):
  Basket | 'read'
```

It answers a new `Basket`, or the word that tells the store to read.

## 2. Applying it

For each line id of the event:

| The line | What happens |
| --- | --- |
| Has a patch, and an entry of a row holds that line | the entry takes the fields of the patch and keeps the ones the patch does not carry: its list, the names and `canWrite` of plan `0139`, `demandEditable` |
| Has a patch, and no row holds that line | `'read'`. The line is new to this client |
| Has no patch, and an entry holds that line | the entry is removed. A row with no entry left is removed |
| Has no patch, and no row holds it | nothing |

- **A patch older than the entry is dropped.** An entry whose `version` is above the
  `version` of the patch stays as it is. With equal versions the patch is applied: a skip
  moves no version.
- **With plan `0201` on the base branch**: a patch whose `tripItemId` is set and is not
  the product of the row that holds the line answers `'read'`. The line now belongs to
  another row, and only a read knows which.
- A patch never changes `demandEditable`, a name, a price or a product.
- `REMOVED` rows have no entries and are never touched by a patch.

## 3. The row and the counts after a patch

For every row that a patch touched:

- `rowNumbersOf` answers `left`, `bought`, `asked`, `boughtElsewhere` and the newest act,
  which gives `touchedBy` and `touchedAt`.
- `rowStateOf` answers the state.
- The note of a row is not recomputed. Keep the note the last read sent, except that a
  row with nothing skipped any more drops a note about a skip. If that rule needs more
  than those words to write, answer `'read'` for a patch that changes `skipped`.

Then `progressOf` from the same library counts the rows, and the answer replaces
`Basket.progress` and the `pending` lifted from it.

**Why the client counts now.** After plan `0201` the rows of a shopping list depend on
the shop of the read, so two phones on one shopping list can hold different rows, and no
event can carry a count that is right for both. The count is therefore taken from the
rows on screen. It cannot drift from the server's, because both run the same function of
one library. A spec feeds one set of entries through a full read of the memory twin and
through a patch, and compares the two shopping lists field by field.

## 4. Marks

When an event has `marksMoved`, the store asks `GET /v1/baskets/:id/changes/marks`. It
waits 300 ms first, so the marks of a burst cost one request.

- Each row takes the mark of its lines: `ADDED` wins over `CHANGED`, and a row with no
  marked line has none. A `REMOVED` row keeps the mark it has.
- `unseenChangeCount` and `newestUnseenChangeId` are replaced by the answer.
- The acknowledgement of plan `0093` does not change. It still sends the newest change
  that was drawn.
- A failed read of the marks is silent. The next full read brings them.

## 5. When the store still reads

An event with no `entries`, `'read'` from section 2, `basket.updated`, and a participant
who joins or leaves.

- **The first event after a quiet time reads at once.** Events that arrive while that
  read is out, or within 1500 ms of it, are gathered into one more read at the end. The
  first change is on screen after one round trip. A burst that lasts longer than the
  ceiling below costs about one read for each 3000 ms it lasts, not two in all ("What
  the build decided", point 2).
- **The wait has a ceiling.** A read that was asked for never waits more than 3000 ms,
  however many events follow.
- **The rows read.** When `GET /v1/baskets/:id/rows` of backend plan `0205` exists, a read
  that an event caused uses it. The store keeps the products, the scopes and the shop it
  holds, and falls back to the full read when the answer names a product it does not
  hold. Opening the page, the app coming back and the socket coming back make the full
  read, as today. Without that route, every read is the full read.
- An event that arrives while a full read is out is applied to the answer of that read
  when the read lands, by the version rule of section 2. If the store cannot tell, it
  reads once more.

## 6. The device that made the write

- The answer of a write is applied with the same function as a patch, so the row and the
  counts are right before any event lands. Then the event of the same write arrives and
  changes nothing.
- **With plan `0139` on the base branch, its read after a write goes** (its section 4,
  "then refetches as it does today"). The answer carries the entries with the fields a
  patch has, and section 3 rebuilds the row.
- A device that makes two writes close together can receive the event of the first after
  the answer of the second. The version rule drops it for a buy and a take back. For a
  skip and a skip taken back it can show the older state until the event of the second
  write arrives, which is already on its way. That is accepted.

## 7. The memory twin

`basket-memory.ts` sends the same event with `entries` for the writes that the server
sends them for, and answers the marks read, so the app in its memory mode and the specs
exercise the same path.

## 8. Tests

- `applyBasketPatch`: each row of the table of section 2, a patch older than the entry,
  equal versions, a row of two lists where one entry goes to zero, a row that loses its
  last entry, a malformed patch.
- The comparison of section 3: a read and a patch give the same shopping list, for a buy,
  a take back, a skip, "they had none", a change of quantity, and a buy made through
  another shopping list.
- The store: an event with `entries` makes no request. An event without them reads at
  once, and three more inside the window make one more read. A read asked for is never
  later than 3000 ms. `marksMoved` asks the marks once for a burst.
- The store: the answer of a write, then its own event, changes nothing. No read follows
  a write.
- The rows read: used after an event, and the full read is made when a product is
  missing.
- `velista-luna-e2e`: two sessions on one shopping list. One buys over the gateway, and
  the other shows the row as bought within one second, with no request to the shopping
  list.

## 9. Not in this plan

- The backend half (plan `0204`) and the cheaper read (plan `0205`).
- The row of a buy made through another shopping list (plan `0142`). This plan applies
  whatever state the server sends.
- A write that is drawn before its answer.
- The card on the dashboard.
