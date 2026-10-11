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
  read is out, or within 1500 ms of it, are gathered into one more read at the end. So a
  burst costs two reads at most, and the first change is on screen after one round trip.
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
