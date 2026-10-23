# 0168: the socket keeps trying, and the header says so

> Asked for by the owner on 2026-10-23, after the Android app of plans 0166 and 0167: "Let's
> try to first make the user reconnect to the socket and reload info that could have changed
> on the page without a reload. (...) It's important to show the user that he lost
> connection, but without interfering too much with the screen. A quiet message on the header
> or an icon is perfect (I think an icon is better). It only needs to be shown if connection
> is lost or is reconnecting. Right now I think the socket connection is already recovered
> but it doesn't seem to work fine. Specially after turning off the screen, sometimes it
> doesn't reconnect correctly on my phone (Pixel 10a)."
>
> This is the first half: the socket comes back by itself, every time, and the header carries
> one quiet mark while it is away. Plan `0169` is the second half: the stores that mirror
> server state read again after a reconnect. This plan opens the one contract `0169` needs
> (`reconnects`) and nothing else of it.
>
> Every fact below was read on `feat/velista-capacitor-android` at `e5320be3` on 2026-10-23.
> The evidence, three traces from the API 37 emulator with line references, is
> `docs/reports/2026-10-23-velista-socket-reconnect-on-android.md`. Read it first; its section
> 3.3 is the owner's bug caught in the act.
>
> Prerequisite reading: plan `0016` section 6 (rules R1 to R10 of the transport), plan `0035`
> (the resume, and section 5 for the colour and the mark), plan `0004` section 3.2 (`ui` may
> read `platform`, never `data-access`) and section 8 (`ConnectionState`), plan `0130` (one
> header, rules H1 to H6), plan `0002` section 4.4 (no yellow warning role),
> `libs/velista/data-access/src/lib/realtime/realtime-socket.ts`, `realtime-client.ts`,
> `realtime-memory.ts`, `socket-factory.ts`, `realtime-socket.spec.ts`,
> `libs/velista/platform/src/lib/app-resumed.ts`, `browser-facade.ts` (the `visible` and
> `onLine` signals), `connection-state.ts`, `libs/velista/ui/src/lib/layout/page-header.*`,
> `libs/velista/ui/src/lib/list/list-header.*`, `libs/velista/feature-home/src/lib/home-page/home-page.html`
> (L14 to L28), `libs/velista/feature-lists/src/lib/list-page/list-page.ts` (L585 to L587).

## Brief for the agent

Load the `nx-portfolio-angular-developer` skill before you write code. Load `antislop` and
`antislop-copywriting` before you write any copy.

### Objective

The realtime socket of velista never gives up: it retries with a capped backoff for as long
as a session exists and the page is visible, it makes no attempt while the page is hidden,
and on a resume after a long absence it drops the socket it holds and opens a new one at
once. The connection state reaches `platform` as a three valued phase, and `PageHeader`
draws one quiet mark on every page while the socket has been down for more than a moment.
The client exposes a `reconnects` counter that plan `0169` will consume. Nothing here reads a
browser global outside `BrowserFacade`, and nothing runs at module load, so the app stays
server renderable.

### Context

- **Two failures and it stops.** `realtime-socket.ts` L42 (`MAX_CONSECUTIVE_FAILURES = 2`),
  L401 to L421 (`_onAttemptFailed` latches `degraded`) and L276 (`_start` returns while
  `degraded`). The latch clears only through `retry()` (L260), which the `online` edge (L168
  to L178) and the resume edge (L187 to L192) call. The UI never calls it.
- **Both attempts are spent while hidden.** On Android 15 and later the system cuts the
  app's network within a second of the activity stopping (report section 2:
  `dumpsys netpolicy`, "Uids transitioning to background: UID=10237, +556ms"). In all three
  traces the socket closed one to five seconds after `visibilitychange` said hidden, the one
  retry failed with `ERR_NAME_NOT_RESOLVED`, and `degraded` latched before the screen came
  back (report 3.1 to 3.3).
- **The wake can fail too, and then nothing re-arms.** Report 3.3: on the wake, the two
  attempts failed 130 ms apart with `ERR_INTERNET_DISCONNECTED` because the radio came back a
  second later; only the `online` event, which airplane mode had made possible, cleared the
  latch. A phone whose `navigator.onLine` never changed gets no `online` event and stays
  stale until the next screen off. That is the owner's bug.
- **A held socket blocks `retry()`.** `_start` returns when `_socket !== null` (L276). The
  class cannot ask a socket whether it is alive, so a dead one is noticed only when the
  engine's heartbeat timer expires, 45 s after the last server ping (handshake:
  `pingInterval 25000, pingTimeout 20000`).
- **The resume is already observed.** `AppResumed.resumes()` (`app-resumed.ts`) counts the
  hidden to visible edge of `BrowserFacade.visible` (`browser-facade.ts` L57, fed by
  `visibilitychange` at L89) and `pageshow` with `persisted`. The WebView fires
  `visibilitychange` on screen off and on wake (report section 2), so no native plumbing is
  needed.
- **`degraded` has no reader.** No file under `libs/velista` outside the transport, the
  memory client and the doubles reads `degraded()`. `RealtimeMemory.setDegraded`
  (`realtime-memory.ts` L140) exists for specs that assert it.
- **The mark exists on one page.** `home-page.html` L20 to L28 draws `OfflineIcon` inside
  `[pageHeaderActions]` behind `!connected()`, with the key `connection.notLive` ("Live
  updates are off"). The list header draws a band (`list-header.html` L78 to L82, key
  `list.header.notLive`) behind `!live`, and the list page computes `live` as
  `connected() && !refusedZones().has(zoneId)` (list-page.ts L585 to L587), so the band
  appears on a plain disconnect too. The group page's `stale` reads `staleZoneIds`, which is
  refusal only.
- **`ui` already reads platform state.** `app-layout.ts` L88 injects `ConnectionState` to
  draw the blocking screen; `ConnectionState` (`connection-state.ts`) holds state and does
  no HTTP, which is why it may live in `platform` (plan 0004, section 8). The same shape
  carries the socket phase.
- **`connected` is false for the first second of every cold start**, so a mark bound to it
  flashes on load. It is also false during the 250 ms of an ordinary resume reconnect
  (report 3.1).
- **`BasketSocket` is a second socket** (`basket-socket.ts`), for the basket page and
  share link guests. It has the same two failure latch (its own `_failures`) and its own
  `reconnects` counter (L165). It is **not** in this plan (section 3), and its page notices
  stay as they are.
- `PageHeader` (`page-header.html` L22 and L29) projects `[pageHeaderIcon]` and
  `[pageHeaderActions]`, holds one block size (H1), and never loads (H6).

### Target state

1. **No latch.** `RealtimeSocket` retries for as long as `_tokens.hasSession()` holds, with
   the backoff it has today (full jitter under a ceiling that doubles from 1 s to a cap of
   30 s) and no upper bound on attempts. `MAX_CONSECUTIVE_FAILURES`, `_degraded` and the
   `degraded` signal go. `_failures` stays as the backoff exponent and resets through
   `_markHealthy` exactly as today (an acknowledged ask, or `HEALTHY_AFTER_MS` of life).
2. **Nothing while hidden.** When `BrowserFacade.visible()` is false the retry timer is
   cleared and no new attempt is scheduled: `_onAttemptFailed` records the failure and
   returns, `_start` returns. On the visible edge the client attempts at once, with the
   backoff exponent reset to zero. Use the resume effect that exists (L185 to L192) for the
   edge; do not add a second visibility listener.
3. **A long absence means a dead socket.** The socket records when the page went hidden.
   On a resume, if the page was hidden for longer than `STALE_AFTER_HIDDEN_MS` (45 000, the
   handshake's `pingInterval + pingTimeout`, with a comment saying so) and a socket is held,
   it disconnects that socket under the current generation rules (so its `disconnect` event
   schedules nothing) and connects a new one at once. A shorter absence keeps the socket and
   lets the heartbeat decide, as today.
4. **`reconnects` on the interface.** `RealtimeClientI` gains
   `readonly reconnects: Signal<number>`: zero until the first `connect` of a session,
   incremented on every later `connect` of the same session, reset to zero by `_stop`. Its
   doc comment says why it is a counter (the `AppResumed.resumes` and
   `BasketSocket.reconnects` reason: an edge cannot be read from a boolean) and that rooms
   are rejoined, not replayed, so a consumer that mirrors server state reads again on it.
   `RealtimeMemory` gains a `setReconnects(count)` for specs. `degraded` leaves the interface,
   `RealtimeMemory` and the doubles in `libs/velista/data-access/src/lib/testing/`.
5. **The phase reaches platform.** A new root service `LiveConnection` in
   `libs/velista/platform/src/lib/live-connection.ts`, exported from the barrel, with
   `readonly phase: Signal<'off' | 'down' | 'up'>` (default `'off'`),
   `report(phase): void`, and `readonly attention: Signal<boolean>`, true when the phase has
   been `'down'` for longer than `ATTENTION_AFTER_MS` (2 000) and false the moment it is
   `'up'` or `'off'`. The delay is a timer started in `report` and only in the browser
   (`BrowserFacade.isBrowser`), cleared on `DestroyRef`. `RealtimeSocket` reports: `'off'`
   from `_stop` and when `_start` returns for no session or no browser; `'down'` from
   `_start` when it decides to connect, from `_onConnectionLost`, and from the hidden pause;
   `'up'` from `_onConnected`. While hidden the phase is `'down'` and the timer still runs;
   that is fine, because nobody is looking, and it means the mark is already there on the
   first frame of a resume after a long absence, which is the honest state.
6. **One mark, in `PageHeader`.** `PageHeader` injects `LiveConnection` and, while
   `attention()` is true, draws a `span.live-mark` with `role="img"` and
   `[attr.aria-label]="'connection.reconnecting' | rokuT"` holding `OfflineIcon` with
   `aria-hidden="true"`, at the right end immediately before the projected actions. Colour
   `--app-status-attention-fg`, size the icon as the action icons are, no press behaviour,
   no change to the header's block size (H1) and no change for a page that projects no
   actions. The home page's own mark (`home-page.html` L14 to L28) and its `connected`
   field (home-page.ts L273) go. Keys `connection.reconnecting` in `en.json` and `es.json`:
   English "Reconnecting live updates", Spanish "Reconectando las actualizaciones en directo"
   (improve the words if the copy skill says so; keep them short, they are an accessible
   name).
7. **The list band is for refusals.** The list page passes
   `live: !this._realtime.refusedZones().has(zoneId)` (list-page.ts L585 to L587), so the
   band in `list-header.html` draws only when the zone room was refused, which the header
   mark cannot say. Update the comment beside it and the `list.header.notLive` doc if one
   exists. The basket page's notices (`basket-page.html` L108 to L121) are not touched.
8. **Specs.**
   - `realtime-socket.spec.ts`: ten failures in a row still schedule an eleventh attempt and
     the ceiling stops at 30 s; a failure while `visible` is false schedules nothing; the
     visible edge attempts at once; a resume after 46 s hidden disconnects the held socket
     and opens a new one, and one after 30 s hidden does not; `reconnects` is 0 after the
     first connect, 1 after the second, 0 after sign out; the spec that asserted the
     `degraded` latch is replaced, not deleted silently (say so in its describe).
   - `live-connection.spec.ts`, new: `attention` stays false for 1 999 ms of `'down'` and is
     true at 2 000; `'up'` clears it at once; `'off'` never raises it; nothing runs when
     `isBrowser` is false.
   - `page-header.spec.ts`: the mark is present with its accessible name when
     `attention` is true, absent when false, and the header's height does not change.
   - The list header spec: the band draws for a refusal and not for a plain disconnect.
   - `realtime-memory` and every spec that called `setDegraded` compile and pass.
9. **Emulator verification**, with the staging APK built with `VELISTA_NATIVE_DEBUG=1`
   (`apps/velista/README.md`, "The Android app") and the scripts under
   `apps/velista/scripts/android-reconnect/` (the report's section 3 explains the traces).
   Run the three scenarios listed at the top of `scenario.sh` with `ws-monitor.mjs`
   attached, and one more: screen off, wait 20 s, airplane on, wait 60 s, screen on, wait
   10 s, airplane off (the network comes back ten seconds **after** the wake, with no
   `online` event guaranteed). In every run the trace must show no attempt while hidden
   after the first close, a reconnect within a few seconds of the network being usable,
   and `STATE ... mark:false` within three seconds of the handshake. Put the four trace
   files under `dist/` and quote the decisive lines in "What the build decided".

### Scope

- Work only in: `libs/velista/data-access/src/lib/realtime/**`,
  `libs/velista/data-access/src/lib/testing/**`, `libs/velista/data-access/src/index.ts`,
  `libs/velista/platform/src/lib/live-connection.ts` and its spec,
  `libs/velista/platform/src/index.ts`, `libs/velista/platform/README.md` (one paragraph),
  `libs/velista/ui/src/lib/layout/page-header.*`, `libs/velista/ui/src/lib/list/list-header.*`
  (comments and spec only), `libs/velista/ui/assets/i18n/en.json` and `es.json`,
  `libs/velista/feature-home/src/lib/home-page/home-page.html` and `.ts` (removal only),
  `libs/velista/feature-lists/src/lib/list-page/list-page.ts` (L585 to L587 and its
  comment only), `apps/velista/README.md` (a short paragraph pointing at the probe scripts).
- Do not touch: `basket-socket.ts`, `basket-store.ts`, any other store, `connection-recovery.ts`,
  `connection-state.ts`, `app-resumed.ts`, `browser-facade.ts`, `package.json`, the Android
  project, `capacitor.config.ts`, anything under `apps/luna-shopper-backend`, and any file of
  another app.

### Constraints

- Angular 21, zoneless, standalone components, signals. `inject()`, `input()`, `DestroyRef`,
  hand written signals and subscriptions in services, **no `@angular/core/rxjs-interop`** in
  `data-access` or `platform` (CLAUDE.md, locale routing section; `realtime-socket.ts` L63 to
  L68 say why).
- No new npm dependency. No import of `socket.io-client` outside `socket-factory.ts`; the
  `SocketLike` surface does not grow (section 1, D3 explains why it need not).
- SSR rules of plan 0166 section 2 bind every line: no browser global outside
  `BrowserFacade`, timers only behind `isBrowser`, defaults that behave as the web app.
- Copy goes through RokuTranslator keys, never literals in templates. No inline colour; the
  mark uses the `attention` tokens of plan 0035 section 5.2.
- Prose in files has no dashes as punctuation (the owner's rule).
- Only make the changes this plan names. No feature, refactor or abstraction beyond them.
  In particular: do not make the stores read again on `reconnects`; that is plan 0169.

### Action boundaries

- Proceed with reversible, in scope edits, specs, lint, builds, APK builds and emulator runs.
- Stop and ask before adding a dependency, changing `SocketLike`, touching `BasketSocket`,
  changing a route table, or editing a file outside the listed scope.

### Progress evidence

Report when a numbered target is done, and at the end. Ground each claim in a tool result:
the spec run, the lint run, the build output, the trace lines. Name every decision you had
to take that the plan did not settle, in the section "What the build decided" at the end of
this file.

## 1. Decisions

- **D1. Retry without end, never while hidden.** The latch was written for one case: a
  server that answers a bad token by disconnecting in silence, against which no retry
  succeeds (realtime-socket.ts L54 to L60). That case is already contained one step earlier:
  `_connect` awaits `ensureFreshToken()` before every attempt, and a refresh the server
  answers with a rejection clears the session, which stops the loop through R1. What is left
  is a token the gateway accepts and the realtime service refuses, and against that an
  attempt every thirty seconds is a bounded, harmless cost. The latch, on the other hand,
  is the owner's bug. Pausing while hidden is what stops the attempts being spent where they
  cannot succeed, and it is also cheaper for the phone.
- **D2. The resume is the re-arm, and after 45 s it is a reconnect.** Plan 0035 section 4.2
  kept a held socket on resume because against a healthy one `retry()` is free. The traces
  show the socket is never healthy after a screen off on Android, and a desktop tab that
  was hidden for minutes has had its timers throttled to one a minute, so its pongs were
  late and the server dropped it. The one case a 45 s rule gets wrong, a tab that was
  hidden but kept its socket alive, costs one resubscribe cycle. The case the old rule gets
  wrong costs up to 45 s of a stale screen with no mark on it.
- **D3. No heartbeat check through the engine.** `socket.io-client` can say whether its
  heartbeat has expired (`engine._hasPingExpired()`, which `Socket.emit` consults). It is a
  private member of a dependency and the `SocketLike` interface exists precisely so that no
  such member crosses into the transport. The hidden clock of D2 answers the same question
  from this side of the boundary, with no engine import and a spec that runs on fake timers.
- **D4. `degraded` goes.** Nothing reads it, and with D1 it has no meaning. Keeping a
  signal with no reader and no meaning is how the next person reintroduces the latch.
- **D5. The phase lives in `platform`, like `ConnectionState`.** `PageHeader` is in `ui`,
  which may not import `data-access` (plan 0004, section 3.2), and rule D1 says a `ui`
  component takes inputs rather than stores. The precedent that wins is `ConnectionState`:
  state that `ui` must draw from every screen, written by `data-access`, held in `platform`
  with no HTTP in it. Threading a `[live]` input through every page that draws a header is
  the alternative, and it is twenty edits that each page can forget.
- **D6. One mark, two seconds late.** The owner asked for a quiet icon shown only when the
  connection is lost or reconnecting. A mark bound to `connected` flashes on every cold
  start and on every ordinary resume (250 ms). Two seconds of `'down'` is longer than any
  healthy reconnect in the traces and shorter than a person's patience. The mark disappears
  the instant the socket is up, with no delay in that direction.
- **D7. The list band says what the mark cannot.** Plan 0035 section 5.3 drew the two as
  different sentences: the mark is about the connection, the band about this list. With the
  mark on every header the band on a plain disconnect is a second sentence for the same
  fact, and it moves the list down, which is the interference the owner does not want. A
  refused room is still only the band's to say.
- **D8. `reconnects` is the contract with plan 0169, and this plan ships it unused.** The
  counter is five lines and a comment, and it is the shape the basket socket already has.
  Shipping it here lets 0169 be built against a merged interface rather than a branch.

## 2. SSR rules that bind this plan

The rules of plan 0166 section 2 apply unchanged. Two of them bite here: the attention timer
of `LiveConnection` starts only when `BrowserFacade.isBrowser` is true, and the phase defaults
to `'off'` so a server render draws no mark.

## 3. Not in this plan

- The stores reading again on `reconnects` (plan 0169).
- `BasketSocket`: its latch, its hidden behaviour and the basket page's notices. It is a
  second transport with its own plan history (velista 0090 and after); it should receive D1
  and D2 in a plan of its own once this one has been through a phone.
- `ConnectionRecovery` probing `/health/ready` every ten seconds while hidden (report 3.3).
  Harmless and out of scope; worth a line in that plan.
- A native `appStateChange` listener as a second source for `AppResumed`. The WebView's
  `visibilitychange` was reliable in every run; add the listener only if a phone shows a
  resume the page did not see.
- A manual control that reconnects or reloads. The owner asked for the automatic path first.
- Google sign in, on hold by the owner's decision of 2026-10-23.

## 4. Choices that are mine

- The names `LiveConnection`, `phase`, `attention`, `report`, `reconnects`,
  `STALE_AFTER_HIDDEN_MS`, `ATTENTION_AFTER_MS`, the class `live-mark`, the key
  `connection.reconnecting`.
- 45 s for the stale rule and 2 s for the mark.
- The mark's place at the right end before the actions, and its reuse of `OfflineIcon` and
  the `attention` colour, rather than a new glyph.
