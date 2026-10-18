> **PR:** [#760](https://github.com/IchirokuXVI/nx-portfolio/pull/760)

# 0159: a write that the network dropped is reported, not forgotten

> Asked for by the owner on 2026-10-16: "create plans to fix the most important problems from
> the recent e2e report". Finding F7.3 of `docs/reports/2026-10-16-velista-e2e-slot1.md`
> (major): a quantity change in flight when the network drops fails, the offline overlay
> comes up, and on reconnect the page reloads itself and the note "That did not save. Tap to
> try again" is gone with the reload. The person reads the old number and nothing says the
> change was lost. Also F7.9 (minor): the overlay's own icon is a lazy chunk, so it cannot
> load offline in development.
>
> Every fact below was read on `dev` at `d73a36b8` on 2026-10-16.
>
> Prerequisite reading: plan `0001` decision D6 (no offline queue in this phase),
> `libs/velista/data-access/src/lib/lines/line-store.ts:637-656` (`addQuantity`), `:1145-1192`
> (`_write`), `mutations.ts:6-9`, `connection-recovery.ts:115-142`,
> `libs/velista/platform/src/lib/reload-blocker.ts:9`, `:32-68`, `connection-state.ts:38-40`,
> `gateway-interceptor.ts:121`, `:292`, `libs/velista/ui/src/lib/layout/app-layout.ts:108-116`,
> `libs/velista/ui/src/lib/icons/icons.ts:261-273`, `apps/velista/ngsw-config.json:8-19`,
> `apps/velista/src/app/app.config.ts:43-46`, and `libs/velista/ui/assets/i18n/en.json:805`.

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code.

### Objective

A write that failed because the network was gone is named after the reconnect, on the
page where it was made, with a way to send it again. The offline overlay draws its icon
offline.

### Context

- **The failed note lives in memory only.** `addQuantity` (`line-store.ts:637-656`) is
  optimistic through `_write` (`:1145-1192`); on failure it snaps back to `before` and sets
  the note `{ outcome: 'failed' }`, "That did not save. Tap to try again" (`en.json:805`).
- **The reconnect reloads the page.** `ConnectionState.offline` is `!onLine ||
  _requestsFailing` (`connection-state.ts:38-40`), fed by `reportNetworkFailure` from the
  interceptor (`gateway-interceptor.ts:121`, `:292`). `AppLayout.coverOffline` draws the
  overlay (`app-layout.ts:108-116`). `ConnectionRecovery` probes `/health/ready` every 10 s
  and on any answer calls `reportReachable()` and then `ReloadBlocker.reloadWhenIdle()`
  (`connection-recovery.ts:115-142`). `ReloadBlocker` defers only while a component holds
  `block()` (`reload-blocker.ts:32-68`), and a failed row write holds none, so the reload
  wipes the note.
- **There is no outbox, by decision.** `mutations.ts:6-9` and `reload-blocker.ts:9` record
  plan `0001` D6. A replay of a delta is safe only when the first attempt is known not to
  have landed: `ERR_INTERNET_DISCONNECTED` before the send is safe, a timeout is not, and
  `POST /lines/:id/quantity` has no idempotency key.
- **The icon is a lazy chunk.** `OfflineIcon` imports `./offline-icon.svg?raw`
  (`icons.ts:261-273`), used in `state-panels.ts:109`, `list-header.html:79`,
  `basket-page.html:104`, `:114`, `group-summary.html:26`, `home-page.html:26`. In
  production `ngsw-config.json:8-19` prefetches `/*.js`, and every chunk of a local
  production build is in `ngsw.json`, so the failure is dev only, plus the first visit
  before the worker installs and velista mounted under the shell, which registers no
  worker.

### Target state

1. `Mutations.run`, the one choke point, records a write that failed with no response (the
   interceptor's network failure, not a 4xx or 5xx) into a small `sessionStorage` ledger:
   the page URL, a short description key with its arguments ("Pan de pueblo, +1"), and the
   replay payload when the write is a delta that never left (`lineId`, `delta`).
2. After the reconnect reload, the page named in the ledger draws one notice: "Your change
   to Pan de pueblo (+1) was not saved while you were offline", with "Send it again" when a
   replay payload exists and "Dismiss" always. "Send it again" calls `addQuantity` through
   the normal path and clears the entry. The notice is drawn once and cleared on dismiss or
   on leaving the page.
3. A write whose attempt may have landed (a timeout, or a failure after the send) is
   recorded without a replay payload, so the notice says it was not saved and offers no
   resend.
4. The offline icon is inlined at build time, like the other icons that use
   `import(...?raw)` only for size, or imported eagerly in the three components that draw it
   offline. A spec asserts the overlay draws the icon with no lazy chunk.

### Scope

- `libs/velista/data-access/src/lib/mutations.ts`, `mutations.spec.ts`, `lines/line-store.ts`,
  `line-store.spec.ts`, `connection-recovery.ts` and its spec (the reload reads nothing,
  the ledger is read by the page).
- `libs/velista/platform/src/lib/storage-keys.ts` (one new key).
- `libs/velista/feature-lists/src/lib/list-page/list-page.ts`, `.html`, `list-page.spec.ts`
  (the notice).
- `libs/velista/ui/src/lib/icons/icons.ts` and the three overlay users; `app-layout.spec.ts`.
- `libs/velista/ui/assets/i18n/en.json` and `es.json`.
- This plan file: "What the build decided" at the end and the `> **PR:**` line at the top.

### Constraints

- No outbox and no automatic replay. Plan `0001` D6 stands; the person presses "Send it
  again". A replay without an idempotency key is not safe when the first attempt may have
  landed.
- The ledger holds at most the last few entries and is cleared when read. Wrap every
  storage read and write in try/catch (a private window may refuse it).
- The notice follows the velista copy rules: what was lost, in the person's words, then
  the action. Use `Intl` for nothing here; no dates.
- Do not use `@angular/core/rxjs-interop`.

### Action boundaries

- Edit only the files in Scope. Stop and ask before you add an idempotency key to a
  gateway route, change `ReloadBlocker`, or add a retry loop.
- Start with the quantity write of the list page. If the ledger shape works there, record
  in "What the build decided" which other optimistic writes (a rename, a tick on the
  basket) should get the same treatment in a follow up, and build none of them.

### Progress evidence

- New specs, each failing before the change:
  - a quantity write that fails with a network failure before the send writes a ledger
    entry with a replay payload;
  - a write that fails after a timeout writes an entry without a payload;
  - the list page on construction with a ledger entry for its URL draws the notice, and
    "Send it again" calls `addQuantity` with the recorded delta and clears the entry;
  - the overlay draws its icon with no dynamic import.
- `npx nx run-many -t lint test -p velista/data-access velista/platform velista/feature-lists velista/ui`
  passes.
- `npx nx build velista` passes.
- One check on a slot with Playwright's offline mode repeating the F7.3 steps: after the
  reconnect reload the notice names the change and "Send it again" lands it.

## 1. Not in this plan

- An offline queue that replays by itself. It needs an idempotency key on the write
  routes first, a backend plan.
- The same notice on the basket and the line page writes. A follow up after the shape is
  proven here.

## 2. Choices that are mine

- **A ledger in `sessionStorage`, not a reload block.** Holding the reload until the note is
  seen would keep a page that cannot talk to the server on screen with stale data.
- **Resend only when the attempt never left.** The person is told the truth in every
  case, and a double increment is worse than one extra tap.

## What the build decided

- **The ledger names its page by a key, not by the URL.** An entry holds `list:<listId>`
  (`listWritesPage` in `mutations.ts`). The URL holds the locale, the mount and a possible
  `sheet` segment, and none of them says which page the change was made on. The list page
  takes its entries when it opens, and again when the list in the URL changes.
- **"Never left" is read from `navigator.onLine` as the request starts.** Angular reports
  status 0 for a request the browser refused and for one whose answer was lost, so the
  error itself cannot tell the two apart. When the browser is offline, Chrome refuses the
  request before it is sent (`ERR_INTERNET_DISCONNECTED`). That case keeps the replay. A
  `NetworkError` while the browser is online keeps none, and so does an rxjs `TimeoutError`.
  A captive portal is online by that measure, so it gets the safe answer.
- **The notice without a replay says "may not have been saved"**, with "Check the number
  before you change it again". Target state 3 says "not saved", but such a write may
  have landed, and "not saved" would then be false. The owner can change it.
- **A 4xx or a 5xx records nothing.** A response proves the network works, so no reload
  follows it, and the inline note on the row still says that the change did not save.
- **A write that lands clears the entries of its subject** (the overlay key
  `<lineId>:quantity`). Thus "Tap to try again" on the row, used before any reload,
  leaves no stale notice behind.
- **The page draws the name the row draws.** The entry holds the line's own text. The
  page puts the name it draws for the line in its place while the line is loaded.
- **The two sentences take the name and the delta directly**
  (`list.dropped.quantity.lost` and `.unsure`). They are not built from a nested
  description key, because i18next escapes each value, and a nested sentence would
  escape an `&` in a line name twice.
- **The offline icon is an eager `import()`** (`/* webpackMode: "eager" */`). Webpack puts
  the text in the chunk that holds `OfflineIcon`, and the promise resolves with no
  request. The production build shows it: the markup is in the large velista/ui chunk,
  and the share icon, the control, is still in its own 399 byte chunk. A static `?raw`
  import was tried first and broke `velista:test` in CI: the app's Jest config (and the
  shell's) has no mapping for a `?raw` path, and both are outside this plan's scope.
  The app layout spec reads the eager import off the source, because Jest has no chunks.
  The other icons keep their lazy `import()`, and the pages that draw this one were not
  touched.
- **The notice reuses the list page's `trips-failed` classes** (a sentence and quiet
  actions in one wrapping row), because `list-page.scss` is not in this plan's scope.
- **The ledger keeps 5 entries.**
- **Writes for a follow up, none of them built here:** a rename of a line (`updateLine`
  through `_write`), the approval of a line, a tick or an undo on the basket, a change
  of the quantity on the basket rows and on the line page, and the delete of a line.
  Only the quantity carries a replay that is a pure delta. For the others the notice can
  say what was lost, but a resend needs a separate check that the record still has the
  value that the write was made against.
