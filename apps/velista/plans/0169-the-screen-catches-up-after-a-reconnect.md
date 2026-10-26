> **PR:** [#817](https://github.com/IchirokuXVI/nx-portfolio/pull/817)

# 0169: the screen catches up after a reconnect

> Asked for by the owner on 2026-10-23, with plan `0168`: "make the user reconnect to the
> socket and reload info that could have changed on the page without a reload, which means
> that only data gathered via socket should be re-fetched. I think that is most of the data
> anyway."
>
> This is the second half. Plan `0168` makes the socket come back by itself and gives the
> client a `reconnects` counter. This plan makes every store that mirrors server state read
> again when that counter moves, quietly, so a screen that was stale while the socket was
> down is right again a moment after it is up. Nothing here reloads the document.
>
> **Needs plan `0168` merged first**: it owns `RealtimeClientI.reconnects`. Build nothing of
> `0168` here; if the counter is not on `dev`, say so and stop.
>
> Every fact below was read on `feat/velista-capacitor-android` at `e5320be3` on 2026-10-23.
> The store inventory that this plan is built on is section 3 of this file; each row names
> the method and the guard a builder must respect.
>
> Prerequisite reading: plan `0035` section 4.2 (why a resume refetches nothing, which this
> plan does not reverse), plan `0090` section 7.1 (why a basket is read again on a
> reconnect, which this plan generalises), plan `0093` section 8, plan `0016` section 6 R6
> (rooms are rejoined, not replayed), `libs/velista/data-access/src/lib/baskets/basket-store.ts`
> L325 to L359 (the pattern), `basket-list-store.ts` L205 to L231, `live-basket-store.ts`
> L75 to L99, `libs/velista/platform/src/lib/app-resumed.ts`, and every store in section 3.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

Every store that holds server state kept live by the realtime socket reads that state again
when `REALTIME_CLIENT.reconnects()` moves, without a skeleton, without a document reload,
and without reading anything a screen is not holding. State that only the socket produces
(presence) is not refetched, because the server rebuilds it on the room join. The resume
behaviour of today is untouched.

### Context

- **Rooms come back, events do not.** `RoomRegistry.onConnected` rejoins every room a screen
  holds (realtime-socket.ts L363 to L379). Everything broadcast while the socket was down
  went to a room this socket was not in. Presence is the exception: the server broadcasts a
  fresh snapshot to the room on every join (`apps/luna-shopper-backend/realtime/src/app/presence/presence.service.ts`
  L233, L259), so `PresenceStore` needs nothing beyond its `clear()` on disconnect
  (presence-store.ts L103 to L110).
- **The pattern exists.** `BasketStore` watches `BasketSocket.reconnects()` and
  `AppResumed.resumes()` in one effect, compares each against what it last acted on, and
  calls `refresh()` when either moved (basket-store.ts L344 to L359). `BasketListStore`
  (L221 to L231) and `LiveBasketStore` (L90 to L99) do the same on `resumes()` alone. The
  list page does its own edge detection for product prices (list-page.ts L1354 to L1380).
- **Nothing else reacts.** `ZoneStore`, `ListStore`, `LineStore`, `MembershipStore`,
  `MemberNames`, `ProfileStore`, `ShoppingProfileStore`, `SharedListStore`, `PurchaseStore`,
  `TripStore` and `DueLineStore` react to neither edge (section 3).
- **Some loads are guarded against a second call.** `BasketListStore.load` and
  `SharedListStore.load` return when `_asked`; `PurchaseStore.loadFirst` returns unless
  idle; `MemberNames.ensure` returns when the zone was asked; `TripStore.open` and
  `DueLineStore.open` return for the same list; `LineStore.loadSettlements` and
  `loadItemSettlements` return when the map has the line. A reconnect must call the real
  refetch of each store, not the guarded entry.
- **Some refetches show a skeleton.** `BasketListStore.reload`, `SharedListStore.reload`
  and `ZoneStore.load` set `'loading'`. Their quiet counterparts are private
  (`_refreshQuietly`, `_scheduleRefresh`, `ZoneStore._reconcile` at L548).
- **`LineStore` is app scoped and accumulates.** Its `_byList` map holds every list visited
  this session (line-store.ts L382 `load(listId)`, L421 `refresh(listId)`). Reading every
  one of them again on each reconnect is a request per list visited since the app opened.
- **Plan 0168's counter.** `reconnects` is zero until the first connect of a session, moves
  on every later connect, and resets to zero on sign out. An effect that reads it runs once
  on creation with the value it starts at, so the first run must act on nothing: compare
  against what the effect last saw, as the basket stores do.

### Target state

1. **One helper for the edge.** `libs/velista/platform/src/lib/on-edge.ts` exports
   `onEdge(counter: Signal<number>, act: () => void): void`, to be called in an injection
   context: an `effect` that reads the counter, remembers the value it last saw (seeded with
   the current value at creation, under `untracked`), and calls `act` under `untracked`
   only when the value differs from the remembered one. Its doc comment carries the reason
   the basket stores give (an edge cannot be read from a boolean; the first run acts on
   nothing). Exported from the barrel with a spec. The three basket stores and the list page
   keep their own code: rewriting them is not this plan.
2. **Each store below reads again on the edge**, through `onEdge(this._realtime.reconnects, ...)`
   in its constructor, calling the method in the table and only when the store has
   something to refresh. "Quietly" means: the rows on screen stay while the read runs, no
   `'loading'` state, errors swallowed the way the quiet methods already swallow them.

   | Store                                                 | On the edge                                                                                                                                                                     | Make public or add                                                                                                                                                                                                                 |
   | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `ZoneStore`                                           | `refresh()`: the quiet full read of `listMyZones` that `_reconcile` (L548) does today, then `loadZone(zoneId)` for each zone whose detail state is `'loaded'`                   | `refresh()` wraps `_reconcile`; keep `_reconcile` private                                                                                                                                                                          |
   | `ListStore`                                           | `refresh(zoneId)` (L123) for every zone in its map                                                                                                                              | nothing                                                                                                                                                                                                                            |
   | `LineStore`                                           | `refresh(listId)` (L421) for every list that has a **live** holder, and mark every other loaded list stale so its next `load(listId)` (L382) reads instead of serving the cache | a `stale` set, consulted by `load`; the list page tells the store which list is live through the same call it uses today to view it, or through a new `hold(listId): () => void` if nothing suitable exists (your call, say which) |
   | `MembershipStore`                                     | `load(zoneId, statuses)` (L162) for every zone in its map, with the statuses it last used for that zone, keeping the rows while it runs                                         | the per zone statuses are already in `_statuses`                                                                                                                                                                                   |
   | `MemberNames`                                         | a new `refresh()` that re-reads every zone in `_asked` through the same paging `ensure` uses and absorbs the rows                                                               | `refresh()`                                                                                                                                                                                                                        |
   | `BasketListStore`                                     | `_scheduleRefresh()` when `_asked`                                                                                                                                              | nothing (it is what the resume effect calls)                                                                                                                                                                                       |
   | `SharedListStore`                                     | `_scheduleRefresh()` when `_asked`                                                                                                                                              | nothing                                                                                                                                                                                                                            |
   | `LiveBasketStore`                                     | `load()` when `_asked`                                                                                                                                                          | nothing                                                                                                                                                                                                                            |
   | `ProfileStore`                                        | `load()` (L219)                                                                                                                                                                 | nothing                                                                                                                                                                                                                            |
   | `ShoppingProfileStore`                                | `load()` (L243), the profiles only if a lighter entry exists; say which                                                                                                         | nothing, or a `refreshProfiles()` if you split it                                                                                                                                                                                  |
   | `PurchaseStore`                                       | `refetch()` (L187), which already requires `'loaded'`                                                                                                                           | nothing                                                                                                                                                                                                                            |
   | `TripStore`                                           | `refetch()` (L210)                                                                                                                                                              | nothing                                                                                                                                                                                                                            |
   | `DueLineStore`                                        | `refetch()` (L86)                                                                                                                                                               | nothing                                                                                                                                                                                                                            |
   | comments sheet (`feature-lists`, `comments-sheet.ts`) | re-read the comments of the open line and call `recordComments`, the way it does on open                                                                                        | nothing                                                                                                                                                                                                                            |

   Not on the edge: `PresenceStore` (server snapshot on join), `BasketStore` (its own
   socket's counter already does it), catalog, item names and prices (not socket fed; the
   list page's price visit stays as it is), chains and coverage.

3. **The resume stays as it is.** No store gains a reaction to `AppResumed.resumes()` and
   none loses one. Plan 0168 D2 turns a resume after a long absence into a reconnect, which
   is what makes this sufficient; a short absence with a live socket missed no event.
4. **Specs**, one per store touched: with the double's `setReconnects(1)` after construction
   the quiet method is called once with the ids the store holds; at construction nothing is
   called; a store with nothing loaded calls nothing; `LineStore` reads again only the live
   lists and serves a stale list from the server on the next `load`. `on-edge.spec.ts`
   covers the helper on its own.
5. **Browser check on a slot**, two tabs on one account: tab A on a list, tab B ticks a
   line while tab A's socket is down (DevTools, offline), then tab A's socket returns; the
   line is ticked in tab A within a second of the handshake with no reload and no skeleton.
   Repeat on home (a list created in B appears in A) and on a group's members page. Record
   what you saw in "What the build decided".

### Scope

- Work only in: `libs/velista/platform/src/lib/on-edge.ts` and spec,
  `libs/velista/platform/src/index.ts`, the stores named in the table under
  `libs/velista/data-access/src/lib/**` and their specs,
  `libs/velista/data-access/src/lib/testing/**` (the double's `setReconnects` if 0168 did
  not add it), `libs/velista/feature-lists/src/lib/comments-sheet/**`, and, only if target
  2 needs the list page to name its live list, `libs/velista/feature-lists/src/lib/list-page/list-page.ts`
  around L1446 to L1463.
- Do not touch: `realtime-socket.ts`, `realtime-client.ts`, `basket-socket.ts`,
  `basket-store.ts`, `connection-recovery.ts`, `app-resumed.ts`, any `ui` component, any
  template copy, `package.json`, the Android project, anything under
  `apps/luna-shopper-backend`, and any file of another app.

### Constraints

- Angular 21, zoneless, signals; `effect` with `untracked`, hand written subscriptions,
  **no `@angular/core/rxjs-interop`** in `data-access` or `platform` (every store says why).
- No new npm dependency. No new HTTP route; every refetch calls a read that exists.
- No skeleton on a refetch, no document reload, no navigation.
- A refetch reads only what the store holds; nothing reads "all lists" or "all zones" of
  the account unless the store already holds that listing.
- SSR rules of plan 0166 section 2: the helper runs no timer and reads no global; the
  stores already do not.
- Prose in files has no dashes as punctuation (the owner's rule).
- Only make the changes this plan names. No feature, refactor or abstraction beyond them.
  In particular, do not rewrite the basket stores' edge effects onto the helper.

### Action boundaries

- Proceed with reversible, in scope edits, specs, lint, builds and slot runs.
- Stop and ask before adding a dependency, changing `RealtimeClientI`, adding a backend
  route, or editing a file outside the listed scope.

### Progress evidence

Report when a numbered target is done, and at the end. Ground each claim in a tool result:
the spec run, the lint run, the build output, the browser check. Name every decision you had
to take that the plan did not settle, in the section "What the build decided" at the end of
this file.

## 1. Decisions

- **D1. Refetch on the reconnect edge, not on the resume.** Plan 0035 section 4.2 refused a
  store refetch on resume because "every glance at the phone" would become a burst of
  requests, and that reasoning still holds for a resume whose socket never died. The basket
  stores departed from it (plan 0090) because a basket is the one screen a person reads
  while the phone is in a pocket. With plan 0168 D2, a resume after a long absence is a
  reconnect, and a reconnect is exactly the moment events were missed. One edge, one
  reason.
- **D2. Each store owns its reaction.** A central "catch up" service that knows every store
  and calls each in order is one more place that must learn about every new store, and the
  resume precedent put the reaction inside the store. The helper exists so that the twelve
  copies of the counter compare are one function with one spec.
- **D3. Quiet, always.** A reconnect after a screen off is the most common event this plan
  reacts to, and a skeleton over a list a person is reading, several times an hour, is
  worse than the stale second it replaces. Every store has or gets a quiet read.
- **D4. `LineStore` reads the live lists and forgets the rest.** The one app scoped map that
  grows without bound gets the one rule that keeps a reconnect at a handful of requests:
  what a screen holds is read now, what nothing holds is read when it is next asked for.
- **D5. Presence is not refetched.** The server sends the room's snapshot on join. A read
  that does not exist cannot be added for a state the socket already restores.
- **D6. No stagger, no coalescing across stores.** A reconnect on the home page costs about
  six requests (zones, lists per zone, member names per zone, baskets, live summary,
  profile); on a list page about five. The gateway's rate bucket is per user since PR 515.
  If a phone shows a burst that matters, the coalescing belongs in the gateway as a
  batched read, not in twelve client timers.

## 2. SSR rules that bind this plan

Plan 0166 section 2, unchanged. The helper runs no timer and touches no global.

## 3. The inventory

Read on `e5320be3`. The method names are exact; a builder relies on them.

| Store (data-access/src/lib/)                     | Events it applies                                                                    | First load, cache shape                                                                  | Real refetch, and the guards to avoid                                                                                                                    | Reacts today                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `account/profile-store.ts`                       | `user.usernameChanged` (own id)                                                      | `load()` → `GET /v1/account/me`; one value                                               | `load()` L219, single flight, keeps the held profile                                                                                                     | neither edge                                |
| `baskets/basket-list-store.ts`                   | `basket.created/updated/deleted`                                                     | `reload()` → `GET /v1/baskets`; one page plus cursor                                     | `_scheduleRefresh()` L388 (quiet, debounced); `load()` L259 returns when `_asked`; `reload()` L268 shows a skeleton                                      | resume → `_scheduleRefresh` (L221)          |
| `baskets/basket-store.ts` (page scoped)          | `basket.unshared` via `REALTIME_CLIENT`; the rest via `BasketSocket`                 | `open(id)` L796, `openLive()` L830                                                       | `refresh()` L907                                                                                                                                         | `BasketSocket.reconnects` and resume (L344) |
| `baskets/live-basket-store.ts`                   | `basket.created/updated/deleted` → `load()`                                          | `load()` → `GET /v1/baskets/live/summary`                                                | `load()` L130, generation guarded                                                                                                                        | resume (L90)                                |
| `baskets/shared-list-store.ts`                   | `basket.shared/unshared` → `_scheduleRefresh`                                        | `reload()` → `GET /v1/baskets/shared`                                                    | `_scheduleRefresh()`; `load()` L101 returns when `_asked`; `reload()` L109 shows a skeleton                                                              | neither                                     |
| `due-lines/due-line-store.ts` (list page scoped) | `list.tripsChanged`, `line.settled`, `line.claimChanged` → `refetch()`               | `open(listId)` L67 → `GET /v1/lists/:id/suggestions`                                     | `refetch()` L86, debounced; `open` returns for the same list                                                                                             | neither                                     |
| `lines/line-store.ts` (app scoped)               | `line.added/updated/settled/claimChanged/deleted/reordered`, `comment.added/updated` | `load(listId)` L382 → `GET /v1/lists/:id/lines`, every page; map by list id              | `refresh(listId)` L421, quiet; `loadSettlements` L752 and `loadItemSettlements` L817 return when the map has the line; comments are fetched by the sheet | neither                                     |
| `lists/list-store.ts` (app scoped)               | `list.created/updated/deleted/accessChanged/myAccessChanged`                         | `load(zoneId)` L100 → `GET /v1/zones/:id/lists`; map by zone id                          | `refresh(zoneId)` L123, quiet                                                                                                                            | neither                                     |
| `memberships/member-names.ts` (app scoped)       | `member.*` for asked zones                                                           | `ensure(zoneId)` L139 → `GET /v1/zones/:id/members`, every page; map by zone then user   | none public; `ensure` returns when asked                                                                                                                 | neither                                     |
| `memberships/membership-store.ts` (app scoped)   | `member.*`, `member.rejected`                                                        | `load(zoneId, statuses)` L162; map by zone id, filter in `_statuses`                     | `load` is real, keeps rows, sets `'loading'`, rethrows                                                                                                   | clears on user change                       |
| `presence/presence-store.ts`                     | `presence.zoneUpdated/listUpdated`                                                   | no HTTP                                                                                  | nothing to refetch                                                                                                                                       | clears when `!connected` (L103)             |
| `profiles/shopping-profile-store.ts`             | `profiles.changed`                                                                   | `load()` L243 → profiles, chains, coverage                                               | `load()` real; `refreshCoverage()` L285                                                                                                                  | neither                                     |
| `purchases/purchase-store.ts` (app scoped)       | `line.settled`, `basket.updated` while attached                                      | `loadFirst()` L125 → `GET /v1/purchases/sessions`; rows by entry key                     | `refetch()` L187, debounced, requires `'loaded'`; `loadFirst` returns unless idle; `reload()` L133 shows a skeleton                                      | neither                                     |
| `trips/trip-store.ts` (route scoped)             | `list.tripsChanged`, `line.settled`, `line.claimChanged` → `refetch()`               | `open(listId)` L118 → `GET /v1/lists/:id/trips`; rows by trip key                        | `refetch()` L210, debounced, rereads opened rows; `open` returns for the same list                                                                       | neither                                     |
| `zones/zone-store.ts` (app scoped)               | `zone.*`, `member.*` for self, `list.*` previews                                     | `load()` L225 → `listMyZones`; `loadZone(id)` L366 → `GET /v1/zones/:id`; map by zone id | `_reconcile()` L548 private and quiet; `loadZone` real, stays `'loaded'`; `load()` shows a skeleton                                                      | neither                                     |

Pages: `home-page.ts` loads zones, baskets, the profile and member names; `list-page.ts`
loads lines, the zone, lists, trips, due lines and item names, and refetches prices on both
edges (L1354 to L1380); `group-page.ts` and `members-page.ts` load the zone, lists and
members; `line-detail-sheet.ts` loads settlements.

## 4. Not in this plan

- Rewriting the basket stores and the list page onto `onEdge`.
- A refetch on resume for any store that lacks one.
- Marks on rows for what changed while away outside the basket (plan 0093 section 12).
- `BasketSocket` and the basket page (plan 0168 section 3).
- A batched "catch up" read in the gateway (D6).

## 5. Choices that are mine

- The name `onEdge` and its signature.
- The `LineStore` rule of D4, and leaving the choice of how the list page names its live
  list to the builder.
- The order of the table, which is also a sensible build order: platform helper, zones and
  lists, lines, memberships, the rest.

## 6. What the build decided

Built on `feat/velista-0168-socket-keeps-trying` at `61f0ddd3`, which carries the counter of
plan `0168` before that plan merged.

- **`onEdge` acts on a rise, not on any change.** The plan says "differs from the remembered
  one". The counter falls to zero on a sign out, and a sign out is not a reconnect: acting on
  it would read the account's state at the moment the session ends. A fall is remembered, so
  the first connect after it, zero to one, is a rise again. `on-edge.spec.ts` asserts both.
- **`LineStore` gained `hold(listId): () => void`.** The list page names its list to the
  realtime client through `viewList`, which `LineStore` cannot see, and its line read is
  `load`, which says nothing about how long the page stays. So the page holds the list in
  the same effect, and for the same span, as its room: one more line beside `viewList` and
  `enterZone`, released in the same `onCleanup`. Counted, like the rooms.
- **A stale list answers `idle` from `stateOf`, and keeps its rows.** `load` never served the
  cache; it always reads. The one caller that serves the cache is `loadLineContext`, which
  calls `load` only when `stateOf` is `idle`. Reporting a stale list as `idle` makes that
  caller read it, with no edit outside the scope, and keeps `watchLineGone` from taking a
  stale read as proof that a line is gone. `load`, `refresh` and `forget` clear the mark. The
  stale set is a signal, because `stateOf` is read inside computeds.
- **`ZoneStore.refresh()` reads the listing only when the dashboard loaded it**, then each
  zone whose own detail state is `loaded`, after the listing, so a detail is not overwritten
  by the summary. A deep link that loaded one group does not cause a read of every group.
- **`ListStore` reads the zones it holds rows for** (`_byZone`), not the zones whose read
  failed, so a reconnect never turns a failed zone into an empty loaded one.
- **`MembershipStore` reads every zone through a private `_reread`, not `load`** (review
  round). `load` goes back to the first page, so a members page scrolled past it lost every
  row below, and a `loadMore` in flight could lose its page. The store now counts the pages
  each zone holds (`_pages`: one on `load`, one more per `loadMore`), and `_reread` reads as
  many again, in order, under the zone's statuses, and swaps the rows, the cursor and the
  state in one write at the end, the way `MemberNames` pages. A `loadMore` that lands while
  the read runs raises the count and its page is read too; one still out counts as the
  page it will add, so the read goes that page further, and a per zone generation that the
  swap moves makes that `loadMore` drop its page instead of appending it twice. The state
  is not set to `loading`, a failure keeps the rows and is swallowed, and a zone forgotten
  or loaded again under other statuses meanwhile is left alone. It stayed contained to the
  store: two private maps and one method.
- **`MemberNames.refresh()` keeps a zone asked when its read fails**, unlike `ensure`: the
  names held are still right, and dropping the zone would let the next `ensure` read again
  for nothing.
- **`ShoppingProfileStore` reads the profiles only, through a private `_refreshProfiles`**,
  laid over the held rows with `_applyRemote`, the path a `profiles.changed` event takes. A
  field whose write is in flight keeps what was typed. Chains and coverage are not read: the
  socket does not feed them. No public `refreshProfiles` was added. The review found that
  the typed value survives through the overlay alone, so `_raw.set` passed the spec; what
  `_applyRemote` adds is that the claimed field keeps the held value under the overlay, so a
  write that then fails snaps back to what it showed before the edit, as after a live
  event. The spec pins that, and a second one sets the guards (chains failed once, a postal
  code held) so that a `load` would read chains and coverage, and asserts neither is read.
- **`ProfileStore` reads only when a profile is held**, so a reconnect on a store that never
  loaded, or whose first read failed, draws no skeleton. It reads through a private
  `_reread`, not `load` (review round): a failed `load` sets `failed` and an error even
  while a profile is held, which turned the account page's email row into its failure
  line and hid home's unverified email banner. `_reread` swallows a failure, keeps
  `loaded` and the profile, joins a read already running by skipping, and drops an answer
  that lands after a sign out.
- **The comments sheet rereads through a private `_reread`** that swallows a failure,
  because `_load` sets the error line, and an error over a readable conversation would be
  the opposite of quiet.
- **The fake `LineStore` in `testing/store-doubles.ts` gained `hold`**, since the list page
  now calls it. The double already had `setReconnects` from plan `0168`. After the review it
  records each hold and release in `holdLog`, so the list page spec asserts that the page
  holds the list it shows and releases it when it is destroyed.
- **`loadLineContext` holds its list too** (review round, outside the scope list). Line and
  list events reach `LineStore` through the zone room, so the line page and the history
  page were live before a drop. After a reconnect `_caughtUp` only marked their list stale,
  and the effect that reads the list reads `stateOf` under `untracked` once per list id, so
  the stale `idle` never caused a read: a rename or a tick made while offline stayed off
  screen until the person left. The review named it a defect of the `LineStore` rule of
  D4, so `line-context.ts` was touched: the list effect returns `lines.hold(list)` to its
  `onCleanup`, which holds the list for as long as the page shows it. Its spec runs the
  real `LineStore`.
- **Specs that a mutation could not fail were rewritten** (review round). The `onEdge`
  spec on tracking counts the effect's runs through the counter's own reads, because a
  rerun with the same counter value never calls `act`. `LineStore` has a spec for a
  release called twice beside a second holder, and one for lists whose read failed, held
  or not, which are neither read nor marked stale. `MemberNames` and the comments sheet
  each have a failed reread spec.

### The browser check (target 5)

Luna slot 4 (ephemeral, no backend slot was listening) and velista on front end slot 1, on
2026-10-23. One account, seeded over the gateway. Tab A was a headless Chromium page driven
by Playwright; tab B's actions were the same account's calls to the gateway, which raise the
same events a second tab would. The DevTools offline switch (`setOffline`) did **not** close
the websocket in headless Chromium, so the drop was made by routing the socket and closing
it, refusing reconnects while offline, with `setOffline(true)` beside it so the page saw
`navigator.onLine` fall and rise. Going back online is what re-arms the socket today; the
latch removal of plan `0168` was not on the branch yet.

- **List page.** Bread ticked while A was offline: not ticked in A. After the handshake it
  was ticked in A 51 to 62 ms later. No navigation. The rows of the list stayed drawn; the
  one skeleton seen was a `li.skeleton` in the new trip's group, the trip that the tick
  itself created, whose rows are read when it first appears, as they are for a tick that
  arrives live.
- **Home.** A list created while A was offline appeared on the group card 110 ms after the
  handshake. No skeleton, no navigation.
- **Members page.** The account renamed itself in the group while A was offline. The new
  name appeared 62 ms after the handshake. No skeleton, no navigation.
