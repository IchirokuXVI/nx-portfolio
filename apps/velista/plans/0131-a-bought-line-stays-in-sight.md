# 0131: a bought line stays in sight

> Reported by the owner on 2026-10-04, as the first thing to build. Two or more people
> have the same zone list open. One of them buys a line. The line disappears for everybody
> else. The buyer still sees it. The owner expects the line to stay on the page, marked as
> bought, for as long as the trip that bought it is live.
>
> Prerequisite reading: velista `0088` (the zone list grouped by trip), sections 2, 3, 4
> and 8, and velista `0095` section 5. Then
> `libs/velista/models/src/lib/compose-list-groups.ts` (`composeListGroups`),
> `libs/velista/data-access/src/lib/lists/list-view-store.ts` (`seedOpenTrip`,
> `toggleTrip`, `closeTrip`), `libs/velista/data-access/src/lib/trips/trip-store.ts`
> (`_apply`, `refetch`, `_rereadRows`), and the three effects that start at "The newest
> live trip is open" in `libs/velista/feature-lists/src/lib/list-page/list-page.ts`.

## Brief for the agent

### Objective

Keep a line that somebody else bought in sight on the zone list page: its live trip group
opens by itself the first time it appears, and the line is never on neither side while the
trips are read again.

Use the `nx-portfolio-angular-developer` skill.

### Context

What the code does today, read on 2026-10-04 on `dev` at `73fb7ce9`. **The cause below
comes from reading the code. Nobody reproduced it in a browser yet.** Reproduce it first
(step 1 of "Order of work"), and stop if what you see is a different defect.

- **A bought line leaves To buy by design.** `line.settled` reaches `LineStore`, which
  sets the line's `quantity` to zero with `boughtCount` above zero. `composeListGroups`
  then keeps the line out of To buy when `tripsHold` is true, which means that one heads
  read succeeded and named at least one trip. The line is drawn only as a row of a trip
  group (`0088`, section 3: "A line at zero with purchases is in no live group. It lives
  in its trips").
- **The live trip group is the mark the owner remembers.** A basket trip is live while
  its basket is open and inside the claim window (`core.generatedList.claimWindowMs`, 60
  hours by default, backend `0122`). Its rows draw each line's outcome. That is the "fixed
  amount of time".
- **A trip group opens by itself once per visit, and only at the first load.**
  `ListViewStore.seedOpenTrip` sets `_tripsSeeded` the first time the heads arrive and
  opens the newest live trip, or nothing when there is none. Every later call returns at
  once.
- **So a trip that starts after the page opened arrives closed.** Member B opens the list.
  No trip is live, so the seed opens nothing. Member A starts a basket and buys a line.
  `TripStore` reads the heads again after `TRIPS_REFETCH_QUIET_MS` (400 ms) and now holds
  a live trip, but nothing opens it. For B the line left To buy and sits inside a closed
  group. That is "it disappears".
- **The buyer does not see the defect.** A buys on the basket page, where the row stays
  as bought. When A opens the list afterwards, the first heads read already names the
  live trip, and the seed opens it.
- **There is also a gap with no group at all.** Between the `line.settled` event and the
  answer of the heads read, the line is at zero with purchases and no trip row names it.
  When the list already has any older trip, `tripsHold` is true and the line is drawn
  nowhere. `0088` section 3 says "no line is ever on neither side". The gap is at least
  400 ms plus two reads, and it does not end when the refresh fails.
- **Specs that exist:** `list-view-store.spec.ts`, `compose-list-groups.spec.ts`,
  `trip-store.spec.ts`, `list-page.spec.ts`, and `member.spec.ts` in
  `apps/velista-luna-e2e`.

### Target state

1. **A live trip opens by itself the first time this visit sees it.** Replace the one
   boolean with the set of live trip keys that were opened by the page. At the first load
   the rule of `0088` section 2 stays: the newest live trip opens and every other one is
   closed. After the first load, a live trip whose key was never seen in this visit opens
   once, when its head arrives.
2. **A trip somebody closed stays closed.** A key that was seen is never opened by the
   page again, through any refetch. `toggleTrip` and `closeTrip` keep their behavior.
3. **A past trip never opens by itself.** Only `trip.live` heads count as new.
4. **A line that was just bought stays in To buy until a trip row names it.** The page
   remembers the ids of the lines of this list that a `line.settled` event took to zero
   in this visit. Such a line is drawn in To buy, after the lines at zero that were never
   bought, exactly as a `boughtAtZero` line is drawn today. It leaves that memory when
   the rows of a held trip name it, or when its quantity rises above zero. A failed
   refresh leaves it in To buy, where somebody can raise it.
5. **Leaving the list clears both memories**, in the place that clears `_openTrips`
   today.
6. **No new copy, no new component and no backend change.** The row in the trip group
   already says who bought the line and with what outcome.

### Order of work

1. **Reproduce.** Use two browser sessions on one slot (see
   `apps/velista-luna-e2e` and `tools/dev/README.md`). Check with `--list` first and point
   at a backend that already listens. Member B opens a zone list with no live trip. Member
   A opens a basket over that list and marks one line as bought. Write down what B sees
   after one second and after five. Then repeat with a list that already has a past trip.
2. **Rule out the two other causes** before you write code, with the network panel of B:
   - `GET /v1/lists/:id/trips` for B names A's trip under `live`. If it does not, the
     defect is a redaction on the backend, and this plan is wrong. Stop and report.
   - The rows read of that trip names the bought line. If it does not, stop and report.
3. Write the failing specs of "Tests", then the change.
4. Repeat step 1 and record what B sees.

### Scope

- `libs/velista/data-access/src/lib/lists/list-view-store.ts` and its spec.
- `libs/velista/models/src/lib/compose-list-groups.ts` and its spec: one new optional
  input, the ids of target 4.
- `libs/velista/feature-lists/src/lib/list-page/list-page.ts` and its spec: the seed
  effect, and the memory of target 4.
- `apps/velista-luna-e2e/src/member.spec.ts`: one new step.

### Constraints

- **Do not use `@angular/core/rxjs-interop`** in a store. `CLAUDE.md` says why.
- The memory of target 4 is per visit and is never stored on the device.
- `TripStore` already reads the rows of every live trip on a refresh. Do not add a
  second read.
- Reorder mode and a search keep their rules: reorder mode draws wanted lines only, and
  a search is flat.
- A due line keeps its place in the due section (`0089`). A line held by target 4 that is
  also due is drawn once, in the due section.
- Do not change the basket page, the settle sheet or `BasketStore`.

### Action boundaries

**Stop and ask before** any of these:

- Drawing a bought line inside To buy for the whole life of the trip, in place of the trip
  group. The owner said "marked as settled for a fixed amount of time, if I remember
  correctly". This plan reads that as the live trip group of `0088`. If the owner means
  the To buy section, that is a design change to `0088` and needs a mock.
- Opening more than the new live trip, or changing which trip is open at the first load.
- Any change under `apps/luna-shopper-backend` or `libs/luna-shopper/contracts`.

### Progress evidence

- The specs below fail before the change and pass after it.
- `npx nx affected -t lint test build` is green.
- A note in the pull request with what member B saw before and after, in both cases of
  step 1.

## Tests

1. `list-view-store.spec.ts`: the first load with one live trip opens it. The first load
   with no live trip opens nothing. A live trip that arrives later opens once. The same
   trip closed by `toggleTrip` stays closed when its head arrives again. A second new live
   trip opens while the first keeps its state. A past trip that arrives later stays
   closed. `open(listId)` for another list forgets the seen keys.
2. `compose-list-groups.spec.ts`: a line at zero with purchases whose id is held stays in
   To buy while `tripsHold` is true and no row names it. It leaves To buy when a held
   trip's rows name it. It is absent in reorder mode. A held line that is also due is
   drawn in the due section only.
3. `list-page.spec.ts`: a `line.settled` event for a line of this list, followed by a
   heads answer that names a new live trip, draws the line inside an open group. A
   `line.settled` event followed by a failed refresh leaves the line in To buy.
4. `member.spec.ts`: a member has the list open, the owner buys a line through the
   gateway, and the member sees the line in an open trip group without a reload. Run it
   against a slot (`e2e` of `velista-luna-e2e`). This suite does not run on a pull
   request, so say in the pull request that you ran it and what it printed.

## What this plan does not do

- It does not move a bought line back into To buy for the life of the trip.
- It does not change how long a trip is live.
- It does not fix the finished basket screen or the quantity that can overwrite a
  purchase. Backend `0171` section 3.1 lists those.
