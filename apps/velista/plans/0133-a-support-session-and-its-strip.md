> **PR:** [#725](https://github.com/IchirokuXVI/nx-portfolio/pull/725)

# 0133: a support session and its strip

> Asked for by the owner on 2026-10-07. An operator opens the app as a user to see a bug
> that happens only with the data of that user. While that lasts, a strip at the top of
> every screen says so, and nothing can put it away.
>
> **Needs backend plan `0194` first** (an operator opens the app as a user). It serves the
> exchange route, the end route, the `act` claim and the error codes named here. If its
> contract is not on your base branch, stop and say so. Admin plan `0062` is the other
> client of `0194`, and this plan does not need it.
>
> The mock is `apps/velista/plans/mocks/impersonation/`. The owner chose the strip at the
> top on 2026-10-07, with no frame round the screen. The canvas with the four placements
> that were compared is https://claude.ai/artifact/KwRJ4dV4AZbnVFjgvDhb76.
>
> Prerequisite reading: backend `0194` (all of it), velista `0067` (two documents on one
> origin), `0097` (the bar at the bottom), `0106` (the page slot scrolls), `0130` (one
> header), `libs/velista/platform/src/lib/browser-facade.ts`, `storage-keys.ts`,
> `libs/velista/data-access/src/lib/auth/token-store.ts`, `access-token-expiry.ts`,
> `libs/velista/feature-auth/src/lib/auth-callback-page/`,
> `libs/velista/ui/src/lib/layout/app-layout.html` and `app-layout.scss`.

## What the build decided

The build of 2026-10-15 follows the plan. It made the choices below, and each one is a
choice of the builder that the owner can overturn. Where this section and a later section
disagree, this section is right. Backend `0194` (PR #700) was on the base branch, and its
section 5 ("As built") is the contract this build read: `end` answers 201 `{ ended }`, a
second `end` answers 401 `impersonation_ended`, and `impersonation_code_invalid` is a 400.

**Names and files that moved since the plan was written.**

- `shop-map-page.scss` names no `100svh` any more, so target 6 had nothing to change there.
  Two rules that the plan did not name do: `reset-password-page.scss` (velista `0148`)
  and `record-page.scss` of the walk lab. Both now subtract the strip.
- Two `100svh` rules do not subtract the strip, and need not: `apps/velista/src/styles.scss`
  (the `min-height` of the document) and the host of `AppRoot`
  (`apps/velista/src/app/app-root.ts`). Both are outer frames, and the strip is drawn
  inside `AppLayout`, within them. Shortening them would leave a gap of the strip's height
  under the app.
- `impersonation_not_allowed` was already in `problem.ts` (velista `0148` added it for the
  sign in link of a reset mail). This build adds `impersonation_ended` and
  `impersonation_code_invalid`.
- The token decoder is `libs/velista/platform/src/lib/access-token-expiry.ts`, in
  `platform` and not in `data-access`. `readAccessTokenActor` is beside
  `readAccessTokenExpiry` there.
- An eye icon already exists, in `libs/velista/ui/src/lib/icons/icons.ts` (the password
  reveal uses it). It is the glyph of the mock. The strip uses it, and `libs/shared/ui`
  gets no second copy (target 5 allows this: "unless one exists there already" was read
  as "unless one exists in the app's own icon set").

**Where the state lives.**

1. **`ImpersonationState` is `providedIn: 'root'`**, and not per app as the constraints
   say. `BrowserFacade` is root, and a root service cannot read a service that the app
   provides below it. The answer is a fact about the document, and the root injector is
   one per document in both run modes. It has no `rxjs-interop`.
2. **The facade asks `ImpersonationState` lazily, once**, on its first storage call,
   because `ImpersonationState` reads its marker through the facade itself.
3. **`data-access` holds the session in `ImpersonationSession`**, provided in
   `VELISTA_DATA_ACCESS_PROVIDERS` and started by an environment initializer in
   `app-providers.ts`. It does the exchange, the handoff write, the strip's state, the
   clock and the three ends. `ui` reaches "End" through `ImpersonationState.end()`, which
   calls the handler that `data-access` registered (rule D1).
4. **The handoff page does not use `TokenStore.set`.** The document it runs in is usually
   an ordinary one, whose `TokenStore` holds the operator's own account and whose facade
   writes to `localStorage`. `ImpersonationSession.begin` writes the marker and then the
   pair to `sessionStorage` itself, then loads home with `location.replace`.
5. **An end leaves the document too.** It removes every key of this app from the tab's
   `sessionStorage` and loads `auth/support-ended` with `location.replace`. It does not
   call `TokenStore.clear()`, because a signal change would wake the guards and pages of a
   document that is about to go. The new document has no marker, so it is ordinary at once.
6. **Leftovers of an earlier session in the same tab are removed** by `begin` before it
   writes, so a second session in one tab never reads the last list of the first user.
   Only keys that name this app's key are removed, because mounted in the portfolio the
   tab's storage is the shell's origin too.

**The handoff page.**

7. It removes the fragment with `Location.replaceState(location.path(false))` as the page
   is created, before the request.
8. **A failure that is not `impersonation_code_invalid`** (no answer, a 5xx, a body it
   cannot read) draws "The support session did not open" with "Try again", which posts the
   same code again from memory. Its body names no one cause, because it covers all three.
   The plan names only the bad code and the missing code. The
   retry is not a way into the app, so the rule "no way in" still holds.
9. `OutcomeScreen` takes `actionLabel` as optional now, and draws no button without it.
   The invalid link page and the ended page use it with no action.

**Ending.**

10. "End" waits at most `IMPERSONATION_END_WAIT_MS`, 3 seconds, for the server.
11. A 401 `impersonation_ended` is answered in `gatewayInterceptor` with no refresh, in
    every tab. Only an active tab then ends. The interceptor looks the session service up
    only when that code arrives, so no ordinary request constructs it.
12. A refused refresh reaches the end through `TokenStore`, which drops the pair: the
    session's effect sees a null pair in an active tab and ends it. A pair with no `act`
    ends the same way, and so does a tab that starts with the marker and no pair.
13. The ended page carries `WORKS_WITHOUT_BACKEND`, so a session that the server's loss
    ended still says that it ended. Neither page has a guard.

**The strip.**

14. **The strip is in the column, not fixed.** It is the first item of the `AppLayout`
    frame, above `main` and outside it, so it is never inert under the tour. The frame
    stays `100svh`, and `main` (`flex: 1`) is shorter by the strip. This is "the app is
    shorter by the strip" without a `calc` on the frame. `--app-support-strip-height` is
    `0px` by default and `44px` plus the top inset while the strip is up. The strip takes
    the top inset, and `--app-safe-top` is `0px` below it, the bar's rule turned upside
    down.
15. **It stays above every cover with `--app-support-strip-z: 200`.** The covers are
    fixed at `inset: 0`, so they still draw under the strip's 44px. A spec compares the
    number with the sheet (10), the account lost panel (20), the tour (8) and the
    connection screen (100). `--app-sheet-max-height` now subtracts the strip.
16. **The tokens are in both themes**: `--app-support-strip-bg` is `--app-text-primary`
    and `--app-support-strip-fg` is `--app-surface-ground`. The border of "End" and its
    focus ring use the foreground, so one ratio in `contrast.spec.ts` covers all three.
17. **The time** is whole minutes rounded down. A whole hour reads "1 h left" and not
    "1 h 0 min left". The strip keeps its own clock and ticks when the whole number of
    minutes drops. The strip is a labelled region (`Support session`) and no live region.
18. **The copy** is under `support` in `libs/velista/ui/assets/i18n`. Spanish puts the
    verb first: "Quedan 1 h 42 min", "Queda menos de un minuto". "End" is "Terminar".

**Leaving a document, and a tab that holds two.**

- **A document that has asked to leave writes nothing more.** The old document runs on
  until the new one commits, and a refresh of `TokenStore` can land in that window. So
  after the first `BrowserFacade.replaceDocument`, every write and removal of the tab's
  `sessionStorage` does nothing, and so does a second `replaceDocument`. That covers the
  session methods, and the persisted keys of a tab that holds a support session, which
  are `sessionStorage` too. Without it, a second link opened in a tab with a live session
  could have the old pair written over the new one.
- **`localStorage` stays open after that.** In an ordinary tab the persisted keys are the
  origin's and hold the operator's own account, which the next document does not read in
  place of the tab's. A refresh of that pair which lands after the handoff page asked to
  leave has already rotated the refresh token on the server. Dropping its write would
  keep a revoked token, and the next refresh would sign the operator out (for a guest,
  lose the account).
- **While a handoff runs, the earlier session of the tab does not end the document.** An
  end that it asks for (its clock, a refusal) waits for the answer of the exchange. A good
  code goes on to `begin`. Any other answer lets the held end go ahead, and the tab lands
  on the ended page. Without the hold, an earlier session that ran out during the exchange
  would replace the handoff page after its code was spent.
- **The exchange waits at most `IMPERSONATION_EXCHANGE_WAIT_MS`, 8 seconds**, and then
  answers `failed`, so a hung request cannot hold an earlier end for ever. The held end
  then goes ahead. Eight seconds is the bound of the startup probe, the app's existing
  wait for one answer of the gateway, and it is well inside the code's 60 s life, so
  "Try again" on a page that did not end still sends a good code.
- **A duplicated tab holds the same support session.** A browser copies `sessionStorage`
  into a duplicated tab, so two tabs then hold one session. The server's refresh rules
  bound it: the refresh token rotates, so only one of the two can refresh, and both stop
  at the deadline of the session.

**The refusal (target 8).** `support.refused` is returned for `impersonation_not_allowed`
by `accountFailure` (deleting the account), `authErrorCopy` (securing a guest) and
`zoneErrorKey` (handing a group on). Resending the confirmation mail shows no refusal on
any page today (each page keeps "Ready" on a failure, by design), so a refused resend shows
nothing there either. `google/state` has no caller in velista.

**Storage doors outside the facade (target 2).** Two exist, and both are safe:

- `readAppLocale` and `writeAppLocale` in `rokutranslator-angular` (`roku-locale:velista`
  in `localStorage`). The locale guard writes the locale of the address. A support tab
  can thus set the operator's remembered language to the one the back office put in the
  link. It holds no account and no session. Moving it would change a shared library,
  which is outside this plan's scope.
- `WalkDb` in the walk lab (IndexedDB `velista-walk-lab`). It holds walks recorded on this
  device, keyed by nothing of an account, and the lab is a test tool.

**A defect outside this plan.** `luna-slot.sh` writes
`APP_BASE_URL=http://localhost:${SHELL_PORT}/{locale}/velista`, which puts the locale
before the mount, and on slot 4 it named port 4200. The link the gateway builds on a slot
thus does not open velista. The walk replaced the origin and the path and kept the code.

## Brief for the agent

### Objective

Take a handoff code from the address, trade it for the session of a user, and keep that
session inside one tab. Draw a strip above the app for as long as the session lasts, with
the name of the user, the time that is left and a control that ends it.

Use the `nx-portfolio-angular-developer`, `design-taste-frontend`, `antislop`,
`antislop-ui` and `antislop-human` skills, and read the velista UI rules in `CLAUDE.md`
before you touch a template.

### Context

Every statement below was read on `dev` at `b9eece51`.

- **The session is in `localStorage`**, under `StorageKeys.session`. `TokenStore` writes
  it there, and it follows the `storage` event: a pair that another document wrote is
  adopted, and a removal signs this document out (plan `0067`).
- **That is the trap.** An operator often has an account of their own in this browser. A
  support session written to `localStorage` replaces that account in every tab, and two
  hours later it signs every tab out.
- **`BrowserFacade` is the door to storage.** It has `readStorage`, `writeStorage`,
  `removeStorage` and `watchStorage` over `localStorage`, and the same three reads and
  writes over `sessionStorage`. Other files name storage too: `session-validation.ts`,
  `theme-store.ts`, `basket-page.ts` and `walk-db.ts` (IndexedDB). Read each one.
- **The client already decodes the access token** for its `exp`
  (`libs/velista/platform/src/lib/access-token-expiry.ts`).
- **`AuthCallbackPage`** is the one page that takes a session from the address. It reads a
  fragment, calls `TokenStore.set` and goes to home. Its route is `auth/callback` in
  `libs/velista/feature-shell/src/lib/routes.ts`.
- **`AppLayout`** is the chrome. Its `main` holds the page slot and the bar. The tour and
  the connection cover are drawn outside `main`. The whole app is `100svh` tall
  (`app-layout.scss`). `libs/velista/ui` reads state from `@portfolio/velista/platform`
  and never from `data-access` (rule D1).
- **No strip exists today** that every page shows. The guest banner belongs to home, and a
  person can put it away.

### Target state

1. **A tab knows that it holds a support session.** `sessionStorage` holds a marker under a
   new key in `StorageKeys`. A new platform service, `ImpersonationState`, reads it one
   time as the document starts. It answers `active` for the life of the document.

2. **An active tab keeps everything to itself.** While `ImpersonationState` is active,
   `BrowserFacade.readStorage`, `writeStorage` and `removeStorage` use `sessionStorage`,
   and `watchStorage` delivers nothing. So the session of the user, the last list, the
   view of the basket and every other key of `StorageKeys` live in the tab and end with
   it. The account of the operator in `localStorage` is neither read nor written. Each
   storage door that does not go through the facade is moved behind it, or the report
   names it and says why it is safe.

3. **The handoff page.** A new route `auth/impersonate`, beside `auth/callback`, with no
   guard that needs a session:
   - It reads `code` from the fragment and removes the fragment from the address with a
     replace, before any request.
   - It posts the code to `POST /v1/auth/impersonation/exchange`.
   - On success it writes the marker, then the pair through the facade, and then loads the
     home address as a new document (`location.replace`). A new document is what makes
     every store start from the storage of the tab and not from the account it held.
   - On `impersonation_code_invalid`, or with no code, it draws one sentence: the link is
     used or too old, and the operator opens a new one from the back office. It offers no
     way into the app.

4. **The state the strip reads.** `ImpersonationState` exposes a signal: `null`, or
   `{ username, until }`. `data-access` writes it from the pair: the name from
   `SessionTokens`, and `until` from the `act` claim of the access token. A pair with no
   `act` in an active tab is a defect, and the tab then ends the session (point 7).

5. **The strip.** A new presentational component in `libs/velista/ui`, drawn by
   `AppLayout` as the first thing in the document, above `main`, and only while the signal
   is not `null`:
   - 44px tall, plus the top safe area inset. Full width. One row: an eye icon, "Viewing
     as **marta_r**", the time left, and an "End" button.
   - The name takes the room that is left and ends in an ellipsis. The time and the button
     never shrink.
   - The time reads "1 h 42 min left", then "42 min left", then "Less than a minute left".
     It is worked out from `until` and the clock, and it changes on the minute.
   - Two new semantic tokens give its colours: the ground of the strip is the primary text
     colour of the theme, and its text is the ground colour of the theme. So it is dark on
     Day and light on Night, and the amber of an action is never on it. `contrast.spec.ts`
     covers the pair.
   - It has no close control, and no setting hides it.
   - It stays above every cover: the sheet scrim, the tour, the startup screen, the update
     screen and the connection cover. A press on "End" works under each of them.
   - The eye is a new icon component in `libs/shared/ui`, unless one exists there already.

6. **The app is shorter by the strip.** One custom property holds the height of the strip,
   and it is `0px` when no strip is drawn. `AppLayout` takes it from `100svh`, so the bar
   at the bottom stays on the screen and the page slot loses 44px. Every other rule that
   names `100svh` in velista takes it too, or the report says why it does not need to
   (`shop-map-page.scss`, `record-page.scss`, `apps/velista/src/styles.scss`).

7. **Ending.** Three things end the session in the tab, and all three do the same:
   - A press on "End". It first posts `POST /v1/auth/impersonation/end`, and it does not
     wait for the answer for longer than a few seconds.
   - The clock reaching `until`.
   - A 401 with `impersonation_ended`, or a refresh that the server refuses.

   The tab then removes the pair and the marker and draws the ended page: a new route
   `auth/support-ended` with one sentence ("This support session has ended. You can close
   this tab.") and no link into the app. A reload of that tab is an ordinary tab again.

8. **A refused act says why.** A 403 with `impersonation_not_allowed` shows the message
   "This cannot be done in a support session" where the page shows its other refusals.

9. **Both run modes.** The route and the strip work standalone and mounted in the shell.
   Each difference goes through `appRootRoute(mount)`.

10. **The copy**, in English and Spanish, in the translation assets of the library that
    draws it. No key, class or component carries the name of the product (rule N1).

### Scope

- `libs/velista/platform` (the key, `ImpersonationState`, the facade).
- `libs/velista/data-access` (the exchange and end calls, writing the state, the 401 and
  403 codes in the interceptor, the claim in the token decoder).
- `libs/velista/feature-auth` and `libs/velista/feature-shell` (two pages, two routes).
- `libs/velista/ui` (the strip, the tokens, `AppLayout`), `libs/shared/ui` (the icon).
- `apps/velista/plans/mocks/impersonation/` only if the built strip differs from it.

### Constraints

- **An ordinary tab does not change.** With no marker, the facade, `TokenStore` and
  `AppLayout` behave exactly as on `dev`. A spec asserts each.
- **The marker is read one time.** A document does not become active or stop being active
  while it runs. The handoff page and the ended page are the two places that write it,
  and each one leaves the document behind.
- **Rule D4.** Map the answer of the exchange from `unknown` into `SessionTokens`. Do not
  pass a backend type through.
- **No `@angular/core/rxjs-interop`** in `ImpersonationState`. It is provided per app.
- **The time is not a live region.** A screen reader hears the strip one time, as the page
  loads, and not each minute.
- **`100svh`, never `dvh`.** Raw pixels fail `token-hygiene.spec.ts`: add a token.
- **No raw `Location.back()`**, and the two new pages take no `sheet` segment.
- **The service worker is not touched.** `provideServiceWorker` stays in `app.config.ts`.

### Action boundaries

- Stop and ask before you change how an ordinary session is stored or refreshed.
- Stop and ask if a storage door cannot go behind the facade.
- Do not hide, disable or restyle any control of a page because a support session is
  active. The server decides what a session cannot do, and the page shows the refusal.
- Do not touch the backend or the admin app.

### Progress evidence

- `npx nx affected -t lint test` is green and `npx nx build velista` is green.
- A walk in a browser on a slot, through the shell and standalone, with screenshots of
  home, a list and the Shopping list tab in both themes: start a session over the gateway,
  open the link, see the strip, open a sheet and see the strip above its scrim, press
  "End", see the ended page.
- The same walk with an account of the operator signed in on a second tab: that tab keeps
  its account from start to end. Say so in the report with what you saw.

## Tests

- **The facade.** Active: a write lands in `sessionStorage` and `localStorage` is
  unchanged, and `watchStorage` never calls back. Not active: as today.
- **The handoff page.** The fragment is gone from the address before the request. A good
  code writes the marker and the pair and replaces the document. A bad code and a missing
  code draw the sentence and write nothing.
- **The time.** "1 h 42 min left", "42 min left" and "Less than a minute left" at the
  three boundaries, in both languages, under fake timers.
- **Ending.** Each of the three causes removes the pair and the marker and lands on the
  ended page. "End" still ends the tab when the request fails.
- **The strip.** It is drawn while the signal holds a value and absent otherwise. It has
  no control other than "End". `contrast.spec.ts` passes on both themes.
- **The layout.** With the strip, the height of the app is `100svh` less the strip.
- **The routes.** `routes.spec.ts` passes: the two pages carry no fall guard and no `sheet`
  segment. `app-root-route.spec.ts` passes for both mounts.

## What this plan does not do

- **It draws no frame round the screen.** The owner declined it.
- **It hides nothing from the operator.** The operator sees and can change what the user
  can, less the routes that backend `0194` refuses.
- **It does not tell the user.** No notice reaches the account that was opened.
- **It does not install.** A support session lives in a browser tab. The installed app is
  a separate document, and it keeps the account it had.
