# 0072: an update the server insists on

> **A build the gateway refuses keeps running, and says nothing.** `0034` gave the
> deployment a floor and the client a way to hear about it, and stopped exactly there:
> a `client_too_old` refusal asks the service worker to look for a new version, and
> then the error travels on to whichever screen made the request and renders as an
> ordinary problem document. Section 9 of that plan says so in as many words. There is
> no UI.
>
> So the app a user is holding is one the server will not serve. Every request it
> makes comes back 426. If a new version is found, the reload waits for a navigation,
> and a user who is not navigating never gets one. What they see is a screen where
> nothing works and no explanation of why.
>
> `0071` gives the app a `too-old` state and puts it there at startup. This plan is
> what the app does in it: it says what is happening, it replaces itself, and it
> stops rather than reloading forever when replacing itself does not work.
>
> Prerequisite reading: `0034`, in full, and `0071` sections 3 and 4.

## 1. What exists already

`AppUpdates` (`libs/velista/platform/src/lib/app-updates.ts`) does most of this
already, for a different trigger.

- `checkNow()` asks the worker for a new version. It is called from a timer, from
  every resume, and from `gatewayInterceptor` when the gateway advertises a floor
  above this build or refuses it outright.
- `versionUpdates` filtered to `VERSION_READY` is where a reload is decided. A release
  whose `appData.critical` is true reloads through `ReloadBlocker.reloadWhenIdle()` at
  once. Everything else waits for the next `NavigationEnd`.
- `unrecoverable` reloads immediately and **bypasses `ReloadBlocker` on purpose**. The
  comment records the argument: there is nothing to protect, because the cached state
  is already broken, and waiting for a polite moment only prolongs an app that cannot
  work.

That last branch is the precedent this plan leans on. A refused build is in the same
position as a broken cache: the form behind the screen cannot be submitted, so nothing
is being protected by waiting.

Two modes have no worker at all, and both are ordinary: every development build, and
velista mounted inside the portfolio shell. `provideServiceWorker` lives in
`app.config.ts` alone (`0013` D4), so `SwUpdate.isEnabled` is false there and
`AppUpdates` returns from its constructor before subscribing to anything.

## 2. Decisions

**D1. `too-old` covers every screen, landing included.** `0071` D4 lets the landing
page render while the app is still connecting, because a landing page that shows in a
tunnel is worth having. A refused build is a different thing: it is wrong about
everything, and all four landing actions end in a request the server will not answer.
There is nothing to show, so the update screen replaces the app.

**D2. A refusal is treated as a critical release, whatever `appData` says.** The
mechanism for "replace the running app as soon as the new version is cached" already
exists and is tested. `AppUpdates` gains `demandUpdate()`, which sets the same latch
`isCriticalUpdate` sets, and calls `checkNow()`. No second reload path is written.

**D3. `0034` D7 is preserved, and this plan does not reverse it.** The reload still
happens on `VERSION_READY` and only there. A refusal still never reloads by itself,
which is what stops a client that is told it is old, in the window before the new
bundle is reachable, from reloading into the same build forever. What changes is one
thing: once a new version is genuinely cached, the reload no longer waits for a
navigation that may never come.

**D4. One reload attempt per document, recorded in `sessionStorage`.** D3 removes the
common loop but not every loop. A deployment whose floor is above its own newest build,
or a stale cache serving the old bundle back, would produce a real `VERSION_READY`, a
reload, and another refusal. The counter under `velista.update-attempt` survives the
reload of this tab and dies with the tab, which is exactly the scope of "we already
tried". A second refusal in the same tab shows the dead end screen instead of reloading.

The counter is cleared the moment `BackendReadiness` reaches `ready`, so a floor moved
later in a long lived tab gets its own attempt.

**D5. No new version is an answer, and it ends the wait.** `checkForUpdate()` resolves
`false` when the worker finds nothing. That is the honest signal for "the server
refuses this build and there is nothing newer to install", and it goes straight to the
dead end screen. As a backstop, a `VERSION_READY` that has not arrived **20 seconds**
after a check resolved `true` does the same, because a download can stall.

**D6. With no worker, the update is a plain reload.** In a development build and under
the portfolio shell there is no update channel, and a normal reload fetches a fresh
`index.html` and a fresh bundle. It is bounded by the same one attempt counter, so a
refused build cannot reload the shell's page in a loop.

**D7. The reload bypasses `ReloadBlocker`.** Same argument as `unrecoverable` in
section 1, and it holds here for a sharper reason: the form a blocker protects cannot
be submitted by a client every one of whose requests is refused. Waiting costs the user
time and saves them nothing.

**D8. The screen is not a dialog and not a banner.** It replaces the app, like the
startup screen in `0071`, and for the same reason: there is nothing usable behind it.

**D9. Nothing is signed out and nothing is cleared.** A refused build is a build
problem. The token pair stays where it is, which is what makes the reload land the user
back where they were. `0067` is the plan about how expensive it is to treat a backend
condition as a reason to forget somebody.

## 3. Reaching the state

Two ways in, and both already exist by the end of `0071`.

- **At startup**, the probe's own request is refused, because `MinClientVersionGuard`
  is a global guard and runs for `/health/ready` as well.
- **Mid session**, any request is refused. `gatewayInterceptor` already recognises
  `client_too_old` and, after `0071`, already reports it.

`AppUpdates` watches `BackendReadiness.state()` and calls `demandUpdate()` on the
transition into `too-old`. It watches rather than being called, so there is one place
that decides what the state means and it is the service that owns the worker.

## 4. The screen

One new panel in `libs/velista/ui/src/lib/home/state-panels.ts`, beside the others, with
two faces and no spinner.

| Face     | When                                  | Content                                                             |
| -------- | ------------------------------------- | ------------------------------------------------------------------- |
| Updating | `too-old`, an attempt is in flight    | Brand mark, `update.required.title`, `update.required.body`         |
| Dead end | the attempt is spent, by D4, D5 or D6 | Brand mark, `update.failed.title`, `update.failed.body`, one button |

`AppLayout` renders it in place of the outlet whenever `state() === 'too-old'`, ahead of
the startup screen and ahead of `lib-connection-lost`. Being first matters: a refused
build usually looks offline as well, because every request fails, and the update screen
is the one that tells the truth about why.

The dead end button reloads through `BrowserFacade`, once, bypassing the counter. It is
a person choosing, not the app looping.

## 5. Copy

New keys under `update` in `libs/velista/ui/assets/i18n/en.json` and `es.json`.

| Key                     | English                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `update.required.title` | velista is updating                                                                               |
| `update.required.body`  | This version is too old to talk to the server. The new one is on its way and takes a few seconds. |
| `update.failed.title`   | velista could not update itself                                                                   |
| `update.failed.body`    | Close velista completely and open it again. If that does not work, open it in your browser once.  |
| `update.failed.reload`  | Try again                                                                                         |

The updating face says what is happening rather than apologising for it, and it does not
ask the user to do anything, because there is nothing for them to do yet.

## 6. Tests

`libs/velista/platform`:

- `app-updates.spec.ts` gains seven cases. `demandUpdate()` calls `checkNow()`. A
  `VERSION_READY` after it reloads without a `NavigationEnd`. The reload does not go
  through `ReloadBlocker`. A check resolving `false` reloads nothing and marks the
  attempt spent. A second `too-old` in the same document reloads nothing. The attempt
  counter is cleared when the state reaches `ready`. With `SwUpdate.isEnabled` false
  the plain reload path runs once and only once.
- A spec that asserts `0034` D7 still holds: neither the advertised floor header nor a
  `client_too_old` refusal reloads anything on its own.

`libs/velista/ui`:

- `app-layout.spec.ts`: `too-old` renders the update screen over landing as well
  (D1), and wins over both the startup screen and `lib-connection-lost`.
- The panel's own spec: the two faces, and the dead end button reloading once.

## 7. Build order

1. `demandUpdate()` and the attempt counter in `AppUpdates`, with specs. Nothing renders
   yet, and the behaviour is already correct.
2. The no worker branch (D6).
3. The panel and the copy in both locales.
4. `AppLayout` rendering it, and the precedence in section 4.

## 8. What this deliberately does not do

- **No grace period.** Moving `MIN_CLIENT_VERSION` retires every older client at once,
  including one in the middle of a shop. That is the point of the floor and `0034` 6b
  says so, and an operator moving it is making that choice deliberately.
- **No progress bar.** The worker reports no download progress that is worth showing,
  and a bar that does not move is worse than a sentence.
- **No version numbers on the screen.** `lib-app-version` already puts the build on the
  landing page for support, and a user reading "you are on 1.4.2, the floor is 1.5.0"
  learns nothing they can act on.
- **No store link.** velista is installed from the browser, not from a store, so
  "update the app" has no destination to send anybody to.
- **No realtime enforcement.** Unchanged from `0034` section 9: the socket carries no
  client version, and a refused build finds out on its next REST call, which is
  immediate.

## 9. Acceptance criteria

1. A build below the floor shows the update screen at startup, over every route
   including landing, rather than the connecting screen.
2. When a newer version is cached, the app reloads itself without waiting for a
   navigation, and comes back signed in.
3. When there is no newer version, the app stops on the dead end screen and does not
   reload.
4. A refused build that reloads and is refused again stops on the dead end screen. It
   does not reload a second time.
5. Under the portfolio shell and in a development build, the same states appear and the
   single reload attempt is a plain page reload.
6. Nothing in this plan reloads on a refusal alone. `0034` D7 still holds.
